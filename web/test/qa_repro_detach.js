/* ============================================================
   复现 _autoplay2.js 在 index.html/手机 崩溃（detached Frame）
   目的：判定是【页面自己重载】还是【工具/CDP 竞态】
   手法：同一个浏览器里
       ① 桌面开 index.html，真实点 40 个元素（复刻 autoplay 的累计状态）
       ② 再开一个 375×812 的页，goto index.html，监听主框架导航序列 + load 次数
       ③ 分步 evaluate，看哪一步抛 detached
   ============================================================ */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CLICK_SEL = 'button,[onclick],.btn,.m-ok,.tab,.category-btn,.chip,.tag,select,.modal-close,.ship-chip,.airitem';
const CLOSE_ALL = `(function(){var n=0;document.querySelectorAll('.modal-overlay.active,.modal-overlay[style*="flex"],.modal-mask.show,.overlay.show').forEach(function(m){var b=m.querySelector('.m-ok,.modal-close,[onclick*="acceptDisclaimer"],[onclick*="closeModal"],[onclick*="Close"],[onclick*="closeMods"]');if(!b){var c=[].slice.call(m.querySelectorAll('button,div,span')).filter(function(e){var t=(e.innerText||'').trim();return t&&t.length<=10&&/^(✕|×|取消|关闭|返回)$/.test(t)&&e.getBoundingClientRect().width>0;});b=c[0];}if(b){try{b.click();n++;}catch(e){}} });return n;})()`;

(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox', '--disable-gpu'] });

    /* ① 桌面 pass：复刻 autoplay（点 40 个） */
    const d = await b.newPage();
    await d.setViewport({ width: 1500, height: 1000 });
    await d.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
    await sleep(2500);
    await d.addStyleTag({ content: '*,*::before,*::after{scroll-behavior:auto !important}' }).catch(() => { });
    await d.evaluate(CLOSE_ALL); await sleep(400);
    const seen = new Set();
    for (let k = 0; k < 40; k++) {
        const it = await d.evaluate(async (sel, seenArr) => {
            const seen = new Set(seenArr);
            for (const el of Array.from(document.querySelectorAll(sel))) {
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') < 0.05) continue;
                const key = el.tagName + '|' + (el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 30) + '|' + String(el.getAttribute('onclick') || '').slice(0, 40);
                if (seen.has(key)) continue;
                el.scrollIntoView({ block: 'center' });
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                const r = el.getBoundingClientRect();
                if (r.width < 4 || r.height < 4) return { key, skip: true };
                return { key, x: Math.round(r.left + Math.min(r.width / 2, 60)), y: Math.round(r.top + r.height / 2), txt: (el.innerText || '').trim().slice(0, 20) };
            }
            return null;
        }, CLICK_SEL, Array.from(seen));
        if (!it) break;
        seen.add(it.key);
        if (it.skip) continue;
        try { await d.mouse.click(it.x, it.y); } catch (e) { }
        await sleep(260);
        try { await d.evaluate(CLOSE_ALL); } catch (e) { }
        await sleep(120);
    }
    const lsAfter = await d.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = String(localStorage.getItem(k)).slice(0, 60); } return o; });
    console.log('桌面 pass 完成，点了 ' + seen.size + ' 个； localStorage 键: ' + JSON.stringify(lsAfter).slice(0, 700));
    await d.close();

    /* ② 手机 pass：分步，锁定抛 detached 的那一步 */
    const m = await b.newPage();
    await m.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    const navs = [];
    m.on('framenavigated', fr => { if (fr === m.mainFrame()) navs.push(fr.url()); });
    m.on('pageerror', e => console.log('   ❗ pageerror: ' + String(e.message).slice(0, 200)));
    let crashed = '';
    const step = async (name, fn) => { if (crashed) return; try { const r = await fn(); console.log('   ✅ ' + name + (r !== undefined ? ' → ' + JSON.stringify(r).slice(0, 120) : '')); } catch (e) { crashed = name + ': ' + String(e.message).slice(0, 120); console.log('   ❌ ' + name + ' 抛异常 → ' + crashed); } };
    await step('goto index.html(手机)', async () => { await m.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 }); return 'ok'; });
    await step('sleep 2500', async () => { await sleep(2500); return 'ok'; });
    await step('addStyleTag', async () => { await m.addStyleTag({ content: '*,*::before,*::after{scroll-behavior:auto !important}' }); return 'ok'; });
    await step('evaluate(CLOSE_ALL)', async () => await m.evaluate(CLOSE_ALL));
    await step('sleep 400', async () => { await sleep(400); return 'ok'; });
    await step('evaluate(CLOSE_ALL) 第二次', async () => await m.evaluate(CLOSE_ALL));
    await step('读 body 长度', async () => await m.evaluate(() => document.body.innerText.length));
    console.log('   主框架导航序列: ' + JSON.stringify(navs));
    console.log('   >>> 崩溃步骤: ' + (crashed || '无 —— 未能复现'));
    await m.close();

    /* ③ 反向对照：全新浏览器直接开手机版 index.html（无桌面 pass 的状态） */
    const b2 = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-gpu'] });
    const f = await b2.newPage();
    await f.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    const navs2 = []; f.on('framenavigated', fr => { if (fr === f.mainFrame()) navs2.push(fr.url()); });
    let e2 = '';
    try { await f.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 }); await sleep(2500); await f.addStyleTag({ content: '*,*::before,*::after{scroll-behavior:auto !important}' }); await sleep(200); await f.evaluate(CLOSE_ALL); }
    catch (e) { e2 = String(e.message).slice(0, 140); }
    console.log('\n对照（全新浏览器 / 手机 index.html）: 异常=' + (e2 || '无') + ' 导航序列=' + JSON.stringify(navs2));
    await b2.close();
    await b.close();
})();
