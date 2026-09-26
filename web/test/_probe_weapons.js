/* 冻结一次战斗，逐单位 dump 武器：是否带对空能力、能否选中载机 */
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
  const cdns = Object.keys(AP.addpoints || {});
  await p.evaluate(x => localStorage.setItem('lagrange_addpoint', JSON.stringify(x)), AP.addpoints || AP);
  await p.evaluate(async ids => { for (const c of ids) { try { await loadBpTree(c); } catch (e) { } } }, cdns);

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
    const dump = (arr, side) => arr.map(s => ({
      side, name: s.name, from: JSON.stringify(s.selectedModules||{}), air: 1,
      isAir: s.position === 'aircraft',
      ws: (s.weaponStates || []).map(x => x.weapon).map(w => ({
        n: w.name, tgt: (w.targets || []).map(t => t.types),
        aa: (w.dpm && w.dpm.antiAir) || 0, as: (w.dpm && w.dpm.antiShip) || 0,
        shots: w.shotsPerCycle, single: w.singleDmg, cd: w.cooldown
      }))
    }));
    return { ally: dump(bs.allyShips, 'A'), enemy: dump(bs.enemyShips, 'B') };
  }, PLANA, PLANB);

  const show = (arr, tag) => {
    console.log('\n########## ' + tag + ' ##########');
    const byName = {};
    arr.forEach(s => { (byName[s.name] = byName[s.name] || { aa: 0, as: 0, n: 0, ws: [], mod: s.from }); byName[s.name].n++; byName[s.name].aa += s.ws.reduce((a, w) => a + w.aa, 0); byName[s.name].as += s.ws.reduce((a, w) => a + w.as, 0); if (!byName[s.name].ws.length) byName[s.name].ws = s.ws; });
    Object.keys(byName).forEach(k => {
      const v = byName[k];
      console.log(`  ${k} ×${v.n}  面板防空=${v.aa}/分 反舰=${v.as}/分  mods=${v.mod}`);
      v.ws.forEach(w => console.log(`      · ${w.n} | 防空${w.aa} 反舰${w.as} | tgt=${JSON.stringify(w.tgt)} | shots=${w.shots} 单发=${w.single} cd=${w.cd}`));
    });
  };
  if (out.err) { console.log('prepareBattle failed'); } else { show(out.ally, 'A 方'); show(out.enemy, 'B 方'); }
  await b.close();
})();
