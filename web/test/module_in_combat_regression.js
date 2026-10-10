/* 验证：超主力「所选模块」是否真的进入战斗（不同模块 → 不同武器 → 不同输出） */
const puppeteer=require('puppeteer-core');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
function check(n,ok,d){ if(ok){pass++;console.log('PASS '+n+(d?('  → '+d):''));} else {fail++;console.log('FAIL '+n+(d?'  → '+d:''));} }
(async()=>{
  const b=await puppeteer.launch({executablePath:EDGE,headless:'new',protocolTimeout:600000,args:['--no-sandbox','--disable-gpu']});
  const p=await b.newPage();
  p.on('dialog',async d=>{ try{ await d.accept(); }catch(e){} });
  p.on('pageerror',e=>console.log('PAGEERROR: '+e.message));
  await p.goto('http://127.0.0.1:3888/simulator.html',{waitUntil:'load',timeout:90000});
  await sleep(4500);

  const R=await p.evaluate(()=>{
    const mk=(id,cnt,uid,mods)=>{ const e=JSON.parse(JSON.stringify(SHIP_DATABASE[id]));
        e.uid=uid; e.count=cnt; e.position=e.position||'中排'; e.selectedModules=Object.assign({},mods||{}); e.aircraft=[];
        recalcAircraftSlots(e); return e; };
    // 让双方各剩一艘母舰互殴，避免其它变量干扰：1 大帝(M1) vs 1 大帝(M2)
    const duel=(idA,modsA,idB,modsB)=>{
        FLEET_TYPES.forEach(k=>{ fleetData[k].main=[]; fleetData[k].reinforcement=[]; });
        fleetData['ally-escort'].main=[mk(idA,1,'a',modsA)];
        fleetData['enemy-escort'].main=[mk(idB,1,'e',modsB)];
        refreshFleetViews(); prepareBattle();
        const A=battleState.allyShips[0], B=battleState.enemyShips[0];
        const wsA=A.weaponStates.map(w=>w.weapon.name+'|单发'+w.weapon.singleDmg+'|冷却'+w.weapon.cooldown);
        // 跑 120 秒，统计双方造成的伤害
        const hA0=A.hp,hB0=B.hp;
        let t=0; while(t<1200 && !battleState.ended){ processBattleTick(0.1); t+=0.1; }
        return {t:+t.toFixed(0), A给B:hB0-Math.max(0,B.hp), B给A:hA0-Math.max(0,A.hp),
                A武器数:A.weaponStates.length, wsA,
                wsB:B.weaponStates.map(w=>w.weapon.name+'|单发'+w.weapon.singleDmg+'|冷却'+w.weapon.cooldown),
                B武器数:B.weaponStates.length};
    };
    const out={};
    // ① 大帝 M1 vs M2（同一艘船，只换 M 槽）
    out.大帝M1vsM2 = duel('constantine',{M:'M1',A:'A1',B:'B1'},'constantine',{M:'M2',A:'A1',B:'B1'});
    // ② 大帝 vs 大帝 同配置（对照）
    out.对照 = duel('constantine',{M:'M1',A:'A1',B:'B1'},'constantine',{M:'M1',A:'A1',B:'B1'});
    // ③ 大盾 M1 vs M2
    out.大盾M1vsM2 = duel('plutus-shield',{M:'M1',A:'A1',B:'B1'},'plutus-shield',{M:'M2',A:'A1',B:'B1'});
    // ④ 大矛 B1(无载机) vs B2(护航艇坞舱)
    const a=duel('uranus-spear',{M:'M1',A:'A1',B:'B1'},'uranus-spear',{M:'M1',A:'A1',B:'B1'});
    out.大矛对照=a;
    // 载机位差异（不跑战斗，看编队）
    FLEET_TYPES.forEach(k=>{ fleetData[k].main=[]; fleetData[k].reinforcement=[]; });
    const sweep=(mods)=>{ const e=mk('uranus-spear',4,'x',mods); recalcAircraftSlots(e);
        return (e.simSlots||[]).map(s=>s.key+'='+s.cap); };
    out.大矛B1载机位 = sweep({B:'B1'});
    out.大矛B2载机位 = sweep({B:'B2'});
    // ⑤ 火力总览对比（每艘超主力用第一个模块时有多少门武器）
    out.超主力武器数={};
    ['plutus-shield','uranus-spear','constantine','sun-whale','tianshu','tianquan','eternal-storm',
     'CV3000','antontas','thunder-star','south-cross','eternal-vault','zhizhan','ST59','ediacara','leihuo-hui','FSV830']
     .forEach(id=>{ const s=SHIP_DATABASE[id]; if(!s) return;
        let n=0; Object.keys(s.modules||{}).forEach(k=>{ const g=s.modules[k];
            if(g&&g.type==='moduleGroup'&&g.variants){ const sel=Object.keys(g.variants)[0];
                n+=((g.variants[sel]||{}).weapons||[]).length; } });
        out.超主力武器数[id]=n; });
    return out;
  });
  console.log('① 大帝 M1 vs M2:', JSON.stringify(R.大帝M1vsM2));
  console.log('   对照(同配置)  :', JSON.stringify(R.对照));
  console.log('③ 大盾 M1 vs M2:', JSON.stringify(R.大盾M1vsM2));
  console.log('④ 大矛 B1/B2 载机位:', JSON.stringify(R.大矛B1载机位), 'vs', JSON.stringify(R.大矛B2载机位));
  console.log('⑤ 超主力武器数(首模块):', JSON.stringify(R.超主力武器数));
  console.log();
  check('① 大帝选 M1/M2 → 敌人(选M2)武器确实不同', JSON.stringify(R.大帝M1vsM2.wsB)!==JSON.stringify(R.大帝M1vsM2.wsA),
        '我方(M1)首门:'+R.大帝M1vsM2.wsA[0]+'   敌方(M2)首门:'+R.大帝M1vsM2.wsB[0]);
  check('① 换模块后双方输出不同 → 模块进入实战计算',
        R.大帝M1vsM2.A给B!==R.对照.A给B || R.大帝M1vsM2.B给A!==R.对照.B给A,
        'M1对M2: '+R.大帝M1vsM2.A给B+'/'+R.大帝M1vsM2.B给A+'  同配置: '+R.对照.A给B+'/'+R.对照.B给A);
  check('③ 大盾选 M1/M2 → 敌人(选M2)武器不同', JSON.stringify(R.大盾M1vsM2.wsB)!==JSON.stringify(R.大盾M1vsM2.wsA),
        '我方(M1)首门:'+R.大盾M1vsM2.wsA[0]+'   敌方(M2)首门:'+R.大盾M1vsM2.wsB[0]);
  check('④ 大矛 B1 无载机位、B2 有护航艇位（模块→载机位生效）',
        R.大矛B1载机位.length===0 && JSON.stringify(R.大矛B2载机位)===JSON.stringify(['B2|corvette=12']),
        JSON.stringify({B1:R.大矛B1载机位,B2:R.大矛B2载机位}));
  const armed=Object.keys(R.超主力武器数).filter(k=>R.超主力武器数[k]>0);
  check('⑤ 超主力普遍有武器（'+(armed.length)+'/17 艘）+ 战列舰/支援舰', armed.length>=15,
        JSON.stringify(R.超主力武器数));
  console.log('\n通过 '+pass+' / 失败 '+fail);
  await b.close();
  process.exit(fail?1:0);
})().catch(e=>{ console.error('HARNESS ERROR',e); process.exit(1); });
