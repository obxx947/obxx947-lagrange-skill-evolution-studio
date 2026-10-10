// 默认 GLM-4.7-Flash 检测与"禁止同时启用多Agent"测试（mock LLM，不调真实API）
const path=require('path'); const ROOT=path.resolve(__dirname,'..');
global.window={}; global.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
require(path.join(ROOT,'js/subagent_pool.js'));
global.window.AgentEngine={getSystemPrompt:()=>'你是质检智能体。',getConfig:()=>({})};
global.window.KB={load:async()=>true,search:async()=>[],searchByCategory:async()=>[]};
global.window.SHIP_DB={load:async()=>true,search:()=>[]};
global.window.KbEmbed={};
let auditCount=0, judgeCount=0;
global.fetch=async(url,opts)=>{
  const body=JSON.parse(opts.body);
  const sys=(body.messages[0].content||'');
  let content;
  if(sys.includes('· 审计智能体')){ auditCount++; content='{"issues":[],"evidence_summary":"s","has_issue":false}'; }
  else if(sys.includes('· 裁判智能体')){ judgeCount++; content='{"score":82,"status":"PASS","error_list":[],"user_requirement_check":"ok","review_needs":false,"retour_instruction":""}'; }
  else { content='{"claims":[{"fact":"舰船数据正确","position":"引用原文"}]}'; }
  return {ok:true,json:async()=>({choices:[{message:{content,reasoning_content:''},finish_reason:'stop'}]})};
};
const src=require('fs').readFileSync(path.join(ROOT,'js/qa.js'),'utf8'); eval(src);
const QA=window.QA; const P=window.SubAgentPool;

(async()=>{
  let pass=0,fail=0;
  const ok=(c,n,d)=>{ if(c){pass++;console.log('  OK '+n);}else{fail++;console.log('  FAIL '+n+(d?' | '+d:''));} };

  console.log('=== isDefaultFlash 判定 ===');
  ok(QA.isDefaultFlash({model:'glm-4.7-flash'})===true, 'glm-4.7-flash => true');
  ok(QA.isDefaultFlash({model:'GLM-4.7-Flash-vision'})===true, 'GLM-4.7-Flash-vision(大小写) => true');
  ok(QA.isDefaultFlash({model:'deepseek-chat'})===false, 'deepseek-chat => false');
  ok(QA.isDefaultFlash({model:'glm-4.6'})===false, 'glm-4.6(非flash) => false');
  ok(QA.isDefaultFlash(null)===false, 'null => false');

  console.log('\n=== 默认 Flash：质检禁止同时启用多Agent（A/B 各0次，直接PASS） ===');
  auditCount=0; judgeCount=0;
  const r1=await QA.qaPipeline('大矛护卫舰的服役上限是什么','大矛服役上限6。',{apiKey:'t',apiUrl:'https://api.deepseek.com',model:'glm-4.7-flash'},()=>{});
  ok(auditCount===0, 'Agent-A 审计被调'+auditCount+'次(应为0)');
  ok(judgeCount===0, 'Agent-B 评判被调'+judgeCount+'次(应为0)');
  ok(r1.status==='PASS', 'status=PASS(得'+r1.status+')');
  ok(r1.score===88, 'score=88');
  ok(/多Agent|多个Agent/.test(r1.user_requirement_check||''), '注明跳过多Agent质检');
  ok(P.getCount()===0, '子Agent池清空(count=0)');

  console.log('\n=== 非默认模型：仍走 A/B 协同（审计/评判各≥1） ===');
  auditCount=0; judgeCount=0;
  const r2=await QA.qaPipeline('大矛护卫舰的服役上限是什么','大矛服役上限6。',{apiKey:'t',apiUrl:'https://api.deepseek.com',model:'glm-4.7-2507'},()=>{});
  ok(auditCount>=1, 'Agent-A 审计被调'+auditCount+'次(应≥1)');
  ok(judgeCount>=1, 'Agent-B 评判被调'+judgeCount+'次(应≥1)');
  ok(r2.status==='PASS', 'status=PASS(得'+r2.status+')');
  ok(P.getCount()===0, '子Agent池清空(count=0)');

  console.log('\n结果: '+pass+' 通过, '+fail+' 失败');
  process.exit(fail?1:0);
})().catch(e=>{console.error('异常:',e.message);process.exit(1);});
