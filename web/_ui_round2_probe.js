/* 本轮纠偏验收：
   ①simulator：点开舰队→编辑区=配队页同款【增援卡+主舰队卡同屏】，各有一个整宽「➕增加战舰」；
      两段的加船按钮目标各自正确；★跨段行操作正确：往两段各加一艘后（currentFleetTab 停在 main），
      调 simCyclePos(增援那行的key) 必须改【增援那行】的站位（验证 findRowAny）
   ②配队页：tabs 有「⚙️ 自定义舰船」；管理弹窗列出已有船 + 新建
   ③neuron3d：缩放提示句已删（但按钮/API 仍在）；features 不变 */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 240000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));

    /* ① simulator */
    await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'domcontentloaded' });
    await sleep(4500);
    const r1 = await p.evaluate(() => {
        const panels = [...document.querySelectorAll('.fleet-panel')];
        const panelBtns = panels.reduce((n, el) => n + [...el.querySelectorAll('button')].filter(x => /增加战舰|增加增援/.test(x.textContent)).length, 0);
        panels[0].click();                                   // 点开我方护航舰队
        const ie = document.getElementById('inlineFleetEditor');
        const ed = {
            shown: ie.style.display !== 'none',
            cards: [/增援（\d+ 种）/.test(ie.textContent), /主舰队（\d+ 种）/.test(ie.textContent)],
            addBtns: [...ie.querySelectorAll('button')].filter(x => /增加战舰/.test(x.textContent)).length,
            oldCardGone: !document.getElementById('shipSelection'),
            stitch: !!document.getElementById('stitchCb'),
            mgrBtn: [...document.querySelectorAll('button')].some(x => x.textContent.includes('自定义舰船'))
        };
        /* 两段各加一艘 ST59，验证目标段落 + 跨段行操作 */
        function pick(tab) {
            const btns = [...ie.querySelectorAll('button')].filter(x => /增加战舰/.test(x.textContent));
            const btn = tab === 'reinforcement' ? btns[0] : btns[1];   // 卡顺序：先增援卡后主舰队卡
            btn.click();
            const pk = { shown: document.getElementById('shipPickerModal').classList.contains('active'), fleet: spkFleetType, tab: spkTab };
            spkSel = ['ST59']; spkConfirm(); closeShipPicker();
            return pk;
        }
        const pkRein = pick('reinforcement');
        const pkMain = pick('main');
        const f = fleetData['ally-escort'];
        ed.pkRein = pkRein; ed.pkMain = pkMain;
        ed.reinCount = (f.reinforcement || []).length; ed.mainCount = f.main.length;
        /* ★ 跨段定位：此刻 currentFleetTab = 'main'，但要对【增援那行】改站位 */
        let cross = null;
        try {
            const reinRow = (f.reinforcement || [])[0];
            const pos0 = reinRow.position;
            simCyclePos(rowKey(reinRow));
            cross = { changed: reinRow.position !== pos0, pos0: pos0, pos1: reinRow.position };
        } catch (e) { cross = { error: String(e.message) }; }
        ed.cross = cross;
        /* 清理 */
        f.main = []; f.reinforcement = [];
        return { panels: panels.length, panelBtns, ed };
    });
    console.log('① simulator：面板数 =', r1.panels, '｜面板内按钮 =', r1.panelBtns, '（应 0）｜旧卡片已除 =', r1.ed.oldCardGone, '｜缝合 =', r1.ed.stitch, '｜管理入口 =', r1.ed.mgrBtn);
    console.log('   编辑区：显示 =', r1.ed.shown, '｜两卡片同屏 =', JSON.stringify(r1.ed.cards), '｜整宽加船按钮数 =', r1.ed.addBtns, '（应 2）');
    console.log('   点增援卡按钮 →', JSON.stringify(r1.ed.pkRein), '｜点主舰队卡按钮 →', JSON.stringify(r1.ed.pkMain), '｜落位 = 增援', r1.ed.reinCount, '艘 / 主舰队', r1.ed.mainCount, '艘');
    console.log('   ★跨段改站位（对增援行）:', JSON.stringify(r1.ed.cross));

    /* ② 配队页管理入口 */
    await p.goto('http://127.0.0.1:3888/fleet.html', { waitUntil: 'load' });
    await sleep(2800);
    const r2 = await p.evaluate(() => {
        const tabBtns = [...document.querySelectorAll('.tabs button')].map(x => x.textContent.trim());
        const hasCreateBtn = tabBtns.some(t => t.indexOf('自定义舰船') >= 0 && t.indexOf('管理') < 0);
        const hasMgrBtn = tabBtns.some(t => t.indexOf('自定义舰船管理') >= 0);
        localStorage.setItem('lagrange_custom_ships', JSON.stringify({ custom_mgr1: { id: 'custom_mgr1', name: '管理测试舰', variant: '自定义', condEffects: [] } }));
        /* 点「➕ 自定义舰船」→ 应为新建态（无删除按钮、名称是默认值、不指向已有船） */
        const createBtn = [...document.querySelectorAll('.tabs button')].find(t => t.textContent.indexOf('自定义舰船') >= 0 && t.textContent.indexOf('管理') < 0);
        createBtn.click();
        const shown1 = document.getElementById('customShipOverlay').classList.contains('show');
        const newName = document.getElementById('csName').value;
        const delHidden = document.getElementById('csDelBtn').style.display === 'none';
        const sub1 = document.getElementById('csSubTitle').textContent;
        CustomShip.close();
        /* 点「📋 自定义舰船管理」→ 应列出已有船 + 有新建按钮 */
        const mgrBtn = [...document.querySelectorAll('.tabs button')].find(t => t.textContent.indexOf('自定义舰船管理') >= 0);
        mgrBtn.click();
        const listChips = [...document.querySelectorAll('#csList .cs-chip')].map(x => x.textContent);
        const hasNew = [...document.querySelectorAll('#customShipOverlay button')].some(x => x.textContent.includes('新建'));
        CustomShip.close();
        const all = JSON.parse(localStorage.getItem('lagrange_custom_ships') || '{}'); delete all.custom_mgr1; localStorage.setItem('lagrange_custom_ships', JSON.stringify(all));
        return { hasCreateBtn, hasMgrBtn, shown1, newName, delHidden, sub1: sub1.slice(0, 12), listChips, hasNew };
    });
    console.log('② 配队页：tabs「➕自定义舰船」=', r2.hasCreateBtn, '｜「📋自定义舰船管理」=', r2.hasMgrBtn);
    console.log('   点新增 → 弹窗=', r2.shown1, '名称=', r2.newName, '(应 自定义舰船)｜删除按钮隐藏=', r2.delHidden, '｜副标题=', r2.sub1);
    console.log('   点管理 → 列表 =', JSON.stringify(r2.listChips), '｜新建按钮 =', r2.hasNew);

    /* ②b 模拟器顶部：两个按钮 */
    await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'domcontentloaded' });
    await sleep(4200);
    const r2b = await p.evaluate(() => {
        const btns = [...document.querySelectorAll('button')].map(x => x.textContent.trim());
        return { create: btns.some(t => t.indexOf('自定义舰船') >= 0 && t.indexOf('管理') < 0), mgr: btns.some(t => t.indexOf('自定义舰船管理') >= 0) };
    });
    console.log('②b 模拟器顶部：➕自定义舰船 =', r2b.create, '｜📋自定义舰船管理 =', r2b.mgr);

    /* ③ neuron3d 静态 */
    const n3 = require('fs').readFileSync(__dirname + '/neuron3d.html', 'utf8');
    const r3 = { tipZoomWord: n3.includes('缩放'), zoomBtns: (n3.match(/view\.zoomIn\(\)|view\.zoomOut\(\)|view\.resetZoom\(\)/g) || []).length, media: n3.includes('max-width:760px') };
    console.log('③ neuron3d：提示里还有"缩放"二字 =', r3.tipZoomWord, '（应 false）｜缩放按钮仍在 =', r3.zoomBtns, '（应 3）｜手机媒体查询 =', r3.media);

    console.log('页面错误:', errs.length ? errs.slice(0, 4) : '无');
    const pass = r1.panels === 4 && r1.panelBtns === 0 && r1.ed.oldCardGone && r1.ed.stitch && r1.ed.mgrBtn
        && r1.ed.shown && r1.ed.cards[0] && r1.ed.cards[1] && r1.ed.addBtns === 2
        && r1.ed.pkRein.shown && r1.ed.pkRein.tab === 'reinforcement' && r1.ed.pkMain.shown && r1.ed.pkMain.tab === 'main'
        && r1.ed.reinCount === 1 && r1.ed.mainCount === 1
        && r1.ed.cross && r1.ed.cross.changed
        && r2.hasCreateBtn && r2.hasMgrBtn && r2.shown1 && r2.newName === '自定义舰船' && r2.delHidden && r2.listChips.includes('管理测试舰') && r2.hasNew
        && r2b.create && r2b.mgr
        && !r3.tipZoomWord && r3.zoomBtns === 3 && r3.media && !errs.length;
    console.log(pass ? '\n✅ 全部通过' : '\n❌ 有不符合预期项');
    await b.close().catch(() => { }); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
