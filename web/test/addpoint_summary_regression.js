/* 加点页「属性汇总」两项回归（用户 2026-09-25）
   ① 行标签/系统名不再用「…」截断（CSS 里不能有 text-overflow:ellipsis）
   ② 汇总里要有【本系统】维度的分块（sysBreakdownHtml）
   跑法：先起 http://127.0.0.1:3002，再 node test/addpoint_summary_regression.js
*/
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n + (d ? ('  -> ' + d) : '')); } else { fail++; console.log('FAIL ' + n + (d ? '  -> ' + d : '')); } };

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 120000, args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  p.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
  await p.goto('http://127.0.0.1:3002/addpoint.html', { waitUntil: 'load', timeout: 90000 });
  await new Promise(r => setTimeout(r, 4000));

  const R = await p.evaluate(() => {
    const out = {};
    /* ① CSS 里不该再有 ellipsis 截断（.srow i / .syscard .sec） */
    const css = [].slice.call(document.styleSheets).map(ss => { try { return [].slice.call(ss.cssRules).map(r => r.cssText).join(''); } catch (e) { return ''; } }).join('');
    const srowRule = (css.match(/\.srow i\{[^}]*\}/) || [''])[0];
    const cardRule = (css.match(/\.syscard \.sec\{[^}]*\}/) || [''])[0];
    out.srow = srowRule.slice(0, 120);
    out.card = cardRule.slice(0, 120);
    out.srow有省略号 = /ellipsis/.test(srowRule);
    out.card有省略号 = /ellipsis/.test(cardRule);
    /* ② 系统卡里显示的是完整系统名（不再 slice 8 字） */
    const ship0 = SHIPS[0];
    const longSys = (ship0.systems || []).find(s => (s.sysName || '').length > 8);
    if (longSys) { openShip(ship0.id); out.长名系统 = longSys.sysName; const h = document.querySelector('.syscard'); out.卡片HTML = h ? h.innerHTML.slice(0, 120) : ''; }
    /* ③ 有【本系统】分块函数，且点几个节点后能产出块 */
    out.有函数 = typeof sysBreakdownHtml === 'function';
    localStorage.setItem('lagrange_addpoint', '{}');
    const sid = ship0.id;
    if (typeof openShip === 'function') openShip(sid);
    return out;
  });
  console.log('  [debug] ' + JSON.stringify(R));

  const R2 = await p.evaluate(() => {
    const out = {};
    out.有函数 = typeof sysBreakdownHtml === 'function';
    /* 给当前这艘船每个系统各点一个可加点，看能不能产出【本系统】分块 */
    lv = {};
    (ship.systems || []).forEach(s => {
      const n = (s.nodes || []).find(x => { const st = STATS.nodes[x.id]; return st && st.addable && !st.empty; });
      if (n) lv[n.id] = 3;
    });
    persist();
    const html = statPanelHtml();
    out.点了几个 = Object.keys(lv).length;
    out.面板长度 = html.length;
    out.有本系统块 = html.indexOf('按【本系统】分开看') >= 0;
    out.块数 = (html.match(/个系统有加点/g) || []).length;
    out.片段 = (html.match(/按【本系统】分开看[^<]*/) || [''])[0];
    return out;
  });
  console.log('  [debug] ' + JSON.stringify(R2));

  check('① 汇总行标签不再 text-overflow:ellipsis', R.srow有省略号 === false, R.srow);
  check('① 系统卡副标题不再 text-overflow:ellipsis', R.card有省略号 === false, R.card);
  check('② 有【本系统】分块函数 sysBreakdownHtml', R2.有函数 === true);
  check('③ 点了节点后，汇总里出现「按【本系统】分开看」分块', R2.有本系统块 === true,
    '点了 ' + R2.点了几个 + ' 个系统 · ' + R2.片段);

  await b.close();
  console.log('\n==== ' + pass + ' 通过 / ' + fail + ' 失败 ====');
  process.exit(fail ? 1 : 0);
})();
