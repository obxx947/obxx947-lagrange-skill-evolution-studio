/* 第九轮：三项修复验证 —— 下方刷新 / 显示区+战斗可见载机 / 多套模块组合 */
const puppeteer=require('puppeteer-core');
const fs=require('fs');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE='http://127.0.0.1:3888/';
const LOG=[]; function say(...a){ const s=a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '); LOG.push(s); console.log(s); }
const results=[]; function check(n,ok,d){ results.push({n,ok:!!ok,d}); say((ok?'PASS ':'FAIL ')+n+(d?('  → '+d):'')); }

(async()=>{
  const b=await puppeteer.launch({executablePath:EDGE,headless:'new',protocolTimeout:300000,args:['--no-sandbox','--disable-gpu']});
  const p=await b.newPage();
  p.on('dialog',async d=>{ try{ await d.accept(); }catch(e){} });
  const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/favicon|hf-mirror|ERR_FAILED|CORS|net::/i.test(m.text())) errs.push('CONSOLE: '+m.text()); });
  const ev=async(fn,...a)=>{ try{ return await p.evaluate(fn,...a); }catch(e){ return {__err:String(e.message)}; } };

  await p.goto(BASE+'simulator.html',{waitUntil:'load',timeout:90000});
  await new Promise(r=>setTimeout(r,4000));

  /* ===== 1. 加船后「下方」立即刷新 ===== */
  say('===== 1. 加船后下方编辑区立即刷新 =====');
  const A=await ev(()=>{
    FLEET_TYPES.forEach(k=>{ fleetData[k].main=[]; fleetData[k].reinforcement=[]; });
    currentFleetType='ally-escort'; currentFleetTab='main';
    toggleFleetPanel('ally-escort');                       // 打开下方编辑器
    const before=document.querySelectorAll('#inlineFleetEditor .frow').length;
    spkFleetType='ally-escort'; spkTab='main'; spkSel=[]; spkToggle('constantine'); spkConfirm();
    const after=document.querySelectorAll('#inlineFleetEditor .frow').length;
    return {before, after};
  });
  check('1 加船后下方行数 0→1（原来不刷新）', A.before===0 && A.after===1, JSON.stringify(A));

  /* ===== 2. 显示区 + 战斗界面都能看到载机 ===== */
  say('\n===== 2. 显示区/战斗界面可见载机 =====');
  const B=await ev(()=>{
    const f=fleetData['ally-escort'];
    f.main=[{uid:'r1',id:'sun-whale',name:'太阳鲸',count:1,position:'后排',
             modules:{}, selectedModules:{M:'M2'}, aircraft:[]}];
    recalcAircraftSlots(f.main[0]);
    simAirSet('r1','tianxuan','M2|fighter',4);
    refreshFleetViews();
    const chip=document.querySelector('#fleetPanels .ship-chip');
    const panel=document.querySelector('#fleetPanels .fleet-panel');
    return {chip:chip?chip.innerText.replace(/\s+/g,' '):'(无)',
            panelStats:panel?panel.querySelector('.fleet-panel-stats').innerText.replace(/\s+/g,' '):'(无)',
            air:JSON.stringify((f.main[0].aircraft||[]).map(a=>a.name+'×'+a.count))};
  });
  check('2a 舰队面板船条目显示 ✈ 架数', /✈4/.test(B.chip||''), B.chip);
  check('2b 面板统计显示「搭载:4架」', /搭载:4架/.test(B.panelStats||''), B.panelStats);

  const C=await ev(()=>{
    fleetData['enemy-escort'].main=[{uid:'e1',id:'constantine',name:'大帝',count:2,position:'中排',
        modules:{}, selectedModules:{}, aircraft:[]}];
    recalcAircraftSlots(fleetData['enemy-escort'].main[0]);
    refreshFleetViews();
    const ok=prepareBattle(); if(!ok) return {ok:false};
    const st=battleState;
    // 模拟战斗界面渲染
    renderBattleUI();
    const g0=document.getElementById('battleShips0');
    const g1=document.getElementById('battleShips1');
    return {ok:true,
      allyAircraftInGroup:(st.allyEscort||[]).filter(s=>s.position==='aircraft').map(s=>s.name),
      allyEscortNames:(st.allyEscort||[]).map(s=>s.name+'/'+s.position),
      ui0:g0?g0.innerText.replace(/\s+/g,' ').slice(0,120):'(无)',
      ui1:g1?g1.innerText.replace(/\s+/g,' ').slice(0,120):'(无)',
      hpText:document.getElementById('allyTotalHpText')?.textContent,
      max:st.allyTotalHpMax,
      cur:Math.round(st.allyShips.reduce((a,sh)=>a+Math.max(0,sh.hp),0))};
  });
  check('2c 载机进入护航分组（战斗界面才看得到）', (C.allyAircraftInGroup||[]).length===4, JSON.stringify(C.allyAircraftInGroup));
  check('2d 战斗界面渲染出载机', /天璇/.test((C.ui0||'')+(C.ui1||'')), (C.ui0||'').slice(0,80)+' || '+(C.ui1||'').slice(0,80));
  check('2e 当前HP ≤ 上限（载机也计入上限）', C.cur<=C.max, 'cur='+C.cur+' max='+C.max);

  /* ===== 3. 同一舰船多套模块组合 + 服役上限按舰船汇总 ===== */
  say('\n===== 3. 同型舰多套模块组合（服役上限仍按该舰合计） =====');
  const D=await ev(()=>{
    const f=fleetData['ally-escort'];
    f.main=[]; f.reinforcement=[];
    currentFleetType='ally-escort'; currentFleetTab='main';
    spkFleetType='ally-escort'; spkTab='main'; spkSel=[]; spkToggle('constantine'); spkConfirm();
    const row=fleetData['ally-escort'].main[0];
    row.count=3; recalcAircraftSlots(row);                 // 方案一：3 艘
    const lim=SHIP_DATABASE['constantine'].serviceLimit;   // 6
    // 加第二套配置
    simAddConfig(rowKey(row));
    const rows=fleetData['ally-escort'].main;
    rows[1].count=2; recalcAircraftSlots(rows[1]);         // 方案二：2 艘
    return {lim, n:rows.length, uids:rows.map(r=>r.uid),
            counts:rows.map(r=>r.count), used:simUsedTotal('ally-escort','constantine')};
  });
  check('3a 同型舰可存在两套独立条目', D.n===2 && D.uids[0]!==D.uids[1], JSON.stringify(D));
  check('3b 服役合计 = 3+2 = 5', D.used===5, JSON.stringify(D));

  const E=await ev(()=>{
    const rows=fleetData['ally-escort'].main;
    // 方案一加到 4 → 合计 6 = 上限，应放行
    changeFleetShipCount(rowKey(rows[0]), 1);
    const after1=simUsedTotal('ally-escort','constantine');
    // 再加 1 → 合计 7 > 6，应被拦
    changeFleetShipCount(rowKey(rows[0]), 1);
    const after2=simUsedTotal('ally-escort','constantine');
    return {after1, after2, counts:rows.map(r=>r.count)};
  });
  check('3c 合计到上限(6)放行、超限被拦', E.after1===6 && E.after2===6, JSON.stringify(E));

  const F=await ev(()=>{
    // 增援里再加同型舰也要一起吃这个上限
    const f=fleetData['ally-escort'];
    currentFleetTab='reinforcement';
    spkFleetType='ally-escort'; spkTab='reinforcement'; spkSel=[]; spkToggle('constantine'); spkConfirm();
    const rein=f.reinforcement.length;
    currentFleetTab='main';
    return {rein, used:simUsedTotal('ally-escort','constantine')};
  });
  check('3d 增援同型舰也计入同一上限 → 被拦', F.rein===0 && F.used===6, JSON.stringify(F));

  const G=await ev(()=>{
    // 两套配置各自独立改模块
    const rows=fleetData['ally-escort'].main;
    rows[0].selectedModules={M:'M1'};
    rows[1].selectedModules={M:'M2'};
    recalcAircraftSlots(rows[0]); recalcAircraftSlots(rows[1]);
    refreshFleetViews();
    const html=document.getElementById('inlineFleetEditor').innerHTML;
    return {mods:rows.map(r=>Object.values(r.selectedModules).join('')), twoRows:(html.match(/class="frow"/g)||[]).length};
  });
  check('3e 两套配置模块互不影响', JSON.stringify(G.mods)===JSON.stringify(['M1','M2']) && G.twoRows===2, JSON.stringify(G));

  /* ===== 4. 配队页多套配置 + 旗舰按条目 ===== */
  say('\n===== 4. 配队页：多套模块组合 + 旗舰定位 =====');
  await p.goto(BASE+'fleet.html',{waitUntil:'load',timeout:90000});
  await new Promise(r=>setTimeout(r,3000));
  const H=await ev(()=>{
    store.plans=[]; saveStore(); newPlan();
    const af=activeFleet();
    af.main=[{id:'constantine',name:'新君士坦丁大帝级',pos:'中排',qty:3,mods:{M:'M1'},air:[]}];
    renderAll();
    addConfig('main',0);
    const rows=activeFleet().main;
    rows[1].qty=2; rows[1].mods={M:'M2'};
    renderAll();
    const html=document.getElementById('mainList').innerHTML;
    return {n:rows.length, used:usedTotal('constantine'), lim:getShip('constantine').serviceLimit,
            flagships:(html.match(/⭐/g)||[]).length};
  });
  check('4a 配队页支持两套配置（3+2=5）', H.n===2 && H.used===5, JSON.stringify(H));

  const I=await ev(()=>{
    // 超上限：把第二套加到 4 → 3+4=7 > 6 应被拦
    const rows=activeFleet().main;
    chQty('main',1,1); const a=usedTotal('constantine');
    chQty('main',1,1); const b=usedTotal('constantine');
    return {a,b};
  });
  check('4b 配队页服役上限跨条目拦（6 放行 / 7 拦）', I.a===6 && I.b===6, JSON.stringify(I));

  const J=await ev(()=>{
    const af=activeFleet();
    // 只给第二套设旗舰 → ⭐ 只应出现在第二行
    setFlagship('main|1'); renderAll();
    const html=document.getElementById('mainList').innerHTML;
    const stars=(html.match(/⭐/g)||[]).length;
    const opts=document.getElementById('flagship').innerHTML;
    return {stars, sel:document.getElementById('flagship').value,
            optCount:(opts.match(/<option/g)||[]).length, optHasMods:/M2/.test(opts)};
  });
  check('4c 旗舰按「条目」定位：只有一行有 ⭐', J.stars===1, JSON.stringify(J));
  check('4d 旗舰下拉能区分同型舰的模块（显示 M2）', J.optHasMore===undefined && J.optCount===3 && J.optHasMods, JSON.stringify(J));

  const K=await ev(()=>{
    // 导出给模拟器的旗舰应是舰船 id
    const f=exportFleet();
    return {flagship:f.flagship, main:f.main.length};
  });
  check('4e 导出旗舰为舰船 id（模拟器能认）', K.flagship==='constantine', JSON.stringify(K));

  const L=await ev(()=>{
    // AI 导入兼容：旗舰写成裸 id
    localStorage.setItem('lagrange_fleet_import', JSON.stringify({name:'AI旗舰测试',desc:'',reason:'',
      main:[{id:'constantine',name:'大帝',pos:'中排',qty:2,mods:{},air:[]},
            {id:'sun-whale',name:'太阳鲸',pos:'后排',qty:1,mods:{M:'M2'},air:[]}],
      reinforcement:[], air:[], flagship:'sun-whale'}));
    importFromAI();
    renderAll();
    const html=document.getElementById('mainList').innerHTML;
    return {stars:(html.match(/⭐/g)||[]).length, val:document.getElementById('flagship').value};
  });
  check('4f 旧格式旗舰（裸舰船 id）仍能识别', L.stars===1 && L.val==='main|1', JSON.stringify(L));

  say('\n===== 运行期错误 =====');
  if(!errs.length) say('（无）'); else [...new Set(errs)].forEach(e=>say('  '+e));
  say('\n===== FAIL 汇总 =====');
  const f=results.filter(r=>!r.ok); if(!f.length) say('（全部 PASS）'); else f.forEach(x=>say('  ✗ '+x.n+' → '+x.d));
  fs.writeFileSync('_fleet_test9.log',LOG.join('\n'),'utf8');
  await b.close();
})().catch(e=>{ console.error('HARNESS ERROR',e); process.exit(1); });
