/* 加点「多方案」+ 按舰选择方案 回归（2026-09-24）
   需求：① 一艘船可以有多个加点方案
        ② 在战舰配队 / 战斗模拟里能选这条用哪个方案
        ③ 模拟器里不同舰队（条目）各选各的，互不影响
   验证点：
   ① 保存两个方案（同一艘船）→ buildsOfShip 能列出两个
   ② createShipInstance 带 apBuild=方案B → 实例字段跟方案B一致（不是默认、也不是方案A）
   ③ 同一条目不带 apBuild → 用加点页默认那套
   ④ 同一艘船两个条目各带不同 apBuild → 两个实例互不影响（多舰队独立）
   ⑤ 配队页 exportFleet 会带上 apBuild（复制到模拟器时不丢）
   跑法：先起 http://127.0.0.1:3002，再 node test/addpoint_multibuild_regression.js
*/
const puppeteer = require('puppeteer-core');
const fs = require('fs');
/* 先算出大帝的两个「结构值」加点节点 id（BP_TREE 在页面里是懒加载的，测试里不好取） */
const _st = JSON.parse(fs.readFileSync('data/blueprint_stats.json', 'utf8'));
const _bp = JSON.parse(fs.readFileSync('data/blueprint_all.json', 'utf8'));
const _map = JSON.parse(fs.readFileSync('data/blueprint_map.json', 'utf8'));
const _cdn = String(_map['constantine'].cdnId);
/* 方案A 用「结构值 hp」节点，方案B 用「物理抵抗 physResist」节点 —— 两者效果必须不同 */
const _pick = st => { const r = []; _bp.forEach(b => { if (String(b.id) !== _cdn) return; b.systems.forEach(y => y.nodes.forEach(n => {
  const c = _st.nodes[n.id]; if (c && c.addable && c.stat === st) r.push(n.id); })); }); return r; };
const _hp = _pick('hp'), _res = _pick('physResist').concat(_pick('energyResist'));
if (!_hp.length || !_res.length) { console.error('找不到 hp/抵抗 节点'); process.exit(1); }
const N1 = _hp[0], N2 = _res[0];
console.log('[前置] 大帝 cdnId=' + _cdn + '｜方案A(hp)=' + N1 + '  方案B(抵抗)=' + N2);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:3002';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n + (d ? ('  → ' + d) : '')); } else { fail++; console.log('FAIL ' + n + (d ? ('  → ' + d) : '')); } };

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  p.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });

  /* ============ 模拟器：多方案 + 按条目选 ============ */
  await p.goto(BASE + '/simulator.html', { waitUntil: 'load', timeout: 90000 });
  await sleep(4500);

  const S = await p.evaluate(async (cdn, N1, N2) => {
    const out = {};
    const slug = 'constantine';                       // 大帝：有加点树
    out.hpNodeCount = 2;

    /* 加点页默认那套：只点 N1 */
    localStorage.setItem('lagrange_addpoint', JSON.stringify({ [cdn]: { lv: { [N1]: 5 }, manual: {} } }));
    /* 两个保存方案：A 只点 N1（同默认），B 只点 N2 */
    localStorage.setItem('lagrange_addpoint_builds', JSON.stringify([
      { name: '方案A·装甲', ship: cdn, shipName: '大帝', mods: [], lv: { [N1]: 5 }, manual: {}, updatedAt: 1 },
      { name: '方案B·抵抗', ship: cdn, shipName: '大帝', mods: [], lv: { [N2]: 5 }, manual: {}, updatedAt: 2 }
    ]));
    out.builds = buildsOfShip(slug).map(x => x.name);

    const mk = (apBuild) => {
      const e = JSON.parse(JSON.stringify(SHIP_DATABASE[slug]));
      e.selectedModules = { M: 'M1', A: 'A1' };
      if (apBuild) e.apBuild = apBuild;
      const inst = createShipInstance(e, 'ally', false, false);
      return { hp: inst.maxHp, res: inst.physResistBonus || 0, apBuild: inst.apBuild || null, used: inst._apB ? inst._apB._used : 0 };
    };
    out.默认 = mk(null);
    out.用A = mk('方案A·装甲');
    out.用B = mk('方案B·抵抗');
    out.不存在 = mk('这个方案不存在');

    /* 同一条目两条：模拟器两个舰队各选各的 */
    out.两条独立 = [mk('方案A·装甲').hp, mk('方案B·抵抗').hp];
    return out;
  }, String(_cdn), N1, N2);

  console.log('  [调试] ' + JSON.stringify(S));
  check('① 同一艘船能存多个方案（buildsOfShip 列出 2 个）', (S.builds || []).length === 2, (S.builds || []).join(' / '));
  check('② 带 apBuild=方案B 时实例跟方案B一致（方案B是抵抗，不是结构值）',
    S.用B && S.默认 && S.用B.res > 0 && S.用B.hp !== S.默认.hp,
    '默认 hp=' + (S.默认 && S.默认.hp) + ' 抵抗=' + (S.默认 && S.默认.res) + ' / B hp=' + (S.用B && S.用B.hp) + ' 抵抗=' + (S.用B && S.用B.res));
  check('① 带 apBuild=方案A 与默认等价（同一套数值）', S.用A && S.默认 && S.用A.hp === S.默认.hp, '都 = ' + (S.用A && S.用A.hp));
  check('③ 不存在的方案名 → 安全回落（不报错、仍是有效实例）', S.不存在 && S.不存在.hp > 0, 'hp=' + (S.不存在 && S.不存在.hp));
  check('④ 两个条目各带不同方案 → 两个实例结果不同（多舰队独立）',
    S.两条独立 && S.两条独立[0] !== S.两条独立[1], 'A.hp=' + (S.两条独立 && S.两条独立[0]) + ' / B.hp=' + (S.两条独立 && S.两条独立[1]));

  /* ============ ⑨ 整套方案（所有舰船一起）+ 每个舰队各选一套 ============ */
  const S2 = await p.evaluate((HPN1, HPN2) => {
    const slug = 'constantine', cdn = String(BP_MAP[slug].cdnId);
    const mk = (setName) => {
      const e = JSON.parse(JSON.stringify(SHIP_DATABASE[slug]));
      e.selectedModules = { M: 'M1', A: 'A1' };
      if (setName) e.apSet = setName;
      const inst = createShipInstance(e, 'ally', false, false);
      return { hp: inst.maxHp, res: inst.physResistBonus || 0, apSet: inst.apSet || null };
    };
    /* 整套A：这艘船走 hp 节点；整套B：走抵抗节点；默认：什么都不点 */
    localStorage.setItem('lagrange_addpoint', '{}');
    localStorage.setItem('lagrange_addpoint_sets', JSON.stringify([
      { name: '整套A', addedAt: 1, addpoints: { [cdn]: { lv: { [HPN1]: 5 }, manual: {} } } },
      { name: '整套B', addedAt: 2, addpoints: { [cdn]: { lv: { [HPN2]: 5 }, manual: {} } } }
    ]));
    return { 默认: mk(null), 整套A: mk('整套A'), 整套B: mk('整套B'), 不存在的整套: mk('没有这套') };
  }, N1, N2);
  console.log('  [debug] ' + JSON.stringify(S2));
  check('[9] 选「整套A」→ 实例拿到整套A的加点（结构值被改）', S2.整套A.hp !== S2.默认.hp, 'A.hp=' + S2.整套A.hp + ' 默认.hp=' + S2.默认.hp);
  check('[9] 选「整套B」→ 实例拿到整套B的加点（抵抗被改）', S2.整套B.res > 0 && S2.整套B.hp === S2.默认.hp, 'B.res=' + S2.整套B.res + ' B.hp=' + S2.整套B.hp);
  check('[9] 两个舰队各选各的 → 结果不同（互不影响）', S2.整套A.hp !== S2.整套B.hp, 'A.hp=' + S2.整套A.hp + ' vs B.hp=' + S2.整套B.hp);
  check('[9] 选了不存在的整套 → 安全回落默认', S2.不存在的整套.hp === S2.默认.hp, 'hp=' + S2.不存在的整套.hp);

  /* ============ 配队页：导出是否带 apBuild ============ */
  await p.goto(BASE + '/fleet.html', { waitUntil: 'load', timeout: 90000 });
  await sleep(4000);

  const F = await p.evaluate(() => {
    const out = {};
    out.hasHelpers = typeof apBuildSelect === 'function' && typeof setApBuild === 'function' && typeof apBuildsOf === 'function';
    const slug = 'constantine';
    // 直接造一条带 apBuild 的配队
    cur = { id: 'p1', name: '测试', desc: '', active: 0, updatedAt: 1,
      fleets: [{ name: '主队', flagship: '', main: [{ id: slug, name: '大帝', pos: '中排', qty: 1, mods: {}, apBuild: '方案B·抵抗', air: [] }], reinforce: [] }] };
    const dump = exportFleet();
    out.exported = dump.main[0];
    out.exportedKeys = Object.keys(dump.main[0]);
    // 下拉能列出方案（方案是按 cdnId 存的，配队页用 slug，需要能对上）
    out.buildsForSlug = apBuildsOf(slug).length;
    return out;
  });

  console.log('  [调试] ' + JSON.stringify(F));
  check('⑤ 配队页有 apBuildSelect / setApBuild / apBuildsOf', F.hasHelpers === true);

  /* ⑧ 没有保存过方案时，下拉【也要出现】（用户 2026-09-25 反馈"没出现"） */
  const F3 = await p.evaluate(() => {
    localStorage.setItem('lagrange_addpoint_builds', '[]');       // 清空方案
    const sel = typeof apBuildSelect === 'function' ? apBuildSelect({ id: 'constantine', name: '大帝' }, 'main', 0) : '';
    localStorage.setItem('lagrange_addpoint_builds', JSON.stringify([
      { name: '测试A', ship: '60401', shipName: '大帝', mods: [], lv: {}, manual: {}, updatedAt: 1 }]));
    return { 没方案时: sel, 有方案时: apBuildSelect({ id: 'constantine', name: '大帝' }, 'main', 0) };
  });
  console.log('  [debug] ' + JSON.stringify(F3));
  check('⑧ 没有方案时也显示「＋加点方案」入口', /apGoAddpoint/.test(F3.没方案时), F3.没方案时.slice(0, 90));
  check('⑧ 有方案时下拉里出现「加点:测试A」', /加点:测试A/.test(F3.有方案时), (F3.有方案时.match(/加点:[^<]*/g)||[]).join(' | '));
  check('⑤ 配队页按舰船能查到方案（slug→cdnId 对得上）', F.buildsForSlug === 2, F.buildsForSlug + ' 条');
  check('⑤ exportFleet 导出条目带 apBuild（复制到模拟器不丢）', F.exported && F.exported.apBuild === '方案B·抵抗', JSON.stringify(F.exported));

  await b.close();
  console.log('\n==== ' + pass + ' 通过 / ' + fail + ' 失败 ====');
  process.exit(fail ? 1 : 0);
})();
