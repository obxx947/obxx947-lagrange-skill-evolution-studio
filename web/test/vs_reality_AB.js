/* ============================================================
   与游戏真实战报对比（舰队A / 舰队B）
   ------------------------------------------------------------
   输入：加点导出 json + 两份配队 json（配队页「导出配队」的格式）
   输出：模拟器 N 次的 时长 / 双方 对舰·对空·维修·系统伤害·击毁次数·殉爆 /
        双方损失结构值 / 总结构值 / 存活，并和游戏战报对比差值%

   游戏靶子（用户给的 3 场，同一对舰队）：
     ── 总结构值（顶部 X/Y，单位万）      A 695 / B 620
     ── 时长                              545s(9:05) / 592s(9:52) / 600s(10:00 = 上限)
     ── A 对舰伤害                        784万 / 810.3万 / ~759万(图上)
     ── A 对空伤害                        22.43万 / 17.75万 / 22.81万
     ── B 对舰伤害                        75.24万 / 95.41万 / 92.73万
     ── B 对空伤害                        34.78万 / 37.14万 / 38.93万
     ── B 维修量                          125.3万 / 147.1万 / 139.2万
     ── A 维修量                          图上为 0
     ── 结果                              A 胜（B 被清空，A 剩 599/695）

   跑法：
     node test/vs_reality_AB.js 加点.json 舰队A.json 舰队B.json [RUNS]
   ============================================================ */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const AP_PATH = process.argv[2];
const A_PATH = process.argv[3];
const B_PATH = process.argv[4];
const RUNS = parseInt(process.argv[5] || '5', 10);
if (!AP_PATH || !A_PATH || !B_PATH) {
  console.log('用法: node test/vs_reality_AB.js <整套加点.json> <舰队A.json> <舰队B.json> [RUNS=5]');
  process.exit(0);
}
const AP = JSON.parse(fs.readFileSync(AP_PATH, 'utf8'));
const PLANA = JSON.parse(fs.readFileSync(A_PATH, 'utf8'));
const PLANB = JSON.parse(fs.readFileSync(B_PATH, 'utf8'));

/* 游戏靶子（3 场的范围 + 中位） */
const GAME = {
  A总结构万: 695, B总结构万: 620,
  A损失万: 96,   B损失万: 620,
  时长: [545, 592, 600],
  A对舰万: [791, 784, 810.3],  A对空万: [22.43, 17.75, 22.81],
  B对舰万: [75.24, 95.41, 92.73], B对空万: [34.78, 37.14, 38.93], B维修万: [125.3, 147.1, 139.2]
};
const mid = a => a.reduce((x, y) => x + y, 0) / a.length;

function BUILD_SIDE(planFleet, sec) {
  const src = planFleet[sec] || [];
  const out = [];
  src.forEach(s => {
    const t = SHIP_DATABASE[s.id]; if (!t) return;
    const e = JSON.parse(JSON.stringify(t));
    e.count = s.qty || 1;
    e.selectedModules = Object.assign({}, s.mods || {});
    if (s.pos) e.position = s.pos;
    recalcAircraftSlots(e);
    e.aircraft = [];
    (s.air || []).forEach(a => {
      const at = SHIP_DATABASE[a.id]; if (!at) return;
      const slots = e.simSlots || [];
      const sl = slots.find(x => x.key === a.slot) ||
                 slots.find(x => x.allow === 'ALL' || x.kind === a.kind);
      if (!sl) return;
      const inst = JSON.parse(JSON.stringify(at));
      inst.count = a.qty || 1; inst.slot = sl.key;
      e.aircraft.push(inst);
    });
    out.push(e);
  });
  return out;
}

async function RUN(planSideIdx) {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '/simulator.html', { waitUntil: 'load', timeout: 90000 });
  await sleep(4500);

  const cdns = Object.keys(AP.addpoints || {});
  await p.evaluate(x => localStorage.setItem('lagrange_addpoint', JSON.stringify(x)), AP.addpoints || AP);
  const pre = await p.evaluate(async ids => {
    for (const c of ids) { try { await loadBpTree(c); } catch (e) { } }
    return { n: Object.keys(BP_TREE || {}).length, miss: ids.filter(c => !(BP_TREE && BP_TREE[c])) };
  }, cdns);
  if (pre.miss.length) console.log('⚠️ 加点树没加载: ' + pre.miss.join(','));

  const out = await p.evaluate(async (planA, planB, RUNS) => {
    /* ⚠️ 这个函数体是在浏览器里跑的，不能用 Node 侧的变量/函数（BUILD_SIDE 必须定义在这 */
    function BUILD_SIDE(planFleet, sec) {
      const src = planFleet[sec] || [];
      const out = [];
      src.forEach(s => {
        const t = SHIP_DATABASE[s.id]; if (!t) return;
        const e = JSON.parse(JSON.stringify(t));
        e.count = s.qty || 1;
        e.selectedModules = Object.assign({}, s.mods || {});
        if (s.pos) e.position = s.pos;
        recalcAircraftSlots(e);
        e.aircraft = [];
        (s.air || []).forEach(a => {
          const at = SHIP_DATABASE[a.id]; if (!at) return;
          const slots = e.simSlots || [];
          const sl = slots.find(x => x.key === a.slot) ||
                     slots.find(x => x.allow === 'ALL' || x.kind === a.kind);
          if (!sl) return;
          const inst = JSON.parse(JSON.stringify(at));
          inst.count = a.qty || 1; inst.slot = sl.key;
          e.aircraft.push(inst);
        });
        out.push(e);
      });
      return out;
    }
    const pf = (plan, i) => plan.plans[i].fleets[0];
    const A = BUILD_SIDE(pf(planA, 0), 'main').concat(BUILD_SIDE(pf(planA, 0), 'reinforce'));
    const B = BUILD_SIDE(pf(planB, 0), 'main').concat(BUILD_SIDE(pf(planB, 0), 'reinforce'));
    const unknown = [];
    const rows = [];
    for (let i = 0; i < RUNS; i++) {
      FLEET_TYPES.forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; fleetData[k].apSet = null; });
      fleetData['ally-escort'].main = JSON.parse(JSON.stringify(A));
      fleetData['enemy-escort'].main = JSON.parse(JSON.stringify(B));
      refreshFleetViews();
      if (!prepareBattle()) return { error: '配队为空', unknown };
      const bs = battleState;
      const hp0 = {
        A: bs.allyShips.reduce((a, s) => a + s.maxHp, 0),
        B: bs.enemyShips.reduce((a, s) => a + s.maxHp, 0)
      };
      let t = 0;
      while (!bs.ended && t < 30000) { processBattleTick(0.1); t += 0.1; }
      const st = bs.stat || { ally: {}, enemy: {} };
      /* 按舰种拆结构值（找"总结构偏低"到底低在哪几型船上） */
      if (i === 0) {
        window.__perDump = JSON.parse(JSON.stringify(st));
        const byType = (arr) => { const o = {}; arr.forEach(x => { const k = (x.name || x.id); o[k] = o[k] || { n: 0, hp: 0 }; o[k].n++; o[k].hp += x.maxHp; }); return o; };
        window.__breakdown = { A: byType(bs.allyShips), B: byType(bs.enemyShips) };
      }
      const sum = o => (o.antiShip || 0) + (o.antiAir || 0);
      rows.push({
        时长: +bs.time.toFixed(1), 结束: !!bs.ended,
        A总结构: Math.round(hp0.A), B总结构: Math.round(hp0.B),
        A损失: Math.round(hp0.A - bs.allyShips.reduce((a, s) => a + Math.max(0, s.hp), 0)),
        B损失: Math.round(hp0.B - bs.enemyShips.reduce((a, s) => a + Math.max(0, s.hp), 0)),
        A存活: bs.allyShips.filter(s => s.alive && s.hp > 0).length, A总数: bs.allyShips.length,
        B存活: bs.enemyShips.filter(s => s.alive && s.hp > 0).length, B总数: bs.enemyShips.length,
        A对舰: Math.round(st.ally.antiShip || 0), A对空: Math.round(st.ally.antiAir || 0),
        B对舰: Math.round(st.enemy.antiShip || 0), B对空: Math.round(st.enemy.antiAir || 0),
        A维修: Math.round(st.ally.repair || 0), B维修: Math.round(st.enemy.repair || 0),
        A载机对舰: Math.round(st.ally.byAirShip || 0), A载机对空: Math.round(st.ally.byAirAir || 0),
        B载机对舰: Math.round(st.enemy.byAirShip || 0), B载机对空: Math.round(st.enemy.byAirAir || 0),
        A系统伤害: Math.round(st.ally.sysDmg || 0), A击毁系统: st.ally.sysKill || 0, A殉爆: Math.round(st.ally.blastHp || 0),
        B系统伤害: Math.round(st.enemy.sysDmg || 0), B击毁系统: st.enemy.sysKill || 0, B殉爆: Math.round(st.enemy.blastHp || 0)
      });
    }
    const keys = Object.keys(rows[0]);
    const agg = {};
    keys.forEach(k => {
      const vals = rows.map(r => r[k]);
      if (typeof vals[0] === 'number') {
        agg[k] = Math.round(vals.reduce((a, x) => a + x, 0) / vals.length);
        agg[k + '(区间)'] = Math.min.apply(null, vals) + '~' + Math.max.apply(null, vals);
      } else agg[k] = vals[0];
    });
    agg._逐次 = rows.map(r => r.时长);
    agg._按舰种 = window.__breakdown;
    agg._逐舰种输出 = window.__perDump;
    return agg;
  }, PLANA, PLANB, RUNS);

  console.log('\n--- 页面错误 ---'); console.log(errs.length ? errs.slice(0, 5).join('\n') : '(无)');
  await b.close();
  return out;
}

(async () => {
  const sim = await RUN(0);
  if (sim.error) { console.log('❌ ' + sim.error); return; }
  const W = 10000;
  console.log('\n===== 模拟器（' + RUNS + ' 次均值） =====');
  console.log(JSON.stringify(sim, null, 1));

  const pct = (s, g) => (g ? (s - g) / g * 100 : null);
  const f = pc => pc == null ? '—' : ((pc >= 0 ? '+' : '') + pc.toFixed(1) + '%');
  const L = (name, s, g) => {
    const pc = pct(s, g);
    const ok = pc == null ? '' : (Math.abs(pc) < 10 ? ' ✅' : (Math.abs(pc) < 25 ? ' ⚠️' : ' ❌'));
    console.log('  ' + name.padEnd(18) + String(s).padEnd(12) + String(Math.round(g)).padEnd(12) + f(pc) + ok);
  };
  console.log('\n===== 与游戏战报对比（列：模拟 / 游戏3场中位 / 差值） =====');
  console.log('  指标                模拟        游戏        差值');
  /* ⚠️ 顶部那两个数（695/620）是【人口=指挥值】，不是结构值 —— 不能当血量靶子比。
     结构值的真值来自你那张「结构值变动」曲线图：A ≈425万、B ≈550万。 */
  console.log('  结构值（对曲线图，不在这张对比表里）: A ' + Math.round(sim.A总结构/10000) + '万 vs 曲线 ~425万 = ' +
    (((sim.A总结构/4250000)-1)*100).toFixed(1) + '%  ｜ B ' + Math.round(sim.B总结构/10000) + '万 vs 曲线 ~550万 = ' +
    (((sim.B总结构/5500000)-1)*100).toFixed(1) + '%');
  L('时长(秒)',        sim.时长,    mid(GAME.时长));
  L('A 对舰伤害',      sim.A对舰,   mid(GAME.A对舰万) * W);
  L('A 对空伤害',      sim.A对空,   mid(GAME.A对空万) * W);
  L('B 对舰伤害',      sim.B对舰,   mid(GAME.B对舰万) * W);
  L('B 对空伤害',      sim.B对空,   mid(GAME.B对空万) * W);
  L('B 维修量',        sim.B维修,   mid(GAME.B维修万) * W);
  L('A 损失结构',      sim.A损失,   GAME.A损失万 * W);
  console.log('\n  游戏 3 场原始：时长 ' + GAME.时长.join('/') + 's ｜ A对舰 ' + GAME.A对舰万.join('/') + '万 ｜ B对舰 ' + GAME.B对舰万.join('/') + '万 ｜ B维修 ' + GAME.B维修万.join('/') + '万');
  console.log('  模拟逐次时长：' + (sim._逐次 || []).join(', '));
  const bd = sim._按舰种 || {};
  const dump = (side) => {
    console.log('\n  ── ' + side + ' 各舰种结构值（模拟） ──');
    Object.keys(bd[side] || {}).sort((x, y) => bd[side][y].hp - bd[side][x].hp).forEach(k => {
      const v = bd[side][k];
      console.log('     ' + String(k).padEnd(30) + '×' + String(v.n).padEnd(4) + '单体 ' + String(Math.round(v.hp / v.n)).padEnd(9) + '合计 ' + Math.round(v.hp / 10000) + '万');
    });
    const tot = Object.keys(bd[side] || {}).reduce((a, k) => a + bd[side][k].hp, 0);
    console.log('     ' + '【合计】'.padEnd(30) + '     ' + '          ' + '合计 ' + Math.round(tot / 10000) + '万 / ' + (side === 'A' ? GAME.A总结构万 : GAME.B总结构万) + '万 = ' + ((tot / (side === 'A' ? GAME.A总结构万 : GAME.B总结构万) / 10000 - 1) * 100).toFixed(1) + '%');
  };
  dump('A'); dump('B');
  /* ---- 逐舰种输出对比（游戏数来自你图里那张表） ---- */
  const GAME_PER = {
    '太阳鲸-武装战略航空母舰':  { s: 7910000 * 0.1603, a: 2150, r: 0 },   // 图上 126.8万（占A总791万的16.03%）
    '猎兵级-重型载机巡洋舰':    { s: 2482,   a: 33480,  r: 0 },
    '狩猎者级-载机巡洋舰':      { s: 1298,   a: 52700,  r: 0 },
    '康纳马拉混沌级-高速等离子体巡洋舰': { s: null, a: null, r: 0 },
    'CV3000级-快速航空母舰':    { s: 70300,  a: 11400,  r: 0 },
    '天枢级-支援航空母舰':      { s: 1107,   a: 99500,  r: 808600 },
    '乌拉诺斯之矛':            { s: 526200, a: 67130,  r: 0 }
  };
  const per = sim._逐舰种输出 || {};
  const show = (side) => {
    const key = (side === 'A') ? 'ally' : 'enemy';
    const p = (per[key] && per[key].per) || {};
    console.log('\n  ── ' + side + ' 逐舰种伤害/维修（模拟 vs 游戏图） ──');
    console.log('     ' + '舰种'.padEnd(30) + '对舰(模拟)'.padEnd(13) + '对舰(游戏)'.padEnd(13) + '对空(模拟)'.padEnd(13) + '对空(游戏)'.padEnd(13) + '维修(模拟)'.padEnd(13) + '维修(游戏)');
    Object.keys(p).sort((x, y) => ((p[y].antiShip || 0) + (p[y].antiAir || 0)) - ((p[x].antiShip || 0) + (p[x].antiAir || 0))).forEach(k => {
      const g = GAME_PER[k] || {};
      const w = (v) => v == null ? '—' : (v >= 10000 ? (v / 10000).toFixed(1) + '万' : String(Math.round(v)));
      console.log('     ' + String(k).padEnd(30) + w(p[k].antiShip).padEnd(13) + w(g.s).padEnd(13) + w(p[k].antiAir).padEnd(13) + w(g.a).padEnd(13) + w(p[k].repair).padEnd(13) + w(g.r));
    });
  };
  show('A'); show('B');
})();
