/* ============================================================
   完整用户路径 · 真实点击（fleet.html → 模拟器 → 开战）
   ------------------------------------------------------------
   把用户平时那条路整条连起来，中间每一跳都真的点按钮：
     ① 战舰配队页：点「总体加点」下拉选一套方案（真 change）
     ② 点「⚔️ 复制到模拟器」→ 弹窗 → 点「确认并跳转」（真点击，真跳页）
     ③ 模拟器里：点 ▶ 开始战斗，读时长 / 安东塔斯的 maxHp / 协同指挥
   两套方案各跑一遍：有策略应更短、maxHp 更高、有协同指挥。
   —— 本轮那个"onchange 少个引号"的 bug 就是靠"真点击"才暴露的，
      所以这条路必须真点，不能直接调函数。

   跑法：python -m http.server 3888 --bind 127.0.0.1  →  node test/addpoint_set_ui_twopage.js
   ============================================================ */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const results = [];
function say(...a){ console.log(a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')); }
function check(n,ok,d){ results.push({n,ok:!!ok,d}); say((ok?'PASS ':'FAIL ')+n+(d!==undefined?('  → '+d):'')); }
const sleep = ms => new Promise(r=>setTimeout(r,ms));

/* ---------- fleet.html：造一份配队（走页面自己的数据结构）+ 两套总体加点方案 ---------- */
function FLEET_SETUP() {
    const LV_WITH = { '608011004': 5, '608010108': 1 };
    localStorage.setItem('lagrange_addpoint', JSON.stringify({ '60801': { lv: LV_WITH, manual: {} } }));
    localStorage.setItem('lagrange_addpoint_sets', JSON.stringify([
        { name: 'T_有策略', addpoints: { '60801': { lv: LV_WITH, manual: {} } }, updatedAt: 1 },
        { name: 'T_无策略', addpoints: { '60801': { lv: {},     manual: {} } }, updatedAt: 2 }
    ]));
    cur = { id:'plan_t1', name:'两页测试', desc:'', createdAt:Date.now(), updatedAt:Date.now(), active:0,
            fleets:[ { name:'舰队1', flagship:'antontas', addPoint:true, stitch:false,
                       main:[ {id:'sun-whale', name:'太阳鲸', pos:'中排', qty:4, mods:{M:'M2',C:'C1'}, air:[{id:'s-levi9',name:'S-列维9号-重型鱼雷艇',kind:'corvette',slot:'',qty:8}]},
                              {id:'antontas',  name:'安东塔斯', pos:'中排', qty:3, mods:{}, air:[]} ],
                       reinforce:[] } ] };
    fillPos(cur);
    switchTab('editor'); renderAll();
    const sel = document.querySelector('#fleetTabs select, .tabs select, select[onchange*="setFleetApSet"]');
    return { has: !!sel, optCount: sel ? sel.options.length : 0,
             fleetName: activeFleet() ? activeFleet().name : null,
             mainLen: activeFleet() ? activeFleet().main.length : 0 };
}

/* ---------- fleet.html：真 change 选方案 ---------- */
function FLEET_PICK(name) {
    let sel = document.querySelector('select[onchange*="setFleetApSet"]');
    if (!sel) { const all = Array.from(document.querySelectorAll('select')); sel = all.find(s => Array.from(s.options).some(o => o.value === name)); }
    if (!sel) return { err: '配队页找不到总体加点下拉' };
    const has = Array.from(sel.options).some(o => o.value === name);
    sel.value = name;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const af = activeFleet();
    return { has, value: sel.value, onchangeAttr: sel.getAttribute('onchange'),
             fleetApSet: af.apSet || '(空)', entryApSet: (af.main[0]||{}).apSet || '(空)' };
}

function SET_ENEMY() {
    const mk = (slug, n) => Object.assign(JSON.parse(JSON.stringify(SHIP_DATABASE[slug])), { count:n, selectedModules:{}, aircraft:[] });
    fleetData['enemy-escort'] = { main:[mk('thunder-star',3)], reinforcement:[], flagship:null };
    fleetData['enemy-escorted'] = { main:[], reinforcement:[], flagship:null };
    saveFleetsToStorage();
    return { n: fleetData['enemy-escort'].main.length };
}

/* ---------- 模拟器：点 ▶ 开始战斗，等结束 ---------- */
function CLICK_FIGHT() {
    return new Promise(resolve => {
        battleSpeed = 60;
        Math.random = function(){ window.__seed = (window.__seed*1664525+1013904223)>>>0; return window.__seed/4294967296; };
        const btn = Array.from(document.querySelectorAll('button')).find(b => /开始战斗/.test(b.textContent));
        if (!btn) { resolve({ err:'找不到开始战斗按钮' }); return; }
        btn.click();
        let n = 0;
        const t = setInterval(() => {
            n++;
            if (!battleState) { clearInterval(t); resolve({ err:'battleState 没建起来' }); return; }
            if (battleState.ended || n > 600) {
                clearInterval(t); battleRunning = false; battlePaused = false;
                const bs = battleState;
                const ants = (bs.allyShips||[]).filter(s => s.id === 'antontas');
                resolve({ duration: bs.time, ended: !!bs.ended,
                          status: (document.getElementById('battleStatus')||{}).textContent || '',
                          allyAlive: (bs.allyShips||[]).filter(x=>x.alive).length,
                          allyTotal: (bs.allyShips||[]).length,
                          enemyAlive: (bs.enemyShips||[]).filter(x=>x.alive).length,
                          enemyTotal: (bs.enemyShips||[]).length,
                          apSet: (ants[0]||{}).apSet || '(空)', hpBonus: (ants[0]||{}).hpBonus,
                          hp: (ants[0]||{}).maxHp, cmdAssist: ((ants[0]||{}).cmdAssist||[]).length,
                          apSrcAll: Object.keys((bs.allyShips||[]).reduce((o,s)=>{o[s._apSrc||'?']=1;return o;},{})) });
            }
        }, 100);
    });
}

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless:'new', args:['--no-sandbox','--disable-gpu'] });
  const p = await b.newPage();
  p.on('dialog', async d => { try { await d.accept(); } catch(e){} });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  const ev = async (fn, ...a) => { try { return await p.evaluate(fn, ...a); } catch(e){ return {__err:String(e.message)}; } };

  /* ===== 第 1 轮：配队页选「T_有策略」→ 复制到模拟器 → 开战 ===== */
  await p.goto(BASE + '/fleet.html', { waitUntil:'load', timeout:60000 });
  await sleep(2500);
  const setup = await ev(FLEET_SETUP);
  say('配队页准备:', JSON.stringify(setup));
  check('1 配队页里造好了配队，并且有总体加点下拉', setup.has && setup.mainLen === 2, JSON.stringify(setup));

  const pick1 = await ev(FLEET_PICK, 'T_有策略');
  say('配队页下拉:', JSON.stringify(pick1));
  check('2 ★ 配队页下拉选「T_有策略」真的写进去了', pick1.fleetApSet === 'T_有策略' && pick1.entryApSet === 'T_有策略', JSON.stringify(pick1));
  check('3 配队页下拉的 onchange 里没有"未拼接的变量"', !/'\s*\+\s*fid/.test(String(pick1.onchangeAttr)), String(pick1.onchangeAttr));

  // 真点击「⚔️ 复制到模拟器」→「确认并跳转」
  const clicked = await ev(() => {
    const b1 = Array.from(document.querySelectorAll('button')).find(x => /复制到模拟器/.test(x.textContent));
    if (!b1) return { err:'找不到复制到模拟器按钮' };
    b1.click();
    const modal = document.getElementById('simTargetModal');
    const opened = !!(modal && modal.classList.contains('show'));
    const b2 = Array.from(document.querySelectorAll('#simTargetModal button')).find(x => /确认并跳转/.test(x.textContent));
    if (!b2) return { err:'找不到确认并跳转', opened };
    b2.click();
    return { opened, clicked: true };
  });
  say('跳转:', JSON.stringify(clicked));
  check('4 弹窗打开了并点了「确认并跳转」', clicked.clicked === true, JSON.stringify(clicked));

  await p.waitForFunction(() => /simulator\.html/.test(location.href), { timeout: 30000 }).catch(()=>{});
  await sleep(4500);
  const landed = await ev(() => ({ url: location.href.replace(location.origin,''),
      apSet: (fleetData['ally-escort'].main.find(e=>e.id==='antontas')||{}).apSet || '(空)',
      n: fleetData['ally-escort'].main.length }));
  say('模拟器侧:', JSON.stringify(landed));
  check('5 ★★ 跳过来之后，安东塔斯条目上带着「T_有策略」', landed.apSet === 'T_有策略', JSON.stringify(landed));

  say('补敌方舰队:', JSON.stringify(await ev(SET_ENEMY)));
  const run1 = await ev(() => { window.__seed = 20260926; });
  const R1 = await ev(CLICK_FIGHT);
  say('第1轮开战（有策略）:', JSON.stringify(R1));
  check('6 战斗真的打完', !R1.err && R1.ended, R1.err || (R1.duration.toFixed(1)+'s'));
  check('7 安东塔斯拿到有策略那套（maxHp 234360 / 有协同指挥）', R1.hp === 234360 && R1.cmdAssist > 0,
        'maxHp ' + R1.hp + ' · cmdAssist ' + R1.cmdAssist + ' · ' + JSON.stringify(R1.apSrcAll));

  /* ===== 第 2 轮：配队页选「T_无策略」→ 再走一遍 ===== */
  await p.goto(BASE + '/fleet.html', { waitUntil:'load', timeout:60000 });
  await sleep(2500);
  await ev(FLEET_SETUP);
  const pick2 = await ev(FLEET_PICK, 'T_无策略');
  say('配队页下拉（第2轮）:', JSON.stringify(pick2));
  check('8 第2轮选「T_无策略」写进去了', pick2.fleetApSet === 'T_无策略', JSON.stringify(pick2));
  await ev(() => {
    const b1 = Array.from(document.querySelectorAll('button')).find(x => /复制到模拟器/.test(x.textContent));
    b1.click();
    const b2 = Array.from(document.querySelectorAll('#simTargetModal button')).find(x => /确认并跳转/.test(x.textContent));
    b2.click();
  });
  await p.waitForFunction(() => /simulator\.html/.test(location.href), { timeout: 30000 }).catch(()=>{});
  await sleep(4500);
  const landed2 = await ev(() => ({ apSet: (fleetData['ally-escort'].main.find(e=>e.id==='antontas')||{}).apSet || '(空)' }));
  check('9 ★★ 第2轮跳过来带着「T_无策略」', landed2.apSet === 'T_无策略', JSON.stringify(landed2));
  say('补敌方舰队:', JSON.stringify(await ev(SET_ENEMY)));
  await ev(() => { window.__seed = 20260926; });
  const R2 = await ev(CLICK_FIGHT);
  say('第2轮开战（无策略）:', JSON.stringify(R2));
  const side = r => (r.status||'') + ' 我方存活 ' + r.allyAlive + '/' + r.allyTotal + ' 敌方存活 ' + r.enemyAlive + '/' + r.enemyTotal;
  check('10 ★★★ 换方案后安东塔斯的最终数值真的不同（无策略：结构低、无协同指挥）',
        !R2.err && R2.ended && R2.hp === 173600 && R2.cmdAssist === 0 && R2.apSet === 'T_无策略'
        && R1.hp === 234360 && R1.cmdAssist > 0,
        '有策略 maxHp ' + R1.hp + ' / cmd ' + R1.cmdAssist + ' / apSet ' + R1.apSet
        + '   ⇢   无策略 maxHp ' + R2.hp + ' / cmd ' + R2.cmdAssist + ' / apSet ' + R2.apSet);
  say('【记录·不是断言】两轮战场结果：');
  say('    有策略 ' + (R1.duration||0).toFixed(1) + 's  ' + side(R1));
  say('    无策略 ' + (R2.duration||0).toFixed(1) + 's  ' + side(R2));

  say('\n--- 页面错误 ---');
  say(errs.length ? errs.slice(0,8).join('\n') : '(无)');
  const bad = results.filter(r => !r.ok);
  say('\n================ ' + (results.length-bad.length) + '/' + results.length + ' 通过 ================');
  bad.forEach(r => say('  FAIL ' + r.n + ' → ' + r.d));
  await b.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('测试崩溃:', e); process.exit(2); });
