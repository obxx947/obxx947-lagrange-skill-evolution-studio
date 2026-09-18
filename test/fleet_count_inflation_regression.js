/* 第十一轮：数量暴增修复验证（默认覆盖 / 反复复制不累加 / 超限自动校正） */
const puppeteer=require('puppeteer-core');
const fs=require('fs');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE='http://127.0.0.1:3888/';
const LOG=[]; function say(...a){ const s=a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '); LOG.push(s); console.log(s); }
const results=[]; function check(n,ok,d){ results.push({n,ok:!!ok,d}); say((ok?'PASS ':'FAIL ')+n+(d?('  → '+d):'')); }
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  const b=await puppeteer.launch({executablePath:EDGE,headless:'new',protocolTimeout:300000,args:['--no-sandbox','--disable-gpu']});
  const p=await b.newPage();
  let dialogs=[];
  p.on('dialog',async d=>{ dialogs.push(d.message()); try{ await d.accept(); }catch(e){} });
  const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/favicon|hf-mirror|ERR_FAILED|CORS|net::/i.test(m.text())) errs.push('CONSOLE: '+m.text()); });
  const ev=async(fn,...a)=>{ try{ return await p.evaluate(fn,...a); }catch(e){ return {__err:String(e.message)}; } };

  /* ===== 1. 默认模式应是「覆盖」 ===== */
  say('===== 1. 复制到模拟器：默认覆盖 =====');
  await p.goto(BASE+'fleet.html',{waitUntil:'load',timeout:90000});
  await sleep(3000);
  const A=await ev(()=>{
    newPlan(); const af=activeFleet();
    af.main=[{id:'FG300-A',name:'FG300型-多用途护卫舰',pos:'中排',qty:8,mods:{},air:[]}];
    af.reinforce=[]; fillPos(cur); renderAll();
    toSimulator();
    const checked=document.querySelector('input[name="simMode"]:checked').value;
    const labels=Array.from(document.querySelectorAll('#simTargetModal .stim-item')).map(x=>x.innerText.trim());
    return {checked, labels};
  });
  check('1a 默认选中「覆盖」', A.checked==='replace', JSON.stringify(A));
  check('1b 追加选项标注了累加风险', (A.labels||[]).some(t=>/累加/.test(t)), JSON.stringify(A.labels));

  /* ===== 2. 反复复制 5 次（覆盖）→ 数量恒为 8 ===== */
  say('\n===== 2. 反复复制 5 次（覆盖模式） =====');
  await ev(()=>{ simPick('ally-escort',null); document.querySelector('input[name="simMode"][value="replace"]').checked=true; simConfirm(); });
  await p.waitForNavigation({waitUntil:'load',timeout:60000}).catch(()=>{});
  await sleep(4500);
  const B=await ev(()=>{
    const out=[fleetData['ally-escort'].main.filter(s=>s.id==='FG300-A').reduce((n,s)=>n+s.count,0)];
    return out[0];
  });
  // 再重复 4 次：每次回配队页点复制（覆盖）
  for(let i=0;i<4;i++){
    await p.goto(BASE+'fleet.html',{waitUntil:'load',timeout:90000});
    await sleep(2500);
    await ev(()=>{ loadPlan(store.plans[0]?.id); if(!activeFleet().main.length){ const af=activeFleet();
        af.main=[{id:'FG300-A',name:'FG300型-多用途护卫舰',pos:'中排',qty:8,mods:{},air:[]}]; fillPos(cur); renderAll(); }
      simPick('ally-escort',null); document.querySelector('input[name="simMode"][value="replace"]').checked=true; simConfirm(); });
    await p.waitForNavigation({waitUntil:'load',timeout:60000}).catch(()=>{});
    await sleep(4000);
  }
  const C=await ev(()=>({
    count:fleetData['ally-escort'].main.filter(s=>s.id==='FG300-A').reduce((n,s)=>n+s.count,0),
    entries:fleetData['ally-escort'].main.length,
    battle:(()=>{ fleetData['enemy-escort'].main=[{uid:'e',id:'constantine',name:'大帝',count:1,position:'中排',modules:{},selectedModules:{},aircraft:[]}];
      recalcAircraftSlots(fleetData['enemy-escort'].main[0]);
      return prepareBattle()? battleState.allyShips.length : -1; })()
  }));
  check('2 反复复制 5 次后仍是 8 艘（原来会变 40）', C.count===8 && C.battle===8, JSON.stringify(C));

  /* ===== 3. 追加模式的超限自动校正：手工塞 40 艘 ===== */
  say('\n===== 3. 追加模式 + 超限 40 艘 → 自动校正 =====');
  const D=await ev(()=>{
    fleetData['ally-escort'].main=[{uid:'x1',id:'uranus-spear',name:'乌拉诺斯之矛',count:40,
        position:'前排',modules:{},selectedModules:{},aircraft:[]}];
    recalcAircraftSlots(fleetData['ally-escort'].main[0]);
    refreshFleetViews(); saveFleetsToStorage();
    const fixes=sanitizeFleetLimits('ally-escort', []);
    return {lim:SHIP_DATABASE['uranus-spear'].serviceLimit, after:fleetData['ally-escort'].main[0].count, fixes};
  });
  check('3a 40 艘被校正到服役上限', D.after===D.lim, JSON.stringify(D));

  /* ===== 4. 载机：数量也一起校正 ===== */
  say('\n===== 4. 载机数量暴增也校正 =====');
  const E=await ev(()=>{
    const f=fleetData['ally-escort'];
    f.main=[{uid:'y1',id:'sun-whale',name:'太阳鲸',count:1,position:'中排',
        modules:{},selectedModules:{M:'M2'},aircraft:[]}];
    recalcAircraftSlots(f.main[0]);
    // 手工塞 40 架（模拟原来的暴增）
    f.main[0].aircraft=[Object.assign({}, JSON.parse(JSON.stringify(SHIP_DATABASE['tianxuan'])), {count:40, slot:'M2|fighter'})];
    saveFleetsToStorage();
    const fixes=sanitizeFleetLimits('ally-escort', []);
    const e=f.main[0];
    return {slotCap:(e.simSlots||[]).map(x=>x.key+'='+x.cap), air:(e.aircraft||[]).map(a=>a.name+'×'+a.count),
            servLim:SHIP_DATABASE['tianxuan'].serviceLimit, fixes};
  });
  check('4 40 架载机被裁到该位容量(8)', /×8$/.test((E.air||[]).join('')) && (E.slotCap||[]).join('').indexOf('M2|fighter=8')>=0, JSON.stringify(E));

  /* ===== 5. 加载存档时自动校正历史脏数据 ===== */
  say('\n===== 5. 存档里已有 40 艘 → 刷新后自动校正 =====');
  await ev(()=>{
    const f=fleetData['ally-escort'];
    f.main=[{uid:'z1',id:'uranus-spear',name:'乌拉诺斯之矛',count:40,position:'前排',modules:{},selectedModules:{},aircraft:[]}];
    f.reinforcement=[];
    localStorage.setItem('lagrange_sim_fleets', JSON.stringify(fleetData));
  });
  dialogs=[];
  await p.goto(BASE+'simulator.html',{waitUntil:'load',timeout:90000});
  await sleep(4500);
  const F=await ev(()=>({
    count:fleetData['ally-escort'].main.filter(s=>s.id==='FG300-A').reduce((n,s)=>n+s.count,0),
    saved:JSON.parse(localStorage.getItem('lagrange_sim_fleets')||'{}')['ally-escort']?.main?.map(s=>s.count)
  }));
  check('5 刷新后存档里的 40 艘被自动校正为上限', JSON.stringify(F.saved)==='[6]' && (F.live||[]).join()==='6', JSON.stringify(F));

  /* ===== 6. 缝合模式不被裁 ===== */
  say('\n===== 6. 缝合模式下不裁剪 =====');
  const G=await ev(()=>{
    stitchMode=true;
    const f=fleetData['ally-escort'];
    f.main=[{uid:'s1',id:'uranus-spear',name:'乌拉诺斯之矛',count:40,position:'前排',modules:{},selectedModules:{},aircraft:[]}];
    sanitizeFleetLimits('ally-escort', []);
    const c=f.main[0].count; stitchMode=false; return {c};
  });
  check('6 缝合模式保留 40 艘', G.c===40, JSON.stringify(G));

  say('\n===== 运行期错误 =====');
  if(!errs.length) say('（无）'); else [...new Set(errs)].forEach(e=>say('  '+e));
  say('\n===== FAIL 汇总 =====');
  const f2=results.filter(r=>!r.ok); if(!f2.length) say('（全部 PASS）'); else f2.forEach(x=>say('  ✗ '+x.n+' → '+x.d));
  fs.writeFileSync('_fleet_test11.log',LOG.join('\n'),'utf8');
  await b.close();
})().catch(e=>{ console.error('HARNESS ERROR',e); process.exit(1); });
