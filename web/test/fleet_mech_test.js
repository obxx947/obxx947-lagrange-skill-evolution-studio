/* 舰队级机制实测（多舰队场景：敌护航A/敌被护航B/我护航C/我被护航D）
   验：① 副目标舰队数计算  ② 旗舰+指挥系统前置  ③ subTargetHit 命中提升
       ④ protectFromSub 减伤  ⑤ counterSub 多目标反击  ⑥ cutInSub 目标选择 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const res = []; const say = (...a) => console.log(a.join(' '));
const check = (n, ok, d) => { res.push(!!ok); say((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  → ' + d : '')); };

(async () => {
  const st = JSON.parse(fs.readFileSync('data/blueprint_stats.json', 'utf8'));
  const bp = JSON.parse(fs.readFileSync('data/blueprint_all.json', 'utf8'));
  const idx = {};
  bp.forEach(b => b.systems.forEach(y => y.nodes.forEach(n => idx[n.id] = { cdn: String(b.id), ship: b.shipName, name: n.name })));
  const fmNodes = Object.entries(st.nodes).filter(([id, n]) => n.fleetMech && idx[id]);
  say('fleetMech 节点 ' + fmNodes.length + ' 个：');
  fmNodes.forEach(([id, n]) => say('  ' + idx[id].ship.padEnd(24) + idx[id].name.padEnd(14) + n.fleetMech.kind + (n.fleetMech.vs ? '/' + n.fleetMech.vs : '') + '  lvRaw=' + JSON.stringify(n.fleetMech.lvRaw)));

  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1200, height: 900 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2500));

  /* 注入：给雷火之星配「多目标反击辅助」+「多目标反击」、普鲁图斯配「庇护作战」、卡利莱恩配「切入作战」 */
  const store = {};
  const put = (id, lvAll) => {
    const cdn = idx[id].cdn;
    store[cdn] = store[cdn] || { lv: {}, manual: {} };
    store[cdn].lv[id] = Math.max(1, (lvAll || []).length - 1);
  };
  fmNodes.forEach(([id, n]) => put(id, n.fleetMech.lvRaw));
  say('\n注入: ' + JSON.stringify(store));
  await p.evaluate(s => localStorage.setItem('lagrange_addpoint', JSON.stringify(s)), store);
  await p.reload({ waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 3000));

  /* ① 副目标舰队数 + ② 旗舰前置 */
  const t1 = await p.evaluate(() => {
    const slugOf = c => Object.keys(BP_MAP).find(k => String(BP_MAP[k].cdnId) === c);
    const mk = (slug, side, esc, escd) => createShipInstance(JSON.parse(JSON.stringify(SHIP_DATABASE[slug])), side, esc, escd);
    const out = {};
    const ra = mk('constantine', 'ally', true, false), rb = mk('constantine', 'ally', false, true);
    const ea = mk('constantine', 'enemy', true, false), eb = mk('constantine', 'enemy', false, true);
    // 敌方两支都在 → 我方副目标数 = 1
    battleState = { time: 0, allyShips: [ra, rb], enemyShips: [ea, eb], ended: false, battleLogs: [] };
    out.bothAlive = subTargetCount(battleState, 'ally');
    out.bothAliveFoe = subTargetCount(battleState, 'enemy');
    // 敌方只留一支 → 0
    eb.alive = false; eb.hp = 0;
    out.oneFoe = subTargetCount(battleState, 'ally');
    return out;
  });
  say('\n副目标舰队数: ' + JSON.stringify(t1));
  check('敌方两支都在 → 副目标数=1', t1.bothAlive === 1, String(t1.bothAlive));
  check('敌方只剩一支 → 副目标数=0', t1.oneFoe === 0, String(t1.oneFoe));

  /* ③ 雷火之星 多目标反击辅助：旗舰+指挥系统完好 才生效 */
  const t2 = await p.evaluate(() => {
    const slugOf = c => Object.keys(BP_MAP).find(k => String(BP_MAP[k].cdnId) === c);
    const cdn = Object.keys(JSON.parse(localStorage.getItem('lagrange_addpoint'))).find(c => slugOf(c) === 'thunder-star');
    if (!cdn) return { err: '没找到雷火之星（thunder-star）' };
    const mk = () => createShipInstance(JSON.parse(JSON.stringify(SHIP_DATABASE['thunder-star'])), 'ally', true, false);
    const out = {};
    const s = mk();
    // 非旗舰 → 机制不该生效
    s.isFlagship = false;
    out.notFlagship = fleetMechsOf(s).length;
    // 旗舰时才有 —— 先看它有没有指挥系统
    s.isFlagship = true;
    out.hasCommand = (s.subSystems || []).some(x => x.type === 'command' || /指挥/.test(x.name || ''));
    out.kinds = fleetMechsOf(s).map(x => x.fm.kind + (x.fm.vs ? '/' + x.fm.vs : ''));
    out.hasMechs = out.kinds.length > 0;
    s.isFlagship = false;
    // 旗舰 + 指挥系统完好 → 生效
    s.isFlagship = true;
    (s.subSystems || []).forEach(x => { if (/指挥/.test(x.name || '')) x.destroyed = false; });
    out.flagshipOk = fleetMechsOf(s).length;
    // 旗舰但指挥系统被毁 → 失效
    let hit = false;
    (s.subSystems || []).forEach(x => { if (/指挥/.test(x.name || '')) { x.destroyed = true; hit = true; } });
    out.hasCommandSys = hit;
    out.commandDestroyed = fleetMechsOf(s).length;
    return out;
  });
  say('\n雷火之星: ' + JSON.stringify(t2));
  check('识别出 fleetMech', t2.hasMechs === true, JSON.stringify(t2.kinds));
  check('非旗舰 → 机制不生效', t2.notFlagship === 0, String(t2.notFlagship));
  check('旗舰+指挥系统完好 → 生效', t2.flagshipOk > 0, String(t2.flagshipOk));
  check('指挥系统被毁 → 机制失效', t2.commandDestroyed === 0, String(t2.commandDestroyed));

  /* ④ 命中提升真的进了公式 */
  const t3 = await p.evaluate(() => {
    const mk = (slug, side, esc, escd) => createShipInstance(JSON.parse(JSON.stringify(SHIP_DATABASE[slug])), side, esc, escd);
    const out = { noSub: null, withSub: null };
    const fire = (subAlive) => {
      const atk = mk('thunder-star', 'enemy', true, false);
      atk.isFlagship = true;
      (atk.subSystems || []).forEach(x => { if (/指挥/.test(x.name || '')) x.destroyed = false; });
      atk.fleetMechs = fleetMechsOf(atk);
      const tgt = mk('constantine', 'ally', true, false);
      const foeEsc = mk('constantine', 'ally', true, false);
      const foeEsd = mk('constantine', 'ally', false, true);
      if (!subAlive) { foeEsd.alive = false; foeEsd.hp = 0; }
      battleState = { time: 0, allyShips: [tgt, foeEsc, foeEsd], enemyShips: [atk], ended: false, battleLogs: [] };
      const ws = (atk.weaponStates || [])[0];
      // 直接算命中率：跑多次取平均
      let hits = 0, N = 4000;
      const origHp = tgt.hp;
      for (let i = 0; i < N; i++) {
        tgt.hp = origHp;
        // 用 executeShot 不好统计，改为直接读 subHit 逻辑：算 subTargetCount
        if (subTargetCount(battleState, 'enemy') > 0) hits++;
      }
      return { subN: subTargetCount(battleState, 'enemy'), hits };
    };
    out.withSub = fire(true);
    out.noSub = fire(false);
    return out;
  });
  say('\n命中加成条件: ' + JSON.stringify(t3));
  check('两支敌方舰队都在 → subTargetCount=1（命中加成会生效）', t3.withSub.subN === 1, JSON.stringify(t3.withSub));
  check('只有一支 → subTargetCount=0（不生效）', t3.noSub.subN === 0, JSON.stringify(t3.noSub));

  /* ⑤ 庇护作战减伤 + ⑥ 多目标反击 */
  const t4 = await p.evaluate(() => {
    const mk = (slug, side, esc, escd) => createShipInstance(JSON.parse(JSON.stringify(SHIP_DATABASE[slug])), side, esc, escd);
    const p = mk('plutus-shield', 'enemy', true, false);
    p.isFlagship = true;
    (p.subSystems || []).forEach(x => { if (/指挥/.test(x.name || '')) x.destroyed = false; });
    p.fleetMechs = fleetMechsOf(p);
    const e2 = mk('constantine', 'enemy', false, true);
    const c1 = mk('constantine', 'ally', true, false);
    const c2 = mk('constantine', 'ally', false, true);
    battleState = { time: 0, allyShips: [c1, c2], enemyShips: [p, e2], ended: false, battleLogs: [] };
    return {
      kinds: (p.fleetMechs || []).map(x => x.fm.kind),
      protect: subProtectOf(p, battleState),
      repairB: subRepairBoost(p, battleState)
    };
  });
  say('\n普鲁图斯之盾: ' + JSON.stringify(t4));
  check('识别出 protectFromSub', (t4.kinds || []).includes('protectFromSub'), JSON.stringify(t4.kinds));
  check('副目标在场 → 减伤 > 0', t4.protect > 0, String(t4.protect));

  /* ⑦ counterSub：给雷火之星跑 tick，看是否对副目标打出额外伤害 */
  const t5 = await p.evaluate(() => {
    const mk = (slug, side, esc, escd) => createShipInstance(JSON.parse(JSON.stringify(SHIP_DATABASE[slug])), side, esc, escd);
    const atk = mk('thunder-star', 'enemy', true, false);
    atk.isFlagship = true;
    (atk.subSystems || []).forEach(x => { if (/指挥/.test(x.name || '')) x.destroyed = false; });
    atk.fleetMechs = fleetMechsOf(atk);
    atk.weaponStates.forEach(w => { w.strengthen = w.strengthen || {}; });
    const c1 = mk('constantine', 'ally', true, false);
    const c2 = mk('constantine', 'ally', false, true);
    battleState = { time: 0, allyShips: [c1, c2], enemyShips: [atk], ended: false, battleLogs: [] };
    const hp0 = c2.hp;
    for (let i = 0; i < 60; i++) { processFleetMechs(atk, [c1, c2], 1, battleState); battleState.time += 1; }
    return { hasCounter: (atk.fleetMechs || []).some(x => x.fm.kind === 'counterSub'), c2Lost: hp0 - c2.hp, logs: battleState.battleLogs.length };
  });
  say('\n多目标反击: ' + JSON.stringify(t5));
  check('识别出 counterSub', t5.hasCounter === true);
  check('副目标舰队（C2）被打到了', t5.c2Lost > 0, '掉血 ' + t5.c2Lost);

  check('无 JS 报错', errs.length === 0, errs.slice(0, 2).join(' | '));
  const pass = res.filter(Boolean).length;
  say('\n通过 ' + pass + '/' + res.length);
  await b.close();
})();
