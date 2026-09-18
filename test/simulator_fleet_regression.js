/* 第八轮：模拟器舰队编辑区与配队页一致 + 载机往返不丢 + 存储不再互相覆盖 */
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

  /* ---------- 1. 模拟器：载机位模型 = ---------- */
  say('===== 1. 模拟器载机位改用 FleetCheck.airSlots =====');
  await p.goto(BASE+'simulator.html',{waitUntil:'load',timeout:90000});
  await new Promise(r=>setTimeout(r,4000));
  const A=await ev(()=>{
    const e=JSON.parse(JSON.stringify(SHIP_DATABASE['sun-whale']));
    e.count=1; e.selectedModules={M:'M2',C:'C1'}; e.aircraft=[];
    recalcAircraftSlots(e);
    const e2=JSON.parse(JSON.stringify(SHIP_DATABASE['uranus-spear']));
    e2.count=4; e2.selectedModules={B:'B2'}; e2.aircraft=[]; recalcAircraftSlots(e2);
    return {sun:e.simSlots.map(s=>s.key+'='+s.cap+'/'+s.allow),
            sunAgg:e.aircraftSlots, spear:e2.simSlots.map(s=>s.key+'='+s.cap),
            noModShip:(()=>{ const x=JSON.parse(JSON.stringify(SHIP_DATABASE['constantine']));
              x.count=1; x.selectedModules={}; x.aircraft=[]; recalcAircraftSlots(x); return x.simSlots.length; })()};
  });
  check('1a 太阳鲸 M2+C1 → 两个独立载机位', JSON.stringify(A.sun)===JSON.stringify(['M2|fighter=8/ALL','C1|fighter=5/ALL']), JSON.stringify(A.sun));
  check('1b 容量随数量放大（大矛B2×4=12）', JSON.stringify(A.spear)===JSON.stringify(['B2|corvette=12']), JSON.stringify(A.spear));
  check('1c 未选模块的战巡 → 无载机位', A.noModShip===0, String(A.noModShip));

  /* ---------- 2. 模拟器编辑区外观与配队页一致 ---------- */
  say('\n===== 2. 舰队编辑行（服役/站位/模块/数量/载机） =====');
  const B=await ev(()=>{
    fleetData['ally-escort'].main=[]; fleetData['ally-escort'].reinforcement=[];
    currentFleetType='ally-escort'; currentFleetTab='main';
    spkFleetType='ally-escort'; spkTab='main'; spkSel=[]; spkToggle('sun-whale'); spkConfirm();
    spkFleetType='ally-escort'; spkTab='main'; spkSel=[]; spkToggle('constantine'); spkConfirm();
    toggleFleetPanel('ally-escort');
    const html=document.getElementById('inlineFleetEditor').innerHTML;
    const rows=document.querySelectorAll('#inlineFleetEditor .frow').length;
    const airboxes=document.querySelectorAll('#inlineFleetEditor .airbox').length;
    return {rows, airboxes, hasPos:/class="fpos"/.test(html), hasQty:/class="fqty/.test(html),
            hasServed:/服役 1\//.test(html), hasModBtn:/openSimMods/.test(html),
            head:document.querySelector('#inlineFleetEditor .frow')?.innerText.replace(/\s+/g,' ').slice(0,90)};
  });
  check('2a 渲染出与配队页同款行（frow + 站位 + 数量）', B.rows===2 && B.hasPos && B.hasQty, JSON.stringify({rows:B.rows,pos:B.hasPos,qty:B.hasQty}));
  check('2b 显示「服役 已用/上限」', B.hasServed, B.head);
  check('2c 有模块按钮', B.hasModBtn, String(B.hasModBtn));
  say('   首行：'+B.head);

  const C=await ev(()=>{ simCyclePos('constantine');
    const s=fleetData['ally-escort'].main.find(x=>x.id==='constantine');
    return {pos:s.position}; });
  check('2d 站位可点击切换（写进 position，战斗会用到）', ['前排','中排','后排'].indexOf(C.pos)>=0, JSON.stringify(C));

  /* ---------- 3. 载机：模块门控 + 位独立 + 服役整队 ---------- */
  say('\n===== 3. 载机位操作（选模块才有位 / 位独立 / 整队服役） =====');
  const D=await ev(()=>{
    const s=fleetData['ally-escort'].main.find(x=>x.id==='sun-whale');
    recalcAircraftSlots(s);
    const before=s.simSlots.length;                       // 无模块 → 0 位
    // 选 M2 模块
    s.selectedModules={M:'M2'}; recalcAircraftSlots(s);
    const after=s.simSlots.map(x=>x.key);
    // 塞 8 架天璇到 M2 位
    simAirTarget=null; currentFleetTab='main';
    simAirSet('sun-whale','tianxuan','M2|fighter',8);
    const s2=fleetData['ally-escort'].main.find(x=>x.id==='sun-whale');
    return {before, after, air:s2.aircraft.map(a=>a.name+'×'+a.count+'@'+a.slot), used:simSlotUsed(s2,'M2|fighter')};
  });
  check('3a 未选模块→0 个载机位；选 M2→1 个位', D.before===0 && JSON.stringify(D.after)===JSON.stringify(['M2|fighter']), JSON.stringify(D));
  check('3b 载机按「完整船对象+count+slot」存入', D.air.length===1 && /×8@M2\|fighter/.test(D.air[0]), JSON.stringify(D.air));

  const E=await ev(()=>{
    let res={};
    // 超该位容量（M2 只有 8）→ 应被挡
    const s=fleetData['ally-escort'].main.find(x=>x.id==='sun-whale');
    const n0=s.aircraft.length;
    simAirSet('sun-whale','mistral','M2|fighter',5);     // 位已满 → 不应加入
    res.fullBlocked = s.aircraft.filter(a=>a.id==='mistral').length===0;
    // 该位只能带战机，护航艇不该出现在候选里
    openSimAirPicker('sun-whale','M2|fighter');
    const list=document.getElementById('simAirList').innerHTML;
    res.onlyFighter = list.indexOf('天玑')<0 && list.indexOf('天璇')>=0;
    res.title=document.getElementById('simAirTitle').textContent;
    closeModal('simAirModal');
    // 战机整队服役上限：天璇上限10，主舰队已 8 → 再加 5 只能到 2
    res.servCap = simAirSet && (()=>{ const t=SHIP_DATABASE['tianxuan'].serviceLimit; return t; })();
    return Object.assign({n0},res);
  });
  check('3c 载机位已满 → 不再加入', E.fullBlocked===true, JSON.stringify(E));
  check('3d 该位只列战机（M2 是战机位）', E.onlyFighter===true, E.title);

  /* ---------- 4. 配队页 → 模拟器：载机不丢（本轮核心） ---------- */
  say('\n===== 4. 复制到模拟器：载机必须一起过去 =====');
  await p.goto(BASE+'fleet.html',{waitUntil:'load',timeout:90000});
  await new Promise(r=>setTimeout(r,3000));
  await ev(()=>{
    newPlan();
    const af=activeFleet();
    af.main=[
      {id:'sun-whale',name:'太阳鲸-武装战略航空母舰',pos:'后排',qty:1,mods:{M:'M2',C:'C1'},
       air:[{id:'tianxuan',name:'天璇A-轻型攻击机',kind:'fighter',slot:'M2|fighter',qty:8},
            {id:'mistral',name:'米斯特拉-战斗攻击机',kind:'fighter',slot:'C1|fighter',qty:5}]},
      {id:'uranus-spear',name:'乌拉诺斯之矛',pos:'中排',qty:4,mods:{B:'B2'},
       air:[{id:'tianji',name:'天玑-重型护航艇',kind:'corvette',slot:'B2|corvette',qty:12}]},
      {id:'plutus-shield',name:'普鲁图斯之盾级-防护战列巡洋舰',pos:'前排',qty:5,mods:{B:'B1'},air:[]}
    ];
    af.reinforce=[{id:'tianshu',name:'天枢级-支援航空母舰',pos:'增援',qty:2,mods:{M:'M1'},
       air:[{id:'tianxuan',name:'天璇A-轻型攻击机',kind:'fighter',slot:'M1|fighter',qty:4}]}];
    fillPos(cur); renderAll();
    simPick('ally-escorted',null);
    document.querySelector('input[name="simMode"][value="replace"]').checked=true;
    simConfirm();
    return true;
  });
  await p.goto(BASE+'simulator.html?import=1',{waitUntil:'load',timeout:90000});
  await new Promise(r=>setTimeout(r,5000));
  const F=await ev(()=>{
    const f=fleetData['ally-escorted'];
    return {main:f.main.map(s=>({id:s.id,pos:s.position,qty:s.count,mods:Object.values(s.selectedModules||{}).join('+'),
              air:(s.aircraft||[]).map(a=>a.name+'×'+a.count+'@'+a.slot),
              slots:(s.simSlots||[]).map(x=>x.key+'='+x.cap)})),
            rein:f.reinforcement.map(s=>({id:s.id,air:(s.aircraft||[]).map(a=>a.name+'×'+a.count+'@'+a.slot)}))};
  });
  say('导入结果:\n'+JSON.stringify(F,null,1));
  const sw=F.main.find(x=>x.id==='sun-whale');
  const sp=F.main.find(x=>x.id==='uranus-spear');
  const pr=F.main.find(x=>x.id==='plutus-shield');
  const ts=F.rein.find(x=>x.id==='tianshu');
  check('4a 主舰队 3 条 + 增援 1 条 全部导入', F.main.length===3 && F.rein.length===1, JSON.stringify({m:F.main.length,r:F.rein.length}));
  check('4b 太阳鲸载机 8@M2 位 + 5@C1 位 都过来了', sw.air.length===2 && /×8@M2\|fighter/.test(sw.air[0]) && /×5@C1\|fighter/.test(sw.air[1]), JSON.stringify(sw.air));
  check('4c 大矛 B2 护航艇 12 架过来了', sp.air.length===1 && /×12@B2\|corvette/.test(sp.air[0]), JSON.stringify(sp.air));
  check('4d 增援天枢的载机也过来了', ts.air.length===1 && /×4@M1\|fighter/.test(ts.air[0]), JSON.stringify(ts.air));
  check('4e 站位一起过来（前排/中排/后排）', pr.pos==='前排' && sp.pos==='中排' && sw.pos==='后排', JSON.stringify([pr.pos,sp.pos,sw.pos]));
  check('4f 模块选择一起过来（M2+C1 / B2）', sw.mods==='M2+C1' && sp.mods==='B2', JSON.stringify([sw.mods,sp.mods]));
  check('4g 载机位按模块算出来（太阳鲸 M2=8 / C1=5）', JSON.stringify(sw.slots)===JSON.stringify(['M2|fighter=8','C1|fighter=5']), JSON.stringify(sw.slots));

  const G=await ev(()=>{
    const f=fleetData['ally-escorted'];
    return {airCount:[...f.main,...f.reinforcement].reduce((n,s)=>n+(s.aircraft||[]).reduce((a,x)=>a+(x.count||0),0),0)};
  });
  check('4h 载机总数 = 8+5+12+4 = 29', G.airCount===29, 'airCount='+G.airCount);

  /* ---------- 5. 存储不再互相覆盖 ---------- */
  say('\n===== 5. 模拟器与配队页存储互不覆盖 =====');
  const H=await ev(()=>{
    // 在配队页存一套方案
    return null;
  });
  await p.goto(BASE+'fleet.html',{waitUntil:'load',timeout:90000});
  await new Promise(r=>setTimeout(r,3000));
  const I=await ev(()=>{ newPlan(); document.getElementById('planName').value='存储测试方案'; cur.name='存储测试方案';
    activeFleet().main=[{id:'constantine',name:'大帝',pos:'中排',qty:1,mods:{M:'M1'},air:[]}];
    savePlan();
    return {plans:store.plans.map(x=>x.name), sim_key:localStorage.getItem('lagrange_sim_fleets')?'有':'无'}; });
  check('5a 配队页保存成功', I.plans.indexOf('存储测试方案')>=0, JSON.stringify(I.plans));
  // 去模拟器加船（会触发 saveFleetsToStorage）
  await p.goto(BASE+'simulator.html',{waitUntil:'load',timeout:90000});
  await new Promise(r=>setTimeout(r,4000));
  await ev(()=>{ currentFleetType='enemy-escort'; currentFleetTab='main';
    spkFleetType='enemy-escort'; spkTab='main'; spkSel=[]; spkToggle('constantine'); spkConfirm(); });
  // 回配队页看方案还在不在
  await p.goto(BASE+'fleet.html',{waitUntil:'load',timeout:90000});
  await new Promise(r=>setTimeout(r,3000));
  const J=await ev(()=>({plans:store.plans.map(x=>x.name),
    simKey:localStorage.getItem('lagrange_sim_fleets')?'有':'无',
    legacy:localStorage.getItem('lagrange_fleets')?'有':'无'}));
  check('5b 模拟器保存后，配队页的方案仍在（不再被覆盖）', J.plans.indexOf('存储测试方案')>=0, JSON.stringify(J));

  say('\n===== 运行期错误 =====');
  if(!errs.length) say('（无）'); else [...new Set(errs)].forEach(e=>say('  '+e));
  say('\n===== FAIL 汇总 =====');
  const f=results.filter(r=>!r.ok); if(!f.length) say('（全部 PASS）'); else f.forEach(x=>say('  ✗ '+x.n+' → '+x.d));
  fs.writeFileSync('_fleet_test8.log',LOG.join('\n'),'utf8');
  await b.close();
})().catch(e=>{ console.error('HARNESS ERROR',e); process.exit(1); });
