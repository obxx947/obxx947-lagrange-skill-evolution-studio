/* 第七轮：模拟器选船重做 / 数据统一 / 4舰队目标 / 校验器 */
const puppeteer=require('puppeteer-core');
const fs=require('fs');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE='http://127.0.0.1:3888/';
const LOG=[]; function say(...a){ const s=a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '); LOG.push(s); console.log(s); }
const results=[]; function check(n,ok,d){ results.push({n,ok:!!ok,d}); say((ok?'PASS ':'FAIL ')+n+(d?('  → '+d):'')); }

(async()=>{
  const b=await puppeteer.launch({executablePath:EDGE,headless:'new',args:['--no-sandbox','--disable-gpu']});
  const p=await b.newPage();
  p.on('dialog',async d=>{ try{ await d.accept(); }catch(e){} });
  const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/favicon/.test(m.text())) errs.push('CONSOLE: '+m.text()); });
  const ev=async(fn,...a)=>{ try{ return await p.evaluate(fn,...a); }catch(e){ return {__err:String(e.message)}; } };

  /* ============ A. 模拟器：数据源统一 ============ */
  say('===== A. 模拟器改用 ship_database.json 单一数据源 =====');
  await p.goto(BASE+'simulator.html',{waitUntil:'load',timeout:60000});
  await new Promise(r=>setTimeout(r,3500));
  const A=await ev(()=>{
    const g=id=>SHIP_DATABASE[id];
    return {ready:SHIP_DB_READY, n:Object.keys(SHIP_DATABASE).length,
      br050a:g('BR050-A')&&g('BR050-A').serviceLimit,
      connA:g('connemara-A')&&g('connemara-A').commandValue,
      connB:g('connemara-B')&&g('connemara-B').serviceLimit,
      antontas:g('antontas')&&g('antontas').serviceLimit,
      fsv380:!!g('FSV380'), fsv830:!!g('FSV830'),
      tianji_cmd:g('tianji')&&g('tianji').commandValue,
      hasAirSlots:!!(g('sun-whale')&&g('sun-whale').airSlots),
      wfA:g('wildfire-AA-A')&&g('wildfire-AA-A').name, wfB:g('wildfire-AA-B')&&g('wildfire-AA-B').name};
  });
  check('A1 模拟器加载 JSON 数据源（200 艘）', A.ready===true && A.n===200, JSON.stringify({ready:A.ready,n:A.n}));
  check('A2 5 条数据修正已在模拟器生效', A.br050a===10 && A.connA===16 && A.connB===8 && A.antontas===3,
        JSON.stringify({BR050:A.br050a,connA:A.connA,connB:A.connB,antontas:A.antontas}));
  check('A3 已删的 FSV380 消失、新增 FSV830 存在', A.fsv380===false && A.fsv830===true, JSON.stringify({FSV380:A.fsv380,FSV830:A.fsv830}));
  check('A4 战机人口=0（旧内联数据是 10，会虚增人口）', A.tianji_cmd===0, '天玑 commandValue='+A.tianji_cmd);
  check('A5 模拟器拿到模块载机位 airSlots', A.hasAirSlots===true, String(A.hasAirSlots));
  check('A6 两艘野火格斗护航艇已区分 A/B 型', A.wfA!==A.wfB && /A型/.test(A.wfA||'') && /B型/.test(A.wfB||''), A.wfA+' | '+A.wfB);

  /* ============ B. 模拟器：选船弹窗 ============ */
  say('\n===== B. 模拟器选船弹窗（3列/筛选/多选/确认） =====');
  const B=await ev(()=>{
    const hasModal=!!document.getElementById('shipPickerModal');
    const grid=!!document.getElementById('spkGrid');
    const oldGrid=!!document.getElementById('shipListGrid');
    return {hasModal,grid,oldGrid};
  });
  check('B1 新选船弹窗存在、旧船库网格已移除', B.hasModal && B.grid && !B.oldGrid, JSON.stringify(B));

  // 打开弹窗：默认目标 = 当前编辑舰队
  await ev(()=>{ toggleFleetPanel('enemy-escort'); });
  await new Promise(r=>setTimeout(r,200));
  const B2=await ev(()=>{ openShipPicker();
    return {open:document.getElementById('shipPickerModal').classList.contains('active'),
      target:$('spkFleet').value, tab:document.getElementById('spkTabMain').classList.contains('active'),
      cards:document.querySelectorAll('#spkGrid .spk-card').length,
      filters:document.querySelectorAll('#spkFilters .category-btn').length}; });
  check('B2 弹窗打开、目标=当前舰队(enemy-escort)、3列网格渲染', B2.open && B2.target==='enemy-escort' && B2.cards>100 && B2.filters===8, JSON.stringify(B2));

  const B3=await ev(()=>{ spkSetFilter('cruiser'); const n=document.querySelectorAll('#spkGrid .spk-card').length;
    spkSetFilter('all'); const n2=document.querySelectorAll('#spkGrid .spk-card').length;
    return {cruiser:n, all:n2}; });
  check('B3 舰种筛选生效（巡洋舰 < 全部）', B3.cruiser>0 && B3.cruiser<B3.all, JSON.stringify(B3));

  const B4=await ev(()=>{ spkSel=[]; renderShipPicker();
    spkToggle('constantine'); spkToggle('sun-whale');
    return {sel:document.querySelectorAll('#spkGrid .spk-card.sel').length, cnt:document.getElementById('spkSel').textContent}; });
  check('B4 多选状态与计数', B4.sel===2 && B4.cnt==='2', JSON.stringify(B4));

  const B5=await ev(()=>{ spkConfirm();
    const f=fleetData['enemy-escort'];
    return {open:document.getElementById('shipPickerModal').classList.contains('active'),
      main:f.main.map(s=>s.id+'×'+s.count), rein:f.reinforcement.length}; });
  check('B5 确认后加入所选舰队且弹窗关闭', B5.open===false && B5.main.some(x=>x.indexOf('constantine')===0) && B5.main.some(x=>x.indexOf('sun-whale')===0), JSON.stringify(B5));

  const B6=await ev(()=>{ openShipPicker(); spkSetTab('reinforcement');
    spkSel=[]; spkToggle('tianquan'); spkConfirm();
    const f=fleetData['enemy-escort'];
    return {rein:f.reinforcement.map(s=>s.id+'×'+s.count), tab:document.getElementById('spkTabRein')}; });
  check('B6 可在弹窗内切到「增援舰队」并加入', B6.rein.length===1 && B6.rein[0].indexOf('tianquan')===0, JSON.stringify(B6.rein));

  const B7=await ev(()=>{ // 服役上限：整队口径（主力+增援合计）
    fleetData['enemy-escort'].main=[]; fleetData['enemy-escort'].reinforcement=[];
    stitchMode=false;
    const lim=SHIP_DATABASE['antontas'].serviceLimit;   // 修正后 = 3
    for(let k=0;k<4;k++){ openShipPicker(); if(k===0) spkSetTab('main'); spkSel=[]; spkToggle('antontas'); spkConfirm(); }
    const f=fleetData['enemy-escort'];
    const inMain=f.main.find(s=>s.id==='antontas'), inRein=f.reinforcement.find(s=>s.id==='antontas');
    return {lim, main:(inMain&&inMain.count)||0, rein:(inRein&&inRein.count)||0}; });
  check('B7 服役上限用修正后的值(3)拦截第4艘', B7.lim===3 && (B7.main+B7.rein)===3, JSON.stringify(B7));

  const B8=await ev(()=>{ // 缝合模式放行
    stitchMode=true; openShipPicker(); spkSetTab('main'); spkSel=[]; spkToggle('antontas'); spkConfirm();
    const f=fleetData['enemy-escort'];
    const e=f.main.find(s=>s.id==='antontas');
    stitchMode=false;
    return {count:(e&&e.count)||0}; });
  check('B8 缝合模式忽略服役上限', B8.count===4, JSON.stringify(B8));

  /* ============ C. 校验器：载机不得强塞 ============ */
  say('\n===== C. 校验器（fleet_check）：载机合法性 / 权威数字 / 舰船库 =====');
  await p.goto(BASE+'fleet.html',{waitUntil:'load',timeout:60000});
  await new Promise(r=>setTimeout(r,2500));
  const C=await ev(()=>{
    const out={};
    // C1：太阳鲸【没选模块】→ 无载机位 → 塞战机必须报错
    out.C1=FleetCheck.check({name:'t',main:[{id:'sun-whale',name:'太阳鲸',qty:1,mods:{},air:[{id:'tianxuan',name:'天璇',kind:'fighter',qty:8}]}],reinforcement:[]});
    // C2：太阳鲸选了 M2（有战机位）→ 应通过
    out.C2=FleetCheck.check({name:'t',main:[{id:'sun-whale',name:'太阳鲸',qty:1,mods:{M:'M2'},air:[{id:'tianxuan',name:'天璇',kind:'fighter',qty:8}]}],reinforcement:[]});
    // C3：太阳鲸选 M2 却要塞【护航艇】→ M2 只有战机位 → 报错
    out.C3=FleetCheck.check({name:'t',main:[{id:'sun-whale',name:'太阳鲸',qty:1,mods:{M:'M2'},air:[{id:'tianji',name:'天玑',kind:'corvette',qty:5}]}],reinforcement:[]});
    // C4：大帝（战巡，无任何载机位）塞战机 → 报错
    out.C4=FleetCheck.check({name:'t',main:[{id:'constantine',name:'大帝',qty:1,mods:{},air:[{id:'tianxuan',name:'天璇',kind:'fighter',qty:4}]}],reinforcement:[]});
    // C5：仅中小型战机的载机位塞大型机 → 报错
    out.C5=FleetCheck.check({name:'t',main:[{id:'eternal-vault',name:'永恒苍穹',qty:1,mods:{M:'M1'},air:[{id:'stingray',name:'刺鳐',kind:'fighter',qty:3}]}],reinforcement:[]});
    // C6：权威人口（战机不计人口 + 康纳马拉轨道炮=16）
    out.C6=FleetCheck.check({name:'t',main:[
        {id:'connemara-A',name:'轨道炮',qty:2,mods:{},air:[]},
        {id:'tianji',name:'天玑',qty:10,mods:{},air:[]}],reinforcement:[]});
    // C7：服役上限（整队）
    out.C7=FleetCheck.check({name:'t',main:[{id:'antontas',name:'安东塔斯',qty:2,mods:{},air:[]}],
                             reinforcement:[{id:'antontas',name:'安东塔斯',qty:2,mods:{},air:[]}]});
    // C8：增援>9
    out.C8=FleetCheck.check({name:'t',main:[],reinforcement:[{id:'antontas',name:'安东塔斯',qty:10,mods:{},air:[]}]});
    // C9：不存在的船
    out.C9=FleetCheck.check({name:'t',main:[{id:'not-a-ship',name:'不存在号',qty:1,mods:{},air:[]}],reinforcement:[]});
    return out;
  });
  const C1=C.C1, C2=C.C2, C3=C.C3, C4=C.C4, C5=C.C5, C6=C.C6, C7=C.C7, C8=C.C8, C9=C.C9;
  check('C1 太阳鲸未选模块 → 塞战机被报错并剔除', C1.ok===false && C1.fixed.main[0].air.length===0 && /不能携带载机|没有可用的战机载机位/.test(C1.errors.join('')), JSON.stringify(C1.errors));
  check('C2 太阳鲸选 M2 → 战机合法通过', C2.ok===true && C2.fixed.main[0].air.length===1, JSON.stringify(C2.errors));
  check('C3 太阳鲸 M2 塞护航艇 → 报错（M2 只有战机位）', C3.ok===false && C3.fixed.main[0].air.length===0, JSON.stringify(C3.errors));
  check('C4 大帝（无载机位）塞战机 → 报错', C4.ok===false && C4.fixed.main[0].air.length===0, JSON.stringify(C4.errors));
  check('C5 仅中小型的载机位塞大型机 → 报错', C5.ok===false && C5.fixed.main[0].air.length===0, JSON.stringify(C5.errors));
  check('C6 权威人口=CO2*16=32（战机不计人口）', C6.ok===true && C6.stats.pop===32, 'pop='+C6.stats.pop);
  check('C7 服役上限整队口径：2主+2增=4 > 上限3 → 报错', C7.ok===false && /服役超上限/.test(C7.errors.join('')), JSON.stringify(C7.errors));
  check('C8 增援10艘 > 9 → 报错', C8.ok===false && /增援编队 10 艘/.test(C8.errors.join('')), JSON.stringify(C8.errors));
  check('C9 未知舰船 → 报错', C9.ok===false && /未知舰船|不是舰船库里的舰船/.test(C9.errors.join('')), JSON.stringify(C9.errors));

  const C10=await ev(()=>{ // 载机服役上限（整队）：天璇上限10
    return FleetCheck.check({name:'t',main:[{id:'sun-whale',name:'太阳鲸',qty:1,mods:{M:'M2',C:'C1'},air:[
      {id:'tianxuan',name:'天璇',kind:'fighter',slot:'M2|fighter',qty:8},
      {id:'tianxuan',name:'天璇',kind:'fighter',slot:'C1|fighter',qty:5}]}],reinforcement:[]});
  });
  check('C10 载机服役上限整队口径：天璇 13 > 上限10 → 报错', C10.ok===false && /载机「.*」服役超上限/.test(C10.errors.join('')), JSON.stringify(C10.errors));

  /* ============ D. 舰船库校验（启用时） ============ */
  say('\n===== D. 启用「允许AI检索舰船库」时的所有权校验 =====');
  const D=await ev(()=>{
    UserShipDB.save({aiAccess:true, ships:[
      {shipKey:'sun-whale',name:'太阳鲸-武装战略航空母舰',type:'aircraftcarrier',isSuper:true,mods:{M:['M2']},techPoints:0},
      {shipKey:'constantine',name:'新君士坦丁大帝级-综合战列巡洋舰',type:'battlecruiser',isSuper:true,mods:{M:['M1']},techPoints:0}
    ]});
    const owned=FleetCheck.check({name:'t',main:[{id:'constantine',name:'大帝',qty:1,mods:{M:'M1'},air:[]}],reinforcement:[]});
    const notOwned=FleetCheck.check({name:'t',main:[{id:'antontas',name:'安东塔斯',qty:1,mods:{},air:[]}],reinforcement:[]});
    const badMod=FleetCheck.check({name:'t',main:[{id:'constantine',name:'大帝',qty:1,mods:{M:'M2'},air:[]}],reinforcement:[]});
    const airOwned=FleetCheck.check({name:'t',main:[{id:'sun-whale',name:'太阳鲸',qty:1,mods:{M:'M2'},air:[{id:'tianxuan',name:'天璇',kind:'fighter',qty:4}]}],reinforcement:[]});
    return {userChecked:owned.userChecked, o1:owned.ok, o2:notOwned.errors, o3:badMod.errors, o4:airOwned.ok};
  });
  check('D1 舰船库已启用（userChecked=true）', D.userChecked===true, String(D.userChecked));
  check('D2 用拥有的船+拥有的模块 → 通过', D.o1===true, String(D.o1));
  check('D3 用没拥有的船 → 报错', /用户没有/.test((D.o2||[]).join('')), JSON.stringify(D.o2));
  check('D4 用没拥有的模块 → 报错', /用户没有/.test((D.o3||[]).join('')), JSON.stringify(D.o3));
  check('D5 拥有的船+模块挂载机 → 通过', D.o4===true, String(D.o4));
  await ev(()=>{ UserShipDB.save({aiAccess:false, ships:UserShipDB.getOwnedShips()}); });

  /* ============ E. 配队页 → 模拟器：4 个目标舰队 ============ */
  say('\n===== E. 「复制到模拟器」选择目标舰队 =====');
  const E=await ev(()=>{ newPlan(); const af=activeFleet();
    af.main=[{id:'constantine',name:'大帝',pos:'前排',qty:2,mods:{M:'M1'},air:[]}];
    af.reinforce=[{id:'tianquan',name:'天权',pos:'增援',qty:1,mods:{},air:[]}];
    renderAll(); toSimulator();
    const items=document.querySelectorAll('#simTargetList .stim-item');
    return {open:document.getElementById('simTargetModal').classList.contains('show'),
      n:items.length, labels:Array.from(items).map(x=>x.innerText.trim())}; });
  check('E1 弹窗给出 4 个目标舰队', E.open && E.n===4, JSON.stringify(E.labels));
  check('E2 四个选项正是 我方/敌方 · 护航/被护航',
        ['我方护航舰队','我方被护航舰队','敌方护航舰队','敌方被护航舰队'].every(t=>E.labels.join('|').indexOf(t)>=0), JSON.stringify(E.labels));

  const E3=await ev(()=>{ // 选敌方被护航 + 覆盖
    simPick('enemy-escorted',null);
    document.querySelector('input[name="simMode"][value="replace"]').checked=true;
    simConfirm();
    const raw=localStorage.getItem('lagrange_sim_import');
    const j=raw?JSON.parse(raw):null;
    return {target:j&&j.target, mode:j&&j.mode, main:j&&j.main.length, rein:j&&j.reinforcement.length, modal:document.getElementById('simTargetModal').classList.contains('show')}; });
  check('E3 确认后写入目标=enemy-escorted / mode=replace', E3.target==='enemy-escorted' && E3.mode==='replace' && E3.main===1 && E3.rein===1, JSON.stringify(E3));
  check('E4 弹窗已关闭', E3.modal===false, String(E3.modal));

  // 真机：跳到模拟器执行导入
  await p.goto(BASE+'simulator.html',{waitUntil:'load',timeout:60000});
  await new Promise(r=>setTimeout(r,3500));
  await p.evaluate(()=>{ ['ally-escort','ally-escorted','enemy-escort'].forEach(k=>{ fleetData[k].main=[]; fleetData[k].reinforcement=[]; fleetData[k].flagship=null; }); saveFleetsToStorage(); });
  await p.goto(BASE+'simulator.html?import=1',{waitUntil:'load',timeout:60000});
  await new Promise(r=>setTimeout(r,4500));
  const E5=await ev(()=>{ const f=fleetData['enemy-escorted'];
    const others=['ally-escort','ally-escorted','enemy-escort'].map(k=>fleetData[k].main.length+fleetData[k].reinforcement.length);
    return {main:f.main.map(s=>s.id+'×'+s.count), rein:f.reinforcement.map(s=>s.id+'×'+s.count), others}; });
  check('E5 导入落到「敌方被护航」且不影响其他舰队',
        E5.main[0].indexOf('constantine')===0 && E5.rein[0].indexOf('tianquan')===0 && E5.others.every(x=>x===0), JSON.stringify(E5));

  /* ============ F. 三向联动回归 ============ */
  say('\n===== F. 原有联动回归（AI卡片 / 站位 / 配队库） =====');
  await p.goto(BASE+'fleet.html',{waitUntil:'load',timeout:60000});
  await new Promise(r=>setTimeout(r,2500));
  const F=await ev(()=>{ const out={};
    // AI 导入：含非法载机（太阳鲸没选模块）→ 应被剔除并给出报告
    const aiFleet={name:'AI测试',desc:'',reason:'',
      main:[{id:'sun-whale',name:'太阳鲸',pos:'后排',qty:1,mods:{},air:[{id:'tianxuan',name:'天璇A-轻型攻击机',kind:'fighter',qty:6}]},
            {id:'plutus-shield',name:'大盾',pos:'前排',qty:5,mods:{B:'B1'},air:[]}],
      reinforcement:[], air:[]};
    localStorage.setItem('lagrange_fleet_import', JSON.stringify(aiFleet));
    out.imported=importFromAI();
    out.main=activeFleet().main.map(s=>s.id+'/'+s.pos+'/'+s.qty+'/air'+((s.air||[]).length));
    out.report=!!document.getElementById('checkReport');
    out.reportText=document.getElementById('checkReport')?document.getElementById('checkReport').innerText.replace(/\s+/g,' ').slice(0,160):'';
    // 站位/配队库
    out.txt=FleetIO.fleetToText(cur);
    out.e=FleetLib.entryFromPlan(cur,{scenario:'回归'}); FleetLib.upsert(out.e);
    out.hit=FleetLib.search('大盾',{topK:3}).length;
    return out; });
  check('F1 AI导入：非法载机被剔除（太阳鲸 0 架）', F.imported===true && F.main[0].indexOf('air0')>=0, JSON.stringify(F.main));
  check('F2 给出校验报告面板', F.report===true, (F.reportText||'').slice(0,120));
  check('F3 站位/主舰队保留', F.main[1].indexOf('前排')>=0, JSON.stringify(F.main));
  check('F4 fleetToText 按站位分组', F.txt.indexOf('│')>=0, F.txt.replace(/\n/g,' | ').slice(0,90));
  check('F5 配队库仍可写入/检索', F.hit>0, 'hits='+F.hit);

  say('\n===== 运行期错误 =====');
  if(!errs.length) say('（无）'); else [...new Set(errs)].forEach(e=>say('  '+e));
  say('\n===== FAIL 汇总 =====');
  const f=results.filter(r=>!r.ok); if(!f.length) say('（全部 PASS）'); else f.forEach(x=>say('  ✗ '+x.n+' → '+x.d));
  fs.writeFileSync('_fleet_test7.log',LOG.join('\n'),'utf8');
  await b.close();
})().catch(e=>{ console.error('HARNESS ERROR',e); process.exit(1); });
