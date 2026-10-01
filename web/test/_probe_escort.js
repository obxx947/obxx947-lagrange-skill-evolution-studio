/* 验证：护航舰队还活着时，被护航舰队是不是真的一点伤害都不吃 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const J = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const [APA, AE, AED, APB, BE, BED] = process.argv.slice(2);
(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
  await p.goto(BASE + '/simulator.html', { waitUntil: 'load', timeout: 90000 });
  await sleep(4500);
  const apA = J(APA), apB = J(APB);
  await p.evaluate(x => localStorage.setItem('lagrange_addpoint_sets', JSON.stringify(x)),
    [{ name: '我方加点', addpoints: apA.addpoints || {} }, { name: '敌方加点', addpoints: apB.addpoints || {} }]);
  await p.evaluate(async ids => { for (const c of ids) { try { await loadBpTree(c); } catch (e) { } } },
    Object.keys(apA.addpoints || {}).concat(Object.keys(apB.addpoints || {})));
  const out = await p.evaluate((pAe, pAed, pBe, pBed) => {
    function BUILD(fl, sec, setNm) {
      const o = [];
      ((fl.fleets && fl.fleets[0] && fl.fleets[0][sec]) || []).forEach(s => {
        const t = SHIP_DATABASE[s.id]; if (!t) return;
        const e = JSON.parse(JSON.stringify(t));
        e.count = s.qty || 1; e.selectedModules = Object.assign({}, s.mods || {});
        if (s.pos) e.position = s.pos; e.apSet = setNm;
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
    const side = (plan, nm) => BUILD(plan.plans[0], 'main', nm).concat(BUILD(plan.plans[0], 'reinforce', nm));
    FLEET_TYPES.forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; fleetData[k].apSet = null; });
    fleetData['ally-escort'].main = side(pAe, '我方加点');
    fleetData['ally-escorted'].main = side(pAed, '我方加点');
    fleetData['enemy-escort'].main = side(pBe, '敌方加点');
    fleetData['enemy-escorted'].main = side(pBed, '敌方加点');
    refreshFleetViews();
    if (!prepareBattle()) return { err: 1 };
    const bs = battleState;
    /* 采样：护航存活期间，被护航一共掉了多少血 */
    const shadow = (arr, isEsc) => arr.filter(u => u.isEscort === isEsc);
    let firstEscortDownT = null, escortedDmgWhileEscortAlive = { A: 0, B: 0 };
    const hp0 = { A: {}, B: {} };
    bs.allyShips.concat(bs.enemyShips).forEach(u => { const s = u.side === 'ally' ? 'A' : 'B'; hp0[s][u.__k = (u.name || u.id) + '#' + Math.random()] = u.hp; });
    const before = {};
    bs.allyShips.concat(bs.enemyShips).forEach(u => { before[u.name + '@' + (u.isEscort ? 'E' : 'D')] = 0; });
    let prevHp = {}; bs.allyShips.concat(bs.enemyShips).forEach(u => prevHp[u.__k] = u.hp);
    let t = 0;
    while (!bs.ended && t < 30000) {
      processBattleTick(0.2); t += 0.2;
      const aEsc = bs.allyShips.some(s => s.isEscort && s.alive);
      const bEsc = bs.enemyShips.some(s => s.isEscort && s.alive);
      bs.allyShips.concat(bs.enemyShips).forEach(u => {
        const d = Math.max(0, prevHp[u.__k] - u.hp); prevHp[u.__k] = u.hp;
        if (d <= 0) return;
        const isA = u.side === 'ally';
        const escAlive = isA ? aEsc : bEsc;
        if (!u.isEscort && escAlive) escortedDmgWhileEscortAlive[isA ? 'A' : 'B'] += d;   // ← 这一项应当恒为 0
        if (u.isEscort && isA && !aEsc && firstEscortDownT === null) firstEscortDownT = t;
        if (u.isEscort && !isA && !bEsc && firstEscortDownT === null) firstEscortDownT = t;
      });
    }
    return { err: 0, dur: t,
      A护护航存活时被护航受损: escortedDmgWhileEscortAlive.A,
      B护护航存活时被护航受损: escortedDmgWhileEscortAlive.B,
      A存活: { escort: bs.allyShips.filter(s => s.isEscort && s.alive).length, escortTotal: bs.allyShips.filter(s => s.isEscort).length,
               escorted: bs.allyShips.filter(s => s.isEscorted && s.alive).length, escortedTotal: bs.allyShips.filter(s => s.isEscorted).length },
      B存活: { escort: bs.enemyShips.filter(s => s.isEscort && s.alive).length, escortTotal: bs.enemyShips.filter(s => s.isEscort).length,
               escorted: bs.enemyShips.filter(s => s.isEscorted && s.alive).length, escortedTotal: bs.enemyShips.filter(s => s.isEscorted).length } };
  }, J(AE), J(AED), J(BE), J(BED));
  console.log('pageerror: 见上');
  if (out.err) { console.log('prepareBattle 失败'); await b.close(); return; }
  console.log('战斗时长 ' + out.dur.toFixed(0) + 's');
  console.log('\n★ 护航存活期间【被护航舰队】受到的伤害（应当为 0）：');
  console.log('   我方被护航: ' + Math.round(out.A护护航存活时被护航受损));
  console.log('   敌方被护航: ' + Math.round(out.B护护航存活时被护航受损));
  console.log('\n存活：我方 护航 ' + out.A存活.escort + '/' + out.A存活.escortTotal + '  被护航 ' + out.A存活.escorted + '/' + out.A存活.escortedTotal);
  console.log('      敌方 护航 ' + out.B存活.escort + '/' + out.B存活.escortTotal + '  被护航 ' + out.B存活.escorted + '/' + out.B存活.escortedTotal);
  await b.close();
})();
