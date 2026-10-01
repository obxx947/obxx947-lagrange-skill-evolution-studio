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
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
  await p.goto(BASE + '/simulator.html', { waitUntil: 'load', timeout: 90000 });
  await sleep(4500);
  await p.evaluate(x => localStorage.setItem('lagrange_addpoint', JSON.stringify(x)), AP.addpoints || AP);
  await p.evaluate(async ids => { for (const c of ids) { try { await loadBpTree(c); } catch (e) { } } }, Object.keys(AP.addpoints || {}));
  const out = await p.evaluate((planA, planB) => {
    function BUILD_SIDE(fl, sec) {
      const o = [];
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
        o.push(e);
      });
      return o;
    }
    const pf = (pl, i) => pl.plans[i].fleets[0];
    FLEET_TYPES.forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; fleetData[k].apSet = null; });
    fleetData['ally-escort'].main = BUILD_SIDE(pf(planA, 0), 'main').concat(BUILD_SIDE(pf(planA, 0), 'reinforce'));
    fleetData['enemy-escort'].main = BUILD_SIDE(pf(planB, 0), 'main').concat(BUILD_SIDE(pf(planB, 0), 'reinforce'));
    refreshFleetViews();
    if (!prepareBattle()) return { err: 1 };
    const bs = battleState;
    let t = 0; while (!bs.ended && t < 30000) { processBattleTick(0.2); t += 0.2; }
    let ge = null;
    try { generateBattleReport(); } catch (e) { ge = e.message; }
    const el = document.getElementById('battleReportContent');
    let detail = '';
    try {
      const rows = el ? el.querySelectorAll('[onclick]') : [];
      let hit = null;
      for (const r of rows) { if ((r.getAttribute('onclick')||'').startsWith('bsdOpen')) { hit = r; break; } }
      if (hit) { hit.click(); const d = document.getElementById('bsdBody');
                 detail = d ? (d.textContent||'') : 'NO-BODY'; }
      else detail = 'NO-CLICKABLE(' + rows.length + ')';
    } catch(e) { detail = 'CLICK-ERR '+e.message; }
    return { err: 0, ge: ge, dur: t, len: el ? (el.innerHTML || '').length : -1, txt: el ? (el.textContent || '') : 'NO-EL', clicked: (detail||'') };
  }, PLANA, PLANB);
  console.log('pageerror:', errs.length ? errs : '(无)');
  if (out.err) { console.log('prepareBattle failed'); await b.close(); return; }
  console.log('渲染异常=' + out.ge + ' ｜ html长度=' + out.len + ' ｜ 时长=' + out.dur.toFixed(0) + 's');
  console.log('---- 详情页 ----');
  console.log((out.clicked||'(空)').slice(0,1200));
  console.log('');

  console.log('---- 战报正文 ----');
  await b.close();
})();
