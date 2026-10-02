/* ============================================================
   验收跑架：两份真实战报各跑 3 次，自动算差值 + 判定 <15%
   ------------------------------------------------------------
   战报1：资料3/舰队A.json + 舰队B.json + 拉格朗日_整套加点_总体加点方案4.json
          目标（游戏 3 场均值）：时长 579s ｜ A对舰 795.1万 / A对空 21.0万 ｜
                                B对舰 87.8万 / B对空 37.0万 / B维修 137.2万
   战报2：我方[护航/被护航/加点]能二.json + 敌方[护航/被护航/加点]赐天与彼.json
          目标（游戏单场，时长 6:29=389s）：
            我方被护航（游戏1号舰队）对舰 395.9万 / 对空 0 / 维修 0 / 生存时间占比 87%
            敌方护航  （游戏5号舰队）对舰 56.0万 / 对空 15.6万 / 维修 54.7万 / 生存 86%
   ============================================================ */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const NL = String.fromCharCode(10);
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const D3 = 'C:/Users/Administrator/Desktop/拉格朗日_战报2/资料3/';
const D2 = 'C:/Users/Administrator/Desktop/拉格朗日_战报2/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const J = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const RUNS = parseInt(process.argv[2] || '3', 10);

const GAME1 = { dur: 579, Aas: 7951000, Aaa: 210000, Bas: 877933, Baa: 369500, Bmm: 1372000 };
/* ★ 2026-10-02 口径修正（用户确认）：游戏「行动统计」是【舰队对舰队】分页，
   那一页的数值 = 该舰队打给【单一目标舰队】的量，不是 4 队合计。 */
const GAME2 = { dur: 389,
    /* ★ 2026-10-02 OCR 新增：「A3号舰队」页 = 敌方被护航 总战绩 */
    B2as: 3590000, B2aa: 66550, B2life: 1.00, Aas: 3959000, Aaa: 0, Amm: 0, Alife: 0.87, Bas: 559700, Baa: 156300, Bmm: 547000, Blife: 0.86 };

const W = v => (v >= 10000 ? (v / 10000).toFixed(1) + '万' : String(Math.round(v)));
const pctOf = (s, g) => (g === 0 ? (s === 0 ? 0 : null) : (s / g - 1) * 100);

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
  await p.goto(BASE + '/simulator.html', { waitUntil: 'load', timeout: 90000 });
  await sleep(4500);

  /* ---------- 通用跑法 ---------- */
  const RUN_PLAIN = (planA, planB, apA, runs) => p.evaluate((pa, pb, ap, N) => {
    function BUILD(fl, sec) {
      const o = [];
      ((fl.fleets && fl.fleets[0] && fl.fleets[0][sec]) || []).forEach(s => {
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
    const side = pl => BUILD(pl.plans[0], 'main').concat(BUILD(pl.plans[0], 'reinforce'));
    const A0 = side(pa), B0 = side(pb);
    let sums = null, n = 0;
    const sumPer = (per) => {
      let as = 0, aa = 0, mm = 0;
      Object.values(per || {}).forEach(r => { as += r.antiShip || 0; aa += r.antiAir || 0; mm += r.repair || 0; });
      return { as, aa, mm };
    };
    for (let i = 0; i < N; i++) {
      /* ★ 2026-10-02 第18轮：每次用固定 seed → 可复现 + 降方差 */
      battleSeed = (window.__SEED0 || 1000) + i * 7919;
      FLEET_TYPES.forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; fleetData[k].apSet = null; });
      fleetData['ally-escort'].main = JSON.parse(JSON.stringify(A0));
      fleetData['enemy-escort'].main = JSON.parse(JSON.stringify(B0));
      refreshFleetViews();
      if (!prepareBattle()) return { err: 1 };
      const bs = battleState;
      let t = 0; while (!bs.ended && t < 30000) { processBattleTick(0.2); t += 0.2; }
      const a = sumPer((bs.stat.ally || {}).per), bb = sumPer((bs.stat.enemy || {}).per);
      const cur = { dur: t, Aas: a.as, Aaa: a.aa, Bas: bb.as, Baa: bb.aa, Bmm: bb.mm,
                    Aalive: bs.allyShips.filter(s => s.alive).length, Atot: bs.allyShips.length,
                    Balive: bs.enemyShips.filter(s => s.alive).length, Btot: bs.enemyShips.length };
      if (!window.__DURS1) window.__DURS1 = []; window.__DURS1.push(Math.round(cur.dur));
      if (!sums) sums = Object.assign({}, cur);
      else Object.keys(cur).forEach(k => sums[k] += cur[k]);
      n++;
    }
    Object.keys(sums).forEach(k => sums[k] /= n);
    return { err: 0, s: sums };
  }, planA, planB, apA, runs);

  const RUN_4F = (pAe, pAed, pBe, pBed, apA, apB, runs) => p.evaluate((Pae, Paed, Pbe, Pbed, apA2, apB2, N) => {
    function BUILD(fl, sec, nm) {
      const o = [];
      ((fl.fleets && fl.fleets[0] && fl.fleets[0][sec]) || []).forEach(s => {
        const t = SHIP_DATABASE[s.id]; if (!t) return;
        const e = JSON.parse(JSON.stringify(t));
        e.count = s.qty || 1; e.selectedModules = Object.assign({}, s.mods || {});
        if (s.pos) e.position = s.pos; e.apSet = nm;
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
    localStorage.setItem('lagrange_addpoint_sets', JSON.stringify([
      { name: '我方加点', addpoints: apA2 }, { name: '敌方加点', addpoints: apB2 }]));
    const side = (pl, nm) => BUILD(pl.plans[0], 'main', nm).concat(BUILD(pl.plans[0], 'reinforce', nm));
    const AES = side(Pae, '我方加点'), AED = side(Paed, '我方加点');
    const BES = side(Pbe, '敌方加点'), BED = side(Pbed, '敌方加点');
    let sums = null, n = 0;
    for (let i = 0; i < N; i++) {
      /* ★ 每次固定 seed → 可复现 + 降方差 */
      battleSeed = (window.__SEED0 || 2000) + i * 7919;
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
        const g = { as: 0, aa: 0, mm: 0, n: 0, alive: 0, life: 0 };
        arr.forEach(u => {
          if (u.isEscort !== esc || u.isEscorted !== ecd) return;
          g.as += u._dealtShip || 0; g.aa += u._dealtAir || 0; g.mm += u._healOut || 0;
          g.n++; if (u.alive) g.alive++;
          g.life += (u._aliveSec || 0);
        });
        g.life = g.n ? g.life / (g.n * t) : 0;
        return g;
      };
      /* ★ 按【战报对战报】拆：这支舰队把伤害打给了对方哪一支舰队 */
      const aggTF = (arr, esc, ecd) => {
        const g = { toEsc: { s: 0, a: 0 }, toEcd: { s: 0, a: 0 } };
        arr.forEach(u => {
          if (u.isEscort !== esc || u.isEscorted !== ecd) return;
          const m = u._dByTF || {};
          if (m['护航队']) { g.toEsc.s += m['护航队'].s; g.toEsc.a += m['护航队'].a; }
          if (m['被护航队']) { g.toEcd.s += m['被护航队'].s; g.toEcd.a += m['被护航队'].a; }
        });
        return g;
      };
      const cur = { dur: t, Aecd: agg(bs.allyShips, false, true), Besc: agg(bs.enemyShips, true, false),
                    BescTF: aggTF(bs.enemyShips, true, false), AecdTF: aggTF(bs.allyShips, false, true),
                    AescTF: aggTF(bs.allyShips, true, false), BedTF: aggTF(bs.enemyShips, false, true),
                    Bed: agg(bs.enemyShips, false, true), Aesc: agg(bs.allyShips, true, false),
                    Aalive: bs.allyShips.filter(s => s.alive).length, Atot: bs.allyShips.length,
                    Balive: bs.enemyShips.filter(s => s.alive).length, Btot: bs.enemyShips.length };
      if (!window.__DURS4) window.__DURS4 = []; window.__DURS4.push(Math.round(cur.dur));
      if (!sums) sums = JSON.parse(JSON.stringify(cur));
      else { sums.dur += cur.dur; sums.Aalive += cur.Aalive; sums.Atot += cur.Atot; sums.Balive += cur.Balive; sums.Btot += cur.Btot;
        ['Aecd', 'Besc', 'Bed', 'Aesc'].forEach(k => Object.keys(cur[k]).forEach(x => sums[k][x] += cur[k][x]));
        ['BescTF', 'AecdTF', 'AescTF', 'BedTF'].forEach(k => { ['toEsc', 'toEcd'].forEach(x => { sums[k][x].s += cur[k][x].s; sums[k][x].a += cur[k][x].a; }); }); }
      n++;
    }
    sums.dur /= n; sums.Aalive /= n; sums.Atot /= n; sums.Balive /= n; sums.Btot /= n;
    ['Aecd', 'Besc', 'Bed', 'Aesc'].forEach(k => Object.keys(sums[k]).forEach(x => sums[k][x] /= n));
    ['BescTF', 'AecdTF', 'AescTF', 'BedTF'].forEach(k => { ['toEsc', 'toEcd'].forEach(x => { sums[k][x].s /= n; sums[k][x].a /= n; }); });
    return { err: 0, s: sums };
  }, pAe, pAed, pBe, pBed, apA, apB, runs);

  /* ---------- 战报 1 ---------- */
  /* 战报1 的两队 = 资料3 里那两个文件（A 队船名与 我方被护航能二 完全一致；
     B 队船名与 我方护航能二 完全一致，且 B 队有维修 139.2万 ← 天枢级×5 在 B 队里） */
  const p1a = J(D3 + '我方被护航能二.json'), p1b = J(D3 + '我方护航能二.json'), ap1 = J(D3 + '我方加点能二.json');
  await p.evaluate(x => localStorage.setItem('lagrange_addpoint', JSON.stringify(x)), ap1.addpoints || {});
  await p.evaluate(async ids => { for (const c of ids) { try { await loadBpTree(c); } catch (e) { } } }, Object.keys(ap1.addpoints || {}));
  const r1 = process.env.SKIP_R1 ? { err: 1 } : await RUN_PLAIN(p1a, p1b, ap1.addpoints, RUNS);
  if (process.env.SKIP_R1) console.log('(已跳过战报1，仅跑战报2)');

  /* ---------- 战报 2 ---------- */
  const ap2A = J(D3 + '我方加点能二.json'), ap2B = J(D2 + '敌方加点赐天与彼.json');
  await p.evaluate(async ids => { for (const c of ids) { try { await loadBpTree(c); } catch (e) { } } },
    Object.keys(ap2A.addpoints || {}).concat(Object.keys(ap2B.addpoints || {})));
  const r2 = await RUN_4F(J(D3 + '我方护航能二.json'), J(D3 + '我方被护航能二.json'),
                          J(D2 + '敌方护航赐天与彼.json'), J(D2 + '敌方被护航赐天与彼.json'),
                          ap2A.addpoints, ap2B.addpoints, RUNS);

  console.log('pageerror:', errs.length ? errs : '(无)');
  const rows = [];
  const chk = (name, sim, game) => { const d = pctOf(sim, game); rows.push([name, W(sim), W(game), d]); };
  const chkP = (name, sim, game) => { const d = pctOf(sim, game); rows.push([name, (sim * 100).toFixed(0) + '%', (game * 100).toFixed(0) + '%', d]); };

  console.log(NL + '################ 战报 1（资料3 舰队A/B，' + RUNS + ' 次均值） ################');
  if (r1.err) console.log('  运行失败'); else {
    const s = r1.s;
    chk('时长(秒)', s.dur, GAME1.dur);
    chk('A 对舰伤害', s.Aas, GAME1.Aas);
    chk('A 对空伤害', s.Aaa, GAME1.Aaa);
    chk('B 对舰伤害', s.Bas, GAME1.Bas);
    chk('B 对空伤害', s.Baa, GAME1.Baa);
    chk('B 维修量', s.Bmm, GAME1.Bmm);
    console.log('  A 存活 ' + s.Aalive.toFixed(1) + '/' + s.Atot + '   B 存活 ' + s.Balive.toFixed(1) + '/' + s.Btot);
  }

  console.log(NL + '################ 战报 2（能二 / 赐天与彼，' + RUNS + ' 次均值） ################');
  if (r2.err) console.log('  运行失败'); else {
    const s = r2.s;
    chk('时长(秒)', s.dur, GAME2.dur);
    /* ★ 用户 2026-10-02 确认：「行动统计」那两个「总计」是【该页两支舰队之间】的量（切换会变）。
       对应关系：1号舰队=我方被护航(695) ｜ 5号舰队=敌方护航 ｜ A3号舰队=敌方被护航 */
    chk('我方被护航 →敌护舰', s.AecdTF.toEsc.s, GAME2.Aas);
    chk('我方被护航 →敌护舰 对空', s.AecdTF.toEsc.a, GAME2.Aaa);
    chk('我方被护航 维修', s.Aecd.mm, GAME2.Amm);
    chkP('我方被护航 生存占比', s.Aecd.life, GAME2.Alife);
    /* ★ 2026-10-02 第14轮 OCR 口径澄清：游戏「行动统计」页右侧那个「总计」是
       该舰队的【总战绩】（OCR：1号舰队 vs 5号舰队 —— 左 395.9万 / 右 55.97万），
       不是“只算打给某一支”。所以这里改用总输出。 */
    chk('敌方护航 →我被护航', s.BescTF.toEcd.s, GAME2.Bas);
    chk('敌方护航 →我被护航 对空', s.BescTF.toEcd.a, GAME2.Baa);
    chk('敌方护航 维修', s.Besc.mm, GAME2.Bmm);
    chkP('敌方护航 生存占比', s.Besc.life, GAME2.Blife);
    chk('敌方被护航 →我被护航', s.BedTF.toEcd.s, GAME2.B2as);
    chk('敌方被护航 →我被护航 对空', s.BedTF.toEcd.a, GAME2.B2aa);
    chkP('敌方被护航 生存占比', s.Bed.life, GAME2.B2life);
    console.log('  ---- 【按舰队对舰队】拆解（游戏那一页是「单一目标舰队」口径）----');
    console.log('  敌方护航 → 我方护航队 : 对舰 ' + W(s.BescTF.toEsc.s) + ' / 对空 ' + W(s.BescTF.toEsc.a));
    console.log('  敌方护航 → 我方被护航: 对舰 ' + W(s.BescTF.toEcd.s) + ' / 对空 ' + W(s.BescTF.toEcd.a) + '   ← 对照游戏 对舰 56.0万 / 对空 15.6万');
    console.log('  我方被护航 → 敌方护航队 : 对舰 ' + W(s.AecdTF.toEsc.s) + ' / 对空 ' + W(s.AecdTF.toEsc.a) + '   ← 对照游戏 对舰 395.9万 / 对空 0');
    console.log('  我方被护航 → 敌方被护航: 对舰 ' + W(s.AecdTF.toEcd.s) + ' / 对空 ' + W(s.AecdTF.toEcd.a) + '   ← 对照游戏 对舰 395.9万 / 对空 0');
    console.log('  我方护航队 → 敌方护航队 : 对舰 ' + W(s.AescTF.toEsc.s) + ' / 对空 ' + W(s.AescTF.toEsc.a));
    console.log('  我方护航队 → 敌方被护航: 对舰 ' + W(s.AescTF.toEcd.s) + ' / 对空 ' + W(s.AescTF.toEcd.a));
    console.log('  敌方被护航 → 我方护航队 : 对舰 ' + W(s.BedTF.toEsc.s) + ' / 对空 ' + W(s.BedTF.toEsc.a));
    console.log('  敌方被护航 → 我方被护航: 对舰 ' + W(s.BedTF.toEcd.s) + ' / 对空 ' + W(s.BedTF.toEcd.a));
    console.log('  我方存活 ' + s.Aalive.toFixed(1) + '/' + s.Atot + '（游戏 0/695=全灭）  敌方存活 ' + s.Balive.toFixed(1) + '/' + s.Btot + '（游戏 517/686）');
  }

  console.log(NL + '逐次时长  战报1: ' + JSON.stringify(await p.evaluate(()=>window.__DURS1||[])) +
              '   战报2: ' + JSON.stringify(await p.evaluate(()=>window.__DURS4||[])));
  console.log(NL + '################ 验收判定（差值必须 <15%） ################');
  console.log('  ' + '指标'.padEnd(24) + '模拟'.padStart(11) + '游戏'.padStart(11) + '   差值');
  let fail = 0, tot = 0;
  rows.forEach(([n, a2, g, d]) => {
    tot++;
    const ok = d != null && Math.abs(d) < 15;
    if (!ok) fail++;
    console.log('  ' + n.padEnd(24) + String(a2).padStart(11) + String(g).padStart(11) + '  ' +
      (d == null ? '(无法比)' : (d >= 0 ? '+' : '') + d.toFixed(1) + '%') + '  ' + (ok ? 'OK' : 'FAIL'));
  });
  console.log(NL + '  ===> ' + (tot - fail) + '/' + tot + ' 项通过' + (fail === 0 ? '  ★ 全部达标' : '  （还差 ' + fail + ' 项）'));
  await b.close();
})();
