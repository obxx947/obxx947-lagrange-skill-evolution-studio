/* 统计每门武器实际开了几炮、打的是谁 —— 定位「反击防空一炮没打」 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AP = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const PLANA = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const PLANB = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
  await p.goto(BASE + '/simulator.html', { waitUntil: 'load', timeout: 90000 });
  await sleep(4500);
  await p.evaluate(x => localStorage.setItem('lagrange_addpoint', JSON.stringify(x)), AP.addpoints || AP);
  await p.evaluate(async ids => { for (const c of ids) { try { await loadBpTree(c); } catch (e) { } } }, Object.keys(AP.addpoints || {}));
  const out = await p.evaluate((planA, planB) => {
    function BUILD_SIDE(fl, sec) {
      const out = [];
      (fl[sec] || []).forEach(s => {
        const t = SHIP_DATABASE[s.id]; if (!t) return;
        const e = JSON.parse(JSON.stringify(t));
        e.count = s.qty || 1; e.selectedModules = Object.assign({}, s.mods || {});
        if (s.pos) e.position = s.pos;
        recalcAircraftSlots(e); e.aircraft = [];
        (s.air || []).forEach(a => {
          const at = SHIP_DATABASE[a.id]; if (!at) return;
          const slots = e.simSlots || [];
          const sl = slots.find(x => x.key === a.slot) || slots.find(x => x.allow === 'ALL' || x.kind === a.kind);
          if (!sl) return;
          const inst = JSON.parse(JSON.stringify(at)); inst.count = a.qty || 1; inst.slot = sl.key;
          e.aircraft.push(inst);
        });
        out.push(e);
      });
      return out;
    }
    const pf = (pl, i) => pl.plans[i].fleets[0];
    const A = BUILD_SIDE(pf(planA, 0), 'main').concat(BUILD_SIDE(pf(planA, 0), 'reinforce'));
    const Bz = BUILD_SIDE(pf(planB, 0), 'main').concat(BUILD_SIDE(pf(planB, 0), 'reinforce'));
    FLEET_TYPES.forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; fleetData[k].apSet = null; });
    fleetData['ally-escort'].main = A; fleetData['enemy-escort'].main = Bz;
    refreshFleetViews();
    if (!prepareBattle()) return { err: 1 };
    const bs = battleState;
    /* 统计：哪门武器开火几次、打的什么（按武器名归并） */
    const cnt = {};
    const orig = window.executeShot;
    let nn = 0;
    window.executeShot = function (a, t, w, ws, b2, c) {
      try {
        const k = (a.name || a.id) + ' :: ' + (w.name || '?');
        const o = cnt[k] || (cnt[k] = { n: 0, air: 0, ship: 0, tgtSample: {}, aa: w.antiAirType || '-', side: a.side });
        o.n++;
        if (t.position === 'aircraft') o.air++; else o.ship++;
        const tn = t.name || t.id; o.tgtSample[tn] = (o.tgtSample[tn] || 0) + 1;
      } catch (e) { nn++; }
      return orig.apply(this, arguments);
    };
    let t = 0;
    while (!bs.ended && t < 30000) { processBattleTick(0.2); t += 0.2; }
    /* 同时记录：每方有多少"敌机正在攻击我方舰船"的时刻（反击防空的触发机会） */
    return { dur: t, cnt: cnt, err: nn };
  }, PLANA, PLANB);
  if (out.err === 1) { console.log('prepareBattle failed'); await b.close(); return; }
  console.log('战斗 ' + out.dur.toFixed(0) + 's ｜ executeShot 抛错 ' + out.err + ' 次\n');
  const rows = Object.entries(out.cnt).map(([k, v]) => ({ k, ...v }));
  rows.sort((a, b) => b.n - a.n);
  console.log('武器（开火次数）'.padEnd(58) + '防空类型   次数   打载机 打舰船  最常打的目标');
  rows.slice(0, 26).forEach(r => {
    const top = Object.entries(r.tgtSample).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0] + '×' + x[1]).join(' ');
    console.log(r.k.slice(0, 56).padEnd(58) + String(r.aa).padEnd(10) + String(r.n).padStart(5) + String(r.air).padStart(8) + String(r.ship).padStart(8) + '  ' + top);
  });
  await b.close();
})();
