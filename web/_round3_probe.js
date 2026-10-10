/* 第三轮验收：
   ①settings：单一模型表单（m1_url/m1_key/m1_model）存在并被回填；旧"多模型管理"输入框已删；
     saveOneModel() 保存后 models=[单一]、active_model_id='main'（全部功能都用它）
   ②simulator：行内【无"强化"按钮】、【无"单个舰船加点方案"选择】；行仍可正常渲染与操作
   ③custom_ship：AI 请求走预算阶梯重试（静态断言 + stub 验证"首次空回复→第二次成功写入"） */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 240000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));

    /* ① settings */
    await p.goto('http://127.0.0.1:3888/settings.html', { waitUntil: 'load' });
    await sleep(1500);
    await p.evaluate(() => localStorage.setItem('lagrange_static_config', JSON.stringify({ models: [{ id: 'main', name: 'ds', api_key: 'sk-test', api_url: 'https://api.deepseek.com', model: 'deepseek-chat' }], active_model_id: 'main', max_tokens: 100000 })));
    await p.reload({ waitUntil: 'load' });
    await sleep(2500);
    const r1 = await p.evaluate(() => {
        const v = id => (document.getElementById(id) || {}).value;
        const oldGone = !document.getElementById('nm_key');
        const formOk = !!(document.getElementById('m1_key') && document.getElementById('m1_url') && document.getElementById('m1_model'));
        const filled = { key: v('m1_key'), url: v('m1_url'), model: v('m1_model') };
        /* 改一处再保存 → 检查落库 */
        document.getElementById('m1_model').value = 'deepseek-chat-v9';
        document.getElementById('m1_key').value = 'sk-new';
        saveOneModel();
        const cfg = JSON.parse(localStorage.getItem('lagrange_static_config') || '{}');
        return { oldGone, formOk, filled, saved: cfg.models && cfg.models[0], active: cfg.active_model_id, statusLine: (document.getElementById('modelsList') || {}).textContent || '' };
    });
    console.log('① settings：单模型表单 =', r1.formOk, '｜旧多模型输入已删 =', r1.oldGone, '｜回填 =', JSON.stringify(r1.filled));
    console.log('   保存后：models[0] =', JSON.stringify(r1.saved && { model: r1.saved.model, key: r1.saved.api_key }), '｜active_model_id =', r1.active, '｜状态行 =', r1.statusLine.trim().slice(0, 40));

    /* ② simulator 行 UI */
    await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'domcontentloaded' });
    await sleep(4500);
    const r2 = await p.evaluate(() => {
        const panels = [...document.querySelectorAll('.fleet-panel')];
        panels[0].click();
        const ie = document.getElementById('inlineFleetEditor');
        /* 加一艘船以便看行内按钮 */
        const btns = [...ie.querySelectorAll('button')];
        btns.find(x => /增加战舰/.test(x.textContent)).click();
        spkSel = ['ST59']; spkConfirm(); closeShipPicker();
        const rows = [...ie.querySelectorAll('.frow')];
        const row = rows[0];
        const rowBtns = row ? [...row.querySelectorAll('button')].map(x => x.textContent.trim()) : [];
        const res = {
            rows: rows.length,
            hasStrengthBtn: rowBtns.some(t => t === '⚡') || /强化/.test(ie.textContent),
            hasApBuild: /加点方案/.test(ie.textContent),
            rowBtns: rowBtns,
            /* 行功能仍可用：切站位 */
            posWorks: (() => { try { const f = fleetData['ally-escort']; const s0 = f.reinforcement[0]; const p0 = s0.position; simCyclePos(rowKey(s0)); return s0.position !== p0; } catch (e) { return 'err:' + e.message; } })(),
            /* 数量 ± 仍可用 */
            qtyWorks: (() => { try { const f = fleetData['ally-escort']; const s0 = f.reinforcement[0]; const c0 = s0.count; changeFleetShipCount(rowKey(s0), 1); return s0.count === c0 + 1; } catch (e) { return 'err:' + e.message; } })()
        };
        fleetData['ally-escort'].main = []; fleetData['ally-escort'].reinforcement = [];
        return res;
    });
    console.log('② simulator 行：行数 =', r2.rows, '｜有强化按钮/字样 =', r2.hasStrengthBtn, '（应 false）｜有"加点方案"选择 =', r2.hasApBuild, '（应 false）');
    console.log('   行内按钮 =', JSON.stringify(r2.rowBtns), '｜切站位可用 =', r2.posWorks, '｜数量±可用 =', r2.qtyWorks);

    /* ③ custom_ship：stub 首次空回复 → 第二次成功（验证预算阶梯重试）；并验证 JSON 写入 */
    await p.goto('http://127.0.0.1:3888/fleet.html', { waitUntil: 'load' });
    await sleep(2800);
    const r3 = await p.evaluate(async () => {
        localStorage.setItem('lagrange_custom_ships', JSON.stringify({ custom_retry1: { id: 'custom_retry1', name: '重试测试舰', variant: '自定义', condEffects: [], hp: 1000 } }));
        localStorage.setItem('lagrange_static_config', JSON.stringify({ models: [{ id: 'main', name: 'stub', api_key: 'stub', api_url: 'https://api.deepseek.com', model: 'deepseek-chat' }], active_model_id: 'main' }));
        let calls = 0;
        window.fetch = async (u) => {
            if (String(u).includes('/chat/completions')) {
                calls++;
                if (calls === 1) return { ok: true, status: 200, text: async () => '', json: async () => ({ choices: [{ message: { content: '', reasoning_content: '思考思考思考' }, finish_reason: 'length' }] }) };
                return { ok: true, status: 200, text: async () => '', json: async () => ({ choices: [{ message: { content: '好，给你一条。\n```json\n{"mechanics":[{"when":{"kind":"battleStart"},"then":{"dmgBonus":15},"note":"开场加伤"}]}\n```' }, finish_reason: 'stop' }] }) };
            }
            return new Response('', { status: 404 });
        };
        CustomShip.open('custom_retry1');
        document.getElementById('csChatInput').value = '给我一条机制';
        await CustomShip.send();
        CustomShip.applyPending();   // ★ 写入改为「提议→点✅才写」
        const s = JSON.parse(localStorage.getItem('lagrange_custom_ships') || '{}').custom_retry1 || {};
        const chatHtml = document.getElementById('csChat').innerHTML;
        const all = JSON.parse(localStorage.getItem('lagrange_custom_ships') || '{}'); delete all.custom_retry1; localStorage.setItem('lagrange_custom_ships', JSON.stringify(all));
        return { calls: calls, mechs: (s.condEffects || []).map(c => c.stat + '+' + c.val), wrote: chatHtml.includes('已写入') };
    });
    console.log('③ AI对话重试：请求次数 =', r3.calls, '（应 ≥2）｜写入机制 =', JSON.stringify(r3.mechs), '｜聊天提示"已写入" =', r3.wrote);

    console.log('页面错误:', errs.length ? errs.slice(0, 4) : '无');
    const pass = r1.formOk && r1.oldGone && r1.filled.model === 'deepseek-chat' && r1.saved && r1.saved.model === 'deepseek-chat-v9' && r1.saved.api_key === 'sk-new' && r1.active === 'main'
        && r2.rows === 1 && !r2.hasStrengthBtn && !r2.hasApBuild && r2.posWorks === true && r2.qtyWorks === true
        && r3.calls >= 2 && r3.mechs.length === 1 && r3.mechs[0] === 'dmgBonus+15' && r3.wrote && !errs.length;
    console.log(pass ? '\n✅ 全部通过' : '\n❌ 有不符合预期项');
    await b.close().catch(() => { }); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
