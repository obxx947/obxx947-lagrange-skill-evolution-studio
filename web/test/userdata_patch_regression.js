/* 用户填报数据补录 + 引擎三改 回归（2026-09-24）
   数据侧：
   ① 31 艘载机作战模式（往复 18 / 独立 13）；往复的带去程/回程秒数
   ② 18 艘超主力 sysHp = 25500
   ③ 雷火之辉 hp/护甲/抗性/载机位
   ④ 4 艘基础闪避
   ⑤ 10 艘空白船的 13 门武器（from 你要的.txt）
   引擎侧：
   ⑥ mounts（武器安装数）真的乘进发数
   ⑦ 系统独立血量：累计打满才毁，不再一击即毁
   ⑧ 往复作战：一轮 = 攻击持续 + 冷却 + 去程 + 返程
   跑法：先起 http://127.0.0.1:3002，再 node test/userdata_patch_regression.js
*/
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:3002';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n + (d ? ('  → ' + d) : '')); } else { fail++; console.log('FAIL ' + n + (d ? '  → ' + d : '')); } };

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  p.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
  await p.goto(BASE + '/simulator.html', { waitUntil: 'load', timeout: 90000 });
  await sleep(4500);

  const R = await p.evaluate(() => {
    const out = {};
    const all = Object.values(SHIP_DATABASE);
    const nm = n => all.find(s => s.name === n);

    /* ---------- ① 作战模式 ---------- */
    const recip = all.filter(s => s.flightMode === 'reciprocating');
    const indep = all.filter(s => s.flightMode === 'independent');
    out.flight = { recip: recip.length, indep: indep.length, total: recip.length + indep.length };
    out.recipNoTime = recip.filter(s => !s.departSec || !s.returnSec).map(s => s.name);
    const jl = nm('S-列维9号-重型鱼雷艇');
    out.jl = jl ? { mode: jl.flightMode, d: jl.departSec, r: jl.returnSec } : null;

    /* ---------- ② 系统血量 ---------- */
    out.sysHp = all.filter(s => s.sysHp === 25500).length;

    /* ---------- ③ 雷火之辉 ---------- */
    const lh = nm('雷火之辉');
    out.lh = lh ? { hp: lh.hp, e: lh.energyArmor, p: lh.physicalArmor, cmd: lh.commandValue, svc: lh.serviceLimit, air: lh.airSlots && lh.airSlots.byModule } : null;

    /* ---------- ④ 闪避 ---------- */
    out.ev = ['yueshenxing-A', 'yueshenxing-C', 'kalilaien-C', 'kaiyang-A'].map(id => (SHIP_DATABASE[id] || {}).evasion);

    /* ---------- ⑤ 10 艘新船的武器 ---------- */
    const ten = ['理智级A101-TE-战斗机', '天枪-重型鱼雷艇', '天枪-战术护航艇', '佩刀Aer410-强击攻击机', '牛蛙-两栖轰炸机', '海氏追随者型-脉冲攻击机', '林鸮A100型-联合攻击机', '砂龙-大气层拦截机', '平衡安德森SC020-侦察机', 'SC002型-量子侦察机'];
    let wn = 0, bad = [];
    ten.forEach(n => { const s = nm(n); if (!s) { bad.push(n + ':缺'); return; } Object.values(s.modules || {}).forEach(m => { (m.weapons || []).forEach(w => { wn++; if (!w.singleDmg || !w.dpm) bad.push(n + '/' + w.name); }); }); });
    out.ten = { weapons: wn, bad };

    /* ---------- ⑥ mounts 乘进发数 ---------- */
    const lv = nm('天枪-重型鱼雷艇');
    const w0 = (lv.modules.M.weapons || [])[0];
    out.mounts = { field: w0.mounts, ammo: w0.ammo, attacks: w0.attacks, 期望发数: (w0.ammo || 1) * (w0.attacks || 1) * (w0.mounts || 1) };

    /* ---------- ⑦ 系统独立血量累计 ---------- */
    const dbl = SHIP_DATABASE['constantine'];
    const atk = { name: 'A', id: 'a', type: 'cruiser', size: 'small', position: '中排', side: 'ally', alive: true, hp: 1e9, subSystems: [], strengthen: {}, dmgBonus: 0 };
    const tgtBase = { name: 'T', id: 't', type: 'battlecruiser', size: 'large', position: '中排', hp: 1e9, maxHp: 1e9, alive: true, energyArmor: 0, physicalArmor: 0, subSystems: [], side: 'enemy' };
    // 直接建一个带 sysHp 的靶子，系统 25500，用一门高单发系统武器打
    const mkSys = () => ({ name: '主武器系统', type: 'weapon', key: 'M', hp: 25500, maxHp: 25500, destroyed: false, repairTimer: 0, repairCount: 0, maxRepairs: 2, permanentDestroyed: false });
    const gun = { name: '测试炮', dmgType: 'physical', weaponType: 'projectile', singleDmg: 3000, ammo: 1, attacks: 1, atkDuration: 0, lockTime: 0, cooldown: 1, mounts: 1,
      targets: [{ types: ['战列巡洋舰'], hitMin: 100, hitMax: 100 }], subSystemTargets: { '主武器系统': 'high' } };
    out.sysTest = (() => {
      const tgt = Object.assign({}, tgtBase, { subSystems: [mkSys()] });
      const tgt2 = Object.assign({}, tgtBase, { _no: 1, subSystems: [mkSys()] });
      // 用固定随机数：让"效率命中"必中
      const origRandom = Math.random;
      Math.random = () => 0.0;
      let hits = 0;
      try {
        for (let i = 0; i < 20 && !tgt.subSystems[0].destroyed; i++) { executeShot(atk, tgt, gun, { weapon: gun, module: { name: 'x' }, strengthen: {} }, { battleMode:'escort', time:0, allyShips:[], enemyShips:[] }); hits++; }
      } finally { Math.random = origRandom; }
      return { 打了几发才毁: hits, 剩余hp: tgt.subSystems[0].hp, 已毁: tgt.subSystems[0].destroyed,
               /* ⚠️ 2026-09-26：调校系数由 1.3 改成 1.0（面板即真值，用户核对式里也没有调校项）
                   → 这里跟着改成 1.0；断言本身（25500 ÷ 单发系统伤害 = 需要几发）没变 */
               单发系统伤害: Math.round(3000 * 1.5 * 1.0), 理论需要几发: Math.ceil(25500 / Math.round(3000 * 1.5 * 1.0)) };
    })();

    /* ---------- ⑧ 往复作战循环时间 ---------- */
    out.flightCycle = { 往复: flightCycleSec(Object.assign({}, nm('S-列维9号-重型鱼雷艇'), {})), 独立: flightCycleSec(Object.assign({}, nm('鳐-装甲护航艇'), {})) };

    return out;
  });

  console.log('  [调试] ' + JSON.stringify({ flight: R.flight, jl: R.jl, sysHp: R.sysHp, ev: R.ev, ten: R.ten, mounts: R.mounts, flightCycle: R.flightCycle }));
  console.log('  [调试] 系统血量测试 = ' + JSON.stringify(R.sysTest));

  check('① 作战模式覆盖 52 艘载机', R.flight.total === 52, '往复 ' + R.flight.recip + ' / 独立 ' + R.flight.indep);
  check('① S-列维9号 = 往复 9/5 秒', R.jl && R.jl.mode === 'reciprocating' && R.jl.d === 9 && R.jl.r === 5, JSON.stringify(R.jl));
  check('② 18 艘超主力写了 sysHp=25500', R.sysHp === 18, R.sysHp + ' 艘');
  check('③ 雷火之辉 hp=286370 / 能甲15 / 物甲26.25 / A2=5护航艇 A3=5大型战机',
    R.lh && R.lh.hp === 286370 && R.lh.e === 15 && R.lh.p === 26.25 && R.lh.air && R.lh.air.A2[0].cap === 5 && R.lh.air.A3[0].cap === 5, JSON.stringify(R.lh));
  check('④ 4 艘基础闪避 25/25/35/20', JSON.stringify(R.ev) === '[25,25,35,20]', JSON.stringify(R.ev));
  check('⑤ 10 艘新船共 13 门武器且都有单发/DPM', R.ten.weapons === 13 && R.ten.bad.length === 0, R.ten.weapons + ' 门' + (R.ten.bad.length ? ' 异常:' + R.ten.bad.join(',') : ''));
  check('⑥ mounts 字段存在且发数 = ammo×attacks×mounts', R.mounts.field === 2 && R.mounts.期望发数 === 8, JSON.stringify(R.mounts));
  check('⑦ 系统独立血量：要打满 25500 才毁（不是一击即毁）', R.sysTest.打了几发才毁 === R.sysTest.理论需要几发 && R.sysTest.已毁 === true,
    '发了 ' + R.sysTest.打了几发才毁 + ' 发（单发 ' + R.sysTest.单发系统伤害 + '，理论 ' + R.sysTest.理论需要几发 + ' 发）');
  check('⑧ 往复 = 去程+返程（14s）；独立 = 0', R.flightCycle.往复 === 14 && R.flightCycle.独立 === 0, JSON.stringify(R.flightCycle));

  await b.close();
  console.log('\n==== ' + pass + ' 通过 / ' + fail + ' 失败 ====');
  process.exit(fail ? 1 : 0);
})();
