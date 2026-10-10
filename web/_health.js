/* ============================================================
   全库体检（舰船 / 模块 / 武器 / 加点机制 四层）
   输出：每一层的问题清单 + 影响面，按"对战斗的影响"排序
   跑法：node _health.js
   ============================================================ */
const db = require('./data/ship_database.json');
const st = require('./data/blueprint_stats.json');
const smap = require('./data/blueprint_sysmap.json');
const all = require('./data/blueprint_all.json');
const arr = Array.isArray(all) ? all : Object.values(all);
const R = []; const P = s => R.push(s);

const AIR = /战机|护航艇|载机|无人机|登陆舰/;
const BADNAME = /^(\s*[一二三四五六七八九十]+\s*、|\s*\d+\s*[.、]|补充说明|注\s*[:：]|系统机制|整体基础参数)/;
const NOTEONLY = /补充说明|系统机制|无武器输出|无武器属性|效率(低|中|高)|仅标注系统名称/;

/* 收集所有武器 */
const W = [];
db.forEach(s => Object.keys(s.modules || {}).filter(k => !k.startsWith('_')).forEach(k => {
  const m = s.modules[k];
  const bags = (m.type === 'moduleGroup' && m.variants) ? Object.values(m.variants) : [m];
  (bags || []).forEach(v => (v && v.weapons || []).forEach(w => W.push({ ship: s, slot: k, w })));
}));
const panelOf = w => Math.max((w.dpm || {}).antiShip || 0, (w.dpm || {}).antiAir || 0, (w.dpm || {}).siege || 0);

P('════════ 一、舰船层（' + db.length + ' 艘） ════════');
const noHp = db.filter(s => !(s.hp > 0));
const noArmor = db.filter(s => s.position !== 'aircraft' && !(s.physicalArmor > 0) && !(s.energyArmor > 0));
const noMod = db.filter(s => s.position !== 'aircraft' && !Object.keys(s.modules || {}).filter(k => !k.startsWith('_')).length);
const zeroW = db.filter(s => s.position !== 'aircraft' && !W.some(x => x.ship === s));
P('  ✗ 无结构值: ' + noHp.length + (noHp.length ? '  [' + noHp.map(s => s.name).join('、') + ']' : ' ✅'));
P('  ✗ 无装甲值: ' + noArmor.length + (noArmor.length ? '  [' + noArmor.map(s => s.name).slice(0, 6).join('、') + (noArmor.length > 6 ? '…' : '') + ']' : ' ✅'));
P('  ✗ 无模块: ' + noMod.length + (noMod.length ? '  [' + noMod.map(s => s.name).join('、') + ']' : ' ✅'));
P('  ✗ 无武器(非载机): ' + zeroW.length + (zeroW.length ? '  [' + zeroW.map(s => s.name).join('、') + ']' : ' ✅'));
const ac = db.filter(s => s.position === 'aircraft');
const recip = ac.filter(s => s.flightMode === 'reciprocating');
const noFly = recip.filter(s => !(s.departSec > 0) || !(s.returnSec > 0));
P('  ✗ 往复载机缺去/回程: ' + noFly.length + '/' + recip.length + (noFly.length ? '  [' + noFly.map(s => s.name).join('、') + ']' : ' ✅'));

P('');
P('════════ 二、模块层 ════════');
let modTot = 0, modNoW = 0, groupTot = 0;
const modNoWList = [];
db.forEach(s => Object.keys(s.modules || {}).filter(k => !k.startsWith('_')).forEach(k => {
  const m = s.modules[k];
  if (m.type === 'moduleGroup' && m.variants) {
    groupTot++;
    Object.entries(m.variants).forEach(([vk, v]) => { modTot++; if (!v || !(v.weapons || []).length) { modNoW++; modNoWList.push(s.name + ' ' + k + '/' + vk + ' ' + ((v && v.name) || '')); } });
  } else { modTot++; if (!(m.weapons || []).length) { modNoW++; modNoWList.push(s.name + ' ' + k + ' ' + (m.name || '')); } }
}));
P('  模块变体总数 ' + modTot + '（其中 moduleGroup ' + groupTot + ' 个）');
P('  零武器模块 ' + modNoW + ' 个（含装甲/动力/机库等本来就无武器的，属正常）');
P('  示例: ' + modNoWList.slice(0, 4).join(' ｜ '));

P('');
P('════════ 三、武器层（' + W.length + ' 门） ════════');
const badName = W.filter(x => BADNAME.test(String(x.w.name || '').trim()));
const noteOnly = badName.filter(x => NOTEONLY.test(String(x.w.name || '')));
const realBroken = badName.filter(x => !NOTEONLY.test(String(x.w.name || '')));
P('  ① 名字像段落标题 ' + badName.length + ' 门：其中【说明不是武器】' + noteOnly.length + ' 门（应删）、【真缺数据】' + realBroken.length + ' 门（应按知识库补）');
P('     真缺数据: ' + realBroken.map(x => x.ship.name + '/' + String(x.w.name).slice(0, 18)).slice(0, 8).join(' ｜ '));
const zeroPanel = W.filter(x => panelOf(x.w) === 0 && !BADNAME.test(String(x.w.name || '').trim()));
P('  ② 面板全 0 但名字正常 ' + zeroPanel.length + ' 门: ' + zeroPanel.map(x => x.ship.name + '/' + String(x.w.name).slice(0, 16)).slice(0, 6).join(' ｜ '));
const noTargets = W.filter(x => !(x.w.targets || []).length);
P('  ③ 没有攻击序列 ' + noTargets.length + ' 门: ' + noTargets.map(x => x.ship.name + '/' + String(x.w.name).slice(0, 16)).slice(0, 6).join(' ｜ '));
const seqAirNoPanel = W.filter(x => ((x.w.targets || [])[0] || {}).types && ((x.w.targets || [])[0].types || []).some(t => AIR.test(String(t))) && !(x.w.dpm || {}).antiAir);
P('  ④ 序列首项是载机类但对空面板=0 ' + seqAirNoPanel.length + ' 门（防空值可能记在对舰字段）');

P('');
P('════════ 四、加点机制层 ════════');
let addable = 0, mech = 0, cond = 0, statMap = 0, multi = 0, empty = 0;
Object.keys(st.nodes).forEach(id => {
  const r = st.nodes[id];
  if (r.empty) empty++;
  if (r.addable) addable++;
  if (r.mechanic) mech++;
  if (r.cond) cond++;
  if (r.statMap) statMap++;
  if (r.stats && r.stats.length > 1) multi++;
});
P('  节点 ' + Object.keys(st.nodes).length + '（空槽 ' + empty + ' ｜ 可加点 ' + addable + '）');
P('  机制类 ' + mech + ' ｜ 条件触发 ' + cond + ' ｜ 多参数(statMap) ' + statMap + ' ｜ 一句多机制(stats) ' + multi);
let totSys = 0, nullSys = 0, nullNodes = 0;
arr.forEach(ship => {
  const sm = (smap[String(ship.id)] || {}).systems || {};
  (ship.systems || []).forEach(sys => { totSys++; const m = sm[sys.sysId]; if (!m || (m.scope !== 'module' && m.scope !== 'ship')) { nullSys++; (sys.nodes || []).forEach(n => { const r = st.nodes[n.id]; if (r && r.addable) nullNodes++; }); } });
});
P('  系统映射：总 ' + totSys + ' ｜ 【未归类】' + nullSys + ' 个系统 / ' + nullNodes + ' 个可加点节点');

P('');
P('════════ 五、对战斗影响最大的待修项（按影响排序） ════════');
const impact = [];
impact.push({ n: 'A 对空 -49%', why: 'A 的防空全在载机上（CV-T800/米斯特拉/海氏/林鸮），需按知识库核这几型的武器与命中', fix: '知识库·战机资料/护航艇资料' });
impact.push({ n: '剩余真缺数据武器 ' + realBroken.length + ' 门', why: '面板全 0 → 这些舰船/载机在战斗里零输出', fix: '知识库·各舰种资料（已确认 10 型全命中）' });
impact.push({ n: '9 艘往复载机缺去/回程 ' + noFly.length + ' 艘', why: '往复周期少了去+回程 → 打得太频繁或太慢', fix: '知识库·战机资料（有"去程X秒、返程Y秒"）' });
impact.push({ n: 'sysmap 未归类 ' + nullNodes + ' 个可加点节点', why: '这些加点在引擎里当"未实现"', fix: '_build_sysmap.js 的 matchModule 或按语义兜底' });
impact.forEach((x, i) => P('  ' + (i + 1) + '. ' + x.n + ' —— ' + x.why + '  【可修自：' + x.fix + '】'));

console.log(R.join('\n'));
