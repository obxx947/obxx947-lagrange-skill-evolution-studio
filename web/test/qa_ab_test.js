// ===== 2-Agent 协同质检流程测试（mock LLM，不调真实API） =====
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
global.window = {};
global.localStorage = { getItem:()=>null, setItem:()=>{}, removeItem:()=>{} };
require(path.join(ROOT,'js/subagent_pool.js'));
// 加载 qa.js（它会 require window.AgentEngine? 检查——qa.js sharedSystem 用 window.AgentEngine.getSystemPrompt，需 mock）
global.window.AgentEngine = { getSystemPrompt:()=>'你是质检智能体。', getConfig:()=>({}) };
global.window.KB = { load:async()=>true, search:async()=>[], searchByCategory:async()=>[] };
global.window.SHIP_DB = { load:async()=>true, search:()=>[] };
global.window.KbEmbed = { };

// 可控 mock：bAcceptOnCall 表示第 N 次 B 才给 PASS（此前给"需复查"）
let aCallCount = 0;
let bCallCount = 0;
let bAcceptOnCall = 1; // 默认第1次B就PASS

global.fetch = async (url, opts)=>{
  const body=JSON.parse(opts.body);
  const sys = (body.messages[0].content||'');
  const isA=sys.includes('· 审计智能体'), isB=sys.includes('· 裁判智能体');
  let content;
  if(isA) {
    aCallCount++;
    content='{"issues":[{"position":"示例错误","error_type":"数值冲突","kb_original_text":"正确值","fix_suggest":"修正"}],"evidence_summary":"已查3条","has_issue":true}';
  } else if(isB) {
    bCallCount++;
    if(bCallCount >= bAcceptOnCall){
      content = '{"score":88,"status":"PASS","error_list":[],"user_requirement_check":"覆盖需求","review_needs":false,"retour_instruction":""}';
    } else {
      // B 有疑问 → 回传 A 复查
      content = '{"score":55,"status":"FULL_REGEN","error_list":[{"position":"示例错误","error_type":"需复查","kb_original_text":"","fix_suggest":""}],"user_requirement_check":"","review_needs":true,"retour_instruction":"请重新检索大矛的服役上限并核对"}';
    }
  } else {
    // claimSplit / evidenceRetrieve 等内部辅助调用
    content = '{"claims":[{"fact":"舰船数据正确","position":"引用原文"}]}';
  }
  return {ok:true, json:async()=>({choices:[{message:{content, reasoning_content:''},finish_reason:'stop'}]})};
};
const qaSrc = require('fs').readFileSync(path.join(ROOT,'js/qa.js'),'utf8');
eval(qaSrc);
const QA = window.QA;
const P = window.SubAgentPool;

(async()=>{
  let pass=0, fail=0;
  const ok=(c,n,d)=>{ if(c){pass++;console.log('  OK '+n);}else{fail++;console.log('  FAIL '+n+(d?' | '+d:''));} };

  // ---- 场景一：一轮 PASS（A审计→B直接打分通过） ----
  console.log('=== 场景1 单轮PASS：A审计→B评判通过 ===');
  aCallCount=0; bCallCount=0; bAcceptOnCall=1;
  const res = await QA.qaPipeline('推荐一个护卫舰', '我推荐FG300型护卫舰，服役上限10，人口3。', {apiKey:'test', apiUrl:'https://api.deepseek.com', model:'glm-4.7-2507'}, ()=>{});
  ok(res && typeof res.score==='number', '返回 score='+(res&&res.score));
  ok(res.status==='PASS', 'status=PASS (得'+res.status+')');
  ok(typeof res.final_answer==='string', '有 final_answer');
  ok(P.getCount()===0, '质检结束后子Agent池清空(count=0)');

  // ---- 场景二：B 判定 FAIL（<75 分）→ 交主循环重跑 ----
  console.log('\n=== 场景2 B裁判 FAIL：score<75 → 重生成 ===');
  aCallCount=0; bCallCount=0; bAcceptOnCall=99;   // 永远 FAIL
  const res2 = await QA.qaPipeline('大矛护卫舰的服役上限是什么', '大矛B3配C2，服役上限6。', {apiKey:'test', apiUrl:'https://api.deepseek.com', model:'glm-4.7-2507'}, ()=>{});
  ok(bCallCount===1, 'B被调了'+bCallCount+'次(裁判一次)');
  ok(aCallCount===1, 'A被调了'+aCallCount+'次(审计一次)');
  ok(res2.status==='FAIL' || res2.status==='MAX_ITER_STOP', '低分判定 FAIL (得'+res2.status+')');
  ok(res2.score<75, 'score='+res2.score+' < 75');
  ok(P.getCount()===0, '质检结束后子Agent池清空(count=0)');

  console.log('\n结果: '+pass+' 通过, '+fail+' 失败');
  process.exit(fail?1:0);
})().catch(e=>{console.error('异常:',e.message);process.exit(1);});
