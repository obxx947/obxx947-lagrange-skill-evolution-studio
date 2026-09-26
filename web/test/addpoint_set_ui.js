/* ============================================================
   总体加点方案 · 【真实点击 UI】端到端（puppeteer + Edge）
   ------------------------------------------------------------
   和 addpoint_set_e2e.js 的区别：那个是直接调 prepareBattle/processBattleTick，
   这个走【和用户完全一样的那条路】：
       点 ▶ 开始战斗 → 等战斗结束（真的跑 setTimeout 循环）→
       在【方框右侧下拉】里换方案（真的 dispatch change）→
       再点 ▶ 开始战斗（不点重置，就是用户平时的操作）→ 比时长。
   目的：把"绕过 UI"的盲区补上（startBattle 的 battleState 复用、下拉 onchange、
        战报渲染 这些只有走 UI 才会暴露）。

   跑法：python -m http.server 3888 --bind 127.0.0.1  →  node test/addpoint_set_ui.js
   ============================================================ */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const results = [];
function say(...a){ console.log(a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')); }
function check(n,ok,d){ results.push({n,ok:!!ok,d}); say((ok?'PASS ':'FAIL ')+n+(d!==undefined?('  → '+d):'')); }
const sleep = ms => new Promise(r=>setTimeout(r,ms));

function BUILD_COMP() {
    const LV_WITH = { '608011004': 5, '608010108': 1 };
    localStorage.setItem('lagrange_addpoint', JSON.stringify({ '60801': { lv: LV_WITH, manual: {} } }));
    localStorage.setItem('lagrange_addpoint_sets', JSON.stringify([
        { name: 'T_有策略', addpoints: { '60801': { lv: LV_WITH, manual: {} } }, updatedAt: 1 },
        { name: 'T_无策略', addpoints: { '60801': { lv: {},     manual: {} } }, updatedAt: 2 }
    ]));
    localStorage.removeItem('lagrange_sim_fleets');
    const mk = (slug, n, mods, airSlug, airPer) => {
        const e = Object.assign(JSON.parse(JSON.stringify(SHIP_DATABASE[slug])), { count:n, selectedModules:mods||{}, aircraft:[] });
        recalcAircraftSlots(e);
        if (airSlug && (e.simSlots||[]).length) {
            const sl = e.simSlots.slice().sort((a,b)=>b.cap-a.cap)[0];
            e.aircraft.push(Object.assign(JSON.parse(JSON.stringify(SHIP_DATABASE[airSlug])), { count: Math.min(airPer||8, sl.cap), slot: sl.key }));
        }
        return e;
    };
    fleetData['ally-escort']    = { main:[mk('sun-whale',4,{M:'M2',C:'C1'},'s-levi9',8), mk('antontas',3)], reinforcement:[], flagship:null };
    fleetData['ally-escorted']  = { main:[], reinforcement:[], flagship:null };
    fleetData['enemy-escort']   = { main:[mk('thunder-star',3)], reinforcement:[], flagship:null };
    fleetData['enemy-escorted'] = { main:[], reinforcement:[], flagship:null };
    fleetData['bomb-fleet']     = { main:[], reinforcement:[], flagship:null, maxAircraft:250 };
    renderFleetPanels();
    return { ok: !!SHIP_DATABASE['antontas'] };
}

/* 页面里：点 ▶ 开始战斗，等它结束，返回时长（战斗日志/战报都走真实渲染） */
function CLICK_FIGHT() {
    return new Promise(resolve => {
        battleSpeed = 60;                       // 加速（等价于用户点 60x），跑得快
        const btn = Array.from(document.querySelectorAll('button')).find(b => /开始战斗/.test(b.textContent));
        if (!btn) { resolve({ err: '找不到「开始战斗」按钮' }); return; }
        btn.click();
        let n = 0;
        const t = setInterval(() => {
            n++;
            if (!battleState) { clearInterval(t); resolve({ err: 'battleState 没建起来' }); return; }
            if (battleState.ended || n > 600) {
                clearInterval(t);
                battleRunning = false; battlePaused = false;
                const bs = battleState;
                const ants = (bs.allyShips||[]).filter(s => s.id === 'antontas');
                resolve({
                    duration: bs.time, ended: !!bs.ended, ticks: n,
                    status: document.getElementById('battleStatus') ? document.getElementById('battleStatus').textContent : '',
                    apSet: (ants[0]||{}).apSet || '(空)',
                    hpBonus: (ants[0]||{}).hpBonus,
                    hp: (ants[0]||{}).maxHp,
                    cmdAssist: ((ants[0]||{}).cmdAssist||[]).length,
                    apSrcAll: Object.keys((bs.allyShips||[]).reduce((o,s)=>{o[s._apSrc||'?']=1;return o;},{}))
                });
            }
        }, 100);
    });
}

/* 页面里：在方框右侧下拉里选方案（真实 change 事件） */
function PICK_SET_IN_BOX(name) {
    const sels = Array.from(document.querySelectorAll('.fleet-panel-apset select'));
    if (!sels.length) return { err: '方框里没有加点方案下拉' };
    const sel = sels[0];                                   // 第一个方框 = 我方护航舰队
    const has = Array.from(sel.options).some(o => o.value === name);
    sel.value = name;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { has, value: sel.value, onchangeAttr: sel.getAttribute('onchange'),
             onclickAttr: sel.getAttribute('onclick'),
             fleetApSet: fleetData['ally-escort'].apSet,
             entryApSet: (fleetData['ally-escort'].main[0]||{}).apSet,
             fleets: Object.keys((fleetData['ally-escort']||{})),
             directTry: (function(){ try { simSetFleetApSet('ally-escort', name); return String(fleetData['ally-escort'].apSet); } catch(e){ return 'ERR '+e.message; } })() };
}

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless:'new', args:['--no-sandbox','--disable-gpu'] });
  const p = await b.newPage();
  p.on('dialog', async d => { try { await d.accept(); } catch(e){} });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  const ev = async (fn, ...a) => { try { return await p.evaluate(fn, ...a); } catch(e){ return {__err:String(e.message)}; } };

  await p.goto(BASE + '/simulator.html', { waitUntil:'load', timeout:60000 });
  await sleep(4000);
  // 固定随机种子（否则两场战斗的随机不同，比不出因果）
  await ev(() => { window.__seed = 20260926; Math.random = function(){ window.__seed = (window.__seed*1664525+1013904223)>>>0; return window.__seed/4294967296; }; });
  const prep = await ev(BUILD_COMP);
  say('准备:', JSON.stringify(prep));

  say('\n===== 走真实 UI：点开始战斗 → 换方案 → 再点开始战斗（不点重置） =====');
  await ev(() => { window.__seed = 20260926; });
  const R1 = await ev(CLICK_FIGHT);
  say('第 1 场（默认=加点页当前那套）:', JSON.stringify(R1));

  const pick = await ev(PICK_SET_IN_BOX, 'T_无策略');
  say('下拉换方案:', JSON.stringify(pick));
  check('A1 方框下拉里有「T_无策略」这个选项', pick.has === true, JSON.stringify(pick));
  check('A2 下拉选完，舰队级 apSet 变了', pick.fleetApSet === 'T_无策略', JSON.stringify(pick));

  await ev(() => { window.__seed = 20260926; });
  const R2 = await ev(CLICK_FIGHT);
  say('第 2 场（下拉=无策略）:', JSON.stringify(R2));

  const pick2 = await ev(PICK_SET_IN_BOX, 'T_有策略');
  say('下拉再换:', JSON.stringify(pick2));
  await ev(() => { window.__seed = 20260926; });
  const R3 = await ev(CLICK_FIGHT);
  say('第 3 场（下拉=有策略）:', JSON.stringify(R3));

  check('B1 三场都真的打完了', !R1.err && !R2.err && !R3.err && R1.ended && R2.ended && R3.ended,
        [R1.err || R1.duration, R2.err || R2.duration, R3.err || R3.duration].join(' / '));
  check('B2 ★★ 换方案后时长真的变了（无策略那场必须更长）',
        !R2.err && R2.duration > R1.duration + 30,
        '默认 ' + (R1.duration||0).toFixed(1) + 's → 无策略 ' + (R2.duration||0).toFixed(1) + 's');
  check('B3 ★★ 换回有策略，时长回落到和默认一致',
        !R3.err && Math.abs(R3.duration - R1.duration) < 2,
        '默认 ' + (R1.duration||0).toFixed(1) + 's vs 有策略 ' + (R3.duration||0).toFixed(1) + 's');
  check('B4 安东塔斯的加成/机制随方案变（hpBonus 35 vs 0，cmdAssist 1 vs 0）',
        R1.hpBonus === 35 && R2.hpBonus === 0 && R3.hpBonus === 35 && R2.cmdAssist === 0,
        'hpBonus ' + [R1.hpBonus,R2.hpBonus,R3.hpBonus].join('/') + ' · cmdAssist ' + [R1.cmdAssist,R2.cmdAssist,R3.cmdAssist].join('/'));
  check('B5 战报那块能渲染出来（generateBattleReport 不报错）',
        await ev(() => { try { generateBattleReport(); return true; } catch(e){ return String(e.message); } }) === true,
        '');

  /* ---------- 通用防回归：内联事件属性里" + 变量 + 被困在引号里" ----------
     2026-09-26 的坑：生成的 HTML 变成 simSetFleetApSet(' + fid + ', this.value)，
     fid 成了字符串字面量 → 选了方案什么都不发生、也不报错。那种写法语法合法，
     连 new Function() 都查不出来，只能按"引号内容里出现 + 标识符 +"这个特征扫。 */
  const scan = await ev(() => {
    const bad = [];
    const re = /'[^']*\+ *[A-Za-z_$][\w$]* *\+[^']*'/;
    document.querySelectorAll('*').forEach(el => {
      for (const a of Array.from(el.attributes || [])) {
        if (!/^on/i.test(a.name)) continue;
        if (re.test(a.value)) bad.push(el.tagName + '[' + a.name + ']=' + a.value.slice(0, 120));
      }
    });
    return bad;
  });
  check('C1 页面上没有任何「内联事件里 + 变量 + 被困在引号中」的写法',
        Array.isArray(scan) && scan.length === 0,
        Array.isArray(scan) ? (scan.slice(0,4).join(' ｜ ') || '(无)') : JSON.stringify(scan));

  say('\n--- 页面错误 ---');
  say(errs.length ? errs.slice(0,8).join('\n') : '(无)');
  const bad = results.filter(r => !r.ok);
  say('\n================ ' + (results.length-bad.length) + '/' + results.length + ' 通过 ================');
  bad.forEach(r => say('  FAIL ' + r.n + ' → ' + r.d));
  await b.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('测试崩溃:', e); process.exit(2); });
