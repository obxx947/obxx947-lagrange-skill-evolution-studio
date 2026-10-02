/* 对拍：独立 Node 引擎 vs 浏览器（simulator.html）—— 同配队 + 同种子必须同结果 */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const E = require('../engine/lagrange_engine.js');
const A = [{ id: 'sun-whale', count: 2, position: '中排' }, { id: 'ST59', count: 4, position: '前排' }];
const B = [{ id: 'eternal-storm', count: 3, position: '中排' }, { id: 'plutus-shield', count: 3, position: '中排' }];
const SEED = 12345;
const key = r => r ? [Math.round(r.时长), Math.round(r.我方.总输出对舰), Math.round(r.我方.总输出对空),
    Math.round(r.敌方.总输出对舰), Math.round(r.我方.总承伤)].join('|') : 'x';
(async () => {
    await E.init();
    const n = E.runBattle({ A, B, seed: SEED });
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
    await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'load', timeout: 90000 });
    await sleep(4500);
    const wr = await p.evaluate((A0, B0, seed) => {
        const build = spec => spec.map(s => {
            const t = SHIP_DATABASE[s.id]; if (!t) return null;
            const e = JSON.parse(JSON.stringify(t));
            e.count = s.count; e.selectedModules = {}; e.position = s.position;
            recalcAircraftSlots(e); e.aircraft = [];
            return e;
        }).filter(Boolean);
        FLEET_TYPES.forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; fleetData[k].apSet = null; });
        fleetData['ally-escort'].main = build(A0);
        fleetData['enemy-escort'].main = build(B0);
        refreshFleetViews(); battleSeed = seed;
        if (!prepareBattle()) return null;
        const bs = battleState;
        let t = 0; while (!bs.ended && t < 30000) { processBattleTick(0.2); t += 0.2; }
        const agg = arr => ({ s: arr.reduce((a, x) => a + (x._dealtShip || 0), 0),
            a: arr.reduce((a, x) => a + (x._dealtAir || 0), 0),
            tk: arr.reduce((a, x) => a + (x._taken || 0), 0) });
        return { 时长: t, 我方: agg(bs.allyShips), 敌方: agg(bs.enemyShips) };
    }, A, B, SEED);
    await b.close();
    const norm = r => r ? { 时长: Math.round(r.时长), 我方: { s: Math.round(r.我方.s ?? r.我方.总输出对舰), a: Math.round(r.我方.a ?? r.我方.总输出对空), tk: Math.round(r.我方.tk ?? r.我方.总承伤) } } : null;
    const N = norm(n), W = wr ? { 时长: Math.round(wr.时长), 我方: { s: Math.round(wr.我方.s), a: Math.round(wr.我方.a), tk: Math.round(wr.我方.tk) } } : null;
    console.log('Node 引擎 :', JSON.stringify(N));
    console.log('浏览器    :', JSON.stringify(W));
    const same = N && W && JSON.stringify(N) === JSON.stringify(W);
    console.log(same ? '\n✅ 独立引擎与浏览器逐项一致（可用于进化实验）' : '\n❌ 两者不一致（需排查）');
})();
