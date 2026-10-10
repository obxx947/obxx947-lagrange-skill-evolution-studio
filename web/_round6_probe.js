/* 第六轮验收（自定义舰编辑器系统化）：
   ①表单新件：武器卡有 暴击(勾选出现暴击率/伤害) / 可攻击系统(勾选出现 目标系统+效率) / 目标优先级多行 / 系统血量 / 主武器radio；
     机库卡有 战机槽/护航艇槽/系统血量/载机4项加成/主机库radio；动力·指挥血量输入
   ②保存后数据结构：modules= W1(主武器系统,hp) / H1(主机库系统,hp) / E1(动力系统,hp) / C1(指挥系统,hp)；
     weapon.crit+critRate+critDmg、subSystemTargets={动力系统:'high'}、targets 两条（多选+战机）
     hangarDmg/CritRate/CritDmg/Evasion、aircraftSlots{fighter,corvette}
   ③引擎侧：模拟器 prepareBattle 后该船 subSystems 应含 主武器系统/主机库系统/动力系统/指挥系统 且血量=填的值
   ④旧格式兼容：单 M1 多武器 + isCarrier 的旧船 → 打开时展开成 2 武器卡 + 1 机库行 + 默认动力/指挥血量 */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OLD = {
    id: 'custom_old1', name: '旧格式舰', variant: '自定义', type: 'cruiser', size: 'small', position: '中排',
    hp: 100000, physicalArmor: 100, energyArmor: 5, commandValue: 12, serviceLimit: 6, isCarrier: true,
    aircraftSlots: { fighter: 3, corvette: 1 },
    modules: { M1: { name: '主武器系统', type: 'weapon', weapons: [
        { name: '炮A', dmgType: 'physical', weaponType: 'direct', singleDmg: 2000, cooldown: 6, lockTime: 4, atkDuration: 2, ammo: 1, attacks: 1, lockEfficiency: 10, targets: [{ types: ['巡洋舰'], hitMin: 60, hitMax: 80 }] },
        { name: '炮B', dmgType: 'energy', weaponType: 'projectile', singleDmg: 800, cooldown: 5, lockTime: 3, atkDuration: 1, ammo: 2, attacks: 1, lockEfficiency: 10, targets: [{ types: ['驱逐舰'], hitMin: 50, hitMax: 70 }] }
    ] } },
    condEffects: []
};
(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 240000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));

    await p.goto('http://127.0.0.1:3888/fleet.html', { waitUntil: 'load' });
    await sleep(2800);

    /* ①③④ 表单 + 保存数据 + 引擎侧 */
    const r1 = await p.evaluate((OLD) => {
        /* —— 旧格式兼容 —— */
        localStorage.setItem('lagrange_custom_ships', JSON.stringify({ custom_old1: OLD }));
        CustomShip.open('custom_old1');
        const oldCompat = {
            weapons: document.getElementById('csWeapons').children.length,
            hangars: document.getElementById('csHangars').children.length,
            engine: document.getElementById('csEngineHp').value,
            cmd: document.getElementById('csCmdHp').value
        };
        CustomShip.close();
        /* —— 新船：全套填一遍 —— */
        CustomShip.open();
        const name = '系统化测试舰';
        document.getElementById('csName').value = name;
        /* 武器1 */
        const w1 = document.getElementById('csWeapons').children[0];
        w1.querySelector('[data-f="name"]').value = '主炮';
        w1.querySelector('[data-f="weaponType"]').value = 'projectile';
        w1.querySelector('[data-f="critOn"]').checked = true; CustomShip.refresh();
        const critBoxShown = w1.querySelector('[data-f="critBox"]').style.display !== 'none';
        w1.querySelector('[data-f="critRate"]').value = '25';
        w1.querySelector('[data-f="critDmg"]').value = '50';
        w1.querySelector('[data-f="sysOn"]').checked = true; CustomShip.refresh();
        const sysBoxShown = w1.querySelector('[data-f="sysBox"]').style.display !== 'none';
        w1.querySelector('[data-f="sysEff"]').value = 'high';
        w1.querySelector('[data-f="sysHp"]').value = '3000';
        /* 目标：第一条多选（加巡洋舰），再加第二条（战机） */
        const t1 = w1.querySelector('[data-f="targets"] > .cs-card');
        [...t1.querySelectorAll('[data-f="types"] input')].forEach(x => { if (x.value === '巡洋舰') x.checked = true; });
        CustomShip.addTargetRow(w1.querySelector('.cs-btn.sm'));
        const rows = w1.querySelectorAll('[data-f="targets"] > .cs-card');
        const t2 = rows[1];
        [...t2.querySelectorAll('[data-f="types"] input')].forEach(x => { x.checked = (x.value === '战机'); });
        t2.querySelector('[data-f="hitMin"]').value = '40'; t2.querySelector('[data-f="hitMax"]').value = '60';
        /* 机库 */
        CustomShip.addHangar();
        const h1 = document.getElementById('csHangars').children[0];
        h1.querySelector('[data-f="fighter"]').value = '4';
        h1.querySelector('[data-f="corvette"]').value = '2';
        h1.querySelector('[data-f="dmg"]').value = '20';
        h1.querySelector('[data-f="critRate"]').value = '10';
        h1.querySelector('[data-f="critDmg"]').value = '50';
        h1.querySelector('[data-f="evasion"]').value = '15';
        h1.querySelector('[data-f="sysHp"]').value = '2600';
        /* 动力/指挥 */
        document.getElementById('csEngineHp').value = '3000';
        document.getElementById('csCmdHp').value = '2800';
        CustomShip.save();
        const all = JSON.parse(localStorage.getItem('lagrange_custom_ships') || '{}');
        const id = Object.keys(all).find(k => all[k].name === name);
        const s = all[id];
        const W1 = s.modules.W1, H1 = s.modules.H1, E1 = s.modules.E1, C1 = s.modules.C1;
        const w = W1 && W1.weapons && W1.weapons[0];
        const data = {
            modKeys: Object.keys(s.modules),
            W1name: W1 && W1.name, W1hp: W1 && W1.hp, H1name: H1 && H1.name, H1hp: H1 && H1.hp,
            E1: E1 && (E1.name + ':' + E1.type + ':' + E1.hp), C1: C1 && (C1.name + ':' + C1.type + ':' + C1.hp),
            crit: w && !!w.crit, critRate: w && w.critRate, critDmg: w && w.critDmg,
            sysT: w && w.subSystemTargets, weaponType: w && w.weaponType,
            t0: w && w.targets[0], t1: w && w.targets[1],
            hDmg: s.hangarDmg, hCr: s.hangarCritRate, hCd: s.hangarCritDmg, hEv: s.hangarEvasion,
            slots: s.aircraftSlots, isCarrier: s.isCarrier
        };
        /* 清掉旧船，留新船给引擎验证 */
        const all2 = JSON.parse(localStorage.getItem('lagrange_custom_ships') || '{}'); delete all2.custom_old1;
        localStorage.setItem('lagrange_custom_ships', JSON.stringify(all2));
        return { oldCompat, critBoxShown, sysBoxShown, tRows: rows.length, data, id };
    }, OLD);
    console.log('④ 旧格式兼容：武器卡', r1.oldCompat.weapons, '张（应 2）｜机库行', r1.oldCompat.hangars, '（应 1）｜动力/指挥血量默认', r1.oldCompat.engine, '/', r1.oldCompat.cmd);
    console.log('① 勾选联动：暴击组出现 =', r1.critBoxShown, '｜攻击系统组出现 =', r1.sysBoxShown, '｜目标行数 =', r1.tRows, '（应 2）');
    const d = r1.data;
    console.log('② 保存数据：modules =', JSON.stringify(d.modKeys), '｜', d.W1name + '/' + d.W1hp, d.H1name + '/' + d.H1hp, d.E1, d.C1);
    console.log('   武器：crit =', d.crit, 'critRate =', d.critRate, 'critDmg =', d.critDmg, '｜weaponType =', d.weaponType, '｜攻击系统 =', JSON.stringify(d.sysT));
    console.log('   目标：第1优先 =', JSON.stringify(d.t0), '｜第2优先 =', JSON.stringify(d.t1));
    console.log('   载机：slots =', JSON.stringify(d.slots), '｜伤害强化', d.hDmg, '暴击率', d.hCr, '暴击伤害', d.hCd, '闪避', d.hEv);

    /* ③ 引擎侧：模拟器里该船的系统与血量 */
    await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'domcontentloaded' });
    await sleep(4500);
    const r2 = await p.evaluate((id) => {
        const s = SHIP_DATABASE[id]; if (!s) return { err: '自定义舰未加载' };
        const mk = (src, n) => { const e = JSON.parse(JSON.stringify(src)); e.count = n; try { e.uid = ensureUid(e); } catch (x) { } return e; };
        Object.keys(fleetData).forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; fleetData[k].flagship = null; });
        fleetData['ally-escort'].main = [mk(s, 1)];
        const en = JSON.parse(JSON.stringify(s)); en.id = 'ST59'; en.condEffects = [];
        fleetData['enemy-escort'].main = [mk(JSON.parse(JSON.stringify(SHIP_DATABASE['ST59'])), 1)];
        prepareBattle();
        const inst = (battleState.allyShips || [])[0] || {};
        const sys = (inst.subSystems || []).map(x => x.name + ':' + x.hp + '/' + x.maxHp + (x.type ? '(' + x.type + ')' : ''));
        const airBonus = { dmg: inst.hangarDmg, cr: inst.hangarCritRate, ev: inst.hangarEvasion };
        const wInst = ((inst.weaponStates || [])[0] || {}).weapon || {};
        return { sys, airBonus, slots: inst.aircraftSlots, wCrit: { crit: wInst.crit, critRate: wInst.critRate, critDmg: wInst.critDmg, sysT: wInst.subSystemTargets, targets: (wInst.targets || []).length } };
    }, r1.id);
    console.log('③ 引擎侧系统：', JSON.stringify(r2.sys));
    console.log('   实例载机加成：', JSON.stringify(r2.airBonus), '｜载机位：', JSON.stringify(r2.slots), '｜武器（实例）：', JSON.stringify(r2.wCrit));

    /* 清理 */
    await p.evaluate((id) => { const a = JSON.parse(localStorage.getItem('lagrange_custom_ships') || '{}'); delete a[id]; localStorage.setItem('lagrange_custom_ships', JSON.stringify(a)); }, r1.id);

    console.log('页面错误:', errs.length ? errs.slice(0, 4) : '无');
    const sysHas = n => (r2.sys || []).some(x => x.indexOf(n) === 0);
    const pass = r1.oldCompat.weapons === 2 && r1.oldCompat.hangars === 1 && r1.oldCompat.engine === '2400' && r1.oldCompat.cmd === '2400'
        && r1.critBoxShown && r1.sysBoxShown && r1.tRows === 2
        && d.modKeys.length === 4 && d.W1name === '主武器系统' && d.W1hp === 3000 && d.H1name === '主机库系统' && d.H1hp === 2600
        && /动力系统:engine:3000/.test(d.E1) && /指挥系统:command:2800/.test(d.C1)
        && d.crit && d.critRate === 25 && d.critDmg === 50 && d.sysT && d.sysT['动力系统'] === 'high' && d.weaponType === 'projectile'
        && d.t0.types.length === 3 && d.t0.types.indexOf('巡洋舰') >= 0 && d.t1.types[0] === '战机' && d.t1.hitMin === 40
        && d.hDmg === 20 && d.hCr === 10 && d.hCd === 50 && d.hEv === 15 && d.slots.fighter === 4 && d.slots.corvette === 2
        && sysHas('主武器系统') && sysHas('主机库系统') && sysHas('动力系统') && sysHas('指挥系统')
        && (r2.sys || []).some(x => x.indexOf('主武器系统:3000') === 0) && (r2.sys || []).some(x => x.indexOf('动力系统:3000') === 0)
        && (r2.sys || []).some(x => x.indexOf('指挥系统:2800') === 0)
        && r2.airBonus.dmg === 20 && r2.airBonus.cr === 10 && r2.airBonus.ev === 15
        && r2.wCrit.crit && r2.wCrit.critRate === 25 && r2.wCrit.sysT['动力系统'] === 'high' && r2.wCrit.targets === 2
        && !errs.length;
    console.log(pass ? '\n✅ 全部通过' : '\n❌ 有不符合预期项');
    await b.close().catch(() => { }); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
