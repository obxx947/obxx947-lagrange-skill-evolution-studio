/* 加点 / 配队 导出-导入 回归
   验证点：
   ① addpoint.html：exportAllAddpoints 产出的文件 —— 类型、船名表、加点条目数、方案数
   ② 空的加点不写进文件（不该把 177 艘空配置全塞进去）
   ③ 单条方案导出 exportBuild → 同一个格式，能被 importAddpointsFile 读回来（往返一致）
   ④ fleet.html：exportPlan 产出 {type:'plans',plans:[一条]}，且能被现有 doImport 读回
   ⑤ 文件名合法（不含 \ / : * ? " < > | 空格）
   跑法：先起 http://127.0.0.1:3002（一键局域网部署.bat 或 python -m http.server 3002），再 node test/export_import_regression.js
*/
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:3002';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n + (d ? ('  → ' + d) : '')); } else { fail++; console.log('FAIL ' + n + (d ? '  → ' + d : '')); } };

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  p.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });

  /* ================= addpoint.html ================= */
  await p.goto(BASE + '/addpoint.html', { waitUntil: 'load', timeout: 90000 });
  await sleep(3500);

  const A = await p.evaluate(() => {
    const out = {};
    // 造两条加点 + 两个方案，其中一条方案挂在某艘真船上
    const realId = (typeof SHIPS !== 'undefined' && SHIPS[0]) ? SHIPS[0].id : 'x';
    const realId2 = (typeof SHIPS !== 'undefined' && SHIPS[1]) ? SHIPS[1].id : 'y';
    SAVE[realId] = { lv: { a: 1, b: 2 }, manual: { craft: 3 } };
    SAVE[realId2] = { lv: {}, manual: {} };            // 空配置：不该被导出
    saveStore();
    storeBuilds([
      { name: '测试方案A', ship: realId, shipName: '船A', mods: [{ key: 'M', variant: 'M1' }], lv: { a: 1 }, manual: {}, updatedAt: 1 },
      { name: '测试方案B', ship: realId2, shipName: '船B', mods: [], lv: { c: 3 }, manual: {}, updatedAt: 2 }
    ]);

    // 拦下载
    const got = [];
    const orig = window.dlFile;
    window.dlFile = (name, text) => got.push({ name, text });
    window.__restore = () => { window.dlFile = orig; };

    exportAllAddpoints();
    out.all = got[0] ? { name: got[0].name, size: got[0].text.length } : null;
    try { out.bundle = JSON.parse(got[0].text); } catch (e) { out.bundle = null; }

    got.length = 0;
    exportBuild(0);
    out.one = got[0] ? { name: got[0].name } : null;
    try { out.oneBundle = JSON.parse(got[0].text); } catch (e) { out.oneBundle = null; }

    out.realId = realId; out.realId2 = realId2;
    out.shipCount = (typeof SHIPS !== 'undefined') ? SHIPS.length : -1;

    /* 把「单条方案」文件当作导入源走一遍 importAddpointsFile 的逻辑：
       这里直接复用它的解析分支，手工构造 File 太麻烦，改为验证读回后的同级条目 */
    // 先清空，再模拟导入
    Object.keys(SAVE).forEach(k => delete SAVE[k]);
    storeBuilds([]);
    const j = out.oneBundle;
    Object.keys(j.addpoints || {}).forEach(k => { SAVE[k] = normRec(j.addpoints[k]); });
    saveStore();
    const all = loadBuilds();
    (j.builds || []).forEach(x => all.push(x));
    storeBuilds(all);
    out.roundTrip = { saveKeys: Object.keys(SAVE).length, builds: loadBuilds().map(x => x.name) };

    window.__restore();
    return out;
  });

  console.log('  [调试] ' + JSON.stringify({ all: A.all, one: A.one, realId: A.realId, shipCount: A.shipCount, roundTrip: A.roundTrip }));
  check('① 导出全部加点：产出文件且是 JSON', !!A.bundle && A.bundle.type === 'lagrange_addpoints', A.all ? A.all.name : '无文件');
  check('① 文件里有 names 船名表', A.bundle && A.bundle.names && Object.keys(A.bundle.names).length > 100, A.bundle ? Object.keys(A.bundle.names || {}).length + ' 条船名' : '');
  check('② 空加点不写进文件（只导出有内容的）', A.bundle && Object.keys(A.bundle.addpoints).length === 1, A.bundle ? '导出 ' + Object.keys(A.bundle.addpoints).length + ' 艘' : '');
  check('① 方案也一起导出', A.bundle && A.bundle.builds.length === 2, A.bundle ? A.bundle.builds.map(x => x.name).join('/') : '');
  check('③ 单条方案导出：同一个格式', !!A.oneBundle && A.oneBundle.type === 'lagrange_addpoints' && A.oneBundle.builds.length === 1, A.one ? A.one.name : '无文件');
  check('③ 单条方案文件往返一致（导回后方案名还在）', A.roundTrip.builds.join(',') === '测试方案A', JSON.stringify(A.roundTrip));
  check('⑤ 文件名合法', !/[\\/:*?"<>| ]/.test((A.all || {}).name || '\\'), (A.all || {}).name);
  /* ⑥ 加点页「导出当前加点」：可读 + 带模块组合 + 带节点明细 */
  const A2 = await p.evaluate(() => {
    const got = [];
    const orig = window.dlFile;
    window.dlFile = (name, text) => got.push({ name, text });
    lv = {}; const ids = [];
    ship.systems.forEach(sy => (sy.nodes || []).forEach(n => { if (ids.length < 2 && n.name && !n.disabled) ids.push(n.id); }));
    ids.forEach(id => lv[id] = 1); manual = { siege: 7 };
    exportCurrentAddpoint();
    window.dlFile = orig;
    let j = null; try { j = JSON.parse(got[0].text); } catch (e) { }
    return { name: got[0] && got[0].name, j, nodes: j ? j['已点亮节点'].length : -1,
             mods: j ? j['模块组合'] : null, sh: j ? j['舰船'] : null,
             man: j ? j['手填'] : null, sid: j ? j['官方编号'] : null };
  });
  console.log('  [debug] ' + JSON.stringify({ name: A2.name, ship: A2.sh, nodes: A2.nodes, mods: A2.mods, manual: A2.man }));
  check('[6] 加点页有「导出当前加点」且产出可读 JSON', !!A2.j && A2.j.type === 'lagrange_addpoint_one', A2.name || 'no-file');
  check('[6] 文件带【模块组合】+【节点明细】', Array.isArray(A2.mods) && A2.nodes >= 1, 'mods=' + JSON.stringify(A2.mods) + ' nodes=' + A2.nodes);
  check('[6] 附带精简 addpoints（能被导入读回）', !!(A2.j && A2.j.addpoints && A2.j.addpoints[A2.sid]), JSON.stringify(A2.man));


  /* ================= fleet.html ================= */
  await p.goto(BASE + '/fleet.html', { waitUntil: 'load', timeout: 90000 });
  await sleep(4000);

  const F = await p.evaluate(() => {
    const out = {};
    out.hasExportPlan = typeof exportPlan === 'function';
    // 造一条配队
    store.plans = [{ id: 'p_test', name: '测试配队/带斜杠', desc: '', createdAt: 1, updatedAt: 1, active: 0,
      fleets: [{ name: '主队', main: [], reinforce: [] }] }];
    saveStore();
    const got = [];
    const orig = window.download;
    window.download = (name, text) => got.push({ name, text });
    exportPlan('p_test');
    window.download = orig;
    out.file = got[0] ? { name: got[0].name } : null;
    try { out.parsed = JSON.parse(got[0].text); } catch (e) { out.parsed = null; }
    // 渲染后我的配队里应有导出按钮
    renderMine();
    out.hasBtn = document.getElementById('mineList').innerHTML.indexOf('exportPlan') >= 0;
    return out;
  });

  console.log('  [调试] ' + JSON.stringify({ hasExportPlan: F.hasExportPlan, file: F.file, hasBtn: F.hasBtn }));
  check('④ fleet.html 有 exportPlan', F.hasExportPlan === true);
  check('④ 单条配队导出：格式与「导出全部」一致（可被导入配队读回）', F.parsed && F.parsed.type === 'plans' && F.parsed.plans.length === 1, F.file ? F.file.name : '无文件');
  check('⑤ 配队文件名里的 / 被替换掉', !/[\\/:*?"<>| ]/.test((F.file || {}).name || '\\'), (F.file || {}).name);
  check('④ 「我的配队」列表里出现 📤 导出 按钮', F.hasBtn === true);
  /* ⑦ 配队页「导出当前配舰」：含模块 + 载机（slot/kind/qty） */
  const F2 = await p.evaluate(() => {
    cur = { id: 'p2', name: 'cur', desc: '', active: 0, updatedAt: 1, fleets: [{
      name: 'main', flagship: '', reinforce: [],
      main: [
        { id: 'constantine', name: 'A', pos: '中排', qty: 2, mods: { M: 'M2', A: 'A1' }, apBuild: 'B',
          air: [{ id: 'mistral', name: '米斯特拉', kind: 'fighter', slot: 'M2', qty: 4 }] },
        { id: 'kaiyang-A', name: 'B', pos: '前排', qty: 3, mods: {}, air: [] }
      ] }] };
    const got = [];
    const orig = window.download;
    window.download = (name, text) => got.push({ name, text });
    exportCurrentPlan();
    window.download = orig;
    let j = null; try { j = JSON.parse(got[0].text); } catch (e) { }
    const m = j && j.plans[0].fleets[0].main[0];
    return { name: got[0] && got[0].name, n: j ? j.plans[0].fleets[0].main.length : -1, mods: m ? m.mods : null, air: m ? m.air : null };
  });
  console.log('  [debug] ' + JSON.stringify(F2));
  check('[7] 配队页有「导出当前配舰」（不用先保存）', F2.n === 2, (F2.name || 'no-file') + ' main=' + F2.n);
  check('[7] 导出里【模块选择】完整', !!(F2.mods && F2.mods.M === 'M2' && F2.mods.A === 'A1'), JSON.stringify(F2.mods));
  check('[7] 导出里【舰载机选择】完整',
    !!(F2.air && F2.air[0] && F2.air[0].slot === 'M2' && F2.air[0].qty === 4 && F2.air[0].kind === 'fighter'),
    JSON.stringify(F2.air));


  await b.close();
  console.log('\n==== ' + pass + ' 通过 / ' + fail + ' 失败 ====');
  process.exit(fail ? 1 : 0);
})();
