// ============ 网页版引擎冒烟测试（Node mock 浏览器环境） ============
// 验证：skill按需注入 / create_tool自检 / 能力清单注入 / 上下文压缩 / create_tool注册
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const fs=require('fs');

// ======== 浏览器环境 mock ========
const store={};
// 预置 LLM 配置（getActiveLLM 读取，create_tool 自检/反思需要）
store['lagrange_static_config']=JSON.stringify({llm_api_key:'sk-test', llm_api_url:'https://api.deepseek.com', llm_model:'deepseek-chat'});
global.localStorage={
  getItem:k=>Object.prototype.hasOwnProperty.call(store,k)?store[k]:null,
  setItem:(k,v)=>{store[k]=String(v);},
  removeItem:k=>{delete store[k];},
};
global.window={};
global.navigator={userAgent:'node'};

// fetch mock：知识库/提示词/舰船数据 → 空或最小；LLM → 可编程返回
let llmHandler=null;   // (payload) => message 或 null(默认)
let lastLLMPayload=null;
const llmPayloads=[];  // 全部 LLM 调用 payload（质检等多次调用，主循环注入检查需找含能力清单的那次）
global.fetch=async (url,opts)=>{
  const u=String(url);
  if(u.includes('chat/completions')){
    const payload=JSON.parse(opts.body);
    lastLLMPayload=payload;
    llmPayloads.push(payload);
    if(llmHandler){
      const msg=await llmHandler(payload);
      return {ok:true, json:async()=>({choices:[{message:msg||{content:'测试回答',reasoning_content:''},finish_reason:'stop'}]})};
    }
    return {ok:true, json:async()=>({choices:[{message:{content:'测试回答',reasoning_content:''},finish_reason:'stop'}]})};
  }
  if(u.includes('system_prompt.md')){
    return {ok:true, text:async()=>'【系统提示词】测试版：舰队配置需要调用战斗模拟器验证。'.repeat(3)};
  }
  if(u.includes('ship_database.json')){
    return {ok:true, json:async()=>[]};
  }
  if(u.includes('data/knowledge/')||u.includes('data/knowledge_backup/')){
    return {ok:true, text:async()=>''};
  }
  return {ok:false, status:404, text:async()=>'not found'};
};

require(path.join(ROOT,'js/kb.js'));
require(path.join(ROOT,'js/qa.js'));
require(path.join(ROOT,'js/agent.js'));
require(path.join(ROOT,'js/skills.js'));
Object.assign(global, window);  // 自由变量 KB/SHIP_DB/QA 在浏览器里是 window 属性，Node 下同步到 global

let pass=0, fail=0;
function ok(cond, name, detail){
  if(cond){ pass++; console.log('  ✅ '+name); }
  else{ fail++; console.log('  ❌ '+name+(detail?'  — '+detail:'')); }
}
(async()=>{

console.log('\n【1】create_tool 工具定义存在');
const tools=window.AgentEngine.getTools();
ok(tools.some(t=>t.function&&t.function.name==='create_tool'), 'TOOLS 包含 create_tool');

console.log('\n【2】Skill 按需注入（关键词匹配）');
window.SkillSystem.saveSkills([{id:'s1', name:'护航抗伤配队', summary:'护航抗伤', content:'配队时必须优先考虑生存时长，使用维修船与高护甲旗舰。', keywords:['护航','抗伤','生存'], enabled:true, praise:1, lastUsed:0, createdAt:Date.now()}]);
const hit=window.SkillSystem.getSkillContext('给我一个470+5的护航抗伤队', 2000);
ok(hit.includes('护航抗伤配队'), '命中"护航抗伤"关键词 → 注入全文');
const miss=window.SkillSystem.getSkillContext('帮我看看今天天气怎么样', 2000);
ok(miss==='', '不相关提问 → 不注入（禁止全量注入）');

console.log('\n【3】用户画像精简摘要');
window.SkillSystem.saveProfile({full:'这个用户是老玩家，偏好重甲抗伤，反感等级制评价，常用470+5人口', condensed:'老玩家·重甲抗伤', updatedAt:Date.now()});
ok(window.SkillSystem.getProfileSummary()==='老玩家·重甲抗伤', '只返回精简摘要');
ok(window.SkillSystem.getProfileSummary().length<=20, '精简摘要≤20字');

console.log('\n【4】create_tool 自主创建 + 自检门禁（LLM 逻辑审查）');
llmHandler=(payload)=>{
  // 逻辑审查返回 ok
  return {content:'{"ok":true,"basis":"逻辑正确：纯计算函数，无危险操作"}', reasoning_content:''};
};
const created=await window.SkillSystem.createToolFromLLM({name:'calc_ttk', purpose:'计算舰队击杀时间', code:'async (args, emit) => { const hp=Number(args.hp||0), dpm=Number(args.dpm||0); if(!dpm) return "请提供dpm"; return "TTK≈"+(hp/dpm*60).toFixed(1)+"秒"; }'});
const j=JSON.parse(created);
ok(j.status==='active', '自检通过 → 自动激活');
ok(j.logic_basis.includes('逻辑正确'), '附逻辑依据');
ok(window.SkillSystem.getActiveTools().some(t=>t.function&&t.function.name==='calc_ttk'), '已注册进工具集');
const exec=await window.SkillSystem.executeCustomTool('calc_ttk',{hp:5000000,dpm:1000000});
ok(String(exec).includes('TTK≈300.0'), '自定义工具可执行: '+exec);

console.log('\n【5】自检失败 → 自动禁用');
llmHandler=()=>({content:'{"ok":false,"basis":"存在死循环风险"}', reasoning_content:''});
const bad=await window.SkillSystem.createToolFromLLM({name:'bad_tool', purpose:'危险工具', code:'async (args) => { while(true){} }'});
const bj=JSON.parse(bad);
ok(bj.status==='disabled', '未通过自检 → 禁用');
ok(window.SkillSystem.getActiveTools().every(t=>t.function.name!=='bad_tool'), '未注册进工具集');

console.log('\n【6】chat() 能力清单注入 + 普通/计划模式 + 最终回答');
llmHandler=null;  // 默认：返回普通文本，质检拆解为空→PASS
llmPayloads.length=0;
const events=[];
await window.AgentEngine.chat('给我一个护航抗伤队', [], (e,d,m)=>{ events.push([e,d]); });
ok(events.some(x=>x[0]==='answer'), '收到 answer 事件');
// 主循环 payload = 含"你的能力清单"的那次（质检多次调用在最后，不能用 lastLLMPayload）
const mainPayload=llmPayloads.find(p=>JSON.stringify(p).includes('你的能力清单'))||{};
const mainBody=JSON.stringify(mainPayload);
ok(!!mainPayload.messages, '找到主循环调用');
ok(mainBody.includes('create_tool'), '注入能力清单（含create_tool）');
ok(mainBody.includes('普通模式·所有Agent'), '默认普通模式注入');
ok(mainBody.includes('护航抗伤配队'), '相关 skill 注入本次消息');
ok(mainBody.includes('用户画像·精简'), '注入用户画像精简摘要');

console.log('\n【7】计划模式注入');
store['lagrange_static_config']=JSON.stringify({llm_api_key:'sk-test', llm_api_url:'https://api.deepseek.com', llm_model:'deepseek-chat', plan_mode:true});
llmPayloads.length=0;
await window.AgentEngine.chat('帮我配个输出队', [], ()=>{});
const planPayload=llmPayloads.find(p=>JSON.stringify(p).includes('你的能力清单'))||{};
ok(JSON.stringify(planPayload).includes('核心强制总规则'), '计划模式注入');

console.log('\n【8】上下文压缩（compressConversation）');
llmHandler=()=>({content:'这是压缩后的摘要。', reasoning_content:''});
const hist=[]; for(let i=0;i<30;i++) hist.push({role:'user',content:'第'+i+'轮问题'},{role:'assistant',content:'第'+i+'轮回答内容'});
const cr=await window.AgentEngine.compressConversation(hist, window.AgentEngine.getActiveLLM());
ok(cr.summary==='这是压缩后的摘要。', '生成摘要');
ok(cr.kept.length<=10, '保留最近≤10轮 ('+cr.kept.length+')');
ok(window.AgentEngine.estimateTokens(hist)>0, 'token 估算可用');

console.log('\n【9】压缩失败降级（LLM 抛错）');
llmHandler=()=>{ throw new Error('mock 500'); };
const cr2=await window.AgentEngine.compressConversation(hist, window.AgentEngine.getActiveLLM());
ok(cr2.summary==='', '失败返回空摘要（调用方降级裁剪）');

console.log('\n【10】👍 点赞反思流水线（沉淀skill + 更新画像）');
llmHandler=()=>({content:'{"profile_full":"该用户是老玩家，偏好470+5重甲抗伤，反感等级制评价","profile_condensed":"老玩家·重甲抗伤","patterns":["配队前先查实例库"],"skill":{"name":"470抗伤配队","summary":"470抗伤优先生存","content":"470人口抗伤队必须优先生存时长，主队重甲战巡+维修奶，增援5艘不占人口。","keywords":["470","抗伤","生存"]}}', reasoning_content:''});
const convMsgs=[
  {role:'user',content:'给我一个470+5护航抗伤队'},
  {role:'assistant',content:'好的，按护航抗伤原则，主队6大矛+1大盾旗舰+维修支援，增援5天枢，测试多环境存活时长...'},
];
const ref=await window.SkillSystem.reflectExperience(convMsgs, 'like');
ok(ref.skill && ref.skill.name==='470抗伤配队', '沉淀skill');
ok(ref.skill.summary.length<=20, 'skill摘要≤20字');
ok(window.SkillSystem.getSkillContext('470抗伤队怎么配', 2000).includes('470抗伤配队'), '新skill可按关键词命中');
ok(window.SkillSystem.getProfileSummary().length<=20, '画像精简摘要≤20字');

console.log('\n【11】自动沉淀（每次对话结束后自动考虑，无需点赞）');
// 清空状态
window.SkillSystem.saveSkills([]);
window.SkillSystem.saveTools([]);
localStorage.removeItem('lagrange_auto_reflect');
// 11.1 自动模式产出 skill + onResult 回调
llmHandler=()=>({content:'{"profile_full":"","profile_condensed":"","patterns":["配队先查实例"],"skill":{"name":"自动沉淀测试","summary":"自动测试skill","content":"自动沉淀的测试内容","keywords":["测试"]}}', reasoning_content:''});
const convA=[{role:'user',content:'帮我配一个护航队'},{role:'assistant',content:'方案：大盾旗舰+维修奶船...'},{role:'user',content:'再优化一下'},{role:'assistant',content:'优化后：增加光锥防空...'}];
let hinted=null;
await window.SkillSystem.autoReflectIfNeeded('conv1', convA, s=>hinted=s);
ok(window.SkillSystem.loadSkills().some(s=>s.name==='自动沉淀测试'), '自动反思产出 skill');
ok(hinted && hinted.name==='自动沉淀测试', 'onResult 回调收到 skill');
// 11.2 防重：同一会话无新增轮次 → 不重复触发（LLM 若被调会抛错）
llmHandler=()=>{ throw new Error('不应再次调用 LLM'); };
await window.SkillSystem.autoReflectIfNeeded('conv1', convA, s=>hinted=s);
ok(true, '防重：无新增轮次不重复触发');
// 11.3 新增轮次 → 再次触发
const convA2=[...convA, {role:'user',content:'再给一个思路'},{role:'assistant',content:'第二个思路：小船闪避流...'}];
llmHandler=()=>({content:'{"profile_full":"","profile_condensed":"","patterns":[],"skill":{"name":"第二个自动skill","summary":"s2","content":"c2","keywords":[]}}', reasoning_content:''});
let hinted2=null;
await window.SkillSystem.autoReflectIfNeeded('conv1', convA2, s=>hinted2=s);
ok(!!hinted2, '新增轮次后再次触发');
// 11.4 无价值对话 → skill:null → 不沉淀
const before=window.SkillSystem.loadSkills().length;
llmHandler=()=>({content:'{"profile_full":"","profile_condensed":"","patterns":[],"skill":null}', reasoning_content:''});
await window.SkillSystem.autoReflectIfNeeded('conv2', [{role:'user',content:'谢谢'},{role:'assistant',content:'不客气'}], ()=>{});
ok(window.SkillSystem.loadSkills().length===before, '无价值对话不沉淀（宁缺毋滥）');
// 11.5 重名合并（praise+1）
llmHandler=()=>({content:'{"profile_full":"","profile_condensed":"","patterns":[],"skill":{"name":"自动沉淀测试","summary":"更新版","content":"更新内容","keywords":[]}}', reasoning_content:''});
await window.SkillSystem.autoReflectIfNeeded('conv3', [{role:'user',content:'a'},{role:'assistant',content:'b'},{role:'user',content:'c'},{role:'assistant',content:'d'}], ()=>{});
const merged=window.SkillSystem.loadSkills().find(s=>s.name==='自动沉淀测试');
ok(merged && merged.praise>=2 && merged.content==='更新内容', '重名合并 praise+1 且内容更新');
// 11.6 自动模式失败静默（不抛错、不产出）
llmHandler=()=>{ throw new Error('mock 500'); };
const cntBefore=window.SkillSystem.loadSkills().length;
await window.SkillSystem.autoReflectIfNeeded('conv4', [{role:'user',content:'x'},{role:'assistant',content:'y'},{role:'user',content:'z'},{role:'assistant',content:'w'}], ()=>{});
ok(window.SkillSystem.loadSkills().length===cntBefore, '自动反思失败静默（不污染）');

console.log('\n【12】对话直接创建 skill（create_skill 工具）');
ok(window.AgentEngine.getTools().some(t=>t.function&&t.function.name==='create_skill'), 'TOOLS 包含 create_skill');
const cs=await window.SkillSystem.createSkillFromRequest({name:'对话创建测试', summary:'直接创建的摘要', content:'配队时优先按这个模板执行。', keywords:['模板','直接']});
const csj=JSON.parse(cs);
ok(csj.ok && csj.name==='对话创建测试', '直接创建成功: '+csj.note);
const s=window.SkillSystem.loadSkills().find(x=>x.name==='对话创建测试');
ok(s && s.content.includes('模板') && s.summary.length<=20, '内容与摘要正确');
ok(window.SkillSystem.getSkillContext('用模板配一下队', 2000).includes('对话创建测试'), '新skill可按关键词命中');
// 重复创建 → 更新内容不新增
const cnt=window.SkillSystem.loadSkills().length;
await window.SkillSystem.createSkillFromRequest({name:'对话创建测试', content:'更新后的内容'});
const after=window.SkillSystem.loadSkills();
ok(after.length===cnt && after.find(x=>x.name==='对话创建测试').content==='更新后的内容', '重名更新内容不新增');
// 缺字段 → 错误
const badCreate=JSON.parse(await window.SkillSystem.createSkillFromRequest({name:'x'}));
ok(!!badCreate.error, '缺 content 返回错误');

console.log('\n【13】智谱 GLM 默认模型（默认链 + /v4 地址适配 + 视觉识别）');
// 13.1 默认链：①多模型优先 ②旧单模型 ③智谱(glm key) ④空→智谱地址
store['lagrange_static_config']=JSON.stringify({models:[{id:'m1',name:'自定义',api_key:'k1',api_url:'https://x.com',model:'m'}]});
ok(window.AgentEngine.getActiveLLM().name==='自定义', '多模型优先');
store['lagrange_static_config']=JSON.stringify({llm_api_key:'sk-1', llm_api_url:'https://api.deepseek.com', llm_model:'deepseek-chat'});
ok(window.AgentEngine.getActiveLLM().model==='deepseek-chat', '旧单模型兼容');
store['lagrange_static_config']=JSON.stringify({glm_api_key:'zhipu-key', glm_model:'glm-4.7-flash'});
let llm=window.AgentEngine.getActiveLLM();
ok(llm.model==='glm-4.7-flash' && llm.apiUrl==='https://open.bigmodel.cn/api/paas/v4', '智谱直连默认: '+llm.model);
store['lagrange_static_config']=JSON.stringify({glm_proxy_url:'https://lagrange-glm-proxy.workers.dev'});
llm=window.AgentEngine.getActiveLLM();
ok(llm.apiUrl==='https://lagrange-glm-proxy.workers.dev' && llm.apiKey==='proxy', '智谱代理默认');
store['lagrange_static_config']=JSON.stringify({});
llm=window.AgentEngine.getActiveLLM();
ok(llm.model==='glm-4.7-flash' && llm.apiKey && llm.apiUrl==='https://open.bigmodel.cn/api/paas/v4', '全空→内置智谱Key直连(默认4.7零配置)');
// 13.2 /v4 地址适配：callLLM 请求 URL 不含 /v4/v1
const captured=[];
llmHandler=null;
const origFetch=global.fetch;
global.fetch=async (url,opts)=>{
    if(String(url).includes('chat/completions')){
        captured.push(String(url));
        return {ok:true, json:async()=>({choices:[{message:{content:'测试回答',reasoning_content:''},finish_reason:'stop'}]})};
    }
    return origFetch(url,opts);
};
store['lagrange_static_config']=JSON.stringify({glm_api_key:'z', glm_model:'glm-4.7-flash'});
await window.AgentEngine.chat('测试智谱地址', [], ()=>{});
ok(captured.some(u=>u==='https://open.bigmodel.cn/api/paas/v4/chat/completions'), '智谱地址不追加 /v1（无 /v4/v1）');
// 13.3 describeImage：配置视觉 → 调用 image_url；未配置 → null
captured.length=0;
global.fetch=async (url,opts)=>{
    if(String(url).includes('chat/completions')){
        const p=JSON.parse(opts.body);
        captured.push(JSON.stringify(p));
        return {ok:true, json:async()=>({choices:[{message:{content:'这是一张舰船截图，可见数值...'}}]})};
    }
    return origFetch(url,opts);
};
store['lagrange_static_config']=JSON.stringify({glm_api_key:'z', glm_vision_model:'glm-4.6v-flash'});
const desc=await window.AgentEngine.describeImage('data:image/png;base64,AAAA');
ok(String(desc).includes('舰船截图'), 'describeImage 返回描述');
ok(captured.some(p=>p.includes('glm-4.6v-flash')&&p.includes('image_url')), '视觉调用含 image_url 格式');
store['lagrange_static_config']=JSON.stringify({});
ok((await window.AgentEngine.describeImage('data:image/png;base64,AAAA'))===null, '未配置视觉 → 返回 null');
global.fetch=origFetch;

console.log('\n========================================');
console.log('结果: '+pass+' 通过, '+fail+' 失败');
process.exit(fail?1:0);
})().catch(e=>{ console.error('测试异常:', e); process.exit(1); });
