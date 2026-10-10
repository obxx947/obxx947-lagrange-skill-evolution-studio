/* ============================================================
   最简进化实验（对应用户「方案二B·第八节」）
   ------------------------------------------------------------
   环境：engine/lagrange_engine.js（独立 Node 引擎，不需要浏览器）
   信号：存活时间 —— 我方舰队从开战到最后一名成员被消灭的时长（活得更久 = 分数更高）
   变异：随机改变配队的参数（舰船、数量、站位、模块）
   迭代：保留存活时间最长的若干配队，变异生成下一代
   目标：跑 N 代，看存活时间曲线是否上升
   ------------------------------------------------------------
   用法：
     node demo/evolve_basic.js                # 默认 12 代 × 12 个体
     node demo/evolve_basic.js --gens 50 --pop 20 --runs 3
   参数：
     --gens N     代数（默认 12）
     --pop N      每代个体数（默认 12）
     --runs N     每个个体评估几次取平均（默认 2；引擎是确定性的，>1 只有换种子才有意义）
     --seed N     随机种子基（默认 20261002）
     --enemy <p>  对手：preset（默认，固定强敌）/ mirror（镜像自打）
   ============================================================ */
const path = require('path');
const E = require(path.join(__dirname, '..', 'engine', 'lagrange_engine.js'));

/* ---------- 命令行参数 ---------- */
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };
const argS = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? String(argv[i + 1]) : d; };
const GENS = arg('gens', 12), POP = arg('pop', 12), RUNS = arg('runs', 2);
const SEED0 = arg('seed', 20261002), ENEMY_MODE = argS('enemy', 'preset');

/* ---------- 随机数（可复现） ---------- */
let _s = SEED0 >>> 0 || 1;
const rnd = () => { _s |= 0; _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = arr => arr[Math.floor(rnd() * arr.length)];

/* ---------- 基因池：只挑"数据完整"的船（有结构值 + 至少一门有面板的武器） ---------- */
function weaponPanel(t) {
    let s = 0;
    (t.weapons || []).forEach(w => { s += ((w.dpm || {}).antiShip || 0) + ((w.dpm || {}).antiAir || 0); });
    Object.entries(t.modules || {}).forEach(([k, m]) => {
        if (k.startsWith('_')) return;
        (m.weapons || []).forEach(w => { s += ((w.dpm || {}).antiShip || 0) + ((w.dpm || {}).antiAir || 0); });
        Object.entries(m.variants || {}).forEach(([vk, v]) => (v.weapons || []).forEach(w => { s += ((w.dpm || {}).antiShip || 0) + ((w.dpm || {}).antiAir || 0); }));
    });
    return s;
}
let POOL = [], MODS = {};
function buildPool() {
    const all = Object.values(E.ships);
    POOL = all.filter(t => t && t.hp > 0 && weaponPanel(t) > 0 && t.position !== 'aircraft')
        .map(t => ({ id: t.id, name: t.name, type: t.type, pos: t.position, hp: t.hp, panel: weaponPanel(t) }));
    MODS = {};
    all.forEach(t => {
        if (!t || !t.modules) return;
        const o = {};
        Object.entries(t.modules).forEach(([k, m]) => {
            if (k.startsWith('_')) return;
            const vk = Object.keys(m.variants || {});
            if (vk.length > 1) o[k] = vk;
        });
        if (Object.keys(o).length) MODS[t.id] = o;
    });
    console.log('基因池：' + POOL.length + ' 艘可用舰船（' + Object.keys(MODS).length + ' 艘带可选模块）');
}

/* ---------- 基因组 = 一个配队 ---------- */
function randFleet() {
    const n = 1 + Math.floor(rnd() * 4);              // 1~4 种舰船
    const used = new Set(); const out = [];
    for (let i = 0; i < n; i++) {
        const s = pick(POOL); if (!s || used.has(s.id)) continue; used.add(s.id);
        const gene = { id: s.id, count: 1 + Math.floor(rnd() * 6), position: s.pos };
        if (MODS[s.id]) { const o = {}; Object.keys(MODS[s.id]).forEach(k => { o[k] = pick(MODS[s.id][k]); }); gene.mods = o; }
        out.push(gene);
    }
    return out.length ? out : [{ id: POOL[0].id, count: 2, position: POOL[0].pos }];
}
function mutate(f) {
    const g = JSON.parse(JSON.stringify(f));
    const roll = rnd();
    if (roll < 0.25) {                                  // 换一艘船
        const s = pick(POOL); if (s) g[Math.floor(rnd() * g.length)] = { id: s.id, count: 1 + Math.floor(rnd() * 6), position: s.pos };
    } else if (roll < 0.5) {                            // 改数量
        const i = Math.floor(rnd() * g.length); g[i].count = Math.max(1, Math.min(10, g[i].count + (rnd() < 0.5 ? -1 : 1)));
    } else if (roll < 0.7) {                            // 改站位
        const i = Math.floor(rnd() * g.length); g[i].position = pick(['前排', '中排', '后排']);
    } else if (roll < 0.85) {                           // 改模块
        const i = Math.floor(rnd() * g.length); const m = MODS[g[i].id];
        if (m) { const k = pick(Object.keys(m)); g[i].mods = Object.assign({}, g[i].mods || {}, { [k]: pick(m[k]) }); }
    } else {                                            // 增/删一种船
        if (g.length > 1 && rnd() < 0.5) g.splice(Math.floor(rnd() * g.length), 1);
        else if (g.length < 5) { const s = pick(POOL); if (s && !g.some(x => x.id === s.id)) g.push({ id: s.id, count: 1 + Math.floor(rnd() * 6), position: s.pos }); }
    }
    return g.slice(0, 6);
}

/* ---------- 对手 ---------- */
function enemyFleet() {
    if (ENEMY_MODE === 'mirror') return null;   // 由调用处用自己当对手
    /* 固定强敌：3 艘永恒风暴 + 3 艘普鲁图斯之盾（都是数据完整的战巡） */
    return [{ id: 'eternal-storm', count: 3, position: '中排' }, { id: 'plutus-shield', count: 3, position: '中排' }];
}

/* ---------- 适应度 = 存活时间（我方全灭的时刻；没全灭则记满时间并给一点小奖励） ---------- */
function fitness(fleet, runs) {
    let tot = 0, wins = 0;
    for (let i = 0; i < runs; i++) {
        const B = enemyFleet() || JSON.parse(JSON.stringify(fleet));
        const r = E.runBattle({ A: fleet, B, seed: (SEED0 + i * 7919) >>> 0 });
        if (!r) { tot += 0; continue; }
        const o = E.outcome(r);
        if (o === 'win') wins++;
        /* 存活时间 = 战斗时长（我方全灭时即为我方存活时长）；若我方还有人活着，用"剩余比例"加权 */
        const aliveRatio = (r.我方.存活舰船 + r.我方.存活载机) / Math.max(1, r.我方.舰船数 + r.我方.载机数);
        tot += r.时长 * (0.5 + 0.5 * aliveRatio) + (o === 'win' ? 600 : 0);
    }
    return tot / runs;
}

/* ---------- 主循环 ---------- */
(async () => {
    const t0 = Date.now();
    const info = await E.init();
    console.log('引擎初始化：' + info.ships + ' 艘船，加点数据 ' + (info.bpReady ? 'OK' : '缺失'));
    buildPool();
    if (!POOL.length) { console.log('❌ 基因池为空，检查 data/ship_database.json'); return; }

    let pop = Array.from({ length: POP }, randFleet);
    console.log('\n代   最优存活时间   平均   胜场   最优配队');
    const curve = [];
    let best = null, bestFit = -1;
    for (let g = 1; g <= GENS; g++) {
        const scored = pop.map(f => ({ f, fit: fitness(f, RUNS) })).sort((a, b) => b.fit - a.fit);
        const avg = scored.reduce((a, x) => a + x.fit, 0) / scored.length;
        curve.push(scored[0].fit);
        if (scored[0].fit > bestFit) { bestFit = scored[0].fit; best = scored[0].f; }
        const desc = scored[0].f.map(x => x.id + '×' + x.count).join(' + ');
        console.log(String(g).padStart(2) + '   ' + scored[0].fit.toFixed(0).padStart(10) + '   ' + avg.toFixed(0).padStart(6) + '   ' +
            String(scored.filter(x => x.fit > 0).length).padStart(3) + '    ' + desc.slice(0, 46));
        /* 选择前 1/3，变异繁殖 */
        const keep = scored.slice(0, Math.max(2, Math.floor(POP / 3))).map(x => x.f);
        pop = keep.slice();
        while (pop.length < POP) pop.push(mutate(pick(keep)));
    }
    console.log('\n=== 结果 ===');
    console.log('最优存活时间：' + bestFit.toFixed(0) + '（第 1 代最优 ' + curve[0].toFixed(0) + ' → 末代 ' + curve[curve.length - 1].toFixed(0) + '）');
    const rising = curve[curve.length - 1] > curve[0];
    console.log(rising ? '✅ 存活时间曲线【上升】→ 模拟器有选择压力，进化能跑通' : '⚠️ 曲线未上升 → 需要加大代数/种群，或扩大变异空间');
    console.log('最优配队：' + best.map(x => x.id + '×' + x.count + '(' + x.position + ')').join(' + '));
    console.log('总耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's（' + (GENS * POP * RUNS) + ' 场战斗）');
})();
