/* ============================================================
   判定 index.html 的 "detached Frame" 到底是
     ① 页面自己导航走了  vs  ② 渲染进程崩溃（OOM）
   手法：监听 page.on('error')（puppeteer 在渲染进程崩溃时触发）、
        framenavigated、以及 CDP Target.targetCrashed；
        并每 400ms 探一次活，标出死亡时刻。
   ============================================================ */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    for (const [page, vp] of [['index.html', { width: 1500, height: 1000 }], ['index.html', { width: 375, height: 812, isMobile: true, hasTouch: true }], ['chat.html', { width: 1500, height: 1000 }]]) {
        const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-gpu'] });
        const p = await b.newPage();
        await p.setViewport(vp);
        const ev = [];
        p.on('error', e => ev.push('RENDERER_CRASH: ' + String(e.message).slice(0, 120)));
        p.on('framenavigated', fr => { if (fr === p.mainFrame()) ev.push('NAV:' + fr.url()); });
        p.on('pageerror', e => ev.push('JSERR:' + String(e.message).slice(0, 120)));
        const cdp = await p.target().createCDPSession();
        await cdp.send('Target.setDiscoverTargets', { discover: true }).catch(() => { });
        cdp.on('Target.targetCrashed', e => ev.push('CDP_targetCrashed:' + JSON.stringify(e).slice(0, 160)));
        cdp.on('Inspector.targetCrashed', () => ev.push('CDP_inspectorCrashed'));
        cdp.on('Inspector.detached', e => ev.push('CDP_inspectorDetached:' + JSON.stringify(e).slice(0, 120)));

        let t0 = Date.now(), deadAt = -1, alive = true;
        try { await p.goto(BASE + '/' + page, { waitUntil: 'load', timeout: 60000 }); } catch (e) { ev.push('GOTO_ERR:' + String(e.message).slice(0, 100)); }
        /* 每 400ms 探活，直到 12s 或死亡 */
        for (let i = 0; i < 30; i++) {
            await sleep(400);
            if (!alive) break;
            try { const n = await p.evaluate(() => document.body.innerText.length); if (n === undefined) throw new Error('undefined'); }
            catch (e) { alive = false; deadAt = Date.now() - t0; ev.push('DETACH@"' + deadAt + 'ms":' + String(e.message).slice(0, 90)); }
        }
        console.log('\n--- ' + page + ' / ' + JSON.stringify(vp) + ' ---');
        console.log('   存活: ' + alive + (deadAt > 0 ? ' ｜ 死亡时刻 ≈ ' + deadAt + 'ms（页面 load 后）' : ''));
        console.log('   事件: ' + (ev.length ? ev.join('\n         ') : '（无）'));
        if (alive) {
            const mem = await p.evaluate(() => (performance.memory ? { usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576), totalMB: Math.round(performance.memory.totalJSHeapSize / 1048576) } : 'performance.memory 不可用'));
            console.log('   堆内存: ' + JSON.stringify(mem));
        }
        await b.close();
    }
})();
