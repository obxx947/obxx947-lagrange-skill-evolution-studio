/* 配队页「加点」入口回归
   链路：勾选「加点」→ 每艘舰船 / 每架载机右上角出现 ⬆ 角标 → 点这条跳到 addpoint.html 并带上上下文
   要点：点「站位/模块/数量±/删」等既有控件时【不能】跳转，否则这些按钮就废了 */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(n, ok, d) { if (ok) { pass++; console.log('PASS ' + n + (d ? ('  → ' + d) : '')); } else { fail++; console.log('FAIL ' + n + (d ? '  → ' + d : '')); } }

/* 播种：直接写 activeFleet 并 renderAll。
   ⚠️ 必须 saveStore()：切页面后内存态会丢，不写 localStorage 的话下一段测试就没船了。 */
const SEED = (ap) => {
  const af = activeFleet();
  af.name = '加点测试队'; af.addPoint = !!ap; af.stitch = false;
  af.main = [
    { id: 'uranus-spear', name: '乌拉诺斯之矛', pos: '前排', qty: 4, mods: { M: 'M1', A: 'A1', B: 'B2' }, air: [] },
    { id: 'sun-whale', name: '太阳鲸', pos: '中排', qty: 1, mods: { M: 'M2' }, air: [{ id: 'mistral', name: '米斯特拉', kind: 'fighter', slot: 'M2|fighter', qty: 8 }] }
  ];
  af.reinforce = [{ id: 'eternal-vault', name: '永恒苍穹', pos: '增援', qty: 1, mods: { C: 'C1' }, air: [] }];
  renderAll(); saveStore();
};

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  // ⚠️ 必须给够高的视口：配队页底部有 fixed 统计栏，800×600 时下方舰船行会被它盖住，
  //    p.click 点到的会是统计栏而不是舰船（elementFromPoint 实测返回 DIV.cell cyan）
  await p.setViewport({ width: 900, height: 1400 });
  p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
  p.on('pageerror', e => console.log('PAGEERROR: ' + e.message));

  const ev = async (fn, ...a) => { try { return await p.evaluate(fn, ...a); } catch (e) { return { __err: String(e.message) }; } };
  const openFleet = async (ap) => {
    await p.goto('http://127.0.0.1:3888/fleet.html', { waitUntil: 'load', timeout: 90000 });
    await sleep(2600);
    await ev(SEED, ap);
    await sleep(400);
  };

  /* ================= 1. 未勾选加点 → 没有角标 ================= */
  await openFleet(false);
  const t1 = await ev(() => ({
    badges: document.querySelectorAll('.upbadge').length,
    haspt: document.querySelectorAll('.shiprow.haspt').length,
    rows: document.querySelectorAll('#mainList .shiprow, #reinforceList .shiprow').length,
    airitems: document.querySelectorAll('.airitem').length
  }));
  check('1a 未勾选加点 → 没有任何 ⬆ 角标', t1.badges === 0, '角标=' + t1.badges);
  check('1b 未勾选加点 → 没有 haspt 类', t1.haspt === 0, 'haspt=' + t1.haspt);
  check('1c 种子数据就位（3 条舰船 + 1 架载机）', t1.rows === 3 && t1.airitems === 1, '舰船行=' + t1.rows + ' 载机=' + t1.airitems);

  /* ================= 2. 勾选加点（走真实 UI）→ 角标出现 ================= */
  await p.click('#swAdd');
  await sleep(600);
  const t2 = await ev(() => {
    const rows = Array.from(document.querySelectorAll('#mainList .shiprow, #reinforceList .shiprow'));
    const airs = Array.from(document.querySelectorAll('.airitem'));
    return {
      addPoint: !!activeFleet().addPoint,
      rowsWithBadge: rows.filter(r => r.querySelector(':scope > .upbadge')).length,
      rowsWithHaspt: rows.filter(r => r.classList.contains('haspt')).length,
      totalRows: rows.length,
      airWithBadge: airs.filter(a => a.querySelector('.upbadge')).length,
      airWithHaspt: airs.filter(a => a.classList.contains('haspt')).length,
      totalAir: airs.length,
      badgeText: (document.querySelector('.shiprow .upbadge') || {}).textContent || '',
      rowsClickable: rows.filter(r => !!r.getAttribute('onclick')).length
    };
  });
  check('2a 勾选后 addPoint 置位', t2.addPoint === true);
  check('2b 主舰队+增援的每艘舰船右上角都有 ⬆ 角标', t2.rowsWithBadge === t2.totalRows && t2.totalRows === 3, t2.rowsWithBadge + '/' + t2.totalRows);
  check('2c 舰船行带 haspt（可点样式）', t2.rowsWithHaspt === t2.totalRows, t2.rowsWithHaspt + '/' + t2.totalRows);
  check('2d 舰船行都挂了点击', t2.rowsClickable === t2.totalRows, t2.rowsClickable + '/' + t2.totalRows);
  check('2e 载机也有 ⬆ 角标', t2.airWithBadge === t2.totalAir && t2.totalAir === 1, t2.airWithBadge + '/' + t2.totalAir);
  check('2f 角标内容是向上箭头', t2.badgeText.indexOf('⬆') >= 0, JSON.stringify(t2.badgeText));

  /* ================= 3. 点舰船 → 跳到加点页，参数要对 ================= */
  await Promise.all([
    p.waitForNavigation({ waitUntil: 'load', timeout: 25000 }).catch(() => { }),
    p.click('#mainList .shiprow .nm')                 // 点名称为「点舰船」
  ]);
  const u3 = p.url();
  const q3 = new URL(u3).searchParams;
  check('3a 点了舰船 → 跳到 addpoint.html', u3.indexOf('addpoint.html') >= 0, u3.slice(0, 110));
  check('3b 带上舰船 id / 名称', q3.get('ship') === 'uranus-spear' && q3.get('name') === '乌拉诺斯之矛', q3.get('ship') + ' / ' + q3.get('name'));
  check('3c 带上所选模块（下一轮要按模块加点）', q3.get('mods') === 'M:M1,A:A1,B:B2', JSON.stringify(q3.get('mods')));
  check('3d 带上段位/序号/舰队名/数量', q3.get('sec') === 'main' && q3.get('idx') === '0' && q3.get('fleet') === '加点测试队' && q3.get('qty') === '4',
    [q3.get('sec'), q3.get('idx'), q3.get('fleet'), q3.get('qty')].join('|'));

  /* 加点页是 fetch 舰船库后异步渲染的 → 轮询等它出来。
     ⚠️ 2026-09-19 更新：这几项原来找的是 #shipName / #shipKv / #ctxBox 和 .card h3，
        那是【旧版占位页】的元素，真加点页早就没有它们了（所以一直是 FAIL，不是功能坏了）。
        现在改成按真页面的实际结构断言。 */
  let t3 = null;
  for (let k = 0; k < 25; k++) {
    t3 = await ev(() => ({
      title: document.title,
      searchVal: (document.getElementById('shipSearch') || {}).value || '',
      ctx: (document.getElementById('ctxLine') || {}).innerText || '',
      body: (document.getElementById('body') || {}).innerText || '',
      sysCards: document.querySelectorAll('#body .sys,.syscard,.card').length
    }));
    if (/乌拉诺斯之矛/.test(t3.title) && t3.sysCards > 0) break;
    await sleep(300);
  }
  check('3e 加点页标题显示舰名', t3.title.indexOf('乌拉诺斯之矛') >= 0, t3.title);
  check('3f 搜索框回填该舰名', t3.searchVal.indexOf('乌拉诺斯之矛') >= 0, t3.searchVal);
  check('3g 渲染出了加点系统卡片', t3.sysCards > 0, '系统卡片 ' + t3.sysCards + ' 个');
  check('3h 顶栏列出传入的舰队来源', /加点测试队/.test(t3.ctx), t3.ctx.replace(/\s+/g, ' ').slice(0, 80));

  /* ================= 4. 点载机 → 带上载机参数 ================= */
  await openFleet(true);
  await Promise.all([
    p.waitForNavigation({ waitUntil: 'load', timeout: 25000 }).catch(() => { }),
    p.click('.airitem')
  ]);
  const q4 = new URL(p.url()).searchParams;
  check('4a 点载机 → 带 air / airslot / airname', p.url().indexOf('addpoint.html') >= 0 && q4.get('air') === 'mistral' && q4.get('airslot') === 'M2|fighter' && q4.get('airname') === '米斯特拉',
    [q4.get('air'), q4.get('airslot'), q4.get('airname')].join('|'));
  check('4b 载机条目也带上了所属母舰', q4.get('ship') === 'sun-whale', q4.get('ship'));

  /* ================= 5. 关键回归：点既有控件【不能】跳转 ================= */
  await openFleet(true);

  const before5 = p.url();
  const qty0 = await ev(() => activeFleet().main[0].qty);
  await p.click('#mainList .shiprow .qty button');      // 点「−」
  await sleep(1200);
  const qty1 = await ev(() => activeFleet().main[0].qty);
  check('5a 点数量「−」只减数量、不跳转', p.url() === before5 && qty1 === qty0 - 1, 'qty ' + qty0 + '→' + qty1 + ' | url 未变=' + (p.url() === before5));

  const before5b = p.url();
  const posBefore = await ev(() => activeFleet().main[0].pos);
  await p.click('#mainList .shiprow .pos');             // 点站位
  await sleep(1200);
  const posAfter = await ev(() => activeFleet().main[0].pos);
  check('5b 点站位只切站位、不跳转', p.url() === before5b && posAfter !== posBefore, posBefore + '→' + posAfter);

  const before5c = p.url();
  await p.click('#mainList .shiprow button.gold');      // 点模块按钮 → 打开模块弹窗
  await sleep(1000);
  const modOpen = await ev(() => document.getElementById('modModal').classList.contains('show'));
  check('5c 点模块按钮打开弹窗、不跳转', p.url() === before5c && modOpen === true, '弹窗开=' + modOpen);

  // ⚠️ 必须先把模块弹窗关掉：它是全屏遮罩，不关的话后面点载机会被遮罩接走
  await ev(() => closeMods());
  await sleep(300);

  const before5d = p.url();
  await p.click('.airitem .x');                          // 点载机「删」
  await sleep(1000);
  const airGone = await ev(() => (activeFleet().main[1].air || []).length);
  check('5d 点「删」删掉载机、不跳转', p.url() === before5d && airGone === 0, '剩余载机=' + airGone);

  console.log('\n==== ' + pass + ' 通过 / ' + fail + ' 失败 ====');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
