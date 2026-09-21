/* 条件触发实测（按船取实例）
   验：① hpBelow 满血不生效 / 掉到阈值生效 / 持续到期撤掉 / once 只触发一次
       ② battleStartSec 开场生效 / 过了X秒撤掉 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const res = []; const say = (...a) => console.log(a.join(' '));
const check = (n, ok, d) => { res.push(!!ok); say((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  → ' + d : '')); };

(async () => {
  const st = JSON.parse(fs.readFileSync('data/blueprint_stats.json', 'utf8'));
  const bp = JSON.parse(fs.readFileSync('data/blueprint_all.json', 'utf8'));
  const idx = {};
  bp.forEach(b => b.systems.forEach(y => y.nodes.forEach(n => idx[n.id] = { cdn: String(b.id), ship: b.shipName, sys: y.sysName, name: n.name })));

  const pickHp = Object.entries(st.nodes).find(([id, c]) => c.cond && c.cond.kind === 'hpBelow' && c.cond.dur > 0 && c.addable && idx[id]);
  const pickBs = Object.entries(st.nodes).find(([id, c]) => c.cond && c.cond.kind === 'battleStartSec' && c.addable && idx[id]);
  const H = { id: pickHp[0], c: pickHp[1], i: idx[pickHp[0]] };
  const B = { id: pickBs[0], c: pickBs[1], i: idx[pickBs[0]] };
  say('hpBelow 取样     : ' + H.i.ship + ' / ' + H.i.name + '  thr=' + H.c.cond.threshold + ' dur=' + H.c.cond.dur + ' once=' + H.c.cond.once + ' stat=' + H.c.stat + ' statValues=' + JSON.stringify(H.c.statValues));
  say('battleStartSec 取样: ' + B.i.ship + ' / ' + B.i.name + '  sec=' + B.c.cond.sec + ' stat=' + B.c.stat + ' statValues=' + JSON.stringify(B.c.statValues));

  const store = {};
  [H, B].forEach(x => {
    const mx = (x.c.perLevel || []).length - 1;
    store[x.i.cdn] = { lv: {}, manual: {} };
    store[x.i.cdn].lv[x.id] = Math.max(1, mx);
  });
  say('注入: ' + JSON.stringify(store));

  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1200, height: 900 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2500));
  await p.evaluate(s => localStorage.setItem('lagrange_addpoint', JSON.stringify(s)), store);
  await p.reload({ waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 3000));

  const BP = `(cdn) => Object.keys(BP_MAP).find(k => String(BP_MAP[k].cdnId) === cdn)`;
  const mk = `(cdn) => { const slug = ${BP}(cdn); const e = JSON.parse(JSON.stringify(SHIP_DATABASE[slug])); return createShipInstance(e, 'ally', false, false); }`;

  const runHp = await p.evaluate((cdn) => {
    const slugOf = c => Object.keys(BP_MAP).find(k => String(BP_MAP[k].cdnId) === c);
    const e = JSON.parse(JSON.stringify(SHIP_DATABASE[slugOf(cdn)]));
    const s = createShipInstance(e, 'ally', false, false);
    const foes = [createShipInstance(JSON.parse(JSON.stringify(SHIP_DATABASE['constantine'])), 'enemy', false, false)];
    battleState = { time: 0, allyShips: [s], enemyShips: foes, ended: false, battleLogs: [] };
    const snap = () => ({ t: Math.round(battleState.time), hpPct: Math.round(s.hp / s.maxHp * 100), applied: (s.condEffects || []).map(c => !!c.applied), done: (s.condEffects || []).map(c => !!c.done) });
    const r = { cond: (s.condEffects || []).map(c => ({ kind: c.cond.kind, thr: c.cond.threshold, dur: c.cond.dur, once: !!c.cond.once })) };
    r.t0 = snap();
    for (let i = 0; i < 60; i++) { processCondEffects(s, foes, 1, battleState); battleState.time += 1; }
    r.full = snap();
    s.hp = s.maxHp * 0.05;
    processCondEffects(s, foes, 1, battleState);
    r.lowNow = snap();
    for (let i = 0; i < 90; i++) { processCondEffects(s, foes, 1, battleState); battleState.time += 1; }
    r.afterDur = snap();
    s.hp = s.maxHp;
    processCondEffects(s, foes, 1, battleState);
    r.back = snap();
    return r;
  }, H.i.cdn);
  say('\n[hpBelow] ' + JSON.stringify(runHp));
  check('hpBelow 满血时未生效', runHp.full.applied.every(a => !a), JSON.stringify(runHp.full));
  check('hpBelow 掉到阈值以下 → 生效', runHp.lowNow.applied.some(a => a), JSON.stringify(runHp.lowNow));
  check('hpBelow 持续 ' + H.c.cond.dur + ' 秒到期 → 撤掉', runHp.afterDur.applied.every(a => !a), JSON.stringify(runHp.afterDur));
  check('hpBelow once=true → 回满血也不再触发', runHp.back.applied.every(a => !a), JSON.stringify(runHp.back));

  const runBs = await p.evaluate((cdn) => {
    const slugOf = c => Object.keys(BP_MAP).find(k => String(BP_MAP[k].cdnId) === c);
    const e = JSON.parse(JSON.stringify(SHIP_DATABASE[slugOf(cdn)]));
    const s = createShipInstance(e, 'ally', false, false);
    const foes = [createShipInstance(JSON.parse(JSON.stringify(SHIP_DATABASE['constantine'])), 'enemy', false, false)];
    battleState = { time: 0, allyShips: [s], enemyShips: foes, ended: false, battleLogs: [] };
    const snap = () => ({ t: Math.round(battleState.time), applied: (s.condEffects || []).map(c => !!c.applied) });
    const sec = (s.condEffects[0] || { cond: {} }).cond.sec;
    processCondEffects(s, foes, 1, battleState);
    const t0 = snap();
    for (let i = 0; i < Math.ceil(sec || 0) + 5; i++) { processCondEffects(s, foes, 1, battleState); battleState.time += 1; }
    return { t0, afterSec: snap(), sec };
  }, B.i.cdn);
  say('[battleStartSec] ' + JSON.stringify(runBs));
  check('battleStartSec 开场生效', runBs.t0.applied.some(a => a), JSON.stringify(runBs.t0));
  check('battleStartSec 过了 ' + runBs.sec + ' 秒 → 撤掉', runBs.afterSec.applied.every(a => !a), JSON.stringify(runBs.afterSec));

  check('无 JS 报错', errs.length === 0, errs.slice(0, 2).join(' | '));
  const pass = res.filter(Boolean).length;
  say('\n通过 ' + pass + '/' + res.length);
  await b.close();
})();
