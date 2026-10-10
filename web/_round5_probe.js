/* 第五轮验收：
   ①simulator 选船弹窗：类别里没有 战机/护航艇；列表里没有战机（mistral）；有「⚙️ 自定义舰船管理」入口
   ②fleet 选船弹窗：有管理入口
   ③武器编辑器：新增一行武器 → 有【武器类型 直射/投射】【优先目标 三选一】【暴击】；填 projectile + 大型舰船 + 暴击 → 保存后数据一致
   ④机制闸门：用户只说「你好」时 AI 输出的 json 被忽略（机制数不变 + 有忽略提示）；说「给我设计一条机制」时才出提议卡 */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 240000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));

    /* ① simulator 选船弹窗 */
    await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'domcontentloaded' });
    await sleep(4500);
    const r1 = await p.evaluate(() => {
        openShipPicker();
        const cats = [...document.querySelectorAll('#spkFilters button')].map(x => x.textContent);
        const names = [...document.querySelectorAll('#spkGrid .ship-pick-item, #spkGrid [onclick]')].map(x => x.textContent || '').join(' ');
        const mgr = cats.some(t => t.includes('自定义舰船管理'));
        closeShipPicker();
        return {
            hasFighterCat: cats.some(t => t === '战机'), hasCorvCat: cats.some(t => t === '护航艇'),
            mgr: mgr, hasMistral: /米斯特拉/.test(names), catsCount: cats.length
        };
    });
    console.log('① simulator 选船：战机类别 =', r1.hasFighterCat, '｜护航艇类别 =', r1.hasCorvCat, '（都应 false）｜列表含米斯特拉(战机) =', r1.hasMistral, '（应 false）｜管理入口 =', r1.mgr);

    /* ② fleet 选船弹窗 + ③ 武器编辑器 + ④ 闸门（都在 fleet 页做） */
    await p.goto('http://127.0.0.1:3888/fleet.html', { waitUntil: 'load' });
    await sleep(2800);
    const r2 = await p.evaluate(() => {
        /* ② 打开选船弹窗 → 筛选行应有管理入口 */
        try { openPicker('main'); } catch (e) { }
        const pkMgr = (document.getElementById('pkFilters') || {}).textContent.indexOf('自定义舰船管理') >= 0;
        try { document.getElementById('pickModal').classList.remove('show'); } catch (e) { }
        /* ③ 武器编辑器（2026-10-10 新版：卡片式，含 暴击/攻击系统/目标优先级） */
        CustomShip.newShip();
        const row = document.querySelector('#csWeapons .cs-card');
        const wsel = row && row.querySelector('[data-f="weaponType"]');
        const critOn = row && row.querySelector('[data-f="critOn"]');
        const sysOn = row && row.querySelector('[data-f="sysOn"]');
        const wOpts = wsel ? [...wsel.options].map(o => o.value) : [];
        /* 填值 → 保存 → 读回 */
        document.getElementById('csName').value = '武器测试舰';
        row.querySelector('[data-f="name"]').value = '离子炮';
        row.querySelector('[data-f="dmgType"]').value = 'energy';
        wsel.value = 'projectile';
        critOn.checked = true; sysOn.checked = true; CustomShip.refresh();
        row.querySelector('[data-f="critRate"]').value = '15';
        row.querySelector('[data-f="critDmg"]').value = '30';
        /* 目标优先级第一条：勾上 大型舰船 */
        const t1 = row.querySelector('[data-f="targets"] > .cs-card');
        [...t1.querySelectorAll('[data-f="types"] input')].forEach(x => { if (x.value === '大型舰船') x.checked = true; });
        t1.querySelector('[data-f="hitMin"]').value = '55';
        CustomShip.save();
        const all = JSON.parse(localStorage.getItem('lagrange_custom_ships') || '{}');
        const id = Object.keys(all).find(k => all[k].name === '武器测试舰');
        const wid = id ? Object.keys(all[id].modules).find(k => (all[id].modules[k].weapons || []).length) : null;
        const w0 = wid ? all[id].modules[wid].weapons[0] : {};
        const cs = JSON.stringify({ id: id, weaponType: w0.weaponType, crit: !!w0.crit, critRate: w0.critRate, critDmg: w0.critDmg,
            sysT: w0.subSystemTargets, t0: (w0.targets && w0.targets[0] && w0.targets[0].types) || [], hitMin: w0.targets && w0.targets[0] && w0.targets[0].hitMin,
            dmgType: w0.dmgType, singleDmg: w0.singleDmg, modName: wid ? all[id].modules[wid].name : '', modHp: wid ? all[id].modules[wid].hp : null });
        return { pkMgr, wOpts, hasCritOn: !!critOn, hasSysOn: !!sysOn, saved: JSON.parse(cs) };
    });
    console.log('② fleet 选船弹窗管理入口 =', r2.pkMgr);
    console.log('③ 武器编辑器：类型选项 =', JSON.stringify(r2.wOpts), '｜有暴击开关 =', r2.hasCritOn, '｜有攻击系统开关 =', r2.hasSysOn);
    console.log('   保存回读：', JSON.stringify(r2.saved));

    /* ④ 闸门 */
    const r4 = await p.evaluate(async () => {
        const all = JSON.parse(localStorage.getItem('lagrange_custom_ships') || '{}');
        const id = Object.keys(all).find(k => all[k].name === '武器测试舰');
        all[id].condEffects = [];
        localStorage.setItem('lagrange_custom_ships', JSON.stringify(all));
        localStorage.setItem('lagrange_static_config', JSON.stringify({ models: [{ id: 'main', name: 'stub', api_key: 'stub', api_url: 'https://api.deepseek.com', model: 'deepseek-chat' }], active_model_id: 'main' }));
        window.fetch = async (u) => {
            if (String(u).includes('/chat/completions')) return { ok: true, status: 200, text: async () => '', json: async () => ({ choices: [{ message: { content: '好的！\n```json\n{"mechanics":[{"when":{"kind":"battleStart"},"then":{"dmgBonus":10},"note":"x"}]}\n```' }, finish_reason: 'stop' }] }) };
            return new Response('', { status: 404 });
        };
        CustomShip.open(id);
        /* 只打招呼 */
        document.getElementById('csChatInput').value = '你好';
        await CustomShip.send();
        const afterHello = (JSON.parse(localStorage.getItem('lagrange_custom_ships'))[id].condEffects || []).length;
        const ignoredNote = document.getElementById('csChat').innerHTML.includes('自动忽略');
        const pendAfterHello = document.getElementById('csChat').innerHTML.includes('applyPending');
        /* 明确要求 */
        document.getElementById('csChatInput').value = '给我设计一条机制';
        await CustomShip.send();
        const pendAfterAsk = document.getElementById('csChat').innerHTML.includes('applyPending');
        const all2 = JSON.parse(localStorage.getItem('lagrange_custom_ships')); delete all2[id]; localStorage.setItem('lagrange_custom_ships', JSON.stringify(all2));
        return { afterHello, ignoredNote, pendAfterHello, pendAfterAsk };
    });
    console.log('④ 闸门：说「你好」后机制数 =', r4.afterHello, '（应 0）｜出现"自动忽略"提示 =', r4.ignoredNote, '｜你好时无提议卡 =', !r4.pendAfterHello, '｜明确要求后出现提议卡 =', r4.pendAfterAsk);

    console.log('页面错误:', errs.length ? errs.slice(0, 4) : '无');
    const pass = !r1.hasFighterCat && !r1.hasCorvCat && !r1.hasMistral && r1.mgr
        && r2.pkMgr && JSON.stringify(r2.wOpts) === JSON.stringify(['direct', 'projectile']) && r2.hasCritOn && r2.hasSysOn
        && r2.saved.weaponType === 'projectile' && r2.saved.crit === true && r2.saved.critRate === 15 && r2.saved.sysT && r2.saved.sysT['动力系统'] && r2.saved.t0.indexOf('大型舰船') >= 0 && r2.saved.hitMin === 55 && r2.saved.dmgType === 'energy'
        && r4.afterHello === 0 && r4.ignoredNote && !r4.pendAfterHello && r4.pendAfterAsk && !errs.length;
    console.log(pass ? '\n✅ 全部通过' : '\n❌ 有不符合预期项');
    await b.close().catch(() => { }); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
