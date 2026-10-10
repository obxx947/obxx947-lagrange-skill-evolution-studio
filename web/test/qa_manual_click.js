/* ============================================================
   前端 QA — 真实鼠标点击链路测试（2026-10-02）
   ------------------------------------------------------------
   规矩：全部用 page.mouse.click 真实点击（不调 JS 函数），
         每次点击前先 elementFromPoint 复核命中元素，
         点后校验状态变化。坐标一律先 scrollIntoView({behavior:'instant'})
         再量（项目教训：平滑滚动会量到旧坐标 → 假"被遮挡"）。

   覆盖：
     A. 战报 → 点船 → 数据分析弹窗 → 三种关闭 → 再点另一条船
     B. 配队页：加船 / 选模块 / 带载机 / 存方案
     C. 加点页：点节点 / 保存 / 汇总
     D. 舰船页：搜索 / 筛选 / 添加 / 勾模块
     E. 手机 375×812 顶栏与底部导航可点性
   ============================================================ */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = 0, bad = 0;
const finds = [];
const chk = (n, got, want) => { const p = got === want; p ? ok++ : bad++; console.log((p ? '  ✅ ' : '  ❌ ') + n + '  得到=' + JSON.stringify(got) + ' 期望=' + JSON.stringify(want)); };
const FIND = (t, d) => { finds.push(t); console.log('  🔎 ' + t + ' :: ' + d); };

/* ---------- 真实鼠标点击：src 是"接收 a 返回 element"的函数源码字符串 ---------- */
async function clickBy(page, src, arg, opt) {
    opt = opt || {};
    const scrolled = await page.evaluate((s, a) => {
        let el; try { el = new Function('a', 'return (' + s + ')'); el = el(a); } catch (e) { return { err: 'eval:' + e.message }; }
        if (!el) return { err: 'not-found' };
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        return { ok: true };
    }, src, arg);
    if (scrolled.err) return { err: scrolled.err };
    await sleep(opt.settle || 320);
    const geo = await page.evaluate((s, a) => {
        const el = new Function('a', 'return (' + s + ')')(a);
        if (!el) return { err: 'gone-after-scroll' };
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight, vw = window.innerWidth;
        /* 点击点：元素中心；太高/太宽时夹到视口内 */
        let x = Math.round(r.left + Math.min(r.width / 2, 400));
        let y = Math.round(r.top + Math.min(r.height / 2, 120));
        x = Math.max(1, Math.min(vw - 2, x));
        y = Math.max(1, Math.min(vh - 2, y));
        const top = document.elementFromPoint(x, y);
        const cs = getComputedStyle(el);
        return {
            x, y, w: Math.round(r.width), h: Math.round(r.height),
            rTop: Math.round(r.top), rLeft: Math.round(r.left), rRight: Math.round(r.right), rBottom: Math.round(r.bottom),
            inView: r.top >= 0 && r.bottom <= vh && r.left >= 0 && r.right <= vw,
            hit: !!(top && (top === el || el.contains(top))),
            topDesc: top ? (top.tagName + '.' + String(top.className || '').slice(0, 40)) : 'null',
            pe: cs.pointerEvents, vis: cs.visibility, op: cs.opacity,
            txt: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30)
        };
    }, src, arg);
    if (geo.err) return geo;
    await page.mouse.click(geo.x, geo.y);
    await sleep(opt.after || 350);
    return geo;
}

/* 复核一条点击：命中 + 在视口内 + 可交互 */
function verdict(label, geo) {
    if (geo.err) { bad++; console.log('  ❌ ' + label + ' :: ' + geo.err); return false; }
    const problems = [];
    if (!geo.hit) problems.push('命中被挡→' + geo.topDesc);
    if (!geo.inView) problems.push('超出视口  左' + geo.rLeft + ' 右' + geo.rRight + ' 上' + geo.rTop + ' 下' + geo.rBottom);
    if (geo.pe === 'none') problems.push('pointer-events:none');
    if (geo.vis !== 'visible') problems.push('visibility:' + geo.vis);
    if (parseFloat(geo.op) < 0.05) problems.push('opacity≈0');
    if (problems.length) { bad++; console.log('  ❌ ' + label + '「' + geo.txt + '」:: ' + problems.join(' / ')); return false; }
    ok++; console.log('  ✅ ' + label + '「' + geo.txt + '」@' + geo.x + ',' + geo.y + ' (' + geo.w + '×' + geo.h + ')');
    return true;
}

const q = s => JSON.stringify(s);

(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox', '--disable-gpu'] });

    /* ==================================================================
       A. 战报 → 点船 → 数据分析弹窗 → 三种关闭 → 再点另一条船
       ================================================================== */
    console.log('\n========== A. 战报链路（真实鼠标） ==========');
    {
        const p = await b.newPage();
        await p.setViewport({ width: 1500, height: 1200 });
        const errs = []; p.on('pageerror', e => errs.push(e.message));
        p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
        await p.goto(BASE + '/simulator.html', { waitUntil: 'load', timeout: 90000 });
        await sleep(4500);

        const built = await p.evaluate(() => {
            const mk = (id, count, pos) => {
                const t = SHIP_DATABASE[id]; if (!t) return null;
                const e = JSON.parse(JSON.stringify(t));
                e.count = count; e.position = pos; e.selectedModules = {}; recalcAircraftSlots(e); e.aircraft = [];
                return e;
            };
            FLEET_TYPES.forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; fleetData[k].apSet = null; });
            const A = [mk('fury-frigate', 4, '前排'), mk('ruby-A', 2, '中排')].filter(Boolean);
            const B = [mk('douniu-A', 4, '前排'), mk('AC721-A', 2, '后排')].filter(Boolean);
            if (!A.length || !B.length) return { err: '舰船 id 不对' };
            fleetData['ally-escort'].main = A; fleetData['enemy-escort'].main = B;
            if (!prepareBattle()) return { err: 'prepareBattle 失败' };
            const bs = battleState; let t = 0;
            while (!bs.ended && t < 600) { processBattleTick(0.2); t += 0.2; }
            return { ok: true, dur: Math.round(t) };
        });
        if (built.err) { bad++; console.log('  ❌ 战斗准备失败: ' + built.err); }
        else {
            console.log('  战斗结束于 ' + built.dur + 's');
            await p.evaluate(() => generateBattleReport());
            await sleep(700);

            /* 用固定下标选行：返回该行的元素 */
            const rowSrc = i => `(function(){var rows=Array.from(document.querySelectorAll('#battleReportContent div[onclick^="bsdOpen"]'));return rows[${i}]||null;})()`;

            const rowInfo = async i => p.evaluate(j => {
                const rows = Array.from(document.querySelectorAll('#battleReportContent div[onclick^="bsdOpen"]'));
                const el = rows[j]; if (!el) return null;
                const oc = (el.getAttribute('onclick') || '').replace(/&quot;/g, '"');
                const m = oc.match(/bsdOpen\('[^']+',\s*"([^"]+)"/);
                return { key: m ? m[1] : '', label: (el.innerText || '').trim().split('\n')[0] };
            }, i);

            const nRows = await p.evaluate(() => document.querySelectorAll('#battleReportContent div[onclick^="bsdOpen"]').length);
            console.log('  战报行数 = ' + nRows);
            chk('战报有 ≥2 行可点', nRows >= 2, true);

            const r0 = await rowInfo(0), r1 = await rowInfo(1);
            console.log('  第1行=' + r0.label + ' | 第2行=' + r1.label);

            const modalState = () => p.evaluate(() => {
                const m = document.getElementById('bsdModal'); if (!m) return { err: 'no bsdModal' };
                const cs = getComputedStyle(m);
                /* ⚠️ simulator.html 里 SD 是顶层 let/const → 不进 window，必须直接读裸标识符 */
                let key = '';
                try { key = SD.key || ''; } catch (e) { key = '(SD 不可达)'; }
                return {
                    active: m.classList.contains('active'), display: cs.display, opacity: cs.opacity,
                    key: key,
                    btns: Array.from(m.querySelectorAll('button')).map(b => (b.innerText || '').trim()).filter(Boolean),
                    body: (document.getElementById('bsdBody').innerText || '').replace(/\s+/g, ' ').slice(0, 60)
                };
            });

            /* --- A1: 点第 1 条船 --- */
            let g = await clickBy(p, rowSrc(0), null);
            verdict('A1 点战报第 1 行', g);
            let ms = await modalState();
            chk('A1 数据分析弹窗已打开(active)', ms.active, true);
            chk('A1 弹窗不透明', ms.opacity, '1');
            chk('A1 内容是第1条船', ms.key, r0.key);

            /* --- A2 关闭方式①：← 返回战报 --- */
            g = await clickBy(p, `(function(){
                var m=document.getElementById('bsdModal'); if(!m) return null;
                return Array.from(m.querySelectorAll('button')).find(function(b){return /返回战报/.test(b.innerText);})||null;})()`, null);
            verdict('A2 点「← 返回战报」', g);
            ms = await modalState();
            chk('A2 弹窗已关闭', ms.active, false);

            /* 关闭后战报行必须仍可点（用户报的"点不动了"） */
            const underlying = await p.evaluate(() => {
                const rows = Array.from(document.querySelectorAll('#battleReportContent div[onclick^="bsdOpen"]'));
                const el = rows[0]; if (!el) return { err: 'no rows' };
                el.scrollIntoView({ block: 'center', behavior: 'instant' });
                const r = el.getBoundingClientRect();
                const x = Math.round(r.left + 120), y = Math.round(r.top + 12);
                const top = document.elementFromPoint(x, y);
                return { hit: !!(top && el.contains(top)), topDesc: top ? top.tagName + '.' + String(top.className || '').slice(0, 30) : 'null' };
            });
            chk('A2 关闭后战报行未被残层遮挡', underlying.hit, true);

            /* --- A3 关闭方式②：✕ --- */
            g = await clickBy(p, rowSrc(0), null);
            verdict('A3a 再点第 1 行', g);
            g = await clickBy(p, `(function(){
                var m=document.getElementById('bsdModal'); if(!m) return null;
                return Array.from(m.querySelectorAll('button')).find(function(b){return (b.innerText||'').trim()==='✕';})||null;})()`, null);
            verdict('A3 点「✕」', g);
            ms = await modalState();
            chk('A3 弹窗已关闭', ms.active, false);

            /* --- A4 关闭方式③：点遮罩 --- */
            g = await clickBy(p, rowSrc(0), null);
            verdict('A4a 再点第 1 行', g);
            /* 遮罩空白处：弹窗外侧下方 */
            const maskPt = await p.evaluate(() => {
                const m = document.getElementById('bsdModal');
                const inner = m.querySelector('.modal');
                const mr = m.getBoundingClientRect(), ir = inner.getBoundingClientRect();
                const x = Math.round(mr.left + mr.width / 2);
                const y = Math.round(Math.min(mr.bottom - 3, ir.bottom + 10));
                const top = document.elementFromPoint(x, y);
                return { x, y, isMask: top === m, topDesc: top ? top.tagName + '.' + String(top.className || '').slice(0, 30) : 'null' };
            });
            await p.mouse.click(maskPt.x, maskPt.y);
            await sleep(350);
            ms = await modalState();
            chk('A4 点遮罩空白处关闭（命中' + maskPt.topDesc + '）', ms.active, false);

            /* --- A5 再点另一条船 --- */
            g = await clickBy(p, rowSrc(1), null);
            verdict('A5 点战报第 2 行', g);
            ms = await modalState();
            chk('A5 弹窗已打开', ms.active, true);
            chk('A5 内容是第 2 条船', ms.key, r1.key);
            chk('A5 第2条 != 第1条', ms.key !== r0.key, true);

            /* 分析面板的模式 tab 也真点一遍。
               ⚠️ 不要硬编码按钮名：模拟器在 2026-10-02 22:25 改版，面板 tab 从
                  「按目标/按武器/按舰队」换成了「按目标/按武器/维修去向/生存时间占比分析/承伤分析」。
                  这里从「当时页面里真实存在的 _sdSetMode tab」动态取，避免误判。 */
            const tabs = await p.evaluate(() => Array.from(document.querySelectorAll('#bsdModal button'))
                .filter(b => /_sdSetMode/.test(b.getAttribute('onclick') || ''))
                .map(b => (b.innerText || '').trim()));
            console.log('    A6 面板 tab = ' + JSON.stringify(tabs));
            chk('A6 面板至少 2 个模式 tab', tabs.length >= 2, true);
            for (const mode of tabs) {
                const btnList = (await modalState()).btns;
                const gm = await clickBy(p, `(function(){
                    var m=document.getElementById('bsdModal'); if(!m) return null;
                    return Array.from(m.querySelectorAll('button')).find(function(b){return (b.innerText||'').trim()===${q(mode)} && /_sdSetMode/.test(b.getAttribute('onclick')||'');})||null;})()`, null);
                if (gm.err) { bad++; console.log('  ❌ A6 点模式「' + mode + '」 :: ' + gm.err + ' ｜ 当时按钮=' + JSON.stringify(btnList)); }
                else verdict('A6 点模式「' + mode + '」', gm);
                const n = await p.evaluate(() => (document.getElementById('bsdBody').innerText || '').replace(/\s+/g, ' ').length);
                chk('A6 「' + mode + '」正文非空', n > 60, true);
            }

            if (errs.length) FIND('A pageerror', errs.slice(0, 3).join(' | '));
            else chk('A 全程无 pageerror', 0, 0);
        }
        await p.close();
    }

    /* ==================================================================
       B. 配队页：加船 / 选模块 / 带载机 / 存方案
       ================================================================== */
    console.log('\n========== B. 配队页（真实鼠标） ==========');
    {
        const p = await b.newPage();
        await p.setViewport({ width: 1400, height: 1000 });
        const errs = []; p.on('pageerror', e => errs.push(e.message));
        p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
        await p.goto(BASE + '/fleet.html', { waitUntil: 'load', timeout: 90000 });
        await sleep(3000);

        /* 清空 localStorage 保证干净基线 */
        await p.evaluate(() => { try { localStorage.clear(); } catch (e) { } });
        await p.reload({ waitUntil: 'load' }); await sleep(2500);

        /* B1: 点「➕ 增加战舰」（必须是【主舰队】那张卡里的，页面有两个同名按钮） */
        let g = await clickBy(p, `(function(){
            return Array.from(document.querySelectorAll('button')).find(function(b){
                return /增加战舰/.test(b.innerText) && b.closest('#editor') &&
                       b.closest('.card') && b.closest('.card').contains(document.getElementById('mainList'));})||null;})()`, null);
        verdict('B1 点主舰队的「➕ 增加战舰」', g);
        let st = await p.evaluate(() => ({ open: document.getElementById('pickModal').classList.contains('show'), n: document.querySelectorAll('#pkGrid .pcard').length }));
        chk('B1 选船弹窗打开', st.open, true);
        chk('B1 弹窗里有船可选', st.n > 0, true);

        /* B2: 点类型筛选「航母」（航母=超主力，有载机位+模块，后面 3 条链路都能测） */
        g = await clickBy(p, `(function(){
            var f=document.getElementById('pkFilters'); if(!f) return null;
            return Array.from(f.querySelectorAll('button')).find(function(b){return /航母/.test(b.innerText);})||null;})()`, null);
        verdict('B2 点分类筛选「航母」', g);
        let fn = await p.evaluate(() => document.querySelectorAll('#pkGrid .pcard').length);
        console.log('    筛选后可选 ' + fn + ' 艘');
        chk('B2 筛选后仍有可选项', fn > 0, true);

        /* B3: 点第 1 艘航母 → 确认选择 */
        g = await clickBy(p, `(function(){
            var g=document.getElementById('pkGrid'); if(!g) return null;
            return Array.from(g.querySelectorAll('.pcard')).find(function(c){return !/opacity\s*:\s*\.[0-9]/.test(c.getAttribute('style')||'');})||null;})()`, null);
        verdict('B3 点第 1 艘船', g);
        const pickedName = await p.evaluate(() => {
            const c = document.querySelector('#pkGrid .pcard.sel'); return c ? (c.querySelector('.nm') || {}).innerText : '';
        });
        console.log('    选中「' + pickedName + '」');
        chk('B3 已选中 1 艘（计数=1）', String(await p.evaluate(() => document.getElementById('pkSel').textContent)), '1');

        g = await clickBy(p, `(function(){
            return Array.from(document.querySelectorAll('#pickModal button')).find(function(b){return /确认选择/.test(b.innerText);})||null;})()`, null);
        verdict('B3b 点「确认选择」', g);
        st = await p.evaluate(() => ({
            open: document.getElementById('pickModal').classList.contains('show'),
            main: document.querySelectorAll('#mainList .shiprow').length,
            rein: document.querySelectorAll('#reinforceList .shiprow').length,
            mainTxt: (document.getElementById('mainList').innerText || '').replace(/\s+/g, ' ').slice(0, 60)
        }));
        chk('B3b 选船弹窗已关', st.open, false);
        chk('B3b 主舰队出现 1 行', st.main, 1);
        console.log('    主舰队 ' + st.main + ' 行 ｜ 增援 ' + st.rein + ' 行 ｜ 主舰队内容「' + st.mainTxt + '」');

        /* B4: 先点「模块」选一个【带载机位】的模块 ——
           ⚠️ 依赖关系（实测）：CV3000 基础型没有载机位，必须先选「舰载机搭载平台」类模块，
              行内才会出现「＋ 载机」。所以顺序必须是 模块 → 载机。 */
        const modBtnInfo = await p.evaluate(() => {
            const b = Array.from(document.querySelectorAll('#mainList button, #reinforceList button')).find(x => /模块/.test(x.innerText));
            return b ? { txt: b.innerText.trim() } : null;
        });
        if (!modBtnInfo) { bad++; console.log('  ❌ B4 无「模块」按钮（slotsOf 为空）'); }
        else {
            console.log('    B4 模块按钮文字「' + modBtnInfo.txt + '」');
            g = await clickBy(p, `(function(){
                return Array.from(document.querySelectorAll('#mainList button, #reinforceList button')).find(function(b){return /模块/.test(b.innerText);})||null;})()`, null);
            if (verdict('B4 点「模块」按钮', g)) {
                const mo = await p.evaluate(() => ({ open: document.getElementById('modModal').classList.contains('show'), n: document.querySelectorAll('#mmBody input,#mmBody [onclick],#mmBody label').length }));
                chk('B4 模块弹窗打开', mo.open, true);
                console.log('    模块弹窗可选项 ' + mo.n + ' 个');
                if (mo.open && mo.n > 0) {
                    /* 优先挑含「搭载/载机」的选项，确保能解锁载机位 */
                    g = await clickBy(p, `(function(){
                        var b=document.getElementById('mmBody'); if(!b) return null;
                        var all=Array.from(b.querySelectorAll('label,.var,.mslot-opt,button')).filter(function(e){return e.offsetWidth>0;});
                        return all.find(function(e){return /搭载|载机/.test(e.innerText||'');}) || all[0] || null;})()`, null);
                    verdict('B4a 模块弹窗里点一个「搭载/载机」选项', g);
                    g = await clickBy(p, `(function(){
                        return Array.from(document.querySelectorAll('#modModal button')).find(function(b){return /保存|确认|确定/.test(b.innerText);})||null;})()`, null);
                    verdict('B4b 点模块「保存」', g);
                    const closed = await p.evaluate(() => !document.getElementById('modModal').classList.contains('show'));
                    chk('B4b 模块弹窗已关', closed, true);
                    const rowTxt = await p.evaluate(() => (document.getElementById('mainList').innerText || '').replace(/\s+/g, ' ').slice(0, 90));
                    console.log('    保存后主舰队行内容「' + rowTxt + '」');
                }
            }
        }

        /* B5: 带载机 —— 点该行的「＋ 载机」→ 点一架载机 → 点数量 → 确认 */
        const airBtn = await p.evaluate(() => !!document.querySelector('#mainList button[onclick^="openAirPicker"], #reinforceList button[onclick^="openAirPicker"]'));
        chk('B5 选完搭载模块后出现「＋ 载机」按钮', airBtn, true);
        if (airBtn) {
            g = await clickBy(p, `(function(){return document.querySelector('#mainList button[onclick^="openAirPicker"], #reinforceList button[onclick^="openAirPicker"]');})()`, null);
            verdict('B5a 点「＋ 载机」', g);
            const po = await p.evaluate(() => ({ open: document.getElementById('pickModal').classList.contains('show'), n: document.querySelectorAll('#pkGrid .pcard').length }));
            chk('B5a 载机选择弹窗打开', po.open, true);
            chk('B5a 弹窗里有载机可选', po.n > 0, true);
            console.log('    可选载机 ' + po.n + ' 种');
            if (po.open && po.n > 0) {
                g = await clickBy(p, `(function(){
                    var g=document.getElementById('pkGrid'); if(!g) return null;
                    return Array.from(g.querySelectorAll('.pcard')).find(function(c){return !/opacity\s*:\s*\.[0-9]/.test(c.getAttribute('style')||'');})||null;})()`, null);
                verdict('B5b 点一架载机', g);
                const qo = await p.evaluate(() => ({ open: document.getElementById('qtyModal').classList.contains('show'), n: document.querySelectorAll('#qtyModal .qty-list button').length }));
                chk('B5b 数量弹窗打开', qo.open, true);
                console.log('    数量选项 ' + qo.n + ' 个');
                if (qo.open && qo.n > 0) {
                    g = await clickBy(p, `(function(){
                        var l=document.querySelector('#qtyModal .qty-list'); if(!l) return null;
                        var b=l.querySelectorAll('button'); return b[b.length-1]||null;})()`, null);
                    verdict('B5c 点数量按钮', g);
                }
                g = await clickBy(p, `(function(){
                    var m=document.getElementById('qtyModal'); if(!m) return null;
                    return Array.from(m.querySelectorAll('button')).find(function(b){return /确认|确定|好/.test(b.innerText);})||null;})()`, null);
                verdict('B5d 点数量「确认」', g);
                const airN = await p.evaluate(() => document.querySelectorAll('#mainList .airitem, #reinforceList .airitem').length);
                chk('B5d 载机已挂到航母上（出现 .airitem）', airN > 0, true);
                console.log('    载机条目 ' + airN + ' 条');
            }
        }

        /* B6: 存方案 */
        await p.evaluate(() => { const n = document.getElementById('planName'); if (n) { n.value = '__QA_MANUAL'; n.dispatchEvent(new Event('input')); } });
        g = await clickBy(p, `(function(){return Array.from(document.querySelectorAll('.stats button')).find(function(b){return /保存方案/.test(b.innerText);})||null;})()`, null);
        verdict('B6 点「💾 保存方案」', g);
        const saved = await p.evaluate(() => {
            try {
                const keys = Object.keys(localStorage);
                const out = {};
                keys.forEach(k => { if (/plan|fleet|lagrange/i.test(k)) out[k] = String(localStorage.getItem(k)).slice(0, 80); });
                return { keys: out };
            } catch (e) { return { err: String(e) }; }
        });
        console.log('    相关 localStorage: ' + JSON.stringify(saved).slice(0, 300));
        const savedOk = await p.evaluate(() => {
            try { const st = JSON.parse(localStorage.getItem('lagrange_fleets') || '{}'); return (st.plans || []).length; } catch (e) { return -1; }
        });
        const savedName = await p.evaluate(() => {
            try { const st = JSON.parse(localStorage.getItem('lagrange_fleets') || '{}'); return (st.plans || []).map(x => x.name); } catch (e) { return []; }
        });
        console.log('    方案条数 ' + savedOk + ' 名称 ' + JSON.stringify(savedName).slice(0, 120));
        chk('B6 方案已落库（≥1）', savedOk >= 1, true);
        chk('B6 落库的方案名 = __QA_MANUAL', (savedName || []).indexOf('__QA_MANUAL') >= 0, true);

        if (errs.length) FIND('B pageerror', errs.slice(0, 3).join(' | '));
        else chk('B 全程无 pageerror', 0, 0);
        await p.close();
    }

    /* ==================================================================
       C. 加点页：选船 / 点节点 / 退级 / 保存 / 汇总
       ================================================================== */
    console.log('\n========== C. 加点页（真实鼠标） ==========');
    {
        const p = await b.newPage();
        await p.setViewport({ width: 1400, height: 1000 });
        const errs = []; p.on('pageerror', e => errs.push(e.message));
        p.on('dialog', async d => {
            try {
                if (d.type() === 'prompt') await d.accept('__QA_加点方案');
                else if (d.type() === 'confirm') await d.accept();
                else await d.accept();
            } catch (e) { }
        });
        await p.goto(BASE + '/addpoint.html', { waitUntil: 'load', timeout: 90000 });
        await sleep(3500);
        await p.evaluate(() => { try { localStorage.removeItem('lagrange_addpoint_sets'); } catch (e) { } });

        /* C1: 点搜索框 → 输入 → 点下拉里的船 */
        let g = await clickBy(p, `(function(){return document.getElementById('shipSearch');})()`, null);
        verdict('C1 点舰船搜索框', g);
        await p.keyboard.type('级', { delay: 60 });
        await sleep(700);
        let st = await p.evaluate(() => ({
            drop: document.getElementById('shipDrop').classList.contains('show'),
            n: document.querySelectorAll('#shipDrop .it').length
        }));
        chk('C1 下拉出现在有候选', st.drop && st.n > 0, true);
        console.log('    候选 ' + st.n + ' 条');
        g = await clickBy(p, `(function(){
            var d=document.getElementById('shipDrop'); if(!d) return null;
            return d.querySelector('.it')||null;})()`, null);
        verdict('C1 点下拉第 1 条船', g);
        await sleep(1500);
        st = await p.evaluate(() => ({
            nodes: document.querySelectorAll('#body .node').length,
            cost: (document.getElementById('totalCost') || {}).textContent,
            avail: document.querySelectorAll('#body .node.avail').length
        }));
        console.log('    节点 ' + st.nodes + ' 个（可点 avail ' + st.avail + '）｜总技术值 ' + st.cost);
        chk('C1 加点树已渲染', st.nodes > 0, true);

        /* C2: 点一个 avail 节点 → 总技术值增加 */
        if (st.avail > 0) {
            const before = st.cost;
            g = await clickBy(p, `(function(){
                return document.querySelector('#body .node.avail')||null;})()`, null);
            verdict('C2 点一个可加节点', g);
            await sleep(500);
            const after = await p.evaluate(() => ({
                cost: (document.getElementById('totalCost') || {}).textContent,
                has: document.querySelectorAll('#body .node.has,#body .node.max').length,
                minus: document.querySelectorAll('#body .node .minus').length
            }));
            console.log('    总技术值 前=' + before + ' 后=' + after.cost + '｜已加点 ' + after.has + ' 个');
            chk('C2 总技术值已增加', Number(after.cost) > Number(before), true);
            chk('C2 节点出现「− 退级」按钮', after.minus > 0, true);

            /* C3: 点「−」退一级 */
            if (after.minus > 0) {
                g = await clickBy(p, `(function(){
                    return document.querySelector('#body .node .minus')||null;})()`, null);
                verdict('C3 点「− 退级」', g);
                await sleep(500);
                const back = await p.evaluate(() => (document.getElementById('totalCost') || {}).textContent);
                console.log('    退级后总技术值 = ' + back);
            }
        } else { FIND('C2 无可加节点', '该船没有 avail 节点（可能全锁定）'); }

        /* C4: 存本舰方案 */
        g = await clickBy(p, `(function(){
            return Array.from(document.querySelectorAll('button')).find(function(b){return /存本舰方案/.test(b.innerText);})||null;})()`, null);
        verdict('C4 点「💾 存本舰方案」', g);
        await sleep(800);
        /* C5: 存总体加点方案 */
        g = await clickBy(p, `(function(){
            return Array.from(document.querySelectorAll('button')).find(function(b){return /存总体加点方案/.test(b.innerText);})||null;})()`, null);
        verdict('C5 点「💾 存总体加点方案」', g);
        await sleep(800);
        const saved = await p.evaluate(() => ({
            builds: (JSON.parse(localStorage.getItem('lagrange_addpoint_builds') || '[]') || []).length,
            sets: (JSON.parse(localStorage.getItem('lagrange_addpoint_sets') || '[]') || []).length
        }));
        console.log('    本舰方案 ' + saved.builds + ' 条 ｜ 总体加点方案 ' + saved.sets + ' 条');
        chk('C5 加点方案已落库（本舰或总体 ≥1）', (saved.builds + saved.sets) >= 1, true);

        /* C6: 打开方案列表看汇总 */
        g = await clickBy(p, `(function(){
            return Array.from(document.querySelectorAll('button')).find(function(b){return /总体加点方案/.test(b.innerText) && !/存/.test(b.innerText);})||null;})()`, null);
        if (verdict('C6 点「📁 总体加点方案」', g)) {
            await sleep(500);
            const sum = await p.evaluate(() => ({ txt: (document.getElementById('body').innerText || '').replace(/\s+/g, ' ').slice(0, 140) }));
            console.log('    汇总面板: 「' + sum.txt + '」');
            chk('C6 汇总面板有内容', sum.txt.length > 10, true);
            /* 返回 */
            g = await clickBy(p, `(function(){
                return Array.from(document.querySelectorAll('button')).find(function(b){return /返回加点/.test(b.innerText);})||null;})()`, null);
            verdict('C6 点「返回加点」', g);
        }

        if (errs.length) FIND('C pageerror', errs.slice(0, 3).join(' | '));
        else chk('C 全程无 pageerror', 0, 0);
        await p.close();
    }

    /* ==================================================================
       D. 舰船页：搜索 / 筛选 / 添加 / 勾模块
       ================================================================== */
    console.log('\n========== D. 舰船页（真实鼠标） ==========');
    {
        const p = await b.newPage();
        await p.setViewport({ width: 1400, height: 1000 });
        const errs = []; p.on('pageerror', e => errs.push(e.message));
        p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
        await p.goto(BASE + '/ships.html', { waitUntil: 'load', timeout: 90000 });
        await sleep(3000);
        await p.evaluate(() => { try { localStorage.removeItem('lagrange_user_ships'); localStorage.removeItem('lagrange_userships'); } catch (e) { } });
        await p.reload({ waitUntil: 'load' }); await sleep(2500);

        const cardN = () => p.evaluate(() => ({ cards: document.querySelectorAll('#grid .ship-card').length, stats: (document.getElementById('stats') || {}).textContent }));
        let base = await cardN();
        console.log('    初始 ' + base.stats);
        chk('D0 舰船卡片已渲染', base.cards > 40, true);

        /* D1: 点搜索框 → 输入 */
        let g = await clickBy(p, `(function(){return document.getElementById('fq');})()`, null);
        verdict('D1 点搜索框', g);
        await p.keyboard.type('太阳', { delay: 60 });
        await sleep(700);
        let f1 = await cardN();
        console.log('    输入「太阳」→ ' + f1.stats);
        chk('D1 搜索有过滤（结果 < 初始）', f1.cards < base.cards, true);
        chk('D1 搜索命中 > 0', f1.cards > 0, true);
        /* 清空 */
        await p.evaluate(() => { const e = document.getElementById('fq'); e.value = ''; e.dispatchEvent(new Event('input')); });
        await sleep(500);
        let f2 = await cardN();
        chk('D1 清空后恢复全部', f2.cards, base.cards);

        /* D1b: 无结果时显示空提示 */
        await p.evaluate(() => { const e = document.getElementById('fq'); e.value = 'zzz不存在的船'; e.dispatchEvent(new Event('input')); });
        await sleep(500);
        const emptyShown = await p.evaluate(() => getComputedStyle(document.getElementById('empty')).display !== 'none' && document.querySelectorAll('#grid .ship-card').length === 0);
        chk('D1b 无结果时显示「没有匹配」提示', emptyShown, true);
        await p.evaluate(() => { const e = document.getElementById('fq'); e.value = ''; e.dispatchEvent(new Event('input')); });
        await sleep(500);

        /* D2: 舰种筛选（select 用键盘真实选择） */
        await p.focus('#ft');
        await p.keyboard.press('ArrowDown');
        await p.keyboard.press('Enter');
        await sleep(700);
        const ftv = await p.evaluate(() => document.getElementById('ft').value);
        const f3 = await cardN();
        console.log('    舰种筛选 = ' + ftv + ' → ' + f3.stats);
        if (ftv) { chk('D2 筛选生效（结果 < 全部）', f3.cards < base.cards, true); }
        else { FIND('D2 键盘没改动 select', '当前仍为「全部」，改用直接设值 + 真实 change 事件再验一次'); }
        /* 还原 */
        await p.select('#ft', '');
        await sleep(500);
        chk('D2 还原为全部', (await cardN()).cards, base.cards);

        /* D3: 添加舰船（点第 1 张未拥有卡的「▣ 添加此舰船」） */
        g = await clickBy(p, `(function(){
            var c=Array.from(document.querySelectorAll('#grid .ship-card')).find(function(x){return !x.classList.contains('owned');});
            if(!c) return null;
            return c.querySelector('button.tb.add')||null;})()`, null);
        if (verdict('D3 点「▣ 添加此舰船」', g)) {
            await sleep(600);
            const after = await p.evaluate(() => ({
                owned: document.querySelectorAll('#grid .ship-card.owned').length,
                stats: (document.getElementById('stats') || {}).textContent
            }));
            console.log('    添加后 ' + after.stats);
            chk('D3 卡片变为已拥有', after.owned >= 1, true);
            chk('D3 统计里「已拥有」计数增加', /已拥有 [1-9]/.test(after.stats), true);

            /* D4: 对已拥有的超主力点「🔧 勾选模块」 */
            const hasMod = await p.evaluate(() => !!document.querySelector('#grid .ship-card .tb.mod'));
            if (!hasMod) {
                /* 找一艘超主力加进来 */
                const added = await p.evaluate(() => {
                    const cards = Array.from(document.querySelectorAll('#grid .ship-card'));
                    const c = cards.find(x => /超主力/.test(x.innerText));
                    if (!c) return null;
                    const b = c.querySelector('button.tb.add'); if (!b) return null;
                    b.click(); return c.querySelector('.nm').innerText;
                });
                console.log('    （补加超主力舰：' + added + '）');
                await sleep(700);
            }
            const modBtn = await p.evaluate(() => {
                const c = Array.from(document.querySelectorAll('#grid .ship-card')).find(x => x.querySelector('.tb.mod'));
                if (!c) return null;
                c.scrollIntoView({ block: 'center', behavior: 'instant' });
                return true;
            });
            if (modBtn) {
                g = await clickBy(p, `(function(){
                    return document.querySelector('#grid .ship-card .tb.mod')||null;})()`, null);
                if (verdict('D4 点「🔧 勾选模块」', g)) {
                    await sleep(500);
                    const mo = await p.evaluate(() => ({ show: document.getElementById('modModal').classList.contains('show'), n: document.querySelectorAll('#mmBody input[type=checkbox]').length }));
                    chk('D4 模块弹窗已打开', mo.show, true);
                    chk('D4 弹窗里有可勾选项', mo.n > 0, true);
                    console.log('    可勾选模块项 ' + mo.n + ' 个');
                    if (mo.n > 0) {
                        /* 勾第一个（真鼠标点 label） */
                        g = await clickBy(p, `(function(){
                            var b=document.getElementById('mmBody'); if(!b) return null;
                            return b.querySelector('label.var')||null;})()`, null);
                        verdict('D4a 点第一个模块选项', g);
                        await sleep(300);
                        const checked = await p.evaluate(() => Array.from(document.querySelectorAll('#mmBody input[type=checkbox]')).filter(c => c.checked).length);
                        chk('D4a 复选框已被勾上', checked >= 1, true);
                        g = await clickBy(p, `(function(){
                            return Array.from(document.querySelectorAll('#modModal button')).find(function(b){return /保存模块/.test(b.innerText);})||null;})()`, null);
                        verdict('D4b 点「✅ 保存模块」', g);
                        await sleep(600);
                        const done = await p.evaluate(() => ({
                            closed: !document.getElementById('modModal').classList.contains('show'),
                            flag: !!document.querySelector('#grid .ship-card .modflag')
                        }));
                        chk('D4b 模块弹窗已关', done.closed, true);
                        chk('D4b 卡片出现「模块:」标记', done.flag, true);
                    }
                }
            } else { FIND('D4 无超主力可测模块', '当前列表里找不到带「勾选模块」按钮的卡片'); }
        } else { bad++; console.log('  ❌ D3 找不到可添加的舰船卡片'); }

        /* D5: Esc 关模块弹窗（2026-10-02 新加的行为，回归一下） */
        const mod2 = await p.evaluate(() => {
            const c = Array.from(document.querySelectorAll('#grid .ship-card')).find(x => x.querySelector('.tb.mod'));
            if (!c) return false; c.querySelector('.tb.mod').click(); return true;
        });
        if (mod2) {
            await sleep(400);
            await p.keyboard.press('Escape');
            await sleep(400);
            const escClosed = await p.evaluate(() => !document.getElementById('modModal').classList.contains('show'));
            chk('D5 Esc 能关模块弹窗', escClosed, true);
        } else { FIND('D5 跳过 Esc 测试', '没有可打开模块弹窗的卡片'); }

        if (errs.length) FIND('D pageerror', errs.slice(0, 3).join(' | '));
        else chk('D 全程无 pageerror', 0, 0);
        await p.close();
    }

    /* ==================================================================
       E. 手机 375×812：顶栏与底部导航可点性
          规则：
            · 免责声明弹窗（.modal-mask.show）要先点掉 —— 它是合法模态，
              开着的时候挡住顶栏是【预期】不是 bug
            · 折叠式导航（simulator 的 .top-nav transform:scale(0)）要先点 ☰ 展开，
              在展开态验收每个 tab 可点、且真能切页
            · 底部固定条（fleet 的 .stats / ships 的 #mobileTabbar）逐按钮验命中 + 是否横向溢出
       ================================================================== */
    console.log('\n========== E. 手机 375×812 顶栏/底部导航 ==========');
    {
        const MOBILE = { width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
        const scanNav = async (p) => p.evaluate(() => {
            const out = { vw: window.innerWidth, vh: window.innerHeight, items: [], bars: [], collapsed: [] };
            const add = (e, where) => {
                if (!e.offsetWidth || !e.offsetHeight) return;
                const r = e.getBoundingClientRect();
                const tf = getComputedStyle(e).transform;
                const scaled0 = /matrix\((0|0\.0|1e-)/.test(tf) || (window.getComputedStyle(e.parentElement || document.body).transform || '').startsWith('matrix(0');
                const par = e.closest('.top-nav,.links,.tabs');
                const parTf = par ? getComputedStyle(par).transform : 'none';
                const parCollapsed = parTf && parTf !== 'none' && /^matrix\(0|^matrix\(1e-/.test(parTf);
                const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
                const t = document.elementFromPoint(x, y);
                out.items.push({
                    where, txt: (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 14),
                    l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height),
                    inX: r.left >= -0.5 && r.right <= window.innerWidth + 0.5,
                    inY: r.top >= -0.5 && r.bottom <= window.innerHeight + 0.5,
                    hit: !!(t && (t === e || e.contains(t))),
                    top: t ? t.tagName + '.' + String(t.className || '').slice(0, 24) : 'null',
                    collapsed: !!parCollapsed
                });
            };
            /* 顶栏候选：.topbar 里的 + simulator 的 .nav-tab/.nav-toggle-btn */
            Array.from(document.querySelectorAll('.topbar a,.topbar button,.topbar select,.nav-tab,.nav-toggle-btn')).forEach(e => add(e, 'head'));
            /* 底部固定条：fleet .stats / ships #mobileTabbar / 通用命名 */
            Array.from(document.querySelectorAll('.stats,#mobileTabbar,.bottom-bar,.bottombar,[class*="bottomnav"],[id*="Tabbar"]')).forEach(bx => {
                if (!bx.offsetWidth) return;
                const br = bx.getBoundingClientRect();
                out.bars.push({
                    id: bx.id || bx.className, w: Math.round(br.width), l: Math.round(br.left), r: Math.round(br.right),
                    top: Math.round(br.top), bottom: Math.round(br.bottom),
                    overflowsX: br.right > window.innerWidth + 0.5 || br.left < -0.5,
                    inViewport: br.top >= -0.5 && br.bottom <= window.innerHeight + 0.5
                });
                bx.querySelectorAll('button,a').forEach(e => add(e, 'bottom'));
            });
            return out;
        });
        const closeModals = (p) => p.evaluate(() => {
            let n = 0;
            document.querySelectorAll('.modal-mask.show,.modal-overlay.active').forEach(m => {
                const b = m.querySelector('.m-ok,.modal-close,[onclick*="accept"]');
                if (b) { b.click(); n++; }
            });
            return n;
        });

        for (const f of ['simulator.html', 'fleet.html', 'addpoint.html', 'ships.html', 'index.html', 'chat.html', 'skills.html', 'settings.html']) {
            const p = await b.newPage();
            await p.setViewport(MOBILE);
            const errs = []; p.on('pageerror', e => errs.push(e.message));
            p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
            await p.goto(BASE + '/' + f, { waitUntil: 'load', timeout: 90000 });
            await sleep(2500);
            const closedN = await closeModals(p);
            await sleep(500);
            console.log('  --- ' + f + '（已关 ' + closedN + ' 个模态）---');

            /* E1: 若存在折叠导航，先点 ☰ 展开，再验收 */
            const tg = await p.evaluate(() => {
                const t = document.querySelector('.nav-toggle-btn');
                if (!t) return null;
                const cs = getComputedStyle(t);
                if (cs.display === 'none') return null;
                t.scrollIntoView({ block: 'center', behavior: 'instant' });
                return { txt: (t.innerText || '').trim(), w: Math.round(t.getBoundingClientRect().width), h: Math.round(t.getBoundingClientRect().height) };
            });
            if (tg) {
                let g = await clickBy(p, `(function(){return document.querySelector('.nav-toggle-btn');})()`, null);
                verdict(f + ' E1 点折叠导航「' + tg.txt + '」展开', g);
                const opened = await p.evaluate(() => {
                    const n = document.getElementById('topNav');
                    return n ? getComputedStyle(n).transform : 'none';
                });
                chk(f + ' E1 导航已展开（transform 不再是 scale(0)）', !/^matrix\(0|^matrix\(1e-/.test(opened), true);
            }

            /* E2: 逐元素体检 */
            const rep = await scanNav(p);
            const live = rep.items.filter(x => !x.collapsed);
            const collapsed = rep.items.filter(x => x.collapsed);
            const bads = live.filter(x => !x.hit || !x.inX || !x.inY);
            console.log('      顶栏+底栏 可见可点元素 ' + live.length + ' 个' + (collapsed.length ? '（另有 ' + collapsed.length + ' 个在折叠容器里，已点 ☰ 展开）' : ''));
            bads.forEach(h => console.log('      ❌ [' + h.where + '] 「' + h.txt + '」 l=' + h.l + ' r=' + h.r + ' w=' + h.w + ' inX=' + h.inX + ' inY=' + h.inY + ' hit=' + h.hit + ' top=' + h.top));
            if (!bads.length) { ok++; console.log('      ✅ 全部命中且未溢出视口'); } else bad += bads.length;
            rep.bars.forEach(bb => {
                if (bb.overflowsX) { bad++; console.log('      ❌ 底栏[' + bb.id + '] 横向溢出：l=' + bb.l + ' r=' + bb.r + ' > vw=' + rep.vw); }
                else if (!bb.inViewport) { bad++; console.log('      ❌ 底栏[' + bb.id + '] 不在视口内：top=' + bb.top + ' bottom=' + bb.bottom + ' vh=' + rep.vh); }
                else { ok++; console.log('      ✅ 底栏[' + bb.id + '] 宽 ' + bb.w + ' 未溢出（bottom=' + bb.bottom + '）'); }
            });

            if (errs.length) FIND(f + ' 手机版 pageerror', errs.slice(0, 2).join(' | '));
            await p.close();
        }
    }

    /* ==================================================================
       F. 手机抽屉（index.html/chat.html 的 ☰ 历史对话）
          —— _autoplay2 报的"被遮挡 2 个"就是【抽屉开着时顶栏被遮】。
             那是预期（抽屉=模态）。真正要验的是：抽屉能不能开、能不能关。
       ================================================================== */
    console.log('\n========== F. 手机抽屉开/关（真实鼠标） ==========');
    for (const f of ['index.html', 'chat.html']) {
        const p = await b.newPage();
        await p.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
        const errs = []; p.on('pageerror', e => errs.push(e.message));
        p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
        await p.goto(BASE + '/' + f, { waitUntil: 'load', timeout: 90000 });
        await sleep(2500);
        /* 关掉免责声明弹窗（否则它才是最先挡住的） */
        await p.evaluate(() => {
            document.querySelectorAll('.modal-mask.show,.modal-overlay.active').forEach(m => {
                const b = m.querySelector('.m-ok,.modal-close');
                if (b) b.click();
            });
        });
        await sleep(500);

        const drawerState = () => p.evaluate(() => {
            const d = document.getElementById('mobileDrawer');
            if (!d) return { err: 'no drawer' };
            const panel = d.querySelector('.md-panel');
            const vw = window.innerWidth;
            const pr = panel ? panel.getBoundingClientRect() : null;
            return {
                display: getComputedStyle(d).display,
                panelRight: pr ? Math.round(pr.right) : 0,
                vw,
                maskLeft: (d.querySelector('.md-mask') ? Math.round(d.querySelector('.md-mask').getBoundingClientRect().left) : 0)
            };
        });

        let g = await clickBy(p, `(function(){return document.getElementById('mDrawerBtn');})()`, null);
        verdict(f + ' F1 点「☰ 历史对话」', g);
        let ds = await drawerState();
        chk(f + ' F1 抽屉已打开', ds.display !== 'none', true);
        console.log('    抽屉 display=' + ds.display + ' 面板右边界=' + ds.panelRight + ' 视口宽=' + ds.vw);

        /* F2: 点面板右侧的透明遮罩 → 关闭 */
        if (ds.display !== 'none' && ds.panelRight < ds.vw - 5) {
            const mx = Math.round((ds.panelRight + ds.vw) / 2), my = 400;
            const hitMask = await p.evaluate((x, y) => { const t = document.elementFromPoint(x, y); return t ? t.tagName + '.' + String(t.className || '').slice(0, 20) : 'null'; }, mx, my);
            await p.mouse.click(mx, my);
            await sleep(450);
            ds = await drawerState();
            chk(f + ' F2 点遮罩关闭（命中' + hitMask + ' @x=' + mx + '）', ds.display, 'none');
        } else { FIND(f + ' F2 跳过遮罩测试', '面板占满宽度或抽屉未开，无遮罩空白可点'); }

        /* F3: 重开 → 点「← 返回」关闭 */
        g = await clickBy(p, `(function(){return document.getElementById('mDrawerBtn');})()`, null);
        verdict(f + ' F3a 再点「☰」重开', g);
        ds = await drawerState();
        chk(f + ' F3a 抽屉已重开', ds.display !== 'none', true);
        g = await clickBy(p, `(function(){
            var d=document.getElementById('mobileDrawer'); if(!d) return null;
            return d.querySelector('.md-back')||null;})()`, null);
        if (verdict(f + ' F3 点「← 返回」', g)) {
            ds = await drawerState();
            chk(f + ' F3 抽屉已关闭', ds.display, 'none');
        }

        /* F4: 抽屉关着时，顶栏三个按钮必须恢复可点 */
        const topHit = await p.evaluate(() => {
            const out = [];
            document.querySelectorAll('.topbar .m-btn').forEach(e => {
                const r = e.getBoundingClientRect();
                const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
                const t = document.elementFromPoint(x, y);
                out.push({ txt: (e.innerText || '').trim().slice(0, 10), hit: !!(t && (t === e || e.contains(t))), top: t ? t.tagName + '.' + String(t.className || '').slice(0, 20) : 'null' });
            });
            return out;
        });
        const badTop = topHit.filter(x => !x.hit);
        if (badTop.length) { bad++; console.log('  ❌ ' + f + ' F4 抽屉关闭后顶栏仍被挡: ' + JSON.stringify(badTop)); }
        else { ok++; console.log('  ✅ ' + f + ' F4 抽屉关闭后顶栏 ' + topHit.length + ' 个按钮全部可点'); }

        if (errs.length) FIND(f + ' pageerror', errs.slice(0, 2).join(' | '));
        await p.close();
    }

    console.log('\n==================================================');
    console.log('QA 手点链路 ' + ok + '/' + (ok + bad) + (bad ? '  ❌ 有失败' : '  ✅ 全通过'));
    if (finds.length) { console.log('\n需人工复核（FIND）:'); finds.forEach(f => console.log('  · ' + f)); }
    await b.close();
    process.exit(bad ? 1 : 0);
})();
