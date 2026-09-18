/* 深挖审计：C4 拦截日志为 0、A1 共享 aircraft 是否有害、战报数字是否准、显示 DPM 是否准 */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
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

    /* ---- C4 深挖：拦截到底有没有发生 ---- */
    setup([mk('kaiyang-A', 2, 'c4', {})], [mk('kaiyang-A', 2, 'ec4', {})]);
    const aShip = battleState.allyShips[0], eShip = battleState.enemyShips[0];
    out.C4_我方武器类型 = aShip.weaponStates.map(w => w.weapon.name + '/' + w.weapon.weaponType);
    out.C4_我方位置 = aShip.position; out.C4_敌方位置 = eShip.position;
    battleState.allyShips.forEach(s => { s.interceptRate = 100; s.interceptType = 'sameRow'; });
    const hp0 = battleState.allyShips.map(s => s.hp);
    let ticks = 0;
    while (!battleState.ended && ticks < 3000) { processBattleTick(0.1); ticks++; }
    out.C4_战斗时长 = +battleState.time.toFixed(0);
    out.C4_我方掉血 = Math.round(battleState.allyShips.reduce((a, s, i) => a + (hp0[i] - Math.max(0, s.hp)), 0));
    out.C4_我方存活 = battleState.allyShips.filter(s => s.alive).length;
    out.C4_日志总数 = battleLogs.length;
    out.C4_含被拦截 = battleLogs.filter(l => (l.msg || '').includes('被拦截')).length;
    out.C4_日志样例 = battleLogs.slice(0, 5).map(l => l.msg);

    /* ---- A1 深挖：共享 aircraft 会不会串 ----
       同一条目 3 艘母舰各挂不同的载机，看实例上的 aircraft 是否互相干扰 */
    const c = mk('sun-whale', 3, 'a1', { M: 'M2' });
    c.aircraft = [{ id: 'mistral', name: '米斯特拉', kind: 'fighter', count: 6, slot: 'M2|fighter' }];
    setup([c], [mk('uranus-spear', 1, 'ea1', {})]);
    const air = battleState.allyShips.filter(s => s.position === 'aircraft');
    out.A1_载机实例数 = air.length;
    out.A1_各载机归属的母舰实例 = air.map(s => s.carrierInstId);
    // 改一个实例的 aircraft 会不会污染数据库
    const before = JSON.stringify((SHIP_DATABASE['sun-whale'].aircraft || []));
    battleState.allyShips[0].aircraft.push({ id: 'X', count: 1 });
    out.A1_改实例后数据库aircraft = JSON.stringify((SHIP_DATABASE['sun-whale'].aircraft || [])) !== before ? '被污染了' : '未被污染';
    out.A1_实例aircraft与DB同引用 = (battleState.allyShips[0].aircraft === SHIP_DATABASE['sun-whale'].aircraft);

    /* ---- 战报数字是否等于实际损失 ---- */
    FLEET_TYPES.forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; });
    fleetData['ally-escort'].main = [mk('uranus-spear', 4, 'r1', {})];
    fleetData['enemy-escort'].main = [mk('ediacara', 4, 'r2', {})];
    refreshFleetViews(); prepareBattle();
    const allyMax = battleState.allyShips.reduce((a, s) => a + s.maxHp, 0);
    const enemyMax = battleState.enemyShips.reduce((a, s) => a + s.maxHp, 0);
    for (let i = 0; i < 8000 && !battleState.ended; i++) processBattleTick(0.1);
    const enemyLost = Math.round(enemyMax - battleState.enemyShips.reduce((a, s) => a + Math.max(0, s.hp), 0));
    const allyLost = Math.round(allyMax - battleState.allyShips.reduce((a, s) => a + Math.max(0, s.hp), 0));
    out.R_敌方实际损失 = enemyLost;
    out.R_我方实际损失 = allyLost;
    // 战报里的数字
    try {
      generateBattleReport();
      const txt = (document.getElementById('battleReport') || document.body).innerText || '';
      out.R_战报片段 = txt.replace(/\s+/g, ' ').slice(0, 400);
    } catch (e) { out.R_战报片段 = '生成失败: ' + e.message; }

    /* ---- 显示 DPM vs 引擎实测 ----
       用一艘只有一门武器的船，跑足够久，量它每秒真实输出，再和界面 dpm 字段比 */
    const dpmShip = 'kaiyang-A';
    const ship = SHIP_DATABASE[dpmShip];
    const w0 = ship.modules.A.weapons[0];
    setup([mk(dpmShip, 1, 'd1', {})], [mk('ediacara', 1, 'd2', {})]);
    const shooter = battleState.allyShips[0];
    const targ = battleState.enemyShips[0];
    targ.physicalArmor = 0; targ.maxHp = 1e9; targ.hp = 1e9; targ.alive = true;   // 木桩：不还手、不掉
    battleState.enemyShips.forEach(s => { s.weaponStates = []; });
    const h0 = targ.hp;
    for (let i = 0; i < 1200; i++) processBattleTick(0.1);
    const dealt = h0 - targ.hp;
    out.D_武器名 = w0.name;
    out.D_面板dpm_antiShip = (w0.dpm || {}).antiShip;
    out.D_引擎实测_每分 = Math.round(dealt / battleState.time * 60);
    out.D_单发 = w0.singleDmg; out.D_弹药 = w0.ammo; out.D_次数 = w0.attacks;
    out.D_冷却 = w0.cooldown; out.D_锁定 = w0.lockTime; out.D_持续 = w0.atkDuration;
    out.D_理论_单发x发数x60除周期 = Math.round(w0.singleDmg * (w0.ammo || 1) * (w0.attacks || 1) * 60 / Math.max(0.01, (w0.cooldown || 1) + (w0.lockTime || 0) + (w0.atkDuration || 0)));

    return out;
  });
  console.log(JSON.stringify(R, null, 1));
  await b.close();
})();
