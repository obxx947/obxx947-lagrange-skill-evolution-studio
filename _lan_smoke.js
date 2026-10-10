/* 局域网部署冒烟：从 3002（web/ 部署副本）真实加载页面，确认能跑 */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 120000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
    await p.goto('http://127.0.0.1:3002/chat.html', { waitUntil: 'domcontentloaded' });
    await sleep(4500);
    const c = await p.evaluate(() => ({
        engine: typeof AgentEngine,
        tools: (typeof AgentEngine !== 'undefined' && AgentEngine.getTools) ? AgentEngine.getTools().map(t => t.function.name).filter(n => ['run_subagents', 'set_ship_mechanic', 'save_addpoint_plan', 'battle_simulate'].indexOf(n) >= 0) : null,
        kbStatus: (typeof KB !== 'undefined' && KB.status) ? KB.status() : undefined
    }));
    console.log('chat.html @3002:', JSON.stringify(c));
    await p.goto('http://127.0.0.1:3002/fleet.html', { waitUntil: 'load' });
    await sleep(3000);
    const f = await p.evaluate(() => ({ custom: typeof CustomShip, mech: typeof MechSpec, ships: (typeof ALL !== 'undefined') ? ALL.length : 0 }));
    console.log('fleet.html @3002:', JSON.stringify(f));
    await p.goto('http://127.0.0.1:3002/simulator.html', { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    const s = await p.evaluate(() => ({ engineFn: typeof window.__engineAddMechanic, panels: document.querySelectorAll('.fleet-panel').length, menuGone: !document.getElementById('page-menu') }));
    console.log('simulator.html @3002:', JSON.stringify(s));
    console.log('页面错误:', errs.length ? errs.slice(0, 4) : '无');
    await b.close();
})().catch(e => { console.error('ERR', String(e.message).slice(0, 200)); process.exit(1); });
