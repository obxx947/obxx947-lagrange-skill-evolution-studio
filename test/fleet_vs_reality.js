/* 配队对照工具：把一套配队丢进模拟器跑 N 次，输出 时长/伤害/存活 的均值与波动区间，
   并给出这套配队的【武器数据可信度】（哪些武器的引擎输出与面板 DPM 对不上）。

   用法：
     node test/fleet_vs_reality.js "配队文本"
   配队文本格式（与配队页「复制到模拟器」导出的一致）：
     前排│乌拉诺斯之矛 M1/A1/B2 ×4
     中排│普鲁图斯之盾级-防护战列巡洋舰 M1/B3 ×5 带 米斯特拉×8
   也可以直接给两个：main 与 enemy（用 === 分隔）
*/
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RUNS = parseInt(process.env.RUNS || '8', 10);   // 默认跑 8 次取均值

const TEXT = process.argv[2] || '';
if (!TEXT.trim()) {
  console.log('用法: node test/fleet_vs_reality.js "我方配队文本" ["===敌方配队文本"]');
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
            const sl = slots.find(x => x.kind === kind && (x.used || 0) + a.qty <= x.cap) || slots.find(x => x.kind === kind);
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
      if (!prepareBattle()) return { error: '配队为空或解析失败', unknowns: A.unknowns.concat(B.unknowns) };
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

  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
