// 计划审批指令不应被判为日常闲聊（意图门放行）；真正的闲聊才短路
const path=require('path'); const ROOT=path.resolve(__dirname,'..');
global.window={}; global.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
require(path.join(ROOT,'js/subagent_pool.js'));
global.window.AgentEngine={getSystemPrompt:()=>'你是谁',getConfig:()=>({})};
global.window.KB={load:async()=>true,search:async()=>[],searchByCategory:async()=>[]};
global.window.SHIP_DB={load:async()=>true,search:()=>[]}; global.window.KbEmbed={};
global.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:'{"is_daily_chat":false,"clarified_intent":"x","reason":"x"}'},finish_reason:'stop'}]})});
const src=require('fs').readFileSync(path.join(ROOT,'js/qa.js'),'utf8'); eval(src);
const QA=window.QA;

(async()=>{
  let pass=0,fail=0;
  const ok=(c,n)=>{ if(c){pass++;console.log('  OK '+n);}else{fail++;console.log('  FAIL '+n);} };
  // 应放行（非闲聊）：审批/确认/数字选择
  ok(QA.isSimpleQuestion('1')===false, 'isSimpleQuestion("1")===false (1=批准计划 放行)');
  ok(QA.isSimpleQuestion('批准计划')===false, 'isSimpleQuestion("批准计划")===false (放行)');
  ok(QA.isSimpleQuestion('同意')===false, 'isSimpleQuestion("同意")===false (放行)');
  ok(QA.isSimpleQuestion('好的')===false, 'isSimpleQuestion("好的")===false (放行)');
  ok(QA.isSimpleQuestion('继续')===false, 'isSimpleQuestion("继续")===false (放行)');
  ok(QA.isSimpleQuestion('2')===false, 'isSimpleQuestion("2")===false (数字选择放行)');
  ok(QA.isSimpleQuestion('推荐一个护卫队')===false, 'isSimpleQuestion("推荐一个护卫队")===false (任务放行)');
  // 应短路（闲聊/简单日常）
  ok(QA.isSimpleQuestion('你好')===true, 'isSimpleQuestion("你好")===true (闲聊短路)');
  ok(QA.isSimpleQuestion('谢谢')===true, 'isSimpleQuestion("谢谢")===true (闲聊短路)');
  ok(QA.isSimpleQuestion('在吗')===true, 'isSimpleQuestion("在吗")===true (闲聊短路)');
  ok(QA.isSimpleQuestion('今天天气如何')===true, 'isSimpleQuestion("今天天气如何")===true (闲聊短路)');
  console.log('\n结果: '+pass+' 通过, '+fail+' 失败');
  process.exit(fail?1:0);
})().catch(e=>{console.error('异常:',e.message);process.exit(1);});
