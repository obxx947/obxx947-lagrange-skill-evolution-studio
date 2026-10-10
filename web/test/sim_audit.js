/* 战斗模拟器审计：找出真实存在的问题（不是猜）
   A 类 共享引用：浅拷贝导致实例/条目/数据库互相污染
   B 类 显示 vs 计算：界面上的数字和引擎实际算的是否一致
   C 类 战斗不变量：机制该成立的是否成立
*/
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let 问题 = 0;
const P = (n, ok, d) => { if (!ok) 问题++; console.log((ok ? '  ok   ' : '  ★问题 ') + n + (d ? '  → ' + d : '')); };

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1200, height: 1000 });
  p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
  p.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'load', timeout: 90000 });
  await sleep(4500);

  const R = await p.evaluate(() => {
    const out = {};
    const mk = (id, cnt, uid, mods) => {
      const e = JSON.parse(JSON.stringify(SHIP_DATABASE[id]));
      e.uid = uid; e.count = cnt; e.selectedModules = Object.assign({}, mods || {}); e.aircraft = [];
      recalcAircraftSlots(e); return e;
    };
    const setup = (ally, enemy) => {
      FLEET_TYPES.forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; });
      fleetData['ally-escort'].main = ally;
      fleetData['enemy-escort'].main = enemy;
      refreshFleetViews(); prepareBattle();
    };

    /* ---------- A 类：共享引用 ---------- */
    // A1 实例是否与数据库共享嵌套对象
    setup([mk('uranus-spear', 2, 'a1', { M: 'M1' })], [mk('uranus-spear', 1, 'e1', { M: 'M1' })]);
    const inst = battleState.allyShips[0];
    out.A1_实例modules与DB同引用 = (inst.modules === SHIP_DATABASE['uranus-spear'].modules);
    out.A1_实例aircraft与条目同引用 = (inst.aircraft === fleetData['ally-escort'].main[0].aircraft);
    out.A1_实例strengthen与条目同引用 = (inst.strengthen === fleetData['ally-escort'].main[0].strengthen);

    // A2 开战时是否往数据库里写脏字段（_groupKey/_variantKey 是解析时写的）
    let dirty = [];
    const walk = (o, path) => {
      if (!o || typeof o !== 'object') return;
      Object.keys(o).forEach(k => {
        if (k === '_groupKey' || k === '_variantKey') dirty.push(path + '.' + k);
        else if (k !== 'weapons' && typeof o[k] === 'object') walk(o[k], path + '.' + k);
      });
    };
    walk(SHIP_DATABASE['uranus-spear'], 'uranus-spear');
    out.A2_数据库被写入临时字段 = dirty;

    // A3 同一条目多实例，各自 weaponStates 是否独立
    setup([mk('uranus-spear', 3, 'a3', {})], [mk('uranus-spear', 1, 'e3', {})]);
    const [s1, s2, s3] = battleState.allyShips;
    out.A3_多实例武器状态独立 = (s1.weaponStates !== s2.weaponStates && s1.weaponStates[0] !== s2.weaponStates[0]);

    // A4 同一条目里，某一艘开火后其它艘的冷却是否被带着走（共享 ws 会串）
    setup([mk('uranus-spear', 3, 'a4', {})], [mk('uranus-spear', 1, 'e4', {})]);
    const u1 = battleState.allyShips[0], u2 = battleState.allyShips[1];
    for (let i = 0; i < 20; i++) processBattleTick(0.1);
    out.A4_首舰与次舰的冷却各自独立 = {
      u1首武器冷却: +u1.weaponStates[0].cooldownRemaining.toFixed(2),
      u2首武器冷却: +u2.weaponStates[0].cooldownRemaining.toFixed(2)
    };

    // A5 载机数量（老 bug 回归）：条目填 4 架 × 母舰 3 艘 = 应 4 架，不是 12
    const carrier = mk('sun-whale', 3, 'a5', { M: 'M2', C: 'C1' });
    carrier.aircraft = [{ id: 'mistral', name: '米斯特拉', kind: 'fighter', count: 4, slot: 'M2|fighter' }];
    setup([carrier], [mk('uranus-spear', 1, 'e5', {})]);
    out.A5_载机总数 = battleState.allyShips.filter(s => s.position === 'aircraft').length;
    out.A5_应为 = 4;

    /* ---------- B 类：显示 vs 计算 ---------- */
    // B1 结构值：面板显示 vs 实例 maxHp（带 +50%）
    const e = mk('uranus-spear', 1, 'b1', {}); e.hpBonus = 50;
    e.selectedModules = {}; e.aircraft = [];
    setup([e], [mk('uranus-spear', 1, 'eb1', {})]);
    out.B1_显示结构值 = getShipHp(fleetData['ally-escort'].main[0]);
    out.B1_实例maxHp = Math.round(battleState.allyShips[0].maxHp);
    out.B1_数据库基础值 = SHIP_DATABASE['uranus-spear'].hp;

    // B2 武器数：条目显示的武器 vs 实例 weaponStates
    const e2 = mk('constantine', 1, 'b2', { M: 'M1', A: 'A1', B: 'B1' });
    setup([e2], [mk('uranus-spear', 1, 'eb2', {})]);
    const inst2 = battleState.allyShips[0];
    let dbWeapons = 0;
    const shipTex = SHIP_DATABASE['constantine'];
    Object.keys(shipTex.modules || {}).forEach(k => {
      if (k[0] === '_') return;
      const m = shipTex.modules[k];
      if (m.type === 'moduleGroup' && m.variants) {
        const sel = inst2.selectedModules[k] || Object.keys(m.variants)[0];
        dbWeapons += ((m.variants[sel] || {}).weapons || []).length;
      } else dbWeapons += (m.weapons || []).length;
    });
    out.B2_实例武器数 = inst2.weaponStates.length;
    out.B2_按所选模块应有多少 = dbWeapons;

    /* ---------- C 类：战斗不变量 ---------- */
    // C1 直射武器不得打到中/后排（前排还有活人时）
    setup([mk('uranus-spear', 6, 'c1', {})], [mk('uranus-spear', 6, 'ec1', {})]);
    const enemyFront = battleState.enemyShips.filter(s => s.position === '前排').length;
    const enemyMid = battleState.enemyShips.filter(s => s.position !== '前排').length;
    let 打到后排 = 0, 直射次数 = 0;
    const origExec = window.executeShot;
    // 直接调 getDirectFireTargets 验证
    const attacker = battleState.allyShips[0];
    const directWs = attacker.weaponStates.find(w => w.weapon.weaponType === 'direct');
    if (directWs) {
      const cand = getDirectFireTargets(attacker, battleState.enemyShips.filter(s => s.alive));
      out.C1_直射候选排 = cand.length ? cand[0].position : '（无）';
      out.C1_前排还有活人 = battleState.enemyShips.some(s => s.alive && s.position === '前排');
      out.C1_全部候选都是前排 = cand.every(s => s.position === '前排');
    } else out.C1_直射候选排 = '（这艘船没有直射武器）';

    // C2 护航免疫：被护航舰在护航存活时不该掉血
    const esc = mk('uranus-spear', 1, 'c2e', {}); esc.isEscort = true;
    const escd = mk('uranus-spear', 1, 'c2d', {}); escd.isEscorted = true;
    FLEET_TYPES.forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; });
    fleetData['ally-escort'].main = [esc];
    fleetData['ally-escorted'].main = [escd];
    fleetData['enemy-escort'].main = [mk('constantine', 2, 'c2x', {})];
    refreshFleetViews(); prepareBattle();
    const tgt = battleState.allyShips.find(s => s.isEscorted);
    const hp0 = tgt ? tgt.hp : 0;
    for (let i = 0; i < 400; i++) processBattleTick(0.1);
    out.C2_被护航舰掉血 = tgt ? Math.round(hp0 - tgt.hp) : 'n/a';

    // C3 大盾旗舰减伤 30%：同一目标，有无大盾旗舰各打一次
    const dmgWith = (withPlutus) => {
      FLEET_TYPES.forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; });
      const t = mk('uranus-spear', 1, 'c3t', {}); t.isEscort = true;
      const list = [t];
      if (withPlutus) { const f = mk('plutus-shield', 1, 'c3f', {}); f.isFlagship = true; list.push(f); }
      fleetData['ally-escort'].main = list;
      fleetData['enemy-escort'].main = [mk('constantine', 1, 'c3x', { M: 'M1' })];
      refreshFleetViews(); prepareBattle();
      const tt = battleState.allyShips.find(s => s.uid === 'c3t');
      const h0 = tt.hp;
      for (let i = 0; i < 600 && !battleState.ended; i++) processBattleTick(0.1);
      return Math.round(h0 - tt.hp);
    };
    out.C3_无大盾旗舰_受伤害 = dmgWith(false);
    out.C3_有大盾旗舰_受伤害 = dmgWith(true);

    // C4 拦截只对投射武器生效
    setup([mk('kaiyang-A', 2, 'c4', {})], [mk('kaiyang-A', 2, 'ec4', {})]);
    battleState.allyShips.forEach(s => { s.interceptRate = 100; s.interceptType = 'sameRow'; });
    battleLogs = [];
    for (let i = 0; i < 300; i++) processBattleTick(0.1);
    out.C4_全拦截下日志数 = battleLogs.filter(l => (l.msg || '').includes('被拦截')).length;

    // C5 伤害不得出现 NaN/负数
    setup([mk('eternal-storm', 4, 'c5', {})], [mk('ediacara', 4, 'ec5', {})]);
    let nan = 0;
    for (let i = 0; i < 3000 && !battleState.ended; i++) {
      processBattleTick(0.1);
      if (i % 200 === 0) [...battleState.allyShips, ...battleState.enemyShips].forEach(s => { if (!isFinite(s.hp)) nan++; });
    }
    out.C5_NaN舰船数 = nan;

    // C6 战报"总伤害" vs 实际 HP 损失
    FLEET_TYPES.forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; });
    fleetData['ally-escort'].main = [mk('uranus-spear', 4, 'c6a', {})];
    fleetData['enemy-escort'].main = [mk('ediacara', 4, 'c6e', {})];
    refreshFleetViews(); prepareBattle();
    const enemyHp0 = battleState.enemyShips.reduce((a, s) => a + s.maxHp, 0);
    for (let i = 0; i < 4000 && !battleState.ended; i++) processBattleTick(0.1);
    const 实际损失 = Math.round(enemyHp0 - battleState.enemyShips.reduce((a, s) => a + Math.max(0, s.hp), 0));
    out.C6_战斗时长 = +battleState.time.toFixed(0);
    out.C6_敌方实际损失HP = 实际损失;

    return out;
  });

  console.log('================ 审计结果 ================');
  console.log(JSON.stringify(R, null, 1));

  console.log('\n================ 判定 ================');
  P('A1 实例不与数据库共享嵌套对象', R.A1_实例modules与DB同引用 === false, 'modules 同引用=' + R.A1_实例modules与DB同引用);
  P('A1 实例不与条目共享 aircraft', R.A1_实例aircraft与条目同引用 === false, '同引用=' + R.A1_实例aircraft与条目同引用);
  P('A2 开战不往数据库写临时字段', (R.A2_数据库被写入临时字段 || []).length === 0, '被写入: ' + JSON.stringify((R.A2_数据库被写入临时字段 || []).slice(0, 6)));
  P('A3 多实例的武器状态互相独立', R.A3_多实例武器状态独立 === true);
  P('A5 载机数=配队数(4)，未被母舰数放大', R.A5_载机总数 === R.A5_应为, R.A5_载机总数 + ' / 应为 ' + R.A5_应为);
  P('B1 面板结构值 = 实例 maxHp', R.B1_显示结构值 === R.B1_实例maxHp, R.B1_显示结构值 + ' vs ' + R.B1_实例maxHp);
  P('B2 实例武器数 = 所选模块的武器数', R.B2_实例武器数 === R.B2_按所选模块应有多少, R.B2_实例武器数 + ' vs ' + R.B2_按所选模块应有多少);
  P('C1 直射武器只打最前排', R.C1_全部候选都是前排 === true, JSON.stringify(R.C1_直射候选排));
  P('C2 护航存活时被护航舰免疫（不掉血）', R.C2_被护航舰掉血 === 0, '掉血=' + R.C2_被护航舰掉血);
  P('C3 大盾旗舰确实减伤', R.C3_有大盾旗舰_受伤害 < R.C3_无大盾旗舰_受伤害, R.C3_无大盾旗舰_受伤害 + ' → ' + R.C3_有大盾旗舰_受伤害);
  P('C5 没有 NaN', R.C5_NaN舰船数 === 0, 'NaN=' + R.C5_NaN舰船数);

  console.log('\n合计发现问题: ' + 问题 + ' 处');
  await b.close();
})();
