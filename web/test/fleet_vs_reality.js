/* 配队对照工具：把一套配队丢进模拟器跑 N 次，输出 时长/伤害/存活 的均值与波动区间，
   并给出这套配队的【武器数据可信度】（哪些武器的引擎输出与面板 DPM 对不上）。

   用法：
     node test/fleet_vs_reality.js "配队文本"
   配队文本格式（与配队页「复制到模拟器」导出的一致）：
     前排│乌拉诺斯之矛 M1/A1/B2 ×4
     中排│普鲁图斯之盾级-防护战列巡洋舰 M1/B3 ×5 带 米斯特拉×8
   也可以直接给两个：main 与 enemy（用 === 分隔）

   —— 和【游戏真实战报】对比时，多给这几个环境变量 ——
     APFILE=拉格朗日_整套加点_xxx.json   模拟器用你那套加点（不加就用我这儿默认那套，对不上）
     GAME_DUR=212                        游戏里显示的战斗时长（秒）→ 自动算差值%
     GAME_ALLY_LOSS=38000                游戏里我方损失的结构值（可选）
     GAME_ENEMY_LOSS=52000               游戏里敌方损失的结构值（可选）
     GAME_ALLY_ALIVE=3  GAME_ALLY_TOTAL=8  存活/总数（可选，给了就比对，供参）
     RUNS=5                              跑几次取均值（默认 5）
     TARGET_PCT=10                       判定阈值%（默认 10）

   例：
     APFILE="C:/Users/Administrator/Desktop/拉格朗日_整套加点_总体加点方案5.json" \
     GAME_DUR=212 RUNS=5 node test/fleet_vs_reality.js "前排│..." "===中排│..."
*/
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RUNS = parseInt(process.env.RUNS || '5', 10);   // 默认 5 次取均值
/* ★ 要跟游戏对，模拟器必须用【你游戏里那套加点】。传 APFILE=<导出文件> 即可：
   舰船加点页 →「💾 存总体加点方案」→ 选中那套 →「导出」→ 拉格朗日_整套加点_xxx.json */
const APFILE = process.env.APFILE || '';
/* 游戏里的真实数值（给哪个比哪个） */
const GAME = {
  dur: parseFloat(process.env.GAME_DUR || '0') || 0,
  allyLoss: parseFloat(process.env.GAME_ALLY_LOSS || '0') || 0,
  enemyLoss: parseFloat(process.env.GAME_ENEMY_LOSS || '0') || 0,
  allyAlive: process.env.GAME_ALLY_ALIVE != null ? parseFloat(process.env.GAME_ALLY_ALIVE) : null,
  enemyAlive: process.env.GAME_ENEMY_ALIVE != null ? parseFloat(process.env.GAME_ENEMY_ALIVE) : null,
  allyTotal: process.env.GAME_ALLY_TOTAL != null ? parseFloat(process.env.GAME_ALLY_TOTAL) : null,
  enemyTotal: process.env.GAME_ENEMY_TOTAL != null ? parseFloat(process.env.GAME_ENEMY_TOTAL) : null
};
const TARGET_PCT = parseFloat(process.env.TARGET_PCT || '10');   // 目标：差值 <10%

/* 兼容三种传法：① 一个参数里用 === 分隔双方  ② 两个参数（第 2 个自动当敌方，带不带 === 都行） */
let TEXT = process.argv[2] || '';
if (process.argv[3]) TEXT += '\n===\n' + process.argv[3].replace(/^=+/, '');
if (!TEXT.trim()) {
  console.log('用法: node test/fleet_vs_reality.js "我方配队文本" ["===敌方配队文本"]');
  console.log('要比游戏战报就再加: APFILE=<加点导出文件> GAME_DUR=<时长秒>  [GAME_ALLY_LOSS=.. GAME_ENEMY_LOSS=..]');
  process.exit(0);
}
const [allyText, enemyText] = TEXT.split('===');

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 600000, args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1200, height: 1000 });
  p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
  p.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'load', timeout: 90000 });
  await sleep(4500);

  /* ---------- 载入你的整套加点（并强制把加点树都加载好） ---------- */
  if (APFILE) {
    const raw = fs.readFileSync(APFILE, 'utf8');
    const o = JSON.parse(raw);
    const ap = o.addpoints || o;                       // 兼容两种导出（整套方案 / 完整加点包）
    const cdns = Object.keys(ap || {});
    await p.evaluate(x => localStorage.setItem('lagrange_addpoint', JSON.stringify(x)), ap);
    const pre = await p.evaluate(async (ids) => {
      for (const c of ids) { try { await loadBpTree(c); } catch (e) { } }
      return { 已加载加点树: Object.keys(BP_TREE || {}).length, 需要的: ids.length,
               缺: ids.filter(c => !(BP_TREE && BP_TREE[c])) };
    }, cdns);
    console.log('[加点文件] ' + APFILE.split(/[\\/]/).pop() + ' → 涉及 ' + cdns.length + ' 艘；' + JSON.stringify(pre));
    if (pre.缺 && pre.缺.length) console.log('⚠️ 有 ' + pre.缺.length + ' 艘的加点树没加载成功 —— 这些船的"系统内"加点会被跳过（不会错扩散），但结果会偏低');
  }

  const out = await p.evaluate(async (allyT, enemyT, RUNS) => {
    /* ---------- 1) 解析配队文本 ---------- */
    const VERT = /[\u2502\uFF5C|]/;
    function parseLine(line) {
      line = line.trim();
      if (!line) return null;
      let pos = '', rest = line;
      const i = line.indexOf('│');
      if (i > 0) { pos = line.slice(0, i).trim(); rest = line.slice(i + 1).trim(); }
      // 载机：带 XXX×N
      let air = [];
      const am = rest.match(/带\s*(.+)$/);
      if (am) {
        rest = rest.slice(0, am.index).trim();
        am[1].split(/[+、,，]/).forEach(x => {
          const mm = x.trim().match(/^(.+?)\s*[×x*]\s*(\d+)$/);
          if (mm) air.push({ name: mm[1].trim(), qty: +mm[2] });
        });
      }
      // 数量
      let qty = 1;
      const qm = rest.match(/[×x*]\s*(\d+)\s*$/);
      if (qm) { qty = +qm[1]; rest = rest.slice(0, qm.index).trim(); }
      // 模块 M1/A1
      let mods = {};
      rest.replace(/\b([A-Z])(\d)\b/g, (s, k, v) => { mods[k] = k + v; return ''; });
      rest = rest.replace(/\b[A-Z]\d\b/g, '').trim();
      const name = rest.trim();
      return { pos, name, qty, mods, air };
    }
    const findShip = (nm) => {
      const list = Object.values(SHIP_DATABASE);
      let h = list.find(x => x.name === nm);
      if (!h) h = list.find(x => nm.indexOf(x.name) >= 0 || x.name.indexOf(nm) >= 0);
      if (!h) { const core = nm.replace(/[（(].*?[)）]/g, '').replace(/[级型\-—]/g, ''); h = list.find(x => x.name.replace(/[级型\-—]/g, '').indexOf(core) >= 0); }
      return h || null;
    };
    function build(text) {
      const unknowns = [];
      const list = (text || '').split(/\r?\n/).map(parseLine).filter(Boolean).map(r => {
        const t = findShip(r.name);
        if (!t) { unknowns.push(r.name); return null; }
        const e = JSON.parse(JSON.stringify(t));
        e.uid = 'u' + Math.random().toString(36).slice(2, 7);
        e.count = r.qty; e.selectedModules = Object.assign({}, r.mods);
        if (r.pos) e.position = r.pos;
        e.aircraft = [];
        recalcAircraftSlots(e);
        if (r.air.length) {
          const slots = e.simSlots || [];
          r.air.forEach(a => {
            const ac = Object.values(SHIP_DATABASE).find(x => x.name === a.name || x.name.indexOf(a.name) >= 0);
            if (!ac) { unknowns.push('载机:' + a.name); return; }
            const kind = (ac.aircraftType || ac.type) === 'corvette' ? 'corvette' : 'fighter';
            /* 载机位匹配必须认 allow==='ALL'（那一栏同时收战机和护航艇）；只看 kind 会把护航艇挡在 ALL 位外面 */
            const fits = x => (x.allow === 'ALL' || x.kind === kind);
            const sl = slots.find(x => fits(x) && (x.used || 0) + a.qty <= x.cap) || slots.find(fits);
            if (!sl) { unknowns.push('载机位:' + a.name); return; }
            const inst = JSON.parse(JSON.stringify(ac));
            inst.count = a.qty; inst.slot = sl.key;
            e.aircraft.push(inst);
            sl.used = (sl.used || 0) + a.qty;
          });
        }
        return e;
      }).filter(Boolean);
      return { list, unknowns };
    }
    const A = build(allyT), B = build(enemyT || '');

    /* ---------- 1b) 加点树：先把参战舰船缺的树补上，补不到才报错 ----------
       树没加载 → 不知道节点属于哪个系统 → "系统内"的加点会被跳过或算错。
       所以这里主动 loadBpTree 补齐（不依赖页面那套"预载 store 里的船"的启发式）。 */
    for (const e of A.list.concat(B.list)) {
      const m = BP_MAP && BP_MAP[e.id];
      if (m && m.cdnId && !(BP_TREE && BP_TREE[m.cdnId])) { try { await loadBpTree(m.cdnId); } catch (err) { } }
    }
    const needTree = [];
    A.list.concat(B.list).forEach(e => {
      const m = BP_MAP && BP_MAP[e.id];
      if (!m || !m.cdnId) return;
      if (BP_TREE && BP_TREE[m.cdnId]) return;
      const rec = apStore()[m.cdnId];                       // 只有"这艘船真有点数"才必须要有树
      const hasAp = rec && Object.keys(rec.lv || {}).some(k => (rec.lv[k] || 0) > 0);
      if (hasAp) needTree.push((e.name || e.id) + '(' + m.cdnId + ')');
    });
    if (needTree.length) return { error: '⚠️ 这些船有点数但加点树加载失败，现在跑会算错 —— 先解决再加点树再跑', 未加载加点树: needTree, unknowns: A.unknowns.concat(B.unknowns) };

    /* ---------- 2) 武器数据可信度 ---------- */
    function weaponAudit(list) {
      let n = 0, off = 0; const bad = [];
      const seen = {};
      list.forEach(e => {
        const ship = SHIP_DATABASE[e.id] || {};
        Object.keys(ship.modules || {}).forEach(k => {
          if (k[0] === '_') return;
          const m = ship.modules[k];
          const groups = m.type === 'moduleGroup' && m.variants
            ? [m.variants[e.selectedModules[k] || Object.keys(m.variants)[0]]]
            : [m];
          groups.forEach(g => (g.weapons || []).forEach(w => {
            const d = w.dpm || {}; const vals = [d.antiShip, d.antiAir, d.siege].filter(v => v > 0);
            if (!vals.length) return;
            const cyc = (w.cooldown || 0) + (w.atkDuration || 0); if (cyc <= 0) return;
            const eng = w.singleDmg * (w.ammo || 1) * (w.attacks || 1) * 60 / cyc;
            n++;
            const best = Math.min.apply(null, vals.map(v => Math.abs(eng - v) / v * 100));
            if (best > 5) {
              off++;
              const key = w.name;
              if (!seen[key]) { seen[key] = 1; bad.push(w.name + '（引擎' + Math.round(eng) + ' vs 面板' + JSON.stringify(vals) + '）'); }
            }
          }));
        });
      });
      return { 武器数: n, 对不上: off, 样例: bad.slice(0, 12) };
    }

    /* ---------- 3) 跑 N 次 ---------- */
    const results = [];
    for (let i = 0; i < RUNS; i++) {
      FLEET_TYPES.forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; });
      fleetData['ally-escort'].main = A.list.map(e => JSON.parse(JSON.stringify(e)));
      if (B.list.length) fleetData['enemy-escort'].main = B.list.map(e => JSON.parse(JSON.stringify(e)));
      refreshFleetViews();
      if (!prepareBattle()) return { error: '配队为空或解析失败', unknowns: A.unknowns.concat(B.unknowns),
        _diag: { A: A.list.map(e => e.id + '×' + e.count), B: B.list.map(e => e.id + '×' + e.count),
                 allyMain: (fleetData['ally-escort'].main || []).map(e => e.id + '×' + e.count),
                 enemyMain: (fleetData['enemy-escort'].main || []).map(e => e.id + '×' + e.count) } };
      const allyMax = battleState.allyShips.reduce((a, s) => a + s.maxHp, 0);
      const enemyMax = battleState.enemyShips.reduce((a, s) => a + s.maxHp, 0);
      let t = 0;
      while (!battleState.ended && t < 30000) { processBattleTick(0.1); t += 0.1; }
      results.push({
        时长: +battleState.time.toFixed(1),
        我方存活: battleState.allyShips.filter(s => s.alive && s.hp > 0).length,
        敌方存活: battleState.enemyShips.filter(s => s.alive && s.hp > 0).length,
        我方总结构: Math.round(allyMax),
        敌方总结构: Math.round(enemyMax),
        我方损失: Math.round(allyMax - battleState.allyShips.reduce((a, s) => a + Math.max(0, s.hp), 0)),
        敌方损失: Math.round(enemyMax - battleState.enemyShips.reduce((a, s) => a + Math.max(0, s.hp), 0))
      });
    }
    const avg = k => Math.round(results.reduce((a, x) => a + x[k], 0) / results.length);
    const mn = k => Math.min.apply(null, results.map(x => x[k]));
    const mx = k => Math.max.apply(null, results.map(x => x[k]));
    return {
      我方舰船数: A.list.reduce((a, e) => a + e.count, 0),
      敌方舰船数: B.list.reduce((a, e) => a + e.count, 0),
      未识别: A.unknowns.concat(B.unknowns),
      武器数据: weaponAudit(A.list.concat(B.list)),
      '时长(均值)': avg('时长'), '时长(区间)': mn('时长') + '~' + mx('时长'),
      '我方损失结构(均值)': avg('我方损失'), '敌方损失结构(均值)': avg('敌方损失'),
      我方总结构: results[0] && results[0].我方总结构, 敌方总结构: results[0] && results[0].敌方总结构,
      我方全灭次数: results.filter(x => x.我方存活 === 0).length + '/' + RUNS,
      敌方全灭次数: results.filter(x => x.敌方存活 === 0).length + '/' + RUNS,
      逐次时长: results.map(x => x.时长)
    };
  }, allyText, enemyText, RUNS);

  console.log('\n===== 模拟器（' + RUNS + ' 次） =====');
  console.log(JSON.stringify(out, null, 1));

  /* ---------- 和游戏战报对比 ---------- */
  if (!out || out.error) { console.log('\n❌ ' + ((out && out.error) || '无结果')); await b.close(); return; }
  const diff = (sim, game) => (game > 0 ? (sim - game) / game * 100 : null);
  const fmt = pc => pc == null ? '—' : ((pc >= 0 ? '+' : '') + pc.toFixed(1) + '%');
  const line = (name, sim, game, pct) => {
    const ok = pct == null ? '' : (Math.abs(pct) < TARGET_PCT ? '  ✅' : '  ❌');
    console.log('  ' + name.padEnd(16) + '模拟 ' + String(sim).padEnd(12) + '游戏 ' + String(game).padEnd(12) + '差值 ' + fmt(pct) + ok);
  };
  if (GAME.dur || GAME.allyLoss || GAME.enemyLoss) {
    console.log('\n===== 与游戏战报对比（目标：差值 <' + TARGET_PCT + '%） =====');
    const durPct = diff(out['时长(均值)'], GAME.dur);
    if (GAME.dur) line('战斗时长(秒)', out['时长(均值)'], GAME.dur, durPct);
    if (GAME.allyLoss) line('我方损失结构', out['我方损失结构(均值)'], GAME.allyLoss, diff(out['我方损失结构(均值)'], GAME.allyLoss));
    if (GAME.enemyLoss) line('敌方损失结构', out['敌方损失结构(均值)'], GAME.enemyLoss, diff(out['敌方损失结构(均值)'], GAME.enemyLoss));
    if (GAME.allyAlive != null && GAME.allyTotal != null) {
      const simAlive = out['我方全灭次数'] ? (RUNS - parseFloat(out['我方全灭次数'])) : null;
      console.log('  ' + '我方存活'.padEnd(16) + '游戏 ' + GAME.allyAlive + '/' + GAME.allyTotal + '（模拟逐次存活见上面 JSON，取均值比更准）');
    }
    if (GAME.enemyAlive != null && GAME.enemyTotal != null) {
      console.log('  ' + '敌方存活'.padEnd(16) + '游戏 ' + GAME.enemyAlive + '/' + GAME.enemyTotal);
    }
    // 波动区间：自身波动就超过目标的话，单场对比没有意义
    const [lo, hi] = String(out['时长(区间)'] || '').split('~').map(Number);
    if (lo && hi) {
      const spread = (hi - lo) / out['时长(均值)'] * 100;
      console.log('\n  ⚠️ 模拟器【自身】波动：' + out['时长(区间)'] + 's（' + spread.toFixed(1) + '%）');
      if (spread > TARGET_PCT) console.log('     → 自身波动就 ' + spread.toFixed(1) + '% > 目标 ' + TARGET_PCT + '%，5 次均值只能把误差压到约 ' + (spread / Math.sqrt(RUNS)).toFixed(1) + '%；' +
        '若游戏那边也只是单场，两边的随机性都会算进差值。想分得清"系统性偏差"还是"运气"，最好给同一配队的 2~3 场游戏战报。');
    }
  } else {
    console.log('\n（没给 GAME_DUR 等，跳过与游戏的对比；给了就会自动算差值%）');
  }
  await b.close();
})();
