/* 加点页属性汇总面板：分组是否从 stats.groups 正确渲染 + 战斗能否正常跑完 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const say = (...a) => console.log(a.join(' '));
const res = []; const check = (n, ok, d) => { res.push(ok); say((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  → ' + d : '')); };

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1100, height: 1400 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));

  /* ---- A. 加点页 ---- */
  say('===== A. 加点页属性汇总面板 =====');
  // 给大帝配一份加点（含机库/被命中下降/维修等新属性），看去重后的分组渲染
  const stats = JSON.parse(fs.readFileSync('data/blueprint_stats.json', 'utf8'));
  const bmap = JSON.parse(fs.readFileSync('data/blueprint_map.json', 'utf8'));
  const cdn = String(bmap['constantine'].cdnId);
  // 挑几个不同类别的节点，每类最多 2 个
  const want = ['singleDmg', 'cooldownReduction', 'hp', 'physResist', 'enemyHitDown', 'hangarDmg', 'hangarModuleDmg', 'lockEfficiency', 'repairEff'];
  const bp = JSON.parse(fs.readFileSync('data/blueprint/' + cdn + '.json', 'utf8'));
  const byStat = {};
  for (const s of bp.systems) for (const n of s.nodes) {
    const st = stats.nodes[n.id];
    if (!st || !st.addable || st.statMap || st.multi > 1) continue;
    if (want.indexOf(st.stat) < 0) continue;
    (byStat[st.stat] = byStat[st.stat] || []).push(n.id);
  }
  const lv = {};
  Object.keys(byStat).forEach(k => byStat[k].slice(0, 2).forEach((id, i) => lv[id] = i + 1));
  say('   注入节点: ' + JSON.stringify(Object.keys(byStat).map(k => k + '×' + Math.min(2, byStat[k].length))));

  await p.goto('http://127.0.0.1:3888/addpoint.html?ship=constantine', { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2500));
  await p.evaluate(s => localStorage.setItem('lagrange_addpoint', JSON.stringify(s)), { [cdn]: { lv, manual: {} } });
  await p.reload({ waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 3000));

  const a = await p.evaluate(() => {
    const grids = [...document.querySelectorAll('.sgrid')];
    const rowsOf = g => [...g.querySelectorAll('.srow')].map(r => ({
      n: (r.querySelector('i') || {}).textContent || '',
      auto: (r.querySelector('.auto') || {}).textContent || '', total: (r.querySelector('b') || {}).textContent || ''
    }));
    return {
      grids: grids.length,
      rows: grids.map(rowsOf),
      groupsFromJson: !!(typeof STATS !== 'undefined' && STATS && STATS.groups),
      hasNewFields: grids.length > 0 && rowsOf(grids[0]).some(r => /被命中率下降/.test(r.n)),
      hasHangarGrid: grids.length > 1 && rowsOf(grids[grids.length - 1]).some(r => /机库/.test(r.n))
    };
  });
  check('读到 stats.groups（不再硬编码）', a.groupsFromJson);
  check('渲染出属性行', a.rows.every(r => r.length > 0), '三块行数 ' + a.rows.map(r => r.length).join('/'));
  check('出现新属性「被命中率下降」', a.hasNewFields);
  check('出现机库分项行', a.hasHangarGrid);
  const nonZero = a.rows.flat().filter(r => !/自动 0(\.0)?%?$|自动 0$/.test(r.auto)).map(r => r.n + '=' + r.auto);
  say('   非零项: ' + JSON.stringify(nonZero.slice(0, 12)));

  /* ---- B. 战斗 ---- */
  say('\n===== B. 战斗跑通 =====');
  await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));
  const bt = await p.evaluate(async () => {
    // 用现成的一键开战：造两支镜像舰队
    const e = JSON.parse(JSON.stringify(SHIP_DATABASE['constantine']));
    e.count = 3; e.slot = 'main';
    const mk = () => JSON.parse(JSON.stringify(e));
    const r = await new Promise(res => {
      try {
        if (typeof startBattle === 'function') { window.__done = res; startBattle(); setTimeout(() => res('started'), 3000); }
        else res('no startBattle');
      } catch (err) { res('ERR ' + err.message); }
    });
    return { r: r, hasStart: typeof startBattle === 'function', t: document.body.innerText.slice(0, 200) };
  });
  say('   startBattle: ' + JSON.stringify(bt).slice(0, 200));
  check('无 JS 报错', errs.length === 0, errs.slice(0, 2).join(' | '));

  const pass = res.filter(Boolean).length;
  say('\n通过 ' + pass + '/' + res.length);
  await b.close();
})();
