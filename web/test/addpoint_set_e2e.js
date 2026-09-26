/* ============================================================
   总体加点方案 · 端到端验证（puppeteer + Edge）
   ------------------------------------------------------------
   回答的问题：战斗模拟里选了【总体加点方案】，到底生效没有？

   做法：固定随机种子，只换【舰队级 apSet(总体加点方案名)】，把整场战斗跑完比结果。
     当前加点(lagrange_addpoint) = 安东塔斯(cdnId 60801) 点了
        608011004「强化装甲系统」舰船血量+35% @5  +  608010108「协同指挥」
     四场：
       A 不选方案（= 加点页当前那套）        → 时长 155.5s / 结构 234360 / 有协同指挥
       B 选「T_无策略」（方案里这艘船没加点）→ 时长 445.3s / 结构 173600 / 无协同指挥
       C 选「T_有策略」（和当前那套一样）    → 与 A 完全一致
       D/E 只用【模拟器方框右侧下拉】改方案 → 分别等于 C / B
   只要 B 和 A 不同，就证明"选的方案真的进了开战逻辑"。

   另外覆盖两条"方案名有没有带到底"的路径：
     路径1 战舰配队页 ⚔️复制到模拟器（fleet.html 导出 → simulator.html?import=1）
     路径2 模拟器方框右侧下拉 simSetFleetApSet()

   跑法：
     1) cd 拉格朗日智能体3
     2) python -m http.server 3888 --bind 127.0.0.1
     3) node test/addpoint_set_e2e.js
   ============================================================ */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const SEED = 20260926;
const results = [];
function say(...a){ console.log(a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')); }
function check(n,ok,d){ results.push({n,ok:!!ok,d}); say((ok?'PASS ':'FAIL ')+n+(d!==undefined?('  → '+d):'')); }

/* ---------- 页面里：造编队 + 两套方案（可重复调用；路径1 跳页后要重建） ---------- */
function BUILD_COMP() {
    const LV_WITH = { '608011004': 5, '608010108': 1 };
    localStorage.setItem('lagrange_addpoint', JSON.stringify({ '60801': { lv: LV_WITH, manual: {} } }));
    localStorage.setItem('lagrange_addpoint_sets', JSON.stringify([
        { name: 'T_有策略', addpoints: { '60801': { lv: LV_WITH, manual: {} } }, updatedAt: 1 },
        { name: 'T_无策略', addpoints: { '60801': { lv: {},     manual: {} } }, updatedAt: 2 }
    ]));
    localStorage.removeItem('lagrange_sim_fleets');
    /* 编队：太阳鲸×4（M2+C1 载机位 + 8 架 S-列维9号）+ 安东塔斯×3  vs  雷火之星×3
       ⚠️ 太阳鲸不选模块就没有载机位，协同指挥会"无事可做"，测不出差别 */
    const mk = (slug, n, mods, airSlug, airPer) => {
        const t = SHIP_DATABASE[slug];
        const e = Object.assign(JSON.parse(JSON.stringify(t)), { count:n, selectedModules:mods||{}, aircraft:[] });
        recalcAircraftSlots(e);
        if (airSlug && (e.simSlots||[]).length) {
            const sl = e.simSlots.slice().sort((a,b)=>b.cap-a.cap)[0];
            const a = Object.assign(JSON.parse(JSON.stringify(SHIP_DATABASE[airSlug])),
                                    { count: Math.min(airPer||8, sl.cap), slot: sl.key });
            e.aircraft.push(a);
        }
        return e;
    };
    const whale = mk('sun-whale', 4, {M:'M2', C:'C1'}, 's-levi9', 8);
    const ant   = mk('antontas', 3);
    const star  = mk('thunder-star', 3);
    window.__comp = { ally:[whale, ant], enemy:[star] };
    fleetData['ally-escort']    = { main:[whale, ant], reinforcement:[], flagship:null };
    fleetData['ally-escorted']  = { main:[], reinforcement:[], flagship:null };
    fleetData['enemy-escort']   = { main:[star], reinforcement:[], flagship:null };
    fleetData['enemy-escorted'] = { main:[], reinforcement:[], flagship:null };
    fleetData['bomb-fleet']     = { main:[], reinforcement:[], flagship:null, maxAircraft:250 };
    return { whale: !!SHIP_DATABASE['sun-whale'], ant: !!SHIP_DATABASE['antontas'], star: !!SHIP_DATABASE['thunder-star'],
             cdn: (typeof BP_MAP!=='undefined' && BP_MAP['antontas']) ? BP_MAP['antontas'].cdnId : null,
             whaleSlots: (whale.simSlots||[]).map(s=>s.key+'x'+s.cap), whaleAir: whale.aircraft.map(a=>a.name+'x'+a.count) };
}

/* ---------- 页面里：跑一场战斗（seed 固定 → 两次跑的唯一差别就是加点） ---------- */
function RUN_BATTLE(seed, setId, rebuild) {
    let _s = seed >>> 0;
    Math.random = function(){ _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; };
    if (rebuild) {                                  // 重置编队（顺带清掉条目上的 apSet）
        fleetData['ally-escort'].main = JSON.parse(JSON.stringify(window.__comp.ally));
        fleetData['ally-escort'].reinforcement = [];
        fleetData['enemy-escort'].main = JSON.parse(JSON.stringify(window.__comp.enemy));
        fleetData['enemy-escort'].reinforcement = [];
    }
    if (setId === null) delete fleetData['ally-escort'].apSet;
    else if (setId !== '__keep') fleetData['ally-escort'].apSet = setId;   // __keep = 保留方框下拉写进去的那个
    resetBattle();
    var ok;
    try { ok = prepareBattle(); }
    catch(e){ return {err: String(e && e.message), stack: String(e && e.stack || '').split('\n').slice(0,5).join(' | ')}; }
    if (!ok) return {err:'prepareBattle 返回 false'};
    var bs = battleState, n = 0;
    while (!bs.ended && bs.time < 3000 && n < 40000) { processBattleTick(0.1); n++; }
    var apSrc = {};
    (bs.allyShips||[]).forEach(function(s){ apSrc[s._apSrc||'?'] = (apSrc[s._apSrc||'?']||0)+1; });
    var ants = (bs.allyShips||[]).filter(function(s){ return s.id==='antontas'; });
    var antontas = ants[0] || {};
    return { duration: bs.time, ended: !!bs.ended, ticks: n, apSrc: apSrc,
             antontas_apSet: antontas.apSet || '(空)',
             antontas_apBuild: antontas.apBuild===undefined?'(未定义)':String(antontas.apBuild),
             antontas_hpBonus: antontas.hpBonus,
             antontas_apBhp: (antontas._apB&&antontas._apB.ship)?antontas._apB.ship.hp:'(无_apB)',
             antHpList: ants.map(function(s){return s.maxHp;}),
             antontas_hp: antontas.maxHp,
             antontas_cmdAssist: (antontas.cmdAssist||[]).length,
             airN: (bs.allyShips||[]).filter(function(s){ return s.position==='aircraft'; }).length,
             _dbg_apLv: antontas.id ? JSON.stringify((apOf(antontas.id, antontas.apBuild, antontas.apSet)||{}).lv) : null,
             _dbg_sets: (JSON.parse(localStorage.getItem('lagrange_addpoint_sets')||'[]')||[])
                          .map(function(x){ return x.name + '=' + JSON.stringify((x.addpoints&&x.addpoints['60801']&&x.addpoints['60801'].lv)||{}); }).join(' | '),
             _dbg_store: JSON.stringify((apStore()['60801']||{}).lv || {}),
             _dbg_env: (function(){
                var b = buildAddPointBonus('antontas', null, antontas.apSet);
                return { tree60801: !!(BP_TREE && BP_TREE['60801']), treeN: BP_TREE ? Object.keys(BP_TREE).length : -1,
                         sysmap60801: !!(BP_SYSMAP && BP_SYSMAP['60801']),
                         byModule: b ? JSON.stringify(Object.keys(b.byModule||{})) : null,
                         bshipHp: b ? b.ship.hp : null, foldedHp: b ? foldShipLevelFromModules(b, antontas.modules, antontas.selectedModules).hp : null, used: b ? b._used : null, skipped: b ? b._skipped : null };
             })() };
}

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
  const p = await b.newPage();
  p.on('dialog', async d => { try { await d.accept(); } catch(e){} });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  const ev = async (fn, ...a) => { try { return await p.evaluate(fn, ...a); } catch(e){ return {__err: String(e.message)}; } };
  const open = async (url) => { await p.goto(url, { waitUntil:'load', timeout:60000 }); await new Promise(r=>setTimeout(r,4000)); };

  await open(BASE + '/simulator.html');
  const prep = await ev(BUILD_COMP);
  say('准备:', JSON.stringify(prep));
  check('0 舰船数据就绪（太阳鲸/安东塔斯/雷火之星 + cdnId 60801 + 载机位）',
        prep.whale && prep.ant && prep.star && prep.cdn === '60801' && (prep.whaleSlots||[]).length > 0, JSON.stringify(prep));

  /* ---------- 核心：同一随机种子，只换【舰队级总体加点方案】 ---------- */
  say('\n===== 核心：同种子 / 只换【舰队级总体加点方案】=====');
  const A = await ev(RUN_BATTLE, SEED, null, true);          // 默认 = 加点页当前那套
  const B = await ev(RUN_BATTLE, SEED, 'T_无策略', true);
  const C = await ev(RUN_BATTLE, SEED, 'T_有策略', true);
  say('A 默认   :', JSON.stringify(A));
  say('B 无策略 :', JSON.stringify(B));
  say('C 有策略 :', JSON.stringify(C));

  if (A.err || B.err || C.err) {
    check('1 prepareBattle 可跑', false, (A.err||B.err||C.err) + ' @ ' + (A.stack||B.stack||C.stack||''));
  } else {
    const f = x => x.toFixed(1);
    check('1 prepareBattle 可跑 + 战斗能结束', A.ended && B.ended && C.ended, [f(A.duration), f(B.duration), f(C.duration)].join(' / ') + ' 秒');
    check('2 默认 与「有策略」方案结果一致（差 <5%）', Math.abs(A.duration-C.duration)/Math.max(1,A.duration) < 0.05,
          '默认 ' + f(A.duration) + 's vs 有策略 ' + f(C.duration) + 's');
    check('3 ★★ 安东塔斯结构值：默认/有策略(带装甲节点) 必须【高于】无策略方案',
          A.antontas_hp > B.antontas_hp && C.antontas_hp === A.antontas_hp,
          '默认 ' + A.antontas_hp + ' / 有策略 ' + C.antontas_hp + ' / 无策略 ' + B.antontas_hp);
    check('4 ★★ 协同指挥机制：默认/有策略 有、无策略 没有',
          A.antontas_cmdAssist > 0 && B.antontas_cmdAssist === 0 && C.antontas_cmdAssist > 0,
          '默认 ' + A.antontas_cmdAssist + ' / 有策略 ' + C.antontas_cmdAssist + ' / 无策略 ' + B.antontas_cmdAssist);
    check('5 ★ 战斗结果真的随方案变（默认/有策略 vs 无策略 时长不同）', Math.abs(A.duration-B.duration) > 1,
          '默认 ' + f(A.duration) + 's  vs  无策略 ' + f(B.duration) + 's');
    check('6 安东塔斯实拿到的方案名 = 舰队选的（B 应为 T_无策略）',
          B.antontas_apSet === 'T_无策略' && C.antontas_apSet === 'T_有策略', JSON.stringify({B:B.antontas_apSet, C:C.antontas_apSet}));
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
  await open(BASE + '/simulator.html?import=1');
  const imp = await ev(() => {
    const e = (fleetData['enemy-escort'].main || [])[0] || {};
    return { n: (fleetData['enemy-escort'].main||[]).length,
             apSet: e.apSet === undefined ? '(undefined)' : e.apSet,
             apBuild: e.apBuild === undefined ? '(undefined)' : e.apBuild };
  });
  say('导入结果:', JSON.stringify(imp));
  check('11 ★ 配队页带过来的 apSet 没被导入过程丢掉', imp.apSet === 'T_无策略', JSON.stringify(imp));

  /* ---------- 路径 2：模拟器方框右侧下拉 ---------- */
  say('\n===== 路径2：模拟器方框右侧下拉 =====');
  await ev(BUILD_COMP);                              // 上一步跳了页，重建编队
  const box = await ev(() => {
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
        box.hasSelect && (box.opts||[]).includes('T_有策略') && (box.opts||[]).includes('T_无策略'), JSON.stringify(box.opts));
  check('13 下拉选择写到了舰队级 + 每条条目上', box.apSet === 'T_有策略' && box.entryApSet === 'T_有策略', JSON.stringify(box));
  check('14 下拉选择被持久化（刷新不丢）', box.savedFleetApSet === 'T_有策略', 'lagrange_sim_fleets 里 = ' + box.savedFleetApSet);

  /* ---------- 路径2 收尾：只用下拉选的那个方案开战（不手工改任何 apSet） ---------- */
  say('\n===== 路径2b：下拉选完直接开战 =====');
  const D = await ev(RUN_BATTLE, SEED, '__keep', false);
  say('D 下拉=有策略:', JSON.stringify(D));
  check('15 ★★ 方框下拉选「T_有策略」→ 战斗结果 = 有策略那场',
        !D.err && D.ended && Math.abs(D.duration - A.duration) < 1 && D.antontas_hp === A.antontas_hp && D.antontas_cmdAssist > 0,
        D.err ? D.err : ('下拉 ' + D.duration.toFixed(1) + 's vs 默认 ' + A.duration.toFixed(1) + 's · hp ' + D.antontas_hp + ' · cmdAssist ' + D.antontas_cmdAssist));
  await ev(() => simSetFleetApSet('ally-escort', 'T_无策略'));
  const E = await ev(RUN_BATTLE, SEED, '__keep', false);
  say('E 下拉=无策略:', JSON.stringify(E));
  check('16 ★★ 下拉改「T_无策略」→ 结果立刻变（且不再有协同指挥）',
        !E.err && E.ended && Math.abs(E.duration - B.duration) < 1 && E.antontas_cmdAssist === 0,
        E.err ? E.err : ('下拉 ' + E.duration.toFixed(1) + 's vs 无策略那场 ' + B.duration.toFixed(1) + 's · cmdAssist ' + E.antontas_cmdAssist));

  /* ---------- 不变量：加点成效不能取决于"加点树是否已加载" ---------- */
  say('\n===== 不变量：加点树 加载前/后 必须算出同一个结果 =====');
  await ev(() => { if (typeof BP_TREE === 'object' && BP_TREE) delete BP_TREE['60801']; });
  const F0 = await ev(RUN_BATTLE, SEED, 'T_有策略', true);
  await ev(() => { if (typeof loadBpTree === 'function') return loadBpTree('60801'); });
  const F1 = await ev(RUN_BATTLE, SEED, 'T_有策略', true);
  say('F0 树未加载:', JSON.stringify({ hp:F0.antontas_hp, hpBonus:F0.antontas_hpBonus, env:F0._dbg_env }));
  say('F1 树已加载:', JSON.stringify({ hp:F1.antontas_hp, hpBonus:F1.antontas_hpBonus, env:F1._dbg_env }));
  check('17 ★★★ 加点成效与「加点树是否已加载」无关（原来：树一加载，船级加成被塞进模块桶就没了）',
        !F0.err && !F1.err && F0.antontas_hpBonus === F1.antontas_hpBonus && F0.antontas_hp === F1.antontas_hp && F1.antontas_hpBonus > 0,
        F0.err ? F0.err : ('树未加载 hpBonus=' + F0.antontas_hpBonus + ' / 树已加载 hpBonus=' + F1.antontas_hpBonus
                           + ' · byModule=' + ((F1._dbg_env||{}).byModule)));

  say('\n--- 页面错误 ---');
  say(errs.length ? errs.slice(0,8).join('\n') : '(无)');

  const bad = results.filter(r => !r.ok);
  say('\n================ ' + (results.length - bad.length) + '/' + results.length + ' 通过 ================');
  bad.forEach(r => say('  FAIL ' + r.n + '  → ' + r.d));
  await b.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('测试崩溃:', e); process.exit(2); });
