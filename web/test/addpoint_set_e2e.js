/* ============================================================
   总体加点方案 · 端到端验证（puppeteer + Edge）
   ------------------------------------------------------------
   目的：回答"战斗模拟选了总体加点方案，到底生效没有"。

   做法：同一随机种子，只换【舰队级 apSet】，跑完整战斗，比时长。
     当前加点(lagrange_addpoint) = 安东塔斯点了 608010108「协同指挥」
     A) 舰队不选方案(默认)   → 应该 ≈ 有策略（短）
     B) 舰队选「T_无策略」   → 应该 ≈ 没策略（长）★关键断言
     C) 舰队选「T_有策略」   → 应该 ≈ A

   另测两条路径真把方案名带到了条目上：
     1) 战舰配队页 → ⚔️复制到模拟器（lagrange_sim_import → ?import=1）
     2) 模拟器方框右侧下拉 simSetFleetApSet()

   跑法：
     1) cd 拉格朗日智能体3
     2) python -m http.server 3888 --bind 127.0.0.1
     3) node test/addpoint_set_e2e.js
   ============================================================ */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const results = [];
function say(...a){ console.log(a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')); }
function check(n,ok,d,extra){ results.push({n,ok:!!ok,d,extra}); say((ok?'PASS ':'FAIL ')+n+(d!==undefined?('  → '+d):'')); }

/* 页面内：跑一场战斗，返回时长。
   seed 固定 → 两次跑的唯一差别就是加点。 */
function RUN_BATTLE(seed, setId) {
  let _s = seed >>> 0;
  Math.random = function(){ _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; };
  if (setId === null) delete fleetData['ally-escort'].apSet;
  else fleetData['ally-escort'].apSet = setId;
  resetBattle();
  var ok;
  try { ok = prepareBattle(); }
  catch(e){ return {err: String(e && e.message), stack: String(e && e.stack || '').split('\n').slice(0,6).join(' | ')}; }
  if (!ok) return {err:'prepareBattle 返回 false'};
  var bs = battleState, n = 0;
  while (!bs.ended && bs.time < 3000 && n < 40000) { processBattleTick(0.1); n++; }
  var apSrc = {};
  (bs.allyShips||[]).forEach(function(s){ apSrc[s._apSrc||'?'] = (apSrc[s._apSrc||'?']||0)+1; });
  var antontas = (bs.allyShips||[]).filter(function(s){ return s.id==='antontas'; })[0] || {};
  return { duration: bs.time, ended: !!bs.ended, ticks: n,
           apSrc: apSrc,
           antontas_apSet: antontas.apSet || '(空)',
           antontas_hp: antontas.maxHp,
           antontas_cmdAssist: (antontas.cmdAssist||[]).length,
           antontas_strikes: (antontas.strikes||[]).length,
           antontas_company: antontas.company || 0,
           airN: (bs.allyShips||[]).filter(function(s){ return s.position==='aircraft'; }).length };
}

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
  const p = await b.newPage();
  p.on('dialog', async d => { try { await d.accept(); } catch(e){} });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await p.goto(BASE + '/simulator.html', { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 4000));
  const ev = async (fn, ...a) => { try { return await p.evaluate(fn, ...a); } catch(e){ return {__err: String(e.message)}; } };

  /* ---------- 准备：一套含策略 / 一套不含 ---------- */
  const prep = await ev(() => {
    /* 安东塔斯(cdnId 60801) 两个能明确量出来的节点：
       608011004「强化装甲系统」= 舰船血量 +35% @5  ← 量化用
       608010108「蜂群无人机作战中枢」= 协同指挥（每 3 秒指挥 5 架对舰火力最高的载机） */
    const LV_WITH = { '608011004': 5, '608010108': 1 };
    localStorage.setItem('lagrange_addpoint', JSON.stringify({ '60801': { lv: LV_WITH, manual: {} } }));
    localStorage.setItem('lagrange_addpoint_sets', JSON.stringify([
      { name: 'T_有策略', addpoints: { '60801': { lv: LV_WITH, manual: {} } }, updatedAt: 1 },
      { name: 'T_无策略', addpoints: { '60801': { lv: {},     manual: {} } }, updatedAt: 2 }
    ]));
    localStorage.removeItem('lagrange_sim_fleets');
    /* 编队：太阳鲸×4（带 M2+C1 载机位 + 13 架 S-列维9号）+ 安东塔斯×3  vs  雷火之星×3
       ⚠️ 太阳鲸不选模块就没有载机位，协同指挥会"无事可做"，测不出差别 */
    const mk = (slug, n, mods, airSlug, airPer) => {
      const t = SHIP_DATABASE[slug];
      const e = Object.assign(JSON.parse(JSON.stringify(t)), { count:n, selectedModules:mods||{}, aircraft:[] });
      recalcAircraftSlots(e);
      if (airSlug && (e.simSlots||[]).length) {
        const sl = e.simSlots.slice().sort((a,b)=>b.cap-a.cap)[0];
        const a = Object.assign(JSON.parse(JSON.stringify(SHIP_DATABASE[airSlug])), { count: Math.min(airPer||8, sl.cap), slot: sl.key });
        e.aircraft.push(a);
      }
      return e;
    };
    const whale = mk('sun-whale', 4, {M:'M2', C:'C1'}, 's-levi9', 8);
    fleetData['ally-escort']     = { main:[whale, mk('antontas',3)], reinforcement:[], flagship:null };
    fleetData['ally-escorted']   = { main:[], reinforcement:[], flagship:null };
    fleetData['enemy-escort']    = { main:[mk('thunder-star',3)], reinforcement:[], flagship:null };
    fleetData['enemy-escorted']  = { main:[], reinforcement:[], flagship:null };
    fleetData['bomb-fleet']      = { main:[], reinforcement:[], flagship:null, maxAircraft:250 };
    return { whale: !!SHIP_DATABASE['sun-whale'], ant: !!SHIP_DATABASE['antontas'], star: !!SHIP_DATABASE['thunder-star'],
             cdn: (typeof BP_MAP!=='undefined' && BP_MAP['antontas']) ? BP_MAP['antontas'].cdnId : null,
             whaleSlots: (whale.simSlots||[]).map(s=>s.key+'x'+s.cap), whaleAir: whale.aircraft.map(a=>a.name+'x'+a.count) };
  });
  say('准备:', JSON.stringify(prep));
  check('0 舰船数据就绪（太阳鲸/安东塔斯/雷火之星 + cdnId 60801）',
        prep.whale && prep.ant && prep.star && prep.cdn === '60801', JSON.stringify(prep));

  /* ---------- 核心：同一随机种子，只换方案 ---------- */
  say('\n===== 核心：同种子 / 只换【舰队级总体加点方案】=====');
  const A = await ev(RUN_BATTLE, 20260926, null);          // 默认 = 当前加点（有策略）
  const B = await ev(RUN_BATTLE, 20260926, 'T_无策略');     // 选一个不含策略的方案
  const C = await ev(RUN_BATTLE, 20260926, 'T_有策略');     // 选一个含策略的方案
  say('A 默认    :', JSON.stringify(A));
  say('B 无策略  :', JSON.stringify(B));
  say('C 有策略  :', JSON.stringify(C));

  if (A.err || B.err || C.err) {
    check('1 prepareBattle 可跑', false, (A.err||B.err||C.err) + ' @ ' + (A.stack||B.stack||C.stack||''));
  } else {
    check('1 prepareBattle 可跑 + 战斗能结束', A.ended && B.ended && C.ended,
          [A.duration.toFixed(1), B.duration.toFixed(1), C.duration.toFixed(1)].join(' / ') + ' 秒');
    check('2 默认 与「有策略」方案结果一致（差 <5%）',
          Math.abs(A.duration - C.duration) / Math.max(1,A.duration) < 0.05,
          '默认 ' + A.duration.toFixed(1) + 's vs 有策略 ' + C.duration.toFixed(1) + 's');
    check('3 ★★ 安东塔斯结构值：默认/有策略(带装甲节点) 必须【高于】无策略方案',
          A.antontas_hp > B.antontas_hp && C.antontas_hp === A.antontas_hp,
          '默认 ' + A.antontas_hp + ' / 有策略 ' + C.antontas_hp + ' / 无策略 ' + B.antontas_hp);
    check('4 ★★ 协同指挥机制：默认/有策略 有、无策略 没有',
          A.antontas_cmdAssist > 0 && B.antontas_cmdAssist === 0 && C.antontas_cmdAssist > 0,
          '默认 ' + A.antontas_cmdAssist + ' / 有策略 ' + C.antontas_cmdAssist + ' / 无策略 ' + B.antontas_cmdAssist);
    check('5 ★ 战斗结果真的随方案变（默认/有策略 vs 无策略 时长不同）',
          Math.abs(A.duration - B.duration) > 1,
          '默认 ' + A.duration.toFixed(1) + 's  vs  无策略 ' + B.duration.toFixed(1) + 's');
    check('6 安东塔斯实拿到的方案名 = 舰队选的（B 应为 T_无策略）',
          B.antontas_apSet === 'T_无策略' && C.antontas_apSet === 'T_有策略',
          JSON.stringify({B:B.antontas_apSet, C:C.antontas_apSet}));
    check('7 战报能看出每艘船实际用的加点来源', Object.keys(A.apSrc).length > 0, JSON.stringify(A.apSrc));
    check('8 我方确实带了载机（否则协同指挥测不出）', A.airN > 0, '载机 ' + A.airN + ' 架');
  }

  /* ---------- 路径 1：战舰配队页 → ⚔️复制到模拟器 ---------- */
  say('\n===== 路径1：配队页复制到模拟器（fleet.html 导出 → ?import=1）=====');
  await ev(() => {
    localStorage.setItem('lagrange_sim_import', JSON.stringify({
      name: '测试配队', target: 'enemy-escort', mode: 'replace', flagship: 'thunder-star',
      main: [ { id:'thunder-star', name:'雷火之星', pos:'中排', qty:3, mods:{}, apBuild:'', apSet:'T_无策略' } ],
      reinforcement: []
    }));
  });
  await p.goto(BASE + '/simulator.html?import=1', { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 4500));
  const imp = await ev(() => {
    const e = (fleetData['enemy-escort'].main || [])[0] || {};
    return { n: (fleetData['enemy-escort'].main||[]).length, apSet: e.apSet === undefined ? '(undefined)' : e.apSet,
             apBuild: e.apBuild === undefined ? '(undefined)' : e.apBuild };
  });
  say('导入结果:', JSON.stringify(imp));
  check('11 ★ 配队页带过来的 apSet 没被导入过程丢掉', imp.apSet === 'T_无策略', JSON.stringify(imp));

  /* ---------- 路径 2：模拟器方框右侧下拉 ---------- */
  say('\n===== 路径2：模拟器方框右侧下拉 simSetFleetApSet =====');
  const box = await ev(() => {
    fleetData['ally-escort'].main = [ { ...SHIP_DATABASE['antontas'], count:3, selectedModules:{}, aircraft:[] } ];
    fleetData['ally-escort'].reinforcement = [];
    renderFleetPanels();
    const sel = document.querySelector('.fleet-panel-apset select');
    const optNames = sel ? Array.from(sel.options).map(o=>o.value) : [];
    simSetFleetApSet('ally-escort', 'T_有策略');
    const after = fleetData['ally-escort'];
    const saved = JSON.parse(localStorage.getItem('lagrange_sim_fleets') || '{}');
    return { hasSelect: !!sel, opts: optNames,
             apSet: after.apSet, entryApSet: (after.main[0]||{}).apSet,
             savedFleetApSet: (saved['ally-escort']||{}).apSet };
  });
  say('下拉结果:', JSON.stringify(box));
  check('12 五个方框里确实渲染出了下拉，且列出两套方案',
        box.hasSelect && box.opts.includes('T_有策略') && box.opts.includes('T_无策略'), JSON.stringify(box.opts));
  check('13 下拉选择写到了舰队级 + 每条条目上', box.apSet === 'T_有策略' && box.entryApSet === 'T_有策略', JSON.stringify(box));
  check('14 下拉选择被持久化（刷新不丢）', box.savedFleetApSet === 'T_有策略', 'lagrange_sim_fleets 里 = ' + box.savedFleetApSet);

  say('\n--- 页面错误 ---');
  say(errs.length ? errs.slice(0,8).join('\n') : '(无)');

  const bad = results.filter(r => !r.ok);
  say('\n================ ' + (results.length - bad.length) + '/' + results.length + ' 通过 ================');
  bad.forEach(r => say('  FAIL ' + r.n + '  → ' + r.d));
  await b.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('测试崩溃:', e); process.exit(2); });
