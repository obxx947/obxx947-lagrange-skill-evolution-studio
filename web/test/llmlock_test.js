// 全局 LLM 并发锁测试：确认 LLMLock.run 严格串行（同一时刻仅 1 个在跑）
const path=require('path'); const ROOT=path.resolve(__dirname,'..');
global.window={}; global.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
require(path.join(ROOT,'js/subagent_pool.js'));
const L=global.window.LLMLock;
(async()=>{
  let pass=0,fail=0; const ok=(c,n)=>{ if(c){pass++;console.log('  OK '+n);}else{fail++;console.log('  FAIL '+n);} };
  ok(!!L && typeof L.run==='function', 'LLMLock.run 存在');
  // 并发跑 3 个任务，记录重叠
  let running=0, maxConc=0; const order=[];
  const mk=(id)=>()=>new Promise(res=>{ running++; maxConc=Math.max(maxConc,running); order.push('start'+id);
      setTimeout(()=>{ running--; order.push('end'+id); res(id); }, 20); });
  const results=await Promise.all([L.run(mk('A')), L.run(mk('B')), L.run(mk('C'))]);
  ok(maxConc===1, '最大并发='+maxConc+'（应=1，串行）');
  ok(order.filter(x=>x.startsWith('start')).join(',')==='startA,startB,startC', '按序启动(串行)');
  ok(results.length===3, '3 个结果都返回');
  // 失败不阻塞后续（分别 await，避免 Promise.all 对 reject 快速失败）
  try{ await L.run(()=>Promise.reject(new Error('x'))); }catch(e){}
  const n2 = await L.run(()=>1);
  ok(n2===1, '前一个失败后，后续仍执行');
  console.log('\n结果: '+pass+' 通过, '+fail+' 失败');
  process.exit(fail?1:0);
})().catch(e=>{console.error('异常:',e.message);process.exit(1);});
