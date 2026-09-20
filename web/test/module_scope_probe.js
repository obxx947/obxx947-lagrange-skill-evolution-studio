/* 决定性测试：只给 M2 加点、战斗里只装 M1 —— M1 的武器会不会被 M2 的加点污染？ */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const say = (...a) => console.log(a.join(' '));

(async () => {
  const sysmap = JSON.parse(fs.readFileSync('data/blueprint_sysmap.json', 'utf8'));
  const stats = JSON.parse(fs.readFileSync('data/blueprint_stats.json', 'utf8'));
  const bp = JSON.parse(fs.readFileSync('data/blueprint/60401.json', 'utf8'));
  const sm = sysmap['60401'].systems;
  const buckets = {};
  for (const sys of bp.systems) {
    const m = sm[sys.sysId];
    const key = (m && m.scope === 'module') ? (m.key + '_' + m.variant) : 'SHIP';
    for (const n of sys.nodes) {
      const st = stats.nodes[n.id];
      if (!st || !st.addable || st.statMap) continue;
      (buckets[key] = buckets[key] || []).push({ id: n.id, stat: st.stat, name: n.name });
    }
  }

  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1200, height: 900 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2500));

  const run = async (lv, sel, label) => {
    await p.evaluate((lv) => { localStorage.setItem('lagrange_addpoint', JSON.stringify({ '60401': { lv, manual: {} } })); }, lv);
    await p.evaluate(() => { if (typeof BP_SYSMAP !== 'undefined') BP_SYSMAP = null; });
    await p.reload({ waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 3000));
    const r = await p.evaluate((sel) => {
      const e = JSON.parse(JSON.stringify(SHIP_DATABASE['constantine']));
      e.selectedModules = Object.assign({}, sel);
      const s = createShipInstance(e, 'ally', false, false);
      return {
        hp: s.maxHp, shipB: s._apB ? s._apB.ship : null, mods: s._apB ? Object.keys(s._apB.byModule) : [],
        ws: (s.weaponStates || []).map(w => ({ key: w.strengthenKey, name: (w.module || {}).name || '?', st: w.strengthen || {} }))
      };
    }, sel);
    say('\n=== ' + label + ' ===');
    say('  maxHp=' + r.hp + '   舰船级桶=' + JSON.stringify(r.shipB));
    say('  byModule 键=' + JSON.stringify(r.mods));
    r.ws.forEach(w => say('   武器 ' + String(w.key).padEnd(10) + ' ' + w.name.slice(0, 22).padEnd(24) + ' 强化=' + JSON.stringify(w.st)));
    return r;
  };

  const modsOf = (k, n) => (buckets[k] || []).slice(0, n);

  // ① 完全不加点
  const base = await run({}, { M: 'M1', A: 'A1' }, '① 不加点 · 只装 M1/A1');

  // ② 只给 M2 加点（点满 M2 的所有节点），战斗只装 M1
  const lvM2 = {}; modsOf('M_M2', 99).forEach(x => lvM2[x.id] = 5);
  const onlyM2 = await run(lvM2, { M: 'M1', A: 'A1' }, '② 加点全在 M2 · 战斗只装 M1（M2 的点不该有任何影响）');

  // ③ 只给 M1 加点，战斗装 M1
  const lvM1 = {}; modsOf('M_M1', 99).forEach(x => lvM1[x.id] = 5);
  const onlyM1 = await run(lvM1, { M: 'M1', A: 'A1' }, '③ 加点全在 M1 · 战斗装 M1（应生效）');

  // ④ M1+M2 都加点，战斗装 M1（应等于 ③）
  const lvBoth = Object.assign({}, lvM1, lvM2);
  const both = await run(lvBoth, { M: 'M1', A: 'A1' }, '④ M1+M2 都加点 · 战斗只装 M1（应等于 ③）');

  say('\n===== 判定 =====');
  const sig = r => JSON.stringify(r.ws.map(w => w.st)) + '|' + (r.shipB ? JSON.stringify(r.shipB) : '');
  say('② 与 ① 的每武器强化是否相同（M2 加点不该影响装 M1 的船）: ' + (sig(onlyM2) === sig(base) ? '✅ 相同' : '❌ 不同 —— M2 的加点漏到 M1 上了'));
  say('③ 是否真的改变了武器强化（M1 加点该生效）      : ' + (sig(onlyM1) !== sig(base) ? '✅ 有变化' : '❌ 无变化 —— M1 加点没生效'));
  say('④ 与 ③ 是否相同（多配的模块不该干扰）           : ' + (sig(both) === sig(onlyM1) ? '✅ 相同' : '❌ 不同 —— 未被选中的模块加了点会改变结果'));
  say('JS 报错: ' + (errs.length ? errs.slice(0, 2).join(' | ') : '无'));
  await b.close();
})();
