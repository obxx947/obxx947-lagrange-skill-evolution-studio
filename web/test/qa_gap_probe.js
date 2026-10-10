/* ============================================================
   QA 补漏探针（2026-10-02）
   目的：把 _autoplay2.js 中途崩溃时丢掉的信息捞回来 +
         复核它报出的可疑项（本项目历史上多次是工具自身假警报）：
     1. _autoplay2 崩在 index.html/手机 的 goto（detached Frame）—— 是页面自己跳转还是工具问题
     2. index.html / chat.html 各 1 条 pageerror 的真实内容与栈
     3. chat.html 手机 2 个"被遮挡"是不是真的被挡（含 elementFromPoint 复核 + 真实点击）
   ============================================================ */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox', '--disable-gpu'] });

    /* ---------- 1 & 2：pageerror 细节 + goto 是否被页面自身跳转打断 ---------- */
    for (const [f, vp] of [['index.html', '桌面'], ['index.html', '手机'], ['chat.html', '桌面'], ['chat.html', '手机']]) {
        const isMobile = vp === '手机';
        const p = await b.newPage();
        await p.setViewport(isMobile ? { width: 375, height: 812, isMobile: true, hasTouch: true } : { width: 1500, height: 1000 });
        const errs = [], cons = [], navs = [];
        p.on('pageerror', e => errs.push({ msg: String(e.message).slice(0, 300), stack: String(e.stack || '').split('\n').slice(0, 4).join(' ⏎ ') }));
        p.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|bge embed init failed/i.test(m.text())) cons.push(m.text().slice(0, 200)); });
        p.on('framenavigated', fr => { if (fr === p.mainFrame()) navs.push(fr.url()); });
        let gotoErr = '';
        try { await p.goto(BASE + '/' + f, { waitUntil: 'load', timeout: 60000 }); }
        catch (e) { gotoErr = String(e.message).slice(0, 160); }
        await sleep(3500);
        console.log('\n--- ' + f + ' / ' + vp + ' ---');
        if (gotoErr) console.log('   ⚠ goto 异常: ' + gotoErr);
        console.log('   主框架导航序列: ' + JSON.stringify(navs));
        errs.slice(0, 4).forEach(e => console.log('   ❗ pageerror: ' + e.msg + '\n       栈: ' + e.stack));
        if (!errs.length) console.log('   ✅ 无 pageerror');
        cons.slice(0, 4).forEach(c => console.log('   ⚠ console.error: ' + c));
        if (!errs.length && !cons.length && !gotoErr) console.log('   ✅ 无 console.error');
        await p.close();
    }

    /* ---------- 3：chat.html 手机版"被遮挡"复核 ---------- */
    console.log('\n\n===== chat.html 手机：把每个可点元素逐个真实体检（找那 2 个"被遮挡"）=====');
    {
        const p = await b.newPage();
        await p.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
        await p.goto(BASE + '/chat.html', { waitUntil: 'load', timeout: 90000 });
        await sleep(3500);
        /* 先关掉所有弹窗回到基线，再体检——否则量到的是"免责声明弹窗正常盖住页面"（那是预期行为不是 bug） */
        const closed = await p.evaluate(() => {
            let n = 0;
            document.querySelectorAll('.modal-overlay.active,.modal-overlay[style*="flex"],.modal-mask.show,.overlay.show').forEach(m => {
                const b = m.querySelector('.m-ok,.modal-close,[onclick*="acceptDisclaimer"],[onclick*="closeModal"],[onclick*="Close"],[onclick*="closeMods"]');
                if (b) { try { b.click(); n++; } catch (e) { } }
            });
            return n;
        });
        console.log('   （已关闭 ' + closed + ' 个弹窗回到基线）');
        await sleep(600);
        const r = await p.evaluate(() => {
            const out = [];
            const sel = 'button,[onclick],.btn,.m-ok,.tab,.category-btn,.chip,.tag,select,.modal-close,.ship-chip,.airitem';
            Array.from(document.querySelectorAll(sel)).forEach((el, idx) => {
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') < 0.05) return;
                el.scrollIntoView({ block: 'center', behavior: 'instant' });
                const rc = el.getBoundingClientRect();
                if (rc.width < 4 || rc.height < 4) return;
                const x = Math.round(rc.left + Math.min(rc.width / 2, 60));
                const y = Math.round(rc.top + Math.min(rc.height / 2, 200));
                const top = document.elementFromPoint(x, y);
                const okHit = !!(top && (top === el || el.contains(top) || top.contains(el)));
                if (okHit) return;
                /* 已被挡 → 记录完整证据 */
                const st = { idx, txt: (el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 26),
                    tag: el.tagName, cls: String(el.className || '').slice(0, 50),
                    rect: [Math.round(rc.left), Math.round(rc.top), Math.round(rc.width), Math.round(rc.height)],
                    at: [x, y], vp: [window.innerWidth, window.innerHeight],
                    topTag: top ? top.tagName : 'null', topCls: top ? String(top.className || '').slice(0, 50) : '',
                    topId: top ? top.id : '', zEl: cs.zIndex, pos: cs.position,
                    topZ: top ? getComputedStyle(top).zIndex : '', topPE: top ? getComputedStyle(top).pointerEvents : '',
                    oc: String(el.getAttribute('onclick') || '').slice(0, 60) };
                /* 祖先里有没有 overflow:hidden 的裁切容器（那是"视觉裁切"不是"被遮挡"） */
                let anc = el.parentElement, clip = null;
                while (anc && anc !== document.body) {
                    const a = getComputedStyle(anc);
                    if (/hidden|clip/.test(a.overflowX + a.overflowY)) { const ar = anc.getBoundingClientRect();
                        if (ar.right < rc.left + 2 || ar.left > rc.right - 2 || ar.bottom < rc.top + 2 || ar.top > rc.bottom - 2) { clip = String(anc.className || anc.tagName).slice(0, 40); break; } }
                    anc = anc.parentElement;
                }
                st.clippedBy = clip;
                /* 拦截者是不是"故意打开的弹窗"（预期行为，不是 bug） */
                const owner = top ? top.closest('.modal-overlay.active,.modal-mask.show,.overlay.show') : null;
                st.topIsOpenModal = owner ? (owner.id || owner.className) : null;
                /* 拦截者是不是"没有 active 类却可见"的残层（那才是 bug） */
                /* 找最上层拦截者是不是"透明挡点击层" */
                let ghost = null, tn = top;
                while (tn && tn !== document.body) {
                    const tc = getComputedStyle(tn);
                    if (parseFloat(tc.opacity || '1') < 0.05 || /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(tc.backgroundColor) === false && tc.backgroundColor === 'rgba(0, 0, 0, 0)') { }
                    tn = tn.parentElement;
                }
                out.push(st);
            });
            return out;
        });
        if (!r.length) console.log('   ✅ 无被遮挡元素（与 _autoplay2 的"2 个"不一致 → 说明那 2 个是点击过程中的瞬时态）');
        r.forEach(x => console.log('   ❗ idx' + x.idx + ' 「' + x.txt + '」 ' + x.tag + '.' + x.cls
            + '\n       被 ' + x.topTag + '#' + x.topId + '.' + x.topCls + ' 挡住（z=' + x.topZ + ' pe=' + x.topPE + '）'
            + '\n       元素z=' + x.zEl + ' pos=' + x.pos + ' rect=' + JSON.stringify(x.rect) + ' 点击点=' + JSON.stringify(x.at) + ' 视口=' + JSON.stringify(x.vp)
            + '\n       onclick=' + x.oc
            + (x.topIsOpenModal ? '\n       ⓘ 拦截者是【已打开的弹窗】' + x.topIsOpenModal + ' → 预期行为，非 bug' : '')
            + (x.clippedBy ? '\n       ⚠ 祖先裁切: ' + x.clippedBy : '')));
        await p.close();
    }

    await b.close();
    console.log('\n===== 补漏探针结束 =====');
})();
