/* 验证：载机总数不再被母舰数量乘倍（配队页 18 → 战斗 18，而非 18×6=108） */
const puppeteer=require('puppeteer-core');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
function check(n,ok,d){ if(ok){pass++;console.log('PASS '+n+(d?('  → '+d):''));} else {fail++;console.log('FAIL '+n+(d?'  → '+d:''));} }
(async()=>{
  const b=await puppeteer.launch({executablePath:EDGE,headless:'new',protocolTimeout:300000,args:['--no-sandbox','--disable-gpu']});
  const p=await b.newPage();
  p.on('dialog',async d=>{ try{ await d.accept(); }catch(e){} });
  p.on('pageerror',e=>console.log('PAGEERROR: '+e.message));
  await p.goto('http://127.0.0.1:3888/simulator.html',{waitUntil:'load',timeout:90000});
  await sleep(4000);

  const R=await p.evaluate(()=>{
    FLEET_TYPES.forEach(k=>{ fleetData[k].main=[]; fleetData[k].reinforcement=[]; fleetData[k].flagship=null; });
    // 复刻用户场景：大矛 ×6 带 B2（护航艇位 3/艘 → 容量 18），配 系统支援×10 + 维修支援×8
    const f=fleetData['ally-escort'];
    f.main=[{uid:'a1',id:'uranus-spear',name:'乌拉诺斯之矛',count:6,position:'前排',
             modules:{},selectedModules:{B:'B2'},
             aircraft:[Object.assign({},JSON.parse(JSON.stringify(SHIP_DATABASE['hayabusa-corvette'])),{count:10,slot:'B2|corvette'}),
                       Object.assign({},JSON.parse(JSON.stringify(SHIP_DATABASE['hayabusa-B'])),{count:8,slot:'B2|corvette'})]}];
    recalcAircraftSlots(f.main[0]);
    const slots=(f.main[0].simSlots||[]).map(x=>x.key+'='+x.cap);
    const entryTotal=f.main[0].aircraft.reduce((a,x)=>a+x.count,0);
    fleetData['enemy-escort'].main=[{uid:'e1',id:'constantine',name:'大帝',count:1,position:'中排',
        modules:{},selectedModules:{},aircraft:[]}];
    recalcAircraftSlots(fleetData['enemy-escort'].main[0]);
    refreshFleetViews();
    const ok=prepareBattle();
    const st=battleState;
    const air={};
    (st?st.allyShips:[]).filter(s=>s.position==='aircraft').forEach(s=>{ air[s.name]=(air[s.name]||0)+1; });
    const airTotal=Object.values(air).reduce((a,b)=>a+b,0);
    return {slots, entryTotal, air, airTotal,
            carrierUnits:(st?st.allyShips.filter(s=>s.id==='uranus-spear').length:0),
            inEscortGroup:(st?st.allyEscort.filter(s=>s.position==='aircraft').length:-1),
            total:(st?st.allyShips.length:-1)};
  });
  console.log(JSON.stringify(R,null,1));
  check('大矛×6 + B2 → 护航艇位容量 18', (R.slots||[]).join('')==='B2|corvette=18', JSON.stringify(R.slots));
  check('配队页条目载机合计 = 18', R.entryTotal===18, String(R.entryTotal));
  check('★ 战斗里载机总数 = 18（不再 ×6=108）', R.airTotal===18, JSON.stringify(R.air));
  check('护航/被护航分组里也是 18', R.inEscortGroup===18, String(R.inEscortGroup));
  check('母舰 6 个实例都在', R.carrierUnits===6, String(R.carrierUnits));
  check('我方总实例 = 6 母舰 + 18 载机 = 24', R.total===24, String(R.total));

  // 再验一个：载机少于母舰数量时也不能变多
  const R2=await p.evaluate(()=>{
    const f=fleetData['ally-escort'];
    f.main[0].count=6;
    f.main[0].aircraft=[Object.assign({},JSON.parse(JSON.stringify(SHIP_DATABASE['hayabusa-B'])),{count:2,slot:'B2|corvette'})];
    recalcAircraftSlots(f.main[0]);
    refreshFleetViews();
    prepareBattle();
    const air=battleState.allyShips.filter(s=>s.position==='aircraft');
    return {n:air.length, names:air.map(x=>x.name)};
  });
  check('载机数(2) < 母舰数(6) 时也不放大', R2.n===2, JSON.stringify(R2));

  console.log('\n通过 '+pass+' / 失败 '+fail);
  await b.close();
  process.exit(fail?1:0);
})().catch(e=>{ console.error('HARNESS ERROR',e); process.exit(1); });
