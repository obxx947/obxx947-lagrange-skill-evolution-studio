/* 验证：①强化弹窗修复 ②模块切换对战斗的实际影响 ③强化是否真的进入战斗计算 */
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

  /* ===== ① 强化弹窗 ===== */
  const A=await p.evaluate(()=>{
    FLEET_TYPES.forEach(k=>{ fleetData[k].main=[]; fleetData[k].reinforcement=[]; });
    currentFleetType='ally-escort'; currentFleetTab='main';
    spkFleetType='ally-escort'; spkTab='main'; spkSel=[];
    spkToggle('uranus-spear'); spkToggle('tianji'); spkConfirm();   // 一艘超主力 + 一艘普通舰
    refreshFleetViews();
    const list=fleetData['ally-escort'].main;
    const sp=list.find(s=>s.id==='uranus-spear'), tj=list.find(s=>s.id==='tianji');
    // 普通舰（天玑护航艇）强化
    openStrengthen(rowKey(tj));
    const tjHtml=document.getElementById('strengthenModal').innerHTML;
    const tjHasWeapon=/slider-row/.test(tjHtml) || /单发伤害/.test(tjHtml);
    const tjNoWeapon=/没有武器系统/.test(tjHtml);
    // 超主力（大矛）强化
    openStrengthen(rowKey(sp));
    const spHtml=document.getElementById('strengthenModal').innerHTML;
    const spEmpty=!/单发伤害/.test(spHtml); const spHasWeapon=/单发伤害/.test(spHtml);
    const spNoWeapon=/没有武器系统/.test(spHtml);
    // 面板点船 → 管理器弹窗不该是空的
    showShipManager('ally-escort', rowKey(sp));
    const mgrHtml=document.getElementById('shipManager').innerHTML;
    return {tjHasWeapon, tjNoWeapon, spEmpty, spNoWeapon, spHasWeapon,
            mgrHasName:/乌拉诺斯之矛/.test(mgrHtml), mgrLen:mgrHtml.length};
  });
  check('① 普通舰(天玑)强化列出武器滑杆', A.tjHasWeapon===true, JSON.stringify({有滑杆:A.tjHasWeapon,提示无武器:A.tjNoWeapon}));
  check('① 超主力(大矛)强化现在列出武器滑杆（补齐模块武器后）', A.mgrLen>0 && A.spHasWeapon===true, JSON.stringify({提示无武器:A.spNoWeapon}));
  check('① 面板点船的管理弹窗有内容（原来空白）', A.mgrHasName===true, 'html长度='+A.mgrLen);

  /* ===== ② 模块切换对战斗的影响 ===== */
  const B=await p.evaluate(()=>{
    const list=fleetData['ally-escort'].main;
    const sp=list.find(s=>s.id==='uranus-spear');
    const out={};
    // B1 → B2
    sp.selectedModules={B:'B1'}; recalcAircraftSlots(sp); refreshFleetViews();
    fleetData['enemy-escort'].main=[{uid:'e1',id:'constantine',name:'大帝',count:1,position:'中排',
        modules:{},selectedModules:{},aircraft:[]}];
    recalcAircraftSlots(fleetData['enemy-escort'].main[0]);
    prepareBattle();
    const i1=battleState.allyShips.find(s=>s.id==='uranus-spear');
    out.b1={weapons:i1.weaponStates.length, air:(i1.simSlots||[]).map(x=>x.key+'='+x.cap), hp:i1.hp};
    // 切到 B2
    sp.selectedModules={B:'B2'}; recalcAircraftSlots(sp); refreshFleetViews();
    prepareBattle();
    const i2=battleState.allyShips.find(s=>s.id==='uranus-spear');
    out.b2={weapons:i2.weaponStates.length, air:(i2.simSlots||[]).map(x=>x.key+'='+x.cap), hp:i2.hp};
    return out;
  });
  check('② 模块切换改变了载机位（B1无 → B2有护航艇位）',
        JSON.stringify(B.b1.air)!==JSON.stringify(B.b2.air) && (B.b2.air||[]).join('').indexOf('B2|corvette')>=0,
        JSON.stringify(B));
  check('② 模块切换【已能】改变武器（B1=5门 / B2=4门）', B.b1.weapons>0 && B.b2.weapons>0 && B.b1.weapons!==B.b2.weapons,
        'B1武器数='+B.b1.weapons+' B2武器数='+B.b2.weapons);

  /* ===== ③ 强化是否进入战斗计算 ===== */
  const C=await p.evaluate(()=>{
    const list=fleetData['ally-escort'].main;
    const tj=list.find(s=>s.id==='tianji');
    tj.count=1;
    const before={};
    prepareBattle();
    let i=battleState.allyShips.find(s=>s.id==='tianji');
    before.dmg=i?i.weaponStates[0]?.weapon?.singleDmg:null;
    before.st=i?JSON.stringify(i.weaponStates[0]?.strengthen):null;
    // 加 50% 单发伤害强化
    tj.strengthen={'M1':{0:{dmgBonus:50,lockReduction:0,cooldownReduction:0,critRate:0,critDmg:0,flightTimeReduction:0}}};
    prepareBattle();
    i=battleState.allyShips.find(s=>s.id==='tianji');
    const after={};
    after.st=i?JSON.stringify(i.weaponStates[0]?.strengthen):null;
    after.key=i?i.weaponStates[0]?.strengthenKey:null;
    return {before, after};
  });
  check('③ 强化值被带进战斗（strengthen 传入 weaponStates）',
        /dmgBonus":(0|undefined)/.test(C.before.st||'') || C.before.st===null ? /dmgBonus":50/.test(C.after.st||'') : false,
        JSON.stringify(C));

  /* ===== ④ 结构值强化生效 ===== */
  const D=await p.evaluate(()=>{
    const list=fleetData['ally-escort'].main;
    const tj=list.find(s=>s.id==='tianji');
    const base=SHIP_DATABASE['tianji'].hp;
    tj.hpBonus=0; prepareBattle();
    const h0=battleState.allyShips.find(s=>s.id==='tianji').hp;
    tj.hpBonus=50; prepareBattle();
    const h1=battleState.allyShips.find(s=>s.id==='tianji').hp;
    return {base, h0, h1};
  });
  check('④ 结构值+50% 在战斗里生效', D.h1>D.h0 && Math.abs(D.h1-D.base*1.5)<2, JSON.stringify(D));

  console.log('\n通过 '+pass+' / 失败 '+fail);
  await b.close();
  process.exit(fail?1:0);
})().catch(e=>{ console.error('HARNESS ERROR',e); process.exit(1); });
