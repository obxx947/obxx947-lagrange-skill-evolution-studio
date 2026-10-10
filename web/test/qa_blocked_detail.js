/* ============================================================
   把 _autoplay2.js 报的"被遮挡 N 个"逐条挖出来看真假
   （本项目历史上多次是工具自身假警报，必须逐条复核）
   用法：node test/qa_blocked_detail.js <页面> <桌面|手机>
   输出每条的证据：元素、rect、点击点、最上层命中者、z-index、
        最上层命中者是否属于"已打开的弹窗"（预期遮挡）、
        是否被祖先 overflow:hidden 裁切（视觉裁切 ≠ 被遮挡）、
        以及"绕过遮挡直接对元素派发真实鼠标事件"能否生效（区分真死 vs 只是层序）
   ============================================================ */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PAGE = process.argv[2] || 'index.html';
const VPM = (process.argv[3] || '手机') === '手机';
const CLICK_SEL = 'button,[onclick],.btn,.m-ok,.tab,.category-btn,.chip,.tag,select,.modal-close,.ship-chip,.airitem';
const SKIP_SEL = 'input[type=file]';
const CLOSE_ALL = `(function(){var n=0;document.querySelectorAll('.modal-overlay.active,.modal-overlay[style*="flex"],.modal-mask.show,.overlay.show').forEach(function(m){var b=m.querySelector('.m-ok,.modal-close,[onclick*="acceptDisclaimer"],[onclick*="closeModal"],[onclick*="Close"],[onclick*="closeMods"]');if(!b){var c=[].slice.call(m.querySelectorAll('button,div,span')).filter(function(e){var t=(e.innerText||'').trim();return t&&t.length<=10&&/^(✕|×|取消|关闭|返回)$/.test(t)&&e.getBoundingClientRect().width>0;});b=c[0];}if(b){try{b.click();n++;}catch(e){}} });return n;})()`;

(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    await p.setViewport(VPM ? { width: 375, height: 812, isMobile: true, hasTouch: true } : { width: 1500, height: 1000 });
    const errs = [];
    p.on('pageerror', e => errs.push('JSERR:' + String(e.message).slice(0, 150)));
    p.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) errs.push('CONSOLE:' + m.text().slice(0, 150)); });
    p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
    await p.goto(BASE + '/' + PAGE, { waitUntil: 'load', timeout: 90000 });
    await sleep(2500);
    await p.addStyleTag({ content: '*,*::before,*::after{scroll-behavior:auto !important}' }).catch(() => { });
    await p.evaluate(CLOSE_ALL); await sleep(400);

    console.log('===== ' + PAGE + ' / ' + (VPM ? '手机 375×812' : '桌面 1500×1000') + ' =====');
    const seen = new Set(), blockedList = [];
    for (let k = 0; k < 40; k++) {
        const it = await p.evaluate(async (sel, skipSel, seenArr) => {
            const seen = new Set(seenArr);
            for (const el of Array.from(document.querySelectorAll(sel))) {
                if (el.matches && el.matches(skipSel)) continue;
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') < 0.05) continue;
                const key = el.tagName + '|' + (el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 30) + '|' + String(el.getAttribute('onclick') || '').slice(0, 40);
                if (seen.has(key)) continue;
                el.scrollIntoView({ block: 'center', behavior: 'instant' });
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                const r = el.getBoundingClientRect();
                if (r.width < 4 || r.height < 4) return { key, skip: true };
                const x = Math.round(r.left + Math.min(r.width / 2, 60)), y = Math.round(r.top + Math.min(r.height / 2, 200));
                const top = document.elementFromPoint(x, y);
                const blocked = !(top === el || el.contains(top) || (top && top.contains(el)));
                /* 祖先裁切检查 */
                let anc = el.parentElement, clip = null;
                while (anc && anc !== document.body) {
                    const a = getComputedStyle(anc);
                    if (/hidden|clip/.test(a.overflowX + a.overflowY)) {
                        const ar = anc.getBoundingClientRect();
                        if (ar.right < r.left + 2 || ar.left > r.right - 2 || ar.bottom < r.top + 2 || ar.top > r.bottom - 2) { clip = String(anc.className || anc.tagName).slice(0, 44); break; }
                    }
                    anc = anc.parentElement;
                }
                const owner = top ? top.closest('.modal-overlay.active,.modal-mask.show,.overlay.show,[class*="drawer"],[class*="menu"]') : null;
                return { key, x, y, blocked,
                    txt: (el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 26),
                    tag: el.tagName, cls: String(el.className || '').slice(0, 44),
                    rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], vp: [window.innerWidth, window.innerHeight],
                    topTag: top ? top.tagName : 'null', topId: top ? top.id : '', topCls: top ? String(top.className || '').slice(0, 44) : '',
                    topZ: top ? getComputedStyle(top).zIndex : '', elZ: cs.zIndex, elPos: cs.position,
                    owner: owner ? (owner.id || String(owner.className).slice(0, 30)) : null,
                    clip, oc: String(el.getAttribute('onclick') || '').slice(0, 60) };
            }
            return null;
        }, CLICK_SEL, SKIP_SEL, Array.from(seen));
        if (!it) break;
        seen.add(it.key);
        if (it.skip) continue;
        if (it.blocked) blockedList.push(it);
        try { await p.mouse.click(it.x, it.y); } catch (e) { }
        await sleep(260);
        try { await p.evaluate(CLOSE_ALL); } catch (e) { }
        await sleep(120);
    }

    console.log('\n点了 ' + seen.size + ' 个 ｜ 被遮挡 ' + blockedList.length + ' 个');
    blockedList.forEach((x, i) => {
        console.log('\n【' + (i + 1) + '】「' + x.txt + '」 ' + x.tag + '.' + x.cls);
        console.log('    onclick    = ' + x.oc);
        console.log('    rect       = ' + JSON.stringify(x.rect) + '  视口=' + JSON.stringify(x.vp) + '  元素z=' + x.elZ + ' pos=' + x.elPos);
        console.log('    点击点     = ' + JSON.stringify([x.x, x.y]));
        console.log('    最上层命中 = ' + x.topTag + '#' + x.topId + '.' + x.topCls + ' (z=' + x.topZ + ')');
        console.log('    命中者归属 = ' + (x.owner ? '【' + x.owner + '】' : '（无弹窗/抽屉/菜单归属）'));
        if (x.clip) console.log('    ⚠ 祖先裁切 = ' + x.clip + ' → 这是「视觉裁切」不是「被遮挡」');
        const likely = [];
        if (x.owner) likely.push('拦截者是已打开的面板 → 预期遮挡');
        if (x.clip) likely.push('被祖先裁切');
        if (!x.owner && !x.clip) likely.push('★ 疑似真 bug：无归属的残层挡点击');
        console.log('    初判       = ' + likely.join(' / '));
    });
    console.log('\n页面错误/日志: ' + (errs.length ? errs.join('\n  ') : '（无）'));
    await b.close();
})();
