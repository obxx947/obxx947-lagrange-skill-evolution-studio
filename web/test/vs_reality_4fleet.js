/* ============================================================
   护航对冲（4 舰队）对局：我方护航 / 我方被护航 / 敌方护航 / 敌方被护航
   双方【各用各的加点】—— 两套都塞进 lagrange_addpoint_sets，舰队条目上写 apSet 指定用哪套。

   跑法：
     node test/vs_reality_4fleet.js <我方加点.json> <我方护航.json> <我方被护航.json> \
                                    <敌方加点.json> <敌方护航.json> <敌方被护航.json> [RUNS]
   ============================================================ */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const [AP_A, A_ESC, A_ESCED, AP_B, B_ESC, B_ESCED, RUNS_S] = process.argv.slice(2);
const RUNS = parseInt(RUNS_S || '5', 10);
if (!AP_A || !A_ESC || !A_ESCED || !AP_B || !B_ESC || !B_ESCED) {
  console.log('用法: node test/vs_reality_4fleet.js <我方加点> <我方护航> <我方被护航> <敌方加点> <敌方护航> <敌方被护航> [RUNS]');
  process.exit(0);
}
const J = p => JSON.parse(fs.readFileSync(p, 'utf8'));

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
  await p.goto(BASE + '/simulator.html', { waitUntil: 'load', timeout: 90000 });
  await sleep(4500);

  const apA = J(AP_A), apB = J(AP_B);
  const sets = [
    { name: '我方加点', addpoints: apA.addpoints || {} },
    { name: '敌方加点', addpoints: apB.addpoints || {} }
  ];
  await p.evaluate(x => localStorage.setItem('lagrange_addpoint_sets', JSON.stringify(x)), sets);
  await p.evaluate(x => localStorage.setItem('lagrange_addpoint', JSON.stringify(x)), apA.addpoints || {});
  const cdns = Object.keys(apA.addpoints || {}).concat(Object.keys(apB.addpoints || {}));
  const pre = await p.evaluate(async ids => {
    for (const c of ids) { try { await loadBpTree(c); } catch (e) { } }
    return { n: Object.keys(BP_TREE || {}).length };
  }, cdns);
  console.log('蓝图树载入 =', pre.n, '/', cdns.length, '｜ 两套加点已写入 lagrange_addpoint_sets');

  const planA_esc = J(A_ESC), planA_esced = J(A_ESCED), planB_esc = J(B_ESC), planB_esced = J(B_ESCED);

  const out = await p.evaluate((pAe, pAed, pBe, pBed, RUNS) => {
    function BUILD(fl, sec, setNm) {
      const o = [];
      ((fl.fleets && fl.fleets[0] && fl.fleets[0][sec]) || []).forEach(s => {
        const t = SHIP_DATABASE[s.id]; if (!t) return;
        const e = JSON.parse(JSON.stringify(t));
        e.count = s.qty || 1; e.selectedModules = Object.assign({}, s.mods || {});
        if (s.pos) e.position = s.pos;
        e.apSet = setNm;                       // ★ 这套舰队用哪套加点
        recalcAircraftSlots(e); e.aircraft = [];
        (s.air || []).forEach(a => {
          const at = SHIP_DATABASE[a.id]; if (!at) return;
          const slots = e.simSlots || [];
          const sl = slots.find(x => x.key === a.slot) || slots.find(x => x.allow === 'ALL' || x.kind === a.kind);
          if (!sl) return;
          const inst = JSON.parse(JSON.stringify(at)); inst.count = a.qty || 1; inst.slot = sl.key;
          e.aircraft.push(inst);
        });
        o.push(e);
      });
      return o;
    }
    const side = (plan, setNm) => BUILD(plan.plans[0], 'main', setNm).concat(BUILD(plan.plans[0], 'reinforce', setNm));
    const AES = side(pAe, '我方加点'), AED = side(pAed, '我方加点');
    const BES = side(pBe, '敌方加点'), BED = side(pBed, '敌方加点');
    const dump = [];
    let t0 = 0, res = null;
    for (let i = 0; i < RUNS; i++) {
      FLEET_TYPES.forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; fleetData[k].apSet = null; });
      fleetData['ally-escort'].main = JSON.parse(JSON.stringify(AES));
      fleetData['ally-escorted'].main = JSON.parse(JSON.stringify(AED));
      fleetData['enemy-escort'].main = JSON.parse(JSON.stringify(BES));
      fleetData['enemy-escorted'].main = JSON.parse(JSON.stringify(BED));
      refreshFleetViews();
      if (!prepareBattle()) return { err: 1 };
      const bs = battleState;
      let t = 0; while (!bs.ended && t < 30000) { processBattleTick(0.2); t += 0.2; }
      t0 += t;
      const S = (sd, k) => (((bs.stat || {})[sd] || {})[k]) || 0;
      const sum = (o) => Object.values(o || {}).reduce((a, r) => a + (r.antiShip || 0) + (r.antiAir || 0), 0);
      res = {
        dur: t0 / (i + 1),
        A: { as: sum((bs.stat.ally || {}).per), aa: Object.values((bs.stat.ally || {}).per || {}).reduce((a, r) => a + (r.antiAir || 0), 0),
             mm: Object.values((bs.stat.ally || {}).per || {}).reduce((a, r) => a + (r.repair || 0), 0),
             alive: bs.allyShips.filter(s => s.alive).length, total: bs.allyShips.length },
        B: { as: Object.values((bs.stat.enemy || {}).per || {}).reduce((a, r) => a + (r.antiShip || 0), 0),
             aa: Object.values((bs.stat.enemy || {}).per || {}).reduce((a, r) => a + (r.antiAir || 0), 0),
             mm: Object.values((bs.stat.enemy || {}).per || {}).reduce((a, r) => a + (r.repair || 0), 0),
             alive: bs.enemyShips.filter(s => s.alive).length, total: bs.enemyShips.length },
        apSrc: (bs.allyShips[0] || {})._apSrc
      };
      if (i === 0) dump.push({ side: 'A', per: (bs.stat.ally || {}).per, n: bs.allyShips.length, hp: bs.allyShips.reduce((a, s) => a + s.maxHp, 0) },
                            { side: 'B', per: (bs.stat.enemy || {}).per, n: bs.enemyShips.length, hp: bs.enemyShips.reduce((a, s) => a + s.maxHp, 0) });
    }
    return { err: 0, res: res, dump: dump };
  }, planA_esc, planA_esced, planB_esc, planB_esced, RUNS);

  console.log('pageerror:', errs.length ? errs : '(无)');
  if (out.err) { console.log('prepareBattle 失败'); await b.close(); return; }
  const r = out.res;
  const w = v => (v / 10000).toFixed(1) + '万';
  console.log('\n===== 模拟（' + RUNS + ' 次均值） =====');
  console.log('时长 ' + r.dur.toFixed(0) + 's');
  console.log('🔵 我方：对舰 ' + w(r.A.as) + ' ｜ 对空 ' + w(r.A.aa) + ' ｜ 维修 ' + w(r.A.mm) + ' ｜ 存活 ' + r.A.alive + '/' + r.A.total);
  console.log('🔴 敌方：对舰 ' + w(r.B.as) + ' ｜ 对空 ' + w(r.B.aa) + ' ｜ 维修 ' + w(r.B.mm) + ' ｜ 存活 ' + r.B.alive + '/' + r.B.total);
  console.log('加点来源样例：' + r.apSrc);
  console.log('\n===== 逐舰输出（模拟） =====');
  out.dump.forEach(d => {
    console.log('--- ' + (d.side === 'A' ? '我方' : '敌方') + '（' + d.n + ' 艘，总结构 ' + w(d.hp) + '）---');
    Object.keys(d.per || {}).map(k => [k, d.per[k]]).sort((x, y) => (y[1].antiShip + y[1].antiAir) - (x[1].antiShip + x[1].antiAir))
      .forEach(([k, v]) => {
        if (!(v.antiShip || v.antiAir || v.repair)) return;
        console.log('   ' + String(k).slice(0, 26).padEnd(28) + '对舰 ' + w(v.antiShip).padStart(9) + '  对空 ' + w(v.antiAir).padStart(9) + '  维修 ' + w(v.repair).padStart(9));
      });
  });
  await b.close();
})();
