/* 加点页「二选一」功能测试（白垩级：电子干扰G ／ 超载运行G，同位置[1,1]） */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const res = []; const say = (...a) => console.log(a.join(' '));
const check = (n, ok, d) => { res.push(!!ok); say((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  → ' + d : '')); };

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1100, height: 1400 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await p.goto('http://127.0.0.1:3888/addpoint.html?ship=chalk-A', { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));
  const ev = async (fn, ...a) => { try { return await p.evaluate(fn, ...a); } catch (e) { return { __err: String(e.message) }; } };

  say('===== 1. 页面加载 + 标题 =====');
  const t1 = await ev(() => ({ title: document.title, box: (document.getElementById('shipSearch') || {}).value }));
  check('加载到白垩级', /白垩/.test(t1.title), t1.title);

  say('\n===== 2. 切到「浮游载机系统I型」（有二选一的系统）=====');
  const t2 = await ev(() => {
    const cards = [...document.querySelectorAll('.syscard')];
    const i = cards.findIndex(c => /载机/.test(c.innerText));
    if (i >= 0) cards[i].click();
    return { n: cards.length, names: cards.map(c => c.innerText.split('\n')[0]) };
  });
  await new Promise(r => setTimeout(r, 600));
  check('找到载机系统卡片', t2.n > 0, '系统 ' + t2.n + ' 个');

  say('\n===== 3. 二选一卡片渲染 =====');
  const t3 = await ev(() => {
    const alts = [...document.querySelectorAll('.node.alt')];
    return alts.map(a => ({
      name: (a.querySelector('.nm') || {}).innerText || '',
      dots: [...a.querySelectorAll('.altsw .altdot')].map(d => ({ t: d.innerText, on: d.classList.contains('on'), title: d.title }))
    }));
  });
  check('渲染出金框二选一卡', t3.length === 1, JSON.stringify(t3));
  check('卡上有 ①② 两个切换点', t3[0] && t3[0].dots.length === 2, JSON.stringify(t3[0] && t3[0].dots));
  check('① 标题含「电子干扰G」', t3[0] && /电子干扰G/.test(t3[0].dots[0].title), t3[0] && t3[0].dots[0].title);
  check('② 标题含「超载运行G」', t3[0] && /超载运行G/.test(t3[0].dots[1].title), t3[0] && t3[0].dots[1].title);
  check('默认显示①（当前卡名=电子干扰G）', t3[0] && /电子干扰G/.test(t3[0].name), t3[0] && t3[0].name);
  const hint = await ev(() => (document.querySelector('.syshead .hint') || {}).innerText || '');
  check('系统头提示里说明了二选一', /二选一/.test(hint), hint.slice(0, 80));

  say('\n===== 4. 点①加点 =====');
  const t4 = await ev(() => {
    const card = document.querySelector('.node.alt');
    card.click();
    return true;
  });
  await new Promise(r => setTimeout(r, 500));
  const t4b = await ev(() => {
    const card = document.querySelector('.node.alt');
    return { ft: (card.querySelector('.ft') || {}).innerText || '', cls: card.className, total: (document.getElementById('totalCost') || {}).textContent };
  });
  check('① 加上了点（ft 显示 1/1）', /1\/1/.test(t4b.ft), JSON.stringify(t4b));

  say('\n===== 5. 切到② → ①的点数应被退回 =====');
  const t5 = await ev(() => {
    const dots = [...document.querySelectorAll('.node.alt .altsw .altdot')];
    dots[1].click();
    return true;
  });
  await new Promise(r => setTimeout(r, 600));
  const t5b = await ev(() => {
    const card = document.querySelector('.node.alt');
    return {
      name: (card.querySelector('.nm') || {}).innerText || '',
      ft: (card.querySelector('.ft') || {}).innerText || '',
      onDots: [...card.querySelectorAll('.altsw .altdot')].map(d => d.classList.contains('on')),
      lv: (typeof lv !== 'undefined') ? JSON.stringify(lv) : '(lv 不可见)'
    };
  });
  check('卡切到「超载运行G」', /超载运行G/.test(t5b.name), t5b.name);
  check('检查点：加的点数已清空（不是 1/1）', !/1\/1/.test(t5b.ft), t5b.ft);
  check('高亮切到第 2 个点', t5b.onDots[1] === true && t5b.onDots[0] === false, JSON.stringify(t5b.onDots));

  say('\n===== 6. 校验底层数据：两个节点不会同时有点数 =====');
  const t6 = await ev(() => {
    const ids = [521010113, 521010114];
    return { a: (lv[521010113] || 0), b: (lv[521010114] || 0) };
  });
  check('互斥成立（最多一个有等级）', (t6.a > 0) !== (t6.b > 0) || (t6.a === 0 && t6.b === 0), '①=' + t6.a + ' ②=' + t6.b);

  say('\n===== 7. 无 JS 报错 =====');
  check('无 pageerror / console.error', errs.length === 0, errs.slice(0, 3).join(' | '));

  const pass = res.filter(Boolean).length;
  say('\n通过 ' + pass + '/' + res.length);
  await b.close();
})();
