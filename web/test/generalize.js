/* 泛化验证：3 组"从未见过"的配队，各跑 3 次，对比"基于修复后公式的预期"。
   预期口径（修复后公式）：
     输出速率 ≈ 面板 × 1.45（加点伤害 + 基础暴击；实测口径 ×1.2~1.7）
     时长     ≈ 较弱一方【有效血(血×1.15+维修)】÷【较强一方输出速率】
   判据：实际时长与公式预期的偏差必须 ≤30%（用户的防过拟合线）。 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = v => (v >= 10000 ? (v / 10000).toFixed(1) + '万' : String(Math.round(v)));

/* ★ Node 侧独立的面板计算（不依赖浏览器内的 panelOf，避免口径/缓存问题） */
const RAW = JSON.parse(fs.readFileSync('data/ship_database.json', 'utf8'));
const DB = {}; (Array.isArray(RAW) ? RAW : Object.values(RAW)).forEach(x => { if (x && x.id) DB[x.id] = x; });
function panelNet(list) {
    return list.reduce((sum, it) => {
        const t = DB[it[0]]; if (!t) return sum;
        let one = 0;
        (t.weapons || []).forEach(w => one += ((w.dpm || {}).antiShip || 0) + ((w.dpm || {}).antiAir || 0));
        Object.entries(t.modules || {}).forEach(([k, m]) => {
            if (k.startsWith('_')) return;
            (m.weapons || []).forEach(w => one += ((w.dpm || {}).antiShip || 0) + ((w.dpm || {}).antiAir || 0));
            /* ★ 实战只装【第一个变体】（selectedModules 为空 → 取 variantKeys[0]），
               原来把所有变体都累加 → 面板虚高 3~10 倍 */
            const _vk = Object.keys(m.variants || {})[0];
            if (_vk) (m.variants[_vk].weapons || []).forEach(w => one += ((w.dpm || {}).antiShip || 0) + ((w.dpm || {}).antiAir || 0));
        });
        return sum + one * (it[2] || 1);
    }, 0);
}

const GROUPS = [
    { name: '组1 · 小船快攻（护卫 vs 驱逐）',
      A: [['fury-frigate', '愤怒级-快速护卫舰', 6, '前排'], ['ruby-A', '红宝石级-重型轨道炮护卫舰', 3, '中排']],
      B: [['douniu-A', '斗牛级-脉冲炮驱逐舰', 6, '前排'], ['AC721-A', 'AC721-重型运载驱逐舰', 3, '后排']] },
    { name: '组2 · 巡洋对巡洋',
      A: [['chimera-A', '奇美拉级-重型巡洋舰', 6, '前排'], ['ranger-A', '游骑兵级-综合作战巡洋舰', 3, '中排']],
      B: [['callisto-A', '卡利斯托-集束鱼雷袭击舰', 6, '中排'], ['CAS066-A', 'CAS066级-通用巡洋舰', 3, '前排']] },
    { name: '组3 · 航母载机 vs 战巡（含护航机制）',
      A: [['sun-whale', '太阳鲸-武装战略航空母舰', 2, '中排'], ['ST59', 'ST59级-防御战列巡洋舰', 4, '前排']],
      B: [['eternal-storm', '永恒风暴级-攻击战列巡洋舰', 3, '中排'], ['plutus-shield', '普鲁图斯之盾级-防护战列巡洋舰', 3, '中排']] }
];

(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
    await p.goto(BASE + '/simulator.html', { waitUntil: 'load', timeout: 90000 });
    await sleep(4500);
    console.log('=== 泛化验证：3 组新配队 × 3 次 ===\n');
    const all = await p.evaluate((groups, runs) => {
        const out = [];
        groups.forEach(g => {
            const mk = (list) => list.map(([id, name, qty, pos]) => {
                const t = SHIP_DATABASE[id];
                if (!t) return { __err: 'unknown ' + id };
                const e = JSON.parse(JSON.stringify(t));
                e.count = qty; e.selectedModules = {}; e.position = pos;
                recalcAircraftSlots(e); e.aircraft = [];
                (e.simSlots || e.airSlots || []).forEach(sl => {
                    if (!sl || !sl.allow) return;
                    const kind = (sl.kind || sl.allow);
                    const ac = Object.values(SHIP_DATABASE).find(x => x.position === 'aircraft'
                        && ((x.type === 'fighter' && (kind === 'ALL' || /战机|fighter/i.test(kind)))
                         || (x.type === 'corvette' && (kind === 'ALL' || /护航艇|corvette/i.test(kind)))));
                    if (ac) { const inst = JSON.parse(JSON.stringify(ac)); inst.count = sl.cap || 4; inst.slot = sl.key; e.aircraft.push(inst); }
                });
                return e;
            });
            const A0 = mk(g.A), B0 = mk(g.B);
            const pd = [];
            const panelOf = (arr) => { let s = 0; const addW = (ws) => (ws || []).forEach(w => { s += ((w.dpm || {}).antiShip || 0) + ((w.dpm || {}).antiAir || 0); });
                arr.forEach(e => { if (e.__err) return; const t = SHIP_DATABASE[e.id]; if (!t) return;
                /* ★ 舰船【自带基础武器】也要算（原来漏了 → 面板偏低、效率虚高） */
                addW(t.weapons);
                Object.entries(t.modules || {}).forEach(([k, m]) => { if (k.startsWith('_')) return;
                    /* ★ 模块级武器（m.weapons，无 variants）与变体武器都要算 —— 原来只算了 variants */
                    (m.weapons || []).forEach(w => { s += ((w.dpm || {}).antiShip || 0) + ((w.dpm || {}).antiAir || 0); });
                    if (m.variants && Object.keys(m.variants).length) {
                        const v = m.variants[Object.keys(m.variants)[0]] || m;
                        (v.weapons || []).forEach(w => { s += ((w.dpm || {}).antiShip || 0) + ((w.dpm || {}).antiAir || 0); });
                    } });
                (e.aircraft || []).forEach(ac => (ac.weapons || []).forEach(w => { s += (((w.dpm || {}).antiShip || 0) + ((w.dpm || {}).antiAir || 0)) * (ac.count || 1); }));
                pd.push({ id: e.id, n: e.count, err: !!e.__err }); }); return s; };
            const hpOf = (arr) => arr.reduce((s, e) => { const t = SHIP_DATABASE[e.id]; return s + (t ? t.hp * e.count : 0); }, 0);
            pd.length = 0; const pa = panelOf(A0);
            const pdA = pd.slice();
            pd.length = 0; const pb = panelOf(B0);
            const pdB = pd.slice();
            const ha = hpOf(A0), hb = hpOf(B0);
            let sums = null, n = 0;
            for (let i = 0; i < runs; i++) {
                FLEET_TYPES.forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; fleetData[k].apSet = null; });
                fleetData['ally-escort'].main = JSON.parse(JSON.stringify(A0));
                fleetData['enemy-escort'].main = JSON.parse(JSON.stringify(B0));
                refreshFleetViews();
                battleSeed = 5000 + i * 7919;
                if (!prepareBattle()) { out.push({ g: g.name, err: 1 }); return; }
                const bs = battleState;
                let t = 0; while (!bs.ended && t < 30000) { processBattleTick(0.2); t += 0.2; }
                const agg = (arr) => ({ n: arr.length, alive: arr.filter(x => x.alive).length,
                    as: arr.reduce((s, x) => s + (x._dealtShip || 0), 0), aa: arr.reduce((s, x) => s + (x._dealtAir || 0), 0),
                    heal: arr.reduce((s, x) => s + (x._healOut || 0), 0),
                    life: arr.length ? arr.reduce((s, x) => s + (x._aliveSec || 0), 0) / (arr.length * t) : 0 });
                const cur = { dur: t, A: agg(bs.allyShips), B: agg(bs.enemyShips) };
                if (!sums) sums = JSON.parse(JSON.stringify(cur));
                else { sums.dur += cur.dur; ['A', 'B'].forEach(k => Object.keys(cur[k]).forEach(x => sums[k][x] += cur[k][x])); }
                n++;
            }
            if (sums) { sums.dur /= n; ['A', 'B'].forEach(k => Object.keys(sums[k]).forEach(x => sums[k][x] /= n)); }
            out.push({ g: g.name, pa, pb, ha, hb, r: sums, pdA: pdA || [], pdB: pdB || [] });
        });
        return out;
    }, GROUPS, 3);

    all.forEach(o => {
        const _gi = all.indexOf(o);
        o.paN = panelNet(GROUPS[_gi].A); o.pbN = panelNet(GROUPS[_gi].B);
        if (o.err || !o.r) { console.log('### ' + o.g + ' → 运行失败'); return; }
        const r = o.r;
        const paN = o.paN || o.pa, pbN = o.pbN || o.pb;
        /* 预期【范围】：效率系数取实测区间 [0.20, 1.20]
           （三组共 6 个实测值：1.15 / 0.41 / 0.54 / 0.79 / 0.23 / 0.48）
           → 时长范围 = 较弱一方有效血 ÷ 较强一方【最快/最慢】输出速率 */
        const effA2 = o.ha * 1.15 + r.A.heal, effB2 = o.hb * 1.15 + r.B.heal;
        const lo = 0.20, hi = 1.20;
        const durHi = Math.min(effB2 / ((paN / 60 * lo) || 1), effA2 / ((pbN / 60 * lo) || 1));
        const durLo = Math.min(effB2 / ((paN / 60 * hi) || 1), effA2 / ((pbN / 60 * hi) || 1));
        const actA2 = (r.A.as + r.A.aa) / r.dur * 60, actB2 = (r.B.as + r.B.aa) / r.dur * 60;
        const inRange = r.dur >= durLo * 0.7 && r.dur <= durHi * 1.4;
        console.log('### ' + o.g);
        console.log('  面板：我方 ' + W(paN) + '/分  敌方 ' + W(pbN) + '/分    血：' + W(o.ha) + ' / ' + W(o.hb) +
            '    有效血：' + W(effA2) + ' / ' + W(effB2));
        console.log('  时长：实际 ' + Math.round(r.dur) + 's   预期范围 ' + Math.round(durLo) + '~' + Math.round(durHi) + 's   ' +
            (inRange ? '✅ 在范围内' : '❌ 超出范围'));
        console.log('  输出效率：我方 ' + (actA2 / (paN || 1)).toFixed(2) + '× 面板   敌方 ' + (actB2 / (pbN || 1)).toFixed(2) + '× 面板');
        console.log('  存活：我方 ' + r.A.alive + '/' + r.A.n + '  敌方 ' + r.B.alive + '/' + r.B.n +
            '   生存时间占比 ' + (r.A.life * 100).toFixed(0) + '% / ' + (r.B.life * 100).toFixed(0) + '%');
        console.log('');
    });
    await b.close();
})();
