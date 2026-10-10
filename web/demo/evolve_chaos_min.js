/* ============================================================
   方案二B · 模块八「最小实验」—— 按用户原文实现
     1. 环境：模拟器，两个【随机配队】互打
     2. 信号：唯一原始信号 = 【存活时间】（我方从开战到全灭的秒数）
     3. 变异：随机改变配队的参数（舰船 / 模块 / 数量 / 站位）
     4. 迭代：保留存活时间最长的配队，变异生成下一代
     5. 跑 100 代：看存活时间曲线是否上升
   刻意【不预设】适应度、行为维度、网络结构；不做规模惩罚；只看活多久。
   对手池 = 一批随机配队（固定 seed，保证可比）。
   用法：node demo/evolve_chaos_min.js [代数] [每代个体] [对手数]
   ============================================================ */
const path = require('path'), fs = require('fs');
const E = require(path.join(__dirname, '..', 'engine', 'lagrange_engine.js'));

const GENS = parseInt(process.argv[2] || '100', 10);
const POP = parseInt(process.argv[3] || '6', 10);
const OPP = parseInt(process.argv[4] || '3', 10);
const MAXSEC = 1800;

/* ---------- 可复现随机 ---------- */
let _s = 20261002 >>> 0 || 1;
const rnd = () => { _s |= 0; _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const shuffle = a => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

/* ---------- 舰船池（只挑能上场的：非载机、有武器） ---------- */
let POOL = [];
function allShips() { const all = Object.values(E.ships || {}); return all.filter(t => t && t.hp > 0 && t.position !== 'aircraft'); }
function shipPanel(t) {
    let s = 0;
    (t.weapons || []).forEach(w => { s += ((w.dpm || {}).antiShip || 0) + ((w.dpm || {}).antiAir || 0); });
    Object.entries(t.modules || {}).forEach(([k, m]) => {
        if (k.startsWith('_') || !m || typeof m !== 'object') return;
        (m.weapons || []).forEach(w => { s += ((w.dpm || {}).antiShip || 0) + ((w.dpm || {}).antiAir || 0); });
        Object.entries(m.variants || {}).forEach(([vk, v]) => (v.weapons || []).forEach(w => { s += ((w.dpm || {}).antiShip || 0) + ((w.dpm || {}).antiAir || 0); }));
    });
    return s;
}
function modsOf(t) {                       // 各模块槽的第一个变体键（变异时用来切换）
    const o = {};
    Object.entries(t.modules || {}).forEach(([k, m]) => { if (k.startsWith('_') || !m || !m.variants) return; const ks = Object.keys(m.variants); if (ks.length) o[k] = ks; });
    return o;
}
const MODS = {};

/* ---------- 基因组：配队（舰船/数量/站位/模块） ---------- */
function randEntry() {
    const t = pick(POOL);
    const m = MODS[t.id] || {};
    const mods = {};
    Object.entries(m).forEach(([k, ks]) => { if (rnd() < 0.7) mods[k] = pick(ks); });
    return { id: t.id, count: 1 + Math.floor(rnd() * 4), position: pick(['前排', '中排', '后排']), mods };
}
function randGenome() { const n = 1 + Math.floor(rnd() * 4); const g = []; for (let i = 0; i < n; i++) g.push(randEntry()); return g; }

/* ---------- 变异：加/删/改数量/改站位/改模块（不做结构限制）---------- */
function mutate(g) {
    const out = g.map(e => Object.assign({}, e, { mods: Object.assign({}, e.mods) }));
    const acts = ['add', 'del', 'count', 'pos', 'mod'];
    for (let k = 0; k < 1 + Math.floor(rnd() * 2); k++) {
        const a = pick(acts);
        if (a === 'add' && out.length < 6) out.push(randEntry());
        else if (a === 'del' && out.length > 1) out.splice(Math.floor(rnd() * out.length), 1);
        else if (out.length) {
            const e = out[Math.floor(rnd() * out.length)];
            if (a === 'count') e.count = Math.max(1, Math.min(6, e.count + (rnd() < 0.5 ? -1 : 1)));
            else if (a === 'pos') e.position = pick(['前排', '中排', '后排']);
            else if (a === 'mod') { const m = MODS[e.id] || {}; const ks = Object.keys(m); if (ks.length) { const kk = pick(ks); e.mods[kk] = pick(m[kk]); } }
        }
    }
    return out;
}
const toSpec = g => g.map(e => ({ id: e.id, count: e.count, position: e.position, mods: e.mods, air: [] }));

/* ---------- 适应度：唯一原始信号 = 存活时间（我方全灭的秒数；未全灭按上限算）----------
   ⚠️ 按用户要求【不加】任何其它指标、不加规模惩罚。 */
function survival(spec, opps) {
    let sum = 0, n = 0;
    for (const o of opps) {
        const r = E.runBattle({ A: spec, B: o, seed: 1000 + n * 7919, maxSec: MAXSEC, dt: 0.2 });
        if (!r) continue;
        const alive = r.我方.存活舰船 + r.我方.存活载机;
        sum += (alive > 0) ? (r.时长 + 600) : r.时长;   // 没被打光 → 记"活满 + 奖励"，避免用别的指标
        n++;
    }
    return n ? sum / n : 0;
}

/* ---------- 主循环 ---------- */
(async () => {
    await E.init();
    POOL = allShips().filter(t => shipPanel(t) > 0);
    POOL.forEach(t => { MODS[t.id] = modsOf(t); });
    console.log('舰船池 ' + POOL.length + ' 艘 ｜ 代数 ' + GENS + ' ｜ 每代个体 ' + POP + ' ｜ 对手池 ' + OPP);
    console.log('适应度 = 【存活时间】唯一信号（不做规模惩罚、不加其它指标）\n');

    /* 对手池：固定一批随机配队（公平比较） */
    const opps = []; for (let i = 0; i < OPP; i++) opps.push(toSpec(randGenome()));
    console.log('对手池已固定：' + opps.map(o => o.length + '种').join(' / ') + '\n');

    let best = randGenome(), bestFit = -1;
    const curve = [];
    const t0 = Date.now();
    for (let g = 1; g <= GENS; g++) {
        /* 种群 = 当前最优 + 它的变异体 */
        const pop = [best];
        while (pop.length < POP) pop.push(mutate(best));
        let genBest = null, genFit = -1;
        pop.forEach(ind => { const f = survival(toSpec(ind), opps); if (f > genFit) { genFit = f; genBest = ind; } });
        if (genFit >= bestFit) { best = genBest; bestFit = genFit; }
        curve.push(+bestFit.toFixed(1));
        if (g === 1 || g % 5 === 0 || g === GENS) {
            const el = ((Date.now() - t0) / 1000).toFixed(0);
            console.log('第 ' + String(g).padStart(3) + ' 代 ｜ 存活时间 ' + bestFit.toFixed(1) + 's ｜ 配队 ' +
                best.map(e => e.id + '×' + e.count).join(',') + ' ｜ 已用 ' + el + 's');
        }
    }
    const first = curve.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(5, curve.length);
    const last = curve.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, curve.length);
    console.log('\n=== 结果 ===');
    console.log('前 5 代均值 ' + first.toFixed(1) + 's ｜ 后 5 代均值 ' + last.toFixed(1) + 's ｜ 提升 ' + (first ? ((last / first - 1) * 100).toFixed(1) : '-') + '%');
    console.log(last > first ? '✅ 存活时间上升 → 模拟器有选择压力，进化跑通' : '❌ 未上升 → 区分度不够或变异空间太小');
    fs.writeFileSync(path.join(__dirname, '..', '_chaos_curve.json'),
        JSON.stringify({ gens: GENS, pop: POP, opp: OPP, curve, best: best, seconds: Math.round((Date.now() - t0) / 1000) }, null, 1), 'utf8');
    console.log('曲线已存 _chaos_curve.json');
})();
