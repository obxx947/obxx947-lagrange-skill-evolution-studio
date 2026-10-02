/* ============================================================
   战报弹窗可点性回归（2026-10-02 用户报的 bug）
   ------------------------------------------------------------
   症状：战报弹出来后，点一次舰船详情就"什么都点不动/开不了别的船"。
   真因：`bsdOpen` 只写 m.style.display='flex'，而 CSS 把 opacity:1 挂在
        `.modal-overlay.active` 上 → 弹窗【全屏透明但仍拦截点击】（z-index 2000）。

   本测试全部用**真实鼠标点击**（项目教训：内联事件必须真 dispatch，直接调函数会绕过 bug）：
     1. 战报打开时，战报里的行必须"点得到"（elementFromPoint 命中行本身）
     2. 点第 1 条船 → 数据分析弹窗 active + opacity 1 + 显示的是这条船
     3. 弹窗打开时不会把底下的战报挡住之后无法返回（← 返回战报 / ✕ / 点遮罩都能关）
     4. 关掉后再点第 2 条船 → 能打开，且内容是第 2 条船（用户说的"开不了别的船"）
   ============================================================ */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = 0, bad = 0;
const chk = (n, got, want) => { const p = got === want; p ? ok++ : bad++; console.log((p ? '  ✅ ' : '  ❌ ') + n + '  得到=' + got + ' 期望=' + want); };

(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    await p.setViewport({ width: 1500, height: 1200 });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
    await p.goto(BASE + '/simulator.html', { waitUntil: 'load', timeout: 90000 });
    await sleep(4500);

    /* 跑一场小船对撞（有双方战报行就行） */
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
        return { ok: true, dur: Math.round(t), rows: Object.keys((bs.stat.ally || {}).per || {}).length };
    });
    if (built.err) { console.log('  ❌ ' + built.err); await b.close(); process.exit(1); }
    console.log('  战斗 ' + built.dur + 's，我方战报行 ' + built.rows + ' 条');

    /* 打开战报 */
    await p.evaluate(() => generateBattleReport());
    await sleep(600);

    const geom = async (idx) => {
        /* ⚠️ 先滚到可视区、等滚动稳定后再量坐标（否则量到的是滚动前的位置 → 会点到别的行） */
        await p.evaluate((i) => {
            const rows = Array.from(document.querySelectorAll('#battleReportContent div[onclick^="bsdOpen"]'));
            if (rows[i]) rows[i].scrollIntoView({ block: 'center' });
        }, idx);
        await sleep(400);
        return p.evaluate((i) => {
        const rows = Array.from(document.querySelectorAll('#battleReportContent div[onclick^="bsdOpen"]'));
        if (rows.length <= i) return { err: '只有 ' + rows.length + ' 行' };
        const el = rows[i];
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        const x = Math.round(r.left + Math.min(120, r.width / 2)), y = Math.round(r.top + 12);
        const top = document.elementFromPoint(x, y);
        /* 从行上的 onclick 里取出舰名（最可靠的"我点的是哪条船"） */
        const oc = (rows[i].getAttribute('onclick') || '').replace(/&quot;/g, '"');
        const mm = oc.match(/bsdOpen\('[^']+',\s*"([^"]+)"/);
        return { x, y, n: rows.length, blocked: !el.contains(top),
                 topTag: top ? (top.tagName + '.' + (top.className || '').toString().slice(0, 30)) : 'null',
                 key: mm ? mm[1] : '',
                 label: (rows[i].innerText || '').trim().split('\n')[0] };
        }, idx);
    };

    console.log('== 1) 战报里的行必须点得到 ==');
    const g0 = await geom(0);
    chk('战报里第 1 行没有被别的层挡住', g0.blocked, false);
    console.log('     （第1行=「' + g0.label + '」，共 ' + g0.n + ' 行）');

    /* ★ 结构断言：行之间不能互相嵌套（原来行 div 没闭合 → 点第 N 行会冒泡到第 1 行） */
    const nest = await p.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('#battleReportContent div[onclick^="bsdOpen"]'));
        let inner = 0;
        rows.forEach(r => { if (r.querySelector('div[onclick^="bsdOpen"]')) inner++; });
        return { n: rows.length, nested: inner };
    });
    chk('战报行互不嵌套（嵌套行数=0）', nest.nested, 0);

    /* ★ 可点性断言：弹窗里所有可见按钮都要点得到（防"整片被透明层挡住"） */
    const btns = await p.evaluate(() => {
        const out = [];
        document.querySelectorAll('#battleReportModal button').forEach(b => {
            const r = b.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) return;
            const t = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
            out.push({ txt: (b.innerText || '').trim().slice(0, 8), ok: !!t && (t === b || b.contains(t)) });
        });
        return out;
    });
    chk('战报里的按钮全部可点（' + btns.length + ' 个）', btns.every(x => x.ok), true);
    if (!btns.every(x => x.ok)) console.log('     ' + JSON.stringify(btns.filter(x => !x.ok)));

    /* ★ 滚动断言（用户说"无法移动"）：战报能滚 */
    const sc = await p.evaluate(() => {
        const m = document.querySelector('#battleReportModal .modal');
        const before = m.scrollTop;
        m.scrollTop = 9999;
        const after = m.scrollTop;
        return { canScroll: m.scrollHeight > m.clientHeight, moved: after > before };
    });
    chk('战报可以滚动（内容高于容器时）', sc.canScroll ? sc.moved : true, true);
    await p.evaluate(() => { const m = document.querySelector('#battleReportModal .modal'); m.scrollTop = 0; });

    /* 真实鼠标点第 1 行 */
    await p.mouse.click(g0.x, g0.y);
    await sleep(500);
    const st1 = await p.evaluate(() => {
        const m = document.getElementById('bsdModal');
        const cs = getComputedStyle(m);
        const body = document.getElementById('bsdBody');
        let sd = ''; try { sd = (typeof SD !== 'undefined' && SD.key) || ''; } catch (e) { }
        return { active: m.classList.contains('active'), disp: cs.display, op: cs.opacity,
                 sdkey: sd, shown: (body.innerText || '') };
    });
    console.log('== 2) 点第 1 条船 → 数据分析弹窗 ==');
    chk('弹窗带上 active 类', st1.active, true);
    chk('弹窗 display = flex', st1.disp, 'flex');
    chk('弹窗不透明（opacity ≈ 1）', Math.round(parseFloat(st1.op) * 100) / 100, 1);
    chk('弹窗内容 = 刚点的那条船（SD.key）', st1.sdkey, g0.key);
    chk('弹窗正文出现该舰名', st1.shown.includes(g0.key.replace(/级.*$/, '')), true);
    console.log('     点的是「' + g0.key + '」→ 弹窗 SD.key=「' + st1.sdkey + '」');
    console.log('     弹窗首行="' + st1.shown.slice(0, 40) + '"');

    console.log('== 3) 关闭方式（← 返回战报 / ✕ / 点遮罩）==');
    const closed = async (how) => {
        await p.evaluate(() => closeModal('bsdModal'));
        await sleep(200);
        return p.evaluate(() => document.getElementById('bsdModal').classList.contains('active'));
    };
    chk('closeModal 后 active 被移除', await closed('fn'), false);
    /* 点遮罩（背景）关闭 */
    await p.mouse.click(g0.x, g0.y); await sleep(400);
    await p.mouse.click(8, 8);   // 左上角 = 遮罩背景区
    await sleep(300);
    chk('点遮罩空白处能关闭弹窗', await p.evaluate(() => document.getElementById('bsdModal').classList.contains('active')), false);

    console.log('== 4) 关掉后必须能打开【另一条船】（用户报的"开不了别的船"）==');
    const g1 = await geom(1);
    chk('第 2 行没有被挡住', g1.blocked, false);
    if (!g1.err) {
        await p.mouse.click(g1.x, g1.y);
        await sleep(500);
        const st2 = await p.evaluate(() => {
            const m = document.getElementById('bsdModal');
            let sd = ''; try { sd = (typeof SD !== 'undefined' && SD.key) || ''; } catch (e) { }
            return { active: m.classList.contains('active'), op: getComputedStyle(m).opacity,
                     sdkey: sd, shown: (document.getElementById('bsdBody').innerText || '') };
        });
        chk('第 2 条船也能打开（弹窗 active）', st2.active, true);
        chk('第 2 条的内容 = 它自己（SD.key）', st2.sdkey, g1.key);
        chk('第 2 条 != 第 1 条', st2.sdkey !== st1.sdkey, true);
        console.log('     点的是「' + g1.key + '」→ 弹窗 SD.key=「' + st2.sdkey + '」');
    }
    if (errs.length) console.log('  ⚠ pageerror: ' + errs.slice(0, 3).join(' | '));
    console.log('');
    console.log('== 战报弹窗回归 ' + ok + '/' + (ok + bad) + ' ==' + (bad ? '  ❌ 有失败' : '  ✅ 全通过'));
    await b.close();
    process.exit(bad ? 1 : 0);
})();
