/* ============================================================
   护航对弈 · 参数级进化实验（草案 v1）
   ------------------------------------------------------------
   ⚠️ 定名更正（2026-10-03）：早期把它叫「两个神经元对弈」是【用词不当】——
      本实验【没有神经网络】（无权重 / 无激活函数 / 无拓扑 / 无前向传播），
      进化的对象是一串【参数包】。真正的神经元层（引擎动作回调 + NEAT
      加节点/加连接）尚未实现；三个 demo（basic / chaos_min / duel）
      全部是参数级进化，别把它们当成"已经做了神经元"。
   ------------------------------------------------------------
   对应用户要求：「神经元进化方案 是两个神经元的对弈，他们可以进行
   **配队 / 加点 / 旗舰选择**，每次都得是**护航的 4 个舰队**」

   ◆ 一个个体（"神经元"是当时的比喻，实为参数包）的全部决策：
       escort    护航队（挡伤害的那支）   [{id,count,position,mods}]
       escorted  被护航队（被保护的那支） [{id,count,position,mods}]
       addpoints 加点方案（整套，cdnId → {lv:{节点:等级}}）
       flagship  旗舰选择（从自己两支队里挑一艘，flag: 'escort'|'escorted'|null）

   ◆ 对局：A(护航+被护航) vs B(护航+被护航) —— 固定 4 舰队护航格式
       （引擎按《维护公告》实现：护航队替被护航队承伤、护航队死光后被护航队才暴露）

   ◆ 适应度：存活时间（我方两支队都被消灭的时刻）+ 胜利奖励
       —— 存活时间是用户方案二B 里选的"唯一原始信号"

   ◆ 进化：**交替进化一方，另一方当对手池**（用户方案二A/二B 的共同设计）
       奇数代进化 A（B 冻结）｜ 偶数代进化 B（A 冻结）

   用法：
     node demo/evolve_duel.js                    # 8 代 × 6 个体（约 3~5 分钟）
     node demo/evolve_duel.js --gens 20 --pop 8 --opp 3
   ============================================================ */
const path = require('path');
const E = require(path.join(__dirname, '..', 'engine', 'lagrange_engine.js'));

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };
const GENS = arg('gens', 8), POP = arg('pop', 6), OPP = arg('opp', 3), SEED0 = arg('seed', 777001);
const MAX_SEC = arg('maxsec', 2400);

/* ---------- 可复现随机 ---------- */
let _s = SEED0 >>> 0 || 1;
const rnd = () => { _s |= 0; _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const shuffle = a => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

/* ---------- 舰船池 ---------- */
let POOL = [], MODS = {};
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
function buildPool() {
    const all = Object.values(E.ships);
    POOL = all.filter(t => t && t.hp > 0 && weaponPanel(t) > 0 && t.position !== 'aircraft');
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
    console.log('舰船池 ' + POOL.length + ' 艘（' + Object.keys(MODS).length + ' 艘带可选模块）');
}

/* ---------- 加点树缓存 + 随机加点方案 ---------- */
const TREE = {};
async function ensureTree(shipId) {
    const cdn = E.cdnOf(shipId);
    if (!cdn) return null;
    if (TREE[cdn] !== undefined) return TREE[cdn];
    await E.loadBpTrees([cdn]);
    TREE[cdn] = E.treeOf(cdn);
    return TREE[cdn];
}
/* 生成一艘船的随机加点：逐系统在 enhanceLimit 预算内点节点（尊重前置与二选一） */
function randAllocForShip(t) {
    const lv = {};
    (t || []).forEach(sy => {
        let budget = sy.enhanceLimit || 0;
        if (budget <= 0) return;
        const nodes = shuffle(sy.nodes || []);
        const chosenLv = {};
        const usedPos = new Set();
        for (const n of nodes) {
            if (budget <= 0) break;
            const maxLv = n.maxLevel || 0;
            if (maxLv <= 0) continue;
            /* 前置：parentId 里的每个节点都至少 1 级 */
            const parents = n.parentId || [];
            if (parents.length && !parents.every(p => (chosenLv[p] || 0) > 0)) continue;
            /* 二选一：同 position 且 priorty>0 的，只能选一个 */
            const posKey = (n.position || []).join(',');
            if ((n.priorty || 0) > 0 && usedPos.has(posKey)) continue;
            const cost = n.levelCost || [];
            const full = cost.slice(0, maxLv).reduce((a, b) => a + (b || 0), 0);
            if (full > budget) continue;
            let want = 1 + Math.floor(rnd() * maxLv);
            let c = 0;
            for (let i = 1; i <= want; i++) c += cost[i - 1] || 0;
            if (c > budget) { want = 1; c = cost[0] || 0; }
            if (c > budget) continue;
            chosenLv[n.id] = want;
            budget -= c;
            if ((n.priorty || 0) > 0) usedPos.add(posKey);
        }
        /* 注意：引擎按"节点 id → 等级"读（ap.lv），id 直接用蓝图节点 id */
        Object.assign(lv, chosenLv);
    });
    return lv;
}
async function buildAddPoints(fleet) {
    const ap = {};
    for (const s of fleet) {
        const t = await ensureTree(s.id);
        const lv = randAllocForShip(t);
        const cdn = E.cdnOf(s.id);
        if (cdn && Object.keys(lv).length) ap[cdn] = { lv, manual: {} };
    }
    return ap;
}

/* ---------- 基因组 ---------- */
function randGroup(minN, maxN) {
    const n = minN + Math.floor(rnd() * (maxN - minN + 1));
    const used = new Set(); const out = [];
    for (let i = 0; i < n; i++) {
        const s = pick(POOL); if (!s || used.has(s.id)) continue; used.add(s.id);
        const g = { id: s.id, count: 1 + Math.floor(rnd() * 4), position: s.pos };
        if (MODS[s.id]) { const o = {}; Object.keys(MODS[s.id]).forEach(k => { o[k] = pick(MODS[s.id][k]); }); g.mods = o; }
        out.push(g);
    }
    if (!out.length) out.push({ id: POOL[0].id, count: 2, position: POOL[0].pos });
    return out;
}
async function randGenome() {
    const escort = randGroup(1, 3), escorted = randGroup(1, 3);
    const addpoints = await buildAddPoints(escort.concat(escorted));
    const all = escort.concat(escorted);
    const fs = pick(all);
    return { escort, escorted, addpoints, flagship: fs ? fs.id : null };
}
function mutateGenome(g) {
    const n = JSON.parse(JSON.stringify({ escort: g.escort, escorted: g.escorted, flagship: g.flagship }));
    const roll = rnd();
    if (roll < 0.3) {                       // 改配队
        const which = rnd() < 0.5 ? 'escort' : 'escorted';
        const g2 = n[which];
        const r2 = rnd();
        if (r2 < 0.34 && g2.length > 1) g2.splice(Math.floor(rnd() * g2.length), 1);
        else if (r2 < 0.67) { const s = pick(POOL); if (s && !g2.some(x => x.id === s.id)) g2.push({ id: s.id, count: 1 + Math.floor(rnd() * 4), position: s.pos }); }
        else { const i = Math.floor(rnd() * g2.length); g2[i].count = Math.max(1, Math.min(8, g2[i].count + (rnd() < 0.5 ? -1 : 1))); }
    } else if (roll < 0.55) {               // 改站位
        const which = rnd() < 0.5 ? 'escort' : 'escorted'; const g2 = n[which];
        const i = Math.floor(rnd() * g2.length); g2[i].position = pick(['前排', '中排', '后排']);
    } else if (roll < 0.75) {               // 改模块
        const which = rnd() < 0.5 ? 'escort' : 'escorted'; const g2 = n[which];
        const i = Math.floor(rnd() * g2.length); const m = MODS[g2[i].id];
        if (m) { const k = pick(Object.keys(m)); g2[i].mods = Object.assign({}, g2[i].mods || {}, { [k]: pick(m[k]) }); }
    } else if (roll < 0.9) {                // 换旗舰
        const all = n.escort.concat(n.escorted); const f = pick(all); n.flagship = f ? f.id : null;
    } else {                                // 重掷加点（关键：加点也是被进化的）
        n._realloc = true;
    }
    return n;
}
async function finalize(g) {
    if (!g.addpoints || g._realloc) { g.addpoints = await buildAddPoints(g.escort.concat(g.escorted)); delete g._realloc; }
    if (!g.flagship) { const all = g.escort.concat(g.escorted); g.flagship = all.length ? all[0].id : null; }
    return g;
}

/* ---------- 对局与适应度 ---------- */
function duel(gA, gB, seed) {
    const r = E.runBattle({
        A: gA.escort, AEscorted: gA.escorted,
        B: gB.escort, BEscorted: gB.escorted,
        AFlagship: gA.flagship, BFlagship: gB.flagship,
        AAddPoints: gA.addpoints, BAddPoints: gB.addpoints,
        seed, maxSec: MAX_SEC
    });
    return r;
}
/* 存活时间 = 我方全部单位被消灭的时刻（没全灭就记满时长并给小奖励） */
function survival(r) {
    if (!r) return 0;
    const aAlive = r.我方.存活舰船 + r.我方.存活载机;
    const aTot = Math.max(1, r.我方.舰船数 + r.我方.载机数);
    const ratio = aAlive / aTot;
    const o = E.outcome(r);
    return r.时长 * (0.4 + 0.6 * ratio) + (o === 'win' ? 500 : 0);
}
async function fitness(gA, gBpool, nOpp, seedBase) {
    let tot = 0;
    for (let i = 0; i < nOpp; i++) {
        const gB = gBpool[i % gBpool.length];
        tot += survival(duel(gA, gB, (seedBase + i * 7919) >>> 0));
    }
    return tot / nOpp;
}

/* ---------- 主循环：交替进化 ---------- */
(async () => {
    const t0 = Date.now();
    const info = await E.init();
    console.log('引擎：' + info.ships + ' 艘船 ｜ 加点数据 ' + (info.bpReady ? 'OK' : '缺失'));
    buildPool();

    console.log('正在生成初始种群（含随机加点，需要一点时间）…');
    let popA = [], popB = [];
    for (let i = 0; i < POP; i++) popA.push(await finalize(await randGenome()));
    for (let i = 0; i < POP; i++) popB.push(await finalize(await randGenome()));
    console.log('初始种群就绪：A ' + popA.length + ' 个 · B ' + popB.length + ' 个\n');

    console.log('代   进化方   最优存活   平均     最优基因组（护航 / 被护航 / 旗舰 / 加点船数）');
    const curveA = [], curveB = [];
    for (let g = 1; g <= GENS; g++) {
        const evolveA = (g % 2 === 1);                 // 奇数代进化 A，偶数代进化 B（交替）
        const self = evolveA ? popA : popB;
        const opp = evolveA ? popB : popA;
        /* 对手池 = 随机抽 OPP 个（含当前代全部，天然形成军备竞赛） */
        const pool = shuffle(opp).slice(0, Math.max(2, Math.min(OPP, opp.length)));
        const scored = [];
        for (const gx of self) scored.push({ g: gx, fit: await fitness(gx, pool, pool.length, SEED0 + g * 1000) });
        scored.sort((a, b) => b.fit - a.fit);
        const avg = scored.reduce((a, x) => a + x.fit, 0) / scored.length;
        (evolveA ? curveA : curveB).push(scored[0].fit);
        const best = scored[0].g;
        const shipN = Object.keys(best.addpoints || {}).length;
        console.log(String(g).padStart(2) + '   ' + (evolveA ? 'A' : 'B').padEnd(7) +
            scored[0].fit.toFixed(0).padStart(8) + '   ' + avg.toFixed(0).padStart(6) + '   ' +
            best.escort.map(x => x.id + '×' + x.count).join('+').slice(0, 22) + ' / ' +
            best.escorted.map(x => x.id + '×' + x.count).join('+').slice(0, 22) + ' / ' +
            String(best.flagship).slice(0, 14) + ' / 加点 ' + shipN + ' 艘');
        /* 选择前 1/3 + 变异繁殖 */
        const keep = scored.slice(0, Math.max(2, Math.floor(self.length / 3))).map(x => x.g);
        const next = keep.slice();
        while (next.length < POP) next.push(await finalize(mutateGenome(pick(keep))));
        if (evolveA) popA = next; else popB = next;
    }

    console.log('\n=== 结果 ===');
    const f = a => a.length ? (a[0].toFixed(0) + ' → ' + a[a.length - 1].toFixed(0)) : '-';
    console.log('A 方最优存活时间曲线：' + f(curveA));
    console.log('B 方最优存活时间曲线：' + f(curveB));
    console.log('总耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    console.log('\n说明：双方各自进化【配队 + 加点 + 旗舰】参数包（⚠️非神经网络），每次都是 4 舰队护航格式对战。');
    console.log('      曲线上升 = 模拟器有选择压力、进化能跑通；交替进化 = 避免双方同质化（军备竞赛）。');
})();
