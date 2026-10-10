/* 自定义舰船弹窗（配队页版）验收：①弹窗/表单/AI面板存在 ②保存→localStorage+ALL ③AI对话→json→白名单写入→机制列表 ④编辑数据 ⑤删机制
   ⑥simulator 主菜单已删、默认落在舰队配队 ⑦chat 页有战斗模拟直达。LLM 用 stub，不花真钱。 */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 180000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));

    /* ---------- fleet.html ---------- */
    await p.goto('http://127.0.0.1:3888/fleet.html', { waitUntil: 'load' });
    await sleep(3000);
    const r1 = await p.evaluate(async () => {
        const has = { CustomShip: typeof CustomShip, MechSpec: typeof MechSpec, btn: typeof CustomShip.open === 'function' };
        CustomShip.open();
        const ov = document.getElementById('customShipOverlay');
        const shown = ov && ov.classList.contains('show');
        const hasForm = !!(document.getElementById('csName') && document.getElementById('csWeapons') && document.getElementById('csChat') && document.getElementById('csMechList'));
        /* 保存一艘 */
        document.getElementById('csName').value = 'AI测试舰';
        document.getElementById('csHp').value = '123456';
        CustomShip.save();
        const all = JSON.parse(localStorage.getItem('lagrange_custom_ships') || '{}');
        const id = Object.keys(all).find(k => all[k].name === 'AI测试舰');
        const onPage = (typeof ALLMAP !== 'undefined') && ALLMAP[id] && ALLMAP[id].hp === 123456;
        return { has, shown, hasForm, saved: !!id, id, onPage, subTitle: document.getElementById('csSubTitle').textContent };
    });
    console.log('① 弹窗/表单：', JSON.stringify(r1.has), '｜shown =', r1.shown, '｜表单全 =', r1.hasForm, '｜保存 =', r1.saved, '｜配队页认得(ALLMAP) =', r1.onPage);

    const r2 = await p.evaluate(async (id) => {
        /* stub fetch：返回带 json 代码块的回答（1 条合法 + 1 条非法字段） */
        window.fetch = async (u, o) => {
            if (String(u).includes('/chat/completions')) {
                return { ok: true, status: 200, text: async () => '', json: async () => ({ choices: [{ message: { content: '给你一条半血狂暴（思路：血线越低压得越快）。\n```json\n{"mechanics":[{"when":{"kind":"hpBelow","threshold":50,"dur":10,"cd":25},"then":{"dmgBonus":30,"bogusField":1},"note":"半血狂暴"}]}\n```' } }] }) };
            }
            return new Response('', { status: 404 });
        };
        localStorage.setItem('lagrange_static_config', JSON.stringify({ models: [{ id: 't', name: 'stub', api_key: 'stub', api_url: 'https://api.deepseek.com', model: 'deepseek-chat' }], active_model_id: 't' }));
        CustomShip.open(id);
        document.getElementById('csChatInput').value = '给这艘船设计一条半血狂暴机制';
        await CustomShip.send();
        CustomShip.applyPending();   // ★ 2026-10-10：写入改为「提议→点✅才写」，这里模拟用户点✅
        const all = JSON.parse(localStorage.getItem('lagrange_custom_ships') || '{}');
        const s = all[id] || {};
        const mechs = (s.condEffects || []).map(c => c.stat + '+' + c.val);
        const chatHtml = document.getElementById('csChat').innerHTML;
        const sysHasWrite = chatHtml.includes('已写入');
        const sysHasReject = chatHtml.includes('被拒');
        const listHtml = document.getElementById('csMechList').innerHTML;
        return { mechs, sysHasWrite, sysHasReject, listShown: listHtml.includes('半血狂暴') };
    }, r1.id);
    console.log('② AI对话→写入：机制 =', JSON.stringify(r2.mechs), '｜聊天里"已写入" =', r2.sysHasWrite, '｜"被拒"提示 =', r2.sysHasReject, '｜机制列表展示 =', r2.listShown);

    const r3 = await p.evaluate(async (id) => {
        /* 编辑数据 + 删一条机制 */
        CustomShip.open(id);
        document.getElementById('csHp').value = '999999';
        document.getElementById('csName').value = 'AI测试舰改名';
        CustomShip.save();
        const s1 = JSON.parse(localStorage.getItem('lagrange_custom_ships') || '{}')[id] || {};
        CustomShip.delMech(0);
        const s2 = JSON.parse(localStorage.getItem('lagrange_custom_ships') || '{}')[id] || {};
        const cnt = (s2.condEffects || []).length;
        /* 清理测试船 */
        delete JSON.parse(localStorage.getItem('lagrange_custom_ships') || '{}')[id];
        const allC = JSON.parse(localStorage.getItem('lagrange_custom_ships') || '{}'); delete allC[id];
        localStorage.setItem('lagrange_custom_ships', JSON.stringify(allC));
        return { renamed: s1.name, hp: s1.hp, mechAfterDel: cnt };
    }, r1.id);
    console.log('③ 编辑/删机制：改名 =', r3.renamed, '｜新HP =', r3.hp, '｜删后机制数 =', r3.mechAfterDel);

    /* ---------- simulator 主菜单 ---------- */
    await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'domcontentloaded' });
    await sleep(3500);
    const r4 = await p.evaluate(() => ({
        menuPage: !!document.getElementById('page-menu'),
        activePage: (document.querySelector('.page.active') || {}).id,
        navHasMenu: !!document.querySelector('.nav-tab[data-page="page-menu"]'),
        navHasFleet: !!document.querySelector('.nav-tab[data-page="page-fleet"]')
    }));
    console.log('④ simulator：主菜单页还在 =', r4.menuPage, '｜默认活动页 =', r4.activePage, '｜导航里还有主菜单 =', r4.navHasMenu, '｜舰队配队 tab =', r4.navHasFleet);

    /* ---------- chat 导航 ---------- */
    await p.goto('http://127.0.0.1:3888/chat.html', { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    const r5 = await p.evaluate(() => Array.from(document.querySelectorAll('a[href="simulator.html"]')).length);
    console.log('⑤ chat 页「战斗模拟」直达链接数 =', r5);

    console.log('页面错误:', errs.length ? errs.slice(0, 4) : '无');
    const pass = r1.shown && r1.hasForm && r1.saved && r1.onPage
        && r2.mechs.length === 1 && r2.mechs[0] === 'dmgBonus+30' && r2.sysHasWrite && r2.sysHasReject && r2.listShown
        && r3.renamed === 'AI测试舰改名' && r3.hp === 999999 && r3.mechAfterDel === 0
        && !r4.menuPage && r4.activePage === 'page-fleet' && !r4.navHasMenu && r4.navHasFleet
        && r5 >= 2 && !errs.length;
    console.log(pass ? '\n✅ 全部通过' : '\n❌ 有不符合预期项');
    await b.close().catch(() => { }); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
