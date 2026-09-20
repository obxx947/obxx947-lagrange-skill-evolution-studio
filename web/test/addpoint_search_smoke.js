/* addpoint.html 舰船搜索 冒烟测试 */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const results = []; const say = (...a) => console.log(a.join(' '));
const check = (n, ok, d) => { results.push({ n, ok: !!ok }); say((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  → ' + d : '')); };

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  await p.setViewport({ width: 900, height: 1200 });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await p.goto('http://127.0.0.1:3888/addpoint.html', { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2500));
  const ev = async (fn, ...a) => { try { return await p.evaluate(fn, ...a); } catch (e) { return { __err: String(e.message) }; } };

  say('===== 1. 搜索框存在且初始显示当前船 =====');
  const t1 = await ev(() => ({ has: !!document.getElementById('shipSearch'), val: document.getElementById('shipSearch').value, title: document.title }));
  check('搜索框存在', t1.has);
  check('初始显示舰船名', /[\u4e00-\u9fa5A-Za-z]/.test(t1.val || ''), t1.val);

  say('\n===== 2. 输入中文名筛选 =====');
  await ev(() => { const si = document.getElementById('shipSearch'); si.focus(); si.value = '太阳鲸'; si.dispatchEvent(new Event('input')); });
  await new Promise(r => setTimeout(r, 300));
  const t2 = await ev(() => { const its = [...document.querySelectorAll('#shipDrop .it')]; return { show: document.getElementById('shipDrop').classList.contains('show'), names: its.map(x => x.querySelector('span').textContent) }; });
  check('下拉展开', t2.show);
  check('命中太阳鲸', (t2.names || []).some(n => n.indexOf('太阳鲸') >= 0), JSON.stringify(t2.names));

  say('\n===== 3. 点第一项能切船 =====');
  const before = await ev(() => document.title);
  await ev(() => { const it = document.querySelector('#shipDrop .it'); it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
  await new Promise(r => setTimeout(r, 1200));
  const t3 = await ev(() => ({ title: document.title, box: document.getElementById('shipSearch').value, drop: document.getElementById('shipDrop').classList.contains('show') }));
  check('标题切到新船', t3.title !== before, before + ' → ' + t3.title);
  check('搜索框回填船名', t3.box === '太阳鲸-武装战略航空母舰', t3.box);
  check('下拉已收起', !t3.drop);

  say('\n===== 4. 拼音连打 / 首字母 / 编号 =====');
  const cases = [['taiyangjing', '太阳鲸'], ['sl', '砂龙'], ['10201', 'SC002']];
  for (const [q, want] of cases) {
    const r = await ev((qq) => { const si = document.getElementById('shipSearch'); si.focus(); si.value = qq; si.dispatchEvent(new Event('input'));
      const its = [...document.querySelectorAll('#shipDrop .it')]; return its.slice(0, 40).map(x => x.querySelector('span').textContent); }, q);
    check('查「' + q + '」含 ' + want, (r || []).some(n => String(n).indexOf(want) >= 0), '前几项: ' + JSON.stringify((r || []).slice(0, 4)));
  }

  say('\n===== 5. 键盘 ↑↓ + Enter =====');
  await ev(() => { const si = document.getElementById('shipSearch'); si.focus(); si.value = ''; si.dispatchEvent(new Event('input')); });
  await new Promise(r => setTimeout(r, 200));
  const t5a = await ev(() => ({ n: document.querySelectorAll('#shipDrop .it').length, on: document.querySelector('#shipDrop .it.on') ? document.querySelector('#shipDrop .it.on').querySelector('span').textContent : null }));
  await ev(() => { const si = document.getElementById('shipSearch'); si.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
  await new Promise(r => setTimeout(r, 150));
  const t5b = await ev(() => { const el = document.querySelector('#shipDrop .it.on'); return el ? el.querySelector('span').textContent : null; });
  check('全量列表条数=177', t5a.n === 177, '实际 ' + t5a.n);
  check('↓ 键改变高亮项', t5b && t5b !== t5a.on, t5a.on + ' → ' + t5b);
  await ev(() => { const si = document.getElementById('shipSearch'); si.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await new Promise(r => setTimeout(r, 1200));
  const t5c = await ev(() => document.getElementById('shipSearch').value);
  check('Enter 切换到高亮项', t5c === t5b, t5c + ' vs ' + t5b);

  say('\n===== 6. Esc 取消回原值 =====');
  await ev(() => { const si = document.getElementById('shipSearch'); si.focus(); si.value = 'zzz不存在'; si.dispatchEvent(new Event('input')); });
  await new Promise(r => setTimeout(r, 200));
  const t6a = await ev(() => document.querySelector('#shipDrop .none') ? document.querySelector('#shipDrop .none').textContent : '');
  await ev(() => { const si = document.getElementById('shipSearch'); si.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  await new Promise(r => setTimeout(r, 200));
  const t6b = await ev(() => ({ box: document.getElementById('shipSearch').value, show: document.getElementById('shipDrop').classList.contains('show') }));
  check('无结果提示', t6a.indexOf('没找到') >= 0, t6a);
  check('Esc 恢复原名且收起', t6b.box !== 'zzz不存在' && !t6b.show, JSON.stringify(t6b));

  say('\n===== 7. 页面无 JS 报错 =====');
  check('无 pageerror / console.error', errs.length === 0, errs.slice(0, 3).join(' | '));

  const pass = results.filter(r => r.ok).length;
  say('\n通过 ' + pass + '/' + results.length);
  await b.close();
  process.exit(pass === results.length ? 0 : 1);
})();
