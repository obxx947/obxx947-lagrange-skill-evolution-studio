// ===== 子Agent池 + 2-Agent协同质检 测试（mock） =====
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

global.window = {};
global.localStorage = { getItem:()=>null, setItem:()=>{}, removeItem:()=>{} };

require(path.join(ROOT,'js/subagent_pool.js'));
const P = window.SubAgentPool;

let pass=0, fail=0;
function ok(c,n,d){ if(c){pass++;console.log('  OK '+n);}else{fail++;console.log('  FAIL '+n+(d?' | '+d:''));} }

console.log('=== 1. 子Agent池 ≤7 上限 + 用完即弃 ===');
ok(P.getMax()===7, 'MAX=7');
ok(P.getCount()===0, '初始0');
// 连续 acquire 7 个
const tokens=[];
for(let i=0;i<7;i++){ const t=P.acquire('creator'+i,'role'+i,'prompt'+i); tokens.push(t); ok(!!t, 'acquire '+(i+1)+' 成功'); }
ok(P.isFull()===true, '7个后已满');
ok(P.acquire('creator8','role8','prompt8')===null, '第8个被拒(≥7)');
ok(P.getCount()===7, 'count=7');
// 释放3个
P.release(tokens[0].token); P.release(tokens[1].token); P.release(tokens[2].token);
ok(P.getCount()===4, '释放3个后 count=4');
ok(P.isFull()===false, '释放后可再创建');
const t8=P.acquire('creatorX','roleX','pX');
ok(!!t8 && P.getCount()===5, '释放后第8个成功');
ok(t8.role==='roleX' && t8.prompt==='pX', '创建方注入的 prompt 保留');

console.log('=== 2. llm_gate 用创建方提示词 + 计数 ===');
require(path.join(ROOT,'js/llm_gate.js'));
const G = window.LLMGate;
const calls=[];
(async()=>{
  // mock llmCall
  const r = await G.callAs('agentA','这是A的提示词', {llmCall:async(messages)=>{calls.push(messages); return {content:'{"ok":true}'};}});
  ok(r.content==='{"ok":true}', 'gate 返回LLM结果');
  ok(calls[0][0].role==='system' && calls[0][0].content==='这是A的提示词', 'gate 用创建方提示词作为system');
  ok(P.getCount()===5, 'gate 调用后子Agent释放(count仍5)');

  // 填满池 → gate 应抛"子Agent已满"
  const fill=[];
  for(let i=0;i<2;i++){ const t=P.acquire('f'+i,'r'+i,'p'+i); fill.push(t); }
  ok(P.isFull(), '再占2个 → 满');
  let gateErr='';
  try{ await G.callAs('agentB','B提示',{llmCall:async()=>{}}); }catch(e){ gateErr=e.message; }
  ok(gateErr.includes('子Agent已满'), 'gate 满额时抛错降级: '+gateErr);

  console.log('\n结果: '+pass+' 通过, '+fail+' 失败');
  process.exit(fail?1:0);
})();
