/* ============================================================
   4 舰队（护航对冲）对局 —— 模拟器均值 vs 游戏战报【差值对比】
   统计按【舰队】聚合（护航队 / 被护航队），不是按舰名 —— 同一舰名会跨队。

   跑法：
     node test/cmp_4fleet.js <我方加点> <我方护航> <我方被护航> <敌方加点> <敌方护航> <敌方被护航> [RUNS]
   ============================================================ */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const NL = String.fromCharCode(10);
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const J = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const [APA, AE, AED, APB, BE, BED, RUNS_S] = process.argv.slice(2);
const RUNS = parseInt(RUNS_S || '8', 10);

/* 游戏真值（战报2 · 2026-09-25 14:58:35 那场，时长 6:29）
   左侧 1号舰队 = 我方被护航（太阳鲸/猎兵/狩猎者/康纳马拉/游骑兵/枪骑兵）
   右侧 5号舰队 = 【敌方护航】（永恒风暴/ST59/光锥/CAS066/开阳/谷神星/瑶光）
     —— 船名与 敌方护航赐天与彼.json 完全一致，所以不是"被护航" */
const GAME = {
  dur: 389,
  A被护航: { as: 3959000, aa: 0, mm: 0, life: 0.87 },
  B护航: { as: 559700, aa: 156300, mm: 547000, life: 0.86 }
};

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
  await p.goto(BASE + '/simulator.html', { waitUntil: 'load', timeout: 90000 });
  await sleep(4500);
  const apA = J(APA), apB = J(APB);
  await p.evaluate(x => localStorage.setItem('lagrange_addpoint_sets', JSON.stringify(x)),
    [{ name: '我方加点', addpoints: apA.addpoints || {} }, { name: '敌方加点', addpoints: apB.addpoints || {} }]);
  await p.evaluate(async ids => { for (const c of ids) { try { await loadBpTree(c); } catch (e) { } } },
    Object.keys(apA.addpoints || {}).concat(Object.keys(apB.addpoints || {})));

  const out = await p.evaluate((pAe, pAed, pBe, pBed, RUNS) => {
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
    const AES = side(pAe, '我方加点'), AED = side(pAed, '我方加点');
    const BES = side(pBe, '敌方加点'), BED = side(pBed, '敌方加点');
    let acc = null, n = 0;
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
      const agg = (arr, esc, ecd) => {
        const g = { as: 0, aa: 0, mm: 0, n: 0, alive: 0, hp: 0, hpMax: 0, taken: 0, life: 0 };
        arr.forEach(u => {
          if (u.isEscort !== esc || u.isEscorted !== ecd) return;
          g.as += u._dealtShip || 0; g.aa += u._dealtAir || 0; g.mm += u._healOut || 0;
          g.n++; if (u.alive) g.alive++;
          g.hp += Math.max(0, u.hp); g.hpMax += u.maxHp; g.taken += u._taken || 0;
          g.life += (u._aliveSec || 0);
        });
        g.life = g.n ? g.life / (g.n * t) : 0;
        return g;
      };
      const cur = {
        dur: t,
        Aesc: agg(bs.allyShips, true, false), Aecd: agg(bs.allyShips, false, true),
        Besc: agg(bs.enemyShips, true, false), Becd: agg(bs.enemyShips, false, true)
      };
      if (!acc) acc = JSON.parse(JSON.stringify(cur));
      else Object.keys(cur).forEach(k => { if (k === 'dur') acc.dur += cur.dur; else Object.keys(cur[k]).forEach(x => acc[k][x] += cur[k][x]); });
      n++;
    }
    Object.keys(acc).forEach(k => { if (k === 'dur') acc.dur /= n; else Object.keys(acc[k]).forEach(x => acc[k][x] /= n); });
    return { err: 0, acc: acc };
  }, J(AE), J(AED), J(BE), J(BED), RUNS);

  console.log('pageerror:', errs.length ? errs : '(无)');
  if (out.err) { console.log('prepareBattle 失败'); await b.close(); return; }
  const a = out.acc;
  const w = v => (v >= 10000 ? (v / 10000).toFixed(1) + '万' : String(Math.round(v)));
  const line = (t, s, g, pct) => {
    if (g == null) { console.log('  ' + t.padEnd(20) + w(s).padStart(11) + ''.padStart(11)); return; }
    const ds = pct ? ((s * 100).toFixed(0) + '%') : w(s);
    const gs = pct ? ((g * 100).toFixed(0) + '%') : w(g);
    let d;
    if (g !== 0) { const r = (s / g - 1) * 100; d = (r >= 0 ? '+' : '') + r.toFixed(1) + '%' + (Math.abs(r) <= 15 ? ' OK' : Math.abs(r) <= 30 ? ' ~' : ' X'); }
    else d = (s === 0 ? '两边都是 0  OK' : 'X');
    console.log('  ' + t.padEnd(20) + ds.padStart(11) + gs.padStart(11) + '  ' + d);
  };

  console.log(NL + '==== 模拟（' + RUNS + ' 次均值） vs 游戏（战报2 · 1号舰队 vs 5号舰队） ====');
  console.log('  ' + '指标'.padEnd(20) + '模拟'.padStart(11) + '游戏'.padStart(11) + '  差值');
  line('时长(秒)', a.dur, GAME.dur);
  console.log(NL + '  ── 我方被护航 = 游戏【1号舰队】(太阳鲸/猎兵/狩猎者/康纳马拉/游骑兵/枪骑兵+载机) ──');
  line('对舰伤害', a.Aecd.as, GAME.A被护航.as);
  line('对空伤害', a.Aecd.aa, GAME.A被护航.aa);
  line('维修量', a.Aecd.mm, GAME.A被护航.mm);
  line('生存时间占比', a.Aecd.life, GAME.A被护航.life, true);
  console.log(NL + '  ── 敌方护航 = 游戏【5号舰队】(永恒风暴/ST59/光锥/CAS066/开阳/谷神星/瑶光) ──');
  line('对舰伤害', a.Besc.as, GAME.B护航.as);
  line('对空伤害', a.Besc.aa, GAME.B护航.aa);
  line('维修量', a.Besc.mm, GAME.B护航.mm);
  line('生存时间占比', a.Besc.life, GAME.B护航.life, true);
  console.log(NL + '  ── 其余两队（游戏那一页未显示，只报模拟值）──');
  console.log('  我方护航：对舰 ' + w(a.Aesc.as) + ' 对空 ' + w(a.Aesc.aa) + ' 维修 ' + w(a.Aesc.mm) + ' 生存 ' + (a.Aesc.life * 100).toFixed(0) + '%');
  console.log('  敌方被护航：对舰 ' + w(a.Becd.as) + ' 对空 ' + w(a.Becd.aa) + ' 维修 ' + w(a.Becd.mm) + ' 生存 ' + (a.Becd.life * 100).toFixed(0) + '%');
  console.log(NL + '  ── 结构值（模拟）──');
  console.log('  我方被护航 ' + w(a.Aecd.hp) + '/' + w(a.Aecd.hpMax) + '   我方护航 ' + w(a.Aesc.hp) + '/' + w(a.Aesc.hpMax));
  console.log('  敌方被护航 ' + w(a.Becd.hp) + '/' + w(a.Becd.hpMax) + '   敌方护航 ' + w(a.Besc.hp) + '/' + w(a.Besc.hpMax));
  await b.close();
})();
