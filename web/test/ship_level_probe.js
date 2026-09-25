/* 舰船级系统（装甲/动力等，不属于任何模块）的加点是否始终生效 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const say = (...a) => console.log(a.join(' '));

(async () => {
  const sysmap = JSON.parse(fs.readFileSync('data/blueprint_sysmap.json', 'utf8'));
  const stats = JSON.parse(fs.readFileSync('data/blueprint_stats.json', 'utf8'));
  const bpmap = JSON.parse(fs.readFileSync('data/blueprint_map.json', 'utf8'));
  const cdnId = String(bpmap['constantine'].cdnId);
  const bp = JSON.parse(fs.readFileSync('data/blueprint/' + cdnId + '.json', 'utf8'));
  const sm = sysmap[cdnId].systems;

  // 舰船级系统里的 hp / physResist 节点
  const shipNodes = [];
  for (const sys of bp.systems) {
    const m = sm[sys.sysId];
    const isShip = !(m && m.scope === 'module');
    if (!isShip) continue;
    for (const n of sys.nodes) {
      const st = stats.nodes[n.id];
      if (st && st.addable && !st.statMap && ['hp', 'physResist', 'energyResist'].includes(st.stat))
        shipNodes.push({ id: n.id, stat: st.stat, sys: sys.sysName, name: n.name, vals: st.perLevel });
    }
  }
  say('舰船级系统里的 hp/抵抗 节点（前 8 个）:');
  shipNodes.slice(0, 8).forEach(x => say('   [' + x.id + '] ' + x.sys + ' · ' + x.name + ' = ' + x.stat + ' ' + JSON.stringify(x.vals)));
  // 专挑 hp 的
  const hpNodes = shipNodes.filter(x => x.stat === 'hp').slice(0, 3);
  say('\n用于测试的 hp 节点: ' + hpNodes.map(x => x.sys + '/' + x.name).join(' , '));
  const lv = {}; hpNodes.forEach(x => lv[x.id] = 5);

  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1200, height: 900 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2500));

  const get = async (store, sel) => {
    await p.evaluate((s) => { localStorage.setItem('lagrange_addpoint', JSON.stringify(s)); }, store);
    await p.reload({ waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 3000));
    return await p.evaluate((sel) => {
      const e = JSON.parse(JSON.stringify(SHIP_DATABASE['constantine']));
      e.selectedModules = Object.assign({}, sel);
      const s = createShipInstance(e, 'ally', false, false);
      /* ⚠️ s._apB.ship 是【映射前】的中间桶（键名是原始 stat 名，维修叫 repairEff）。
         引擎实际读的是实例上的 repairBonus / hangarDmg / hitBonus / siegeBonus，
         所以判定必须看实例字段，否则会假报 ❌（2026-09-24 修正）。 */
      return { hp: s.maxHp, shipB: s._apB ? s._apB.ship : null, mods: s._apB ? Object.keys(s._apB.byModule) : [], counted: s._apB ? s._apB._counted : 0,
               实例: { hitBonus: s.hitBonus, repairBonus: s.repairBonus, hangarDmg: s.hangarDmg, siegeBonus: s.siegeBonus } };
    }, sel);
  };

  const n0 = await get({}, { M: 'M1', A: 'A1' });
  say('\n① 不加点            maxHp=' + n0.hp + '   counted=' + n0.counted);
  const n1 = await get({ [cdnId]: { lv, manual: {} } }, { M: 'M1', A: 'A1' });
  say('② 只点舰船级装甲hp   maxHp=' + n1.hp + '   舰船桶hp=' + (n1.shipB ? n1.shipB.hp : '?') + '   counted=' + n1.counted);
  const n2 = await get({ [cdnId]: { lv, manual: { hp: 9999 } } }, { M: 'M1', A: 'A1' });
  say('③ 同上 + 手填hp9999  maxHp=' + n2.hp + '   舰船桶hp=' + (n2.shipB ? n2.shipB.hp : '?'));
  const n3 = await get({ [cdnId]: { lv, manual: { hitBonus: 50, repairBonus: 30, hangarBonus: 20, siege: 77 } } }, { M: 'M1', A: 'A1' });
  say('④ 手填 命中50/维修30/机库20/攻城77 →  舰船桶: ' +
    JSON.stringify({ hitBonus: n3.shipB.hitBonus, repairBonus: n3.shipB.repairBonus, hangarBonus: n3.shipB.hangarBonus, siege: n3.shipB.siege }));

  say('\n===== 判定 =====');
  say('舰船级加点改变结构值: ' + (n1.hp > n0.hp ? '✅ ' + n0.hp + ' → ' + n1.hp : '❌ 没变（' + n0.hp + '）'));
  say('手填数值进入引擎桶  : ' + (n3.实例.hitBonus === 50 && n3.实例.repairBonus === 30 && n3.实例.hangarDmg === 20 && n3.实例.siegeBonus === 77 ? '✅ 四项都到了引擎实例字段' : '❌ ' + JSON.stringify(n3.实例)));
  say('JS 报错: ' + (errs.length ? errs.slice(0, 2).join(' | ') : '无'));
  await b.close();
})();
