/* 按机制文档验证：锁定冷却并行 / 同目标不重复锁定 / 直射不被拦截 / 母舰毁带走载机 */
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

  /* ① 锁定与冷却并行：一轮打完 → 冷却期间就应已锁定下一个目标 */
  const A=await p.evaluate(()=>{
    // 造一门炮：冷却 10s、锁定 6s、持续 0（瞬发）
    const gun={name:'测试炮',dmgType:'physical',weaponType:'projectile',singleDmg:100,ammo:1,attacks:1,
               atkDuration:0,lockTime:6,cooldown:10,priority:'随机',
               targets:[{types:['战列巡洋舰'],hitMin:100,hitMax:100}]};
    const ship={uid:'u1',id:'constantine',name:'测试舰',count:1,position:'中排',modules:{},
                selectedModules:{},aircraft:[],hp:1e9,
                __testWeapon:gun};
    // 直接构造实例
    const s=createShipInstance(ship,'ally',true,false);
    s.instId='t1';
    s.weaponStates=[{weapon:gun,module:{name:'测试炮',weapons:[gun]},moduleKey:'M1',weaponIndex:0,strengthenKey:'M1',
      strengthen:{dmgBonus:0,lockReduction:0,cooldownReduction:0,critRate:0,critDmg:0},
      currentTarget:null,cooldownRemaining:0,lockRemaining:0,atkRemaining:0,batchTimer:0,
      shotsRemaining:0,batchesRemaining:0,totalShots:1,totalBatches:1,firstShot:true}];
    const dummy={name:'靶子',id:'d1',type:'battlecruiser',size:'large',position:'中排',hp:1e9,maxHp:1e9,alive:true,energyArmor:0,physicalArmor:0,subSystems:[]};
    const bs={allyShips:[s],enemyShips:[dummy],allyEscort:[s],allyEscorted:[],enemyEscort:[dummy],enemyEscorted:[],
              battleMode:'escort',time:0,allyEscortAlive:true,enemyEscortAlive:true};
    // 逐 tick 推进，记录：第一次开火时间、第二次开火时间
    const log=[]; let prevShots=0, fires=[];
    for(let i=0;i<400;i++){
      const t=i*0.1;
      processShipWeapons(s,[dummy],0.1,bs);
      const ws=s.weaponStates[0];
      // 检测"刚打完一轮" → 记录冷却开始
      if(ws.cooldownRemaining>0 && log.length<20) log.push({t:t.toFixed(1),cd:ws.cooldownRemaining.toFixed(1),lock:ws.lockRemaining.toFixed(1)});
      // 检测开火（shotsRemaining 减少）
      if(ws.shotsRemaining<prevShots || (prevShots===0&&ws.shotsRemaining>0)){}
      prevShots=ws.shotsRemaining;
      if(ws.firstShot===false && fires.length===0 && ws.cooldownRemaining>0) fires.push(t);
    }
    return {first20:log.slice(0,6)};
  });
  console.log('① 首轮之后的状态序列:', JSON.stringify(A.first20));

  /* ② 稳态周期：冷却10 + 锁定6 → 并行后应约 10s，串联会是 16s */
  const B=await p.evaluate(()=>{
    const gun={name:'测试炮',dmgType:'physical',weaponType:'projectile',singleDmg:1,ammo:1,attacks:1,
               atkDuration:0,lockTime:6,cooldown:10,targets:[{types:['战列巡洋舰'],hitMin:100,hitMax:100}]};
    const ship={uid:'u2',id:'constantine',name:'测',count:1,position:'中排',modules:{},selectedModules:{},aircraft:[],hp:1e9};
    const s=createShipInstance(ship,'ally',true,false); s.instId='t2';
    s.weaponStates=[{weapon:gun,module:{name:'x',weapons:[gun]},moduleKey:'M1',weaponIndex:0,strengthenKey:'M1',
      strengthen:{},currentTarget:null,cooldownRemaining:0,lockRemaining:0,atkRemaining:0,batchTimer:0,
      shotsRemaining:0,batchesRemaining:0,totalShots:1,totalBatches:1,firstShot:true}];
    const dummy={name:'靶',id:'d2',type:'battlecruiser',size:'large',position:'中排',hp:1e12,maxHp:1e12,alive:true,energyArmor:0,physicalArmor:0,subSystems:[]};
    const bs={allyShips:[s],enemyShips:[dummy],allyEscort:[s],allyEscorted:[],enemyEscort:[dummy],enemyEscorted:[],battleMode:'escort',time:0,allyEscortAlive:true,enemyEscortAlive:true};
    const fireTimes=[]; let lastHp=null;
    for(let i=0;i<3000;i++){
      const t=+(i*0.1).toFixed(1);
      processShipWeapons(s,[dummy],0.1,bs);
      if(lastHp!==null && dummy.hp!==lastHp) fireTimes.push(t);   // 靶子掉血 = 这一帧开火了
      lastHp=dummy.hp;
      if(fireTimes.length>=6) break;
    }
    const gaps=[]; for(let i=1;i<fireTimes.length;i++) gaps.push(+(fireTimes[i]-fireTimes[i-1]).toFixed(1));
    return {fireTimes, gaps, targetKept:s.weaponStates[0].currentTarget!==null};
  });
  check('② 稳态周期 ≈ 冷却10s（锁定并行，不是串行16s）', B.gaps.length>=2 && B.gaps.slice(1).every(g=>Math.abs(g-10)<0.25),
        '开火时刻='+JSON.stringify(B.fireTimes)+' 间隔='+JSON.stringify(B.gaps));
  check('② 攻击后保留目标（同目标不重复锁定）', B.targetKept===true, String(B.targetKept));

  /* ③ 直射武器不被拦截 */
  const C=await p.evaluate(()=>{
    const mk=(wtype)=>({name:'x',dmgType:'physical',weaponType:wtype,singleDmg:100,ammo:1,attacks:1,
        atkDuration:0,lockTime:0,cooldown:1,targets:[{types:['战列巡洋舰'],hitMin:100,hitMax:100}]});
    const run=(wtype)=>{
      let intercepted=0;
      for(let k=0;k<300;k++){
        const gun=mk(wtype);
        const atk={name:'A',id:'a',type:'cruiser',size:'small',position:'中排',side:'ally',alive:true,hp:1e9,subSystems:[],strengthen:{}};
        const tgt={name:'T',id:'t',type:'battlecruiser',size:'large',position:'中排',hp:1e9,maxHp:1e9,alive:true,energyArmor:0,physicalArmor:0,subSystems:[],side:'enemy'};
        // 目标方有一艘 100% 拦截的全域拦截船
        const interceptor={name:'I',id:'i',type:'cruiser',size:'small',position:'中排',side:'enemy',alive:true,hp:1e9,interceptRate:100,interceptType:'global',subSystems:[]};
        const bs={allyShips:[atk],enemyShips:[tgt,interceptor],allyEscort:[],allyEscorted:[],enemyEscort:[],enemyEscorted:[],battleMode:'escort',time:0,allyEscortAlive:false,enemyEscortAlive:false};
        const ws={weapon:gun,module:{name:'x'},strengthen:{dmgBonus:0,critRate:0,critDmg:0,cooldownReduction:0,lockReduction:0}};
        const before=tgt.hp;
        executeShot(atk,tgt,gun,ws,bs);
        if(tgt.hp>=before) intercepted++;   // 没掉血 = 被拦下（或未命中，但命中率已设100%）
      }
      return intercepted;
    };
    return {direct:run('direct'), projectile:run('projectile')};
  });
  check('③ 直射武器不被拦截（300发中至多1%是命中上限，不是拦截）', C.direct<=5, '直射被拦='+C.direct+'/300');
  check('③ 投射武器确实被拦截（100%拦截率 → 300 发全拦）', C.projectile===300, '投射被拦='+C.projectile+'/300');

  /* ④ 母舰被毁 → 自己的载机跟着毁 */
  const D=await p.evaluate(()=>{
    FLEET_TYPES.forEach(k=>{ fleetData[k].main=[]; fleetData[k].reinforcement=[]; });
    fleetData['ally-escort'].main=[{uid:'c1',id:'sun-whale',name:'太阳鲸',count:2,position:'中排',
        modules:{},selectedModules:{M:'M2'},
        aircraft:[Object.assign({},JSON.parse(JSON.stringify(SHIP_DATABASE['tianxuan'])),{count:8,slot:'M2|fighter'})]}];
    recalcAircraftSlots(fleetData['ally-escort'].main[0]);
    fleetData['enemy-escort'].main=[{uid:'e1',id:'constantine',name:'大帝',count:1,position:'中排',modules:{},selectedModules:{},aircraft:[]}];
    recalcAircraftSlots(fleetData['enemy-escort'].main[0]);
    refreshFleetViews();
    prepareBattle();
    const carriers=battleState.allyShips.filter(s=>s.id==='sun-whale');
    const airBefore=battleState.allyShips.filter(s=>s.position==='aircraft').length;
    // 手动击毁第一艘母舰（走 executeShot 的死亡分支）
    const gun={name:'x',dmgType:'physical',weaponType:'projectile',singleDmg:9999999,ammo:1,attacks:1,
               atkDuration:0,lockTime:0,cooldown:1,targets:[{types:['航空母舰'],hitMin:100,hitMax:100}]};
    const atk={name:'杀手',id:'k',type:'cruiser',size:'small',position:'中排',side:'enemy',alive:true,hp:1e9,subSystems:[],strengthen:{}};
    battleState.enemyShips.push(atk);
    executeShot(atk, carriers[0], gun, {weapon:gun,module:{name:'x'},strengthen:{dmgBonus:0,critRate:0,critDmg:0,cooldownReduction:0,lockReduction:0}}, battleState);
    const airAfter=battleState.allyShips.filter(s=>s.position==='aircraft'&&s.alive).length;
    return {carrierCount:carriers.length, airBefore, airAfter,
            carrierHasInstId:!!carriers[0].instId,
            airCarrierIds:battleState.allyShips.filter(s=>s.position==='aircraft').map(s=>s.carrierInstId)};
  });
  check('④ 条目合计 8 架按 2 艘平均分摊（各 4）', D.airBefore===8 && D.carrierCount===2, JSON.stringify({air:D.airBefore,carriers:D.carrierCount}));
  check('④ 载机带上了所属母舰单位 id', D.carrierHasInstId && new Set(D.airCarrierIds).size===2, JSON.stringify(D.airCarrierIds));
  check('④ 击毁 1 艘母舰 → 它那 4 架载机跟着被毁（剩 4）', D.airAfter===4, '击毁后存活载机='+D.airAfter);

  console.log('\n通过 '+pass+' / 失败 '+fail);
  await b.close();
  process.exit(fail?1:0);
})().catch(e=>{ console.error('HARNESS ERROR',e); process.exit(1); });
