/* ============================================================
   全库普查：把本轮在 A/B 两队上发现的每一类问题，拿到【全部舰船】上复查
   —— 只报告，不改数据
   跑法：node _audit_all.js
   ============================================================ */
const fs = require('fs');
const db = require('./data/ship_database.json');
const st = require('./data/blueprint_stats.json');
const all = require('./data/blueprint_all.json');
const arr = Array.isArray(all) ? all : Object.values(all);

/* 遍历所有武器（含 moduleGroup 变体） */
const W = [];
db.forEach(s => Object.keys(s.modules || {}).filter(k => !k.startsWith('_')).forEach(k => {
  const m = s.modules[k];
  const bags = (m.type === 'moduleGroup' && m.variants) ? Object.entries(m.variants) : [[null, m]];
  bags.forEach(([vk, v]) => { if (!v) return;
    (v.weapons || []).forEach(w => W.push({ ship: s, slot: k, variant: vk, mod: v, w: w })); });
}));
const AIRCRAFT = /战机|护航艇|载机|无人机|登陆舰/;
const hit = (w, air) => {
  for (const t of (w.targets || [])) {
    const isAir = (t.types || []).some(x => AIRCRAFT.test(String(x)));
    if (isAir !== air) continue;
    return ((t.hitMin ?? 50) + (t.hitMax ?? 70)) / 2 / 100;
  }
  return null;
};
const R = [];
const P = s => R.push(s);

P('========== ① 机制参数顺序（对照占位符出现顺序重算） ==========');
const ORDER_FIELDS = { P: 'every', T: 'dur', C: 'cd' };
let mechTotal = 0, mechBad = 0; const mechBadList = [];
arr.forEach(ship => (ship.systems || []).forEach(sys => (sys.nodes || []).forEach(nd => {
  const r = st.nodes[nd.id]; if (!r || !r.mechanic) return;
  const desc = String(nd.baseDesc || '');
  const lv = (nd.levelValue || [])[nd.levelValue.length - 1] || [];
  const order = []; desc.replace(/\{([^}]+)\}/g, (m, k) => { order.push(k); return m; });
  if (!order.length) return;
  mechTotal++;
  const K = r.mechanic;
  const expect = {};
  order.forEach((key, i) => {
    const v = parseFloat(lv[i]);
    if (isNaN(v)) return;
    if (ORDER_FIELDS[key]) expect[ORDER_FIELDS[key]] = v;
    else if (K.kind === 'cmdAssist') expect[i === 0 ? 'count' : 'every'] = v;
    else if (K.kind === 'strike') expect[i === 0 ? 'dur' : 'cd'] = v;
    else if (K.kind === 'burst') expect.cut = v;
    else if (/Add|Base|Misc/.test(K.kind)) expect.add = v;
  });
  const bad = Object.keys(expect).some(k => {
    const cur = K[k];
    if (cur == null) return expect[k] > 0;                       // 我这边是 null 但原文有值
    return Math.abs(cur - expect[k]) / Math.max(1, Math.abs(expect[k])) > 0.25;
  });
  if (bad) { mechBad++; if (mechBadList.length < 12) mechBadList.push('  ' + nd.id + '【' + nd.name + '】' + K.kind + ' 我=' + JSON.stringify({ cut: K.cut, dur: K.dur, cd: K.cd, every: K.every, count: K.count, add: K.add }) + ' 原文值=' + JSON.stringify(lv) + ' 顺序=' + order.join(',')); }
})));
P('  机制节点 ' + mechTotal + ' 个，参数对不上 ' + mechBad + ' 个');
mechBadList.forEach(x => P(x));

P('');
P('========== ② 维修武器能不能被引擎读到（moduleGroup 变体） ==========');
let repW = 0, repBad = []; const repShips = new Set();
W.forEach(x => { if (x.w.dpm && x.w.dpm.repair > 0) { repW++; repShips.add(x.ship.id); } });
P('  带维修面板的武器 ' + repW + ' 门，涉及 ' + repShips.size + ' 艘船');
/* 引擎 processRepairs 现在会解析变体 → 只要武器挂在模块/变体里就能读到。检查有没有"挂在非模块字段"的。 */
W.forEach(x => {
  if (!(x.w.dpm && x.w.dpm.repair > 0)) return;
  const ok = x.ship.modules && x.ship.modules[x.slot] && (x.mod.weapons || []).indexOf(x.w) >= 0;
  if (!ok) repBad.push('  ' + x.ship.name + ' / ' + x.slot + ' / ' + x.w.name);
});
P('  读不到的维修武器: ' + repBad.length);
repBad.slice(0, 6).forEach(x => P(x));

P('');
P('========== ③ 每门武器能不能打到它该打的目标（对空武器判据 vs 面板） ==========');
let aaPanelNoSeq = [], seqNoAaPanel = [];
W.forEach(x => {
  const d = x.w.dpm || {};
  const t0 = ((x.w.targets || [])[0] || {}).types || [];
  const seqFirstAir = t0.some(t => AIRCRAFT.test(String(t)));
  const hasAaPanel = (d.antiAir || 0) > 0;
  if (hasAaPanel && !seqFirstAir) aaPanelNoSeq.push('  ' + x.ship.name + ' / ' + x.w.name + ' 对空' + d.antiAir + ' 序列首项=' + JSON.stringify(t0));
  if (seqFirstAir && !hasAaPanel) seqNoAaPanel.push('  ' + x.ship.name + ' / ' + x.w.name + ' 序列首项=' + JSON.stringify(t0) + ' 但对空面板=0');
});
P('  ★ 有对空面板、但序列首项不是载机类（现在打不了空）: ' + aaPanelNoSeq.length);
aaPanelNoSeq.slice(0, 10).forEach(x => P(x));
P('  ★ 序列首项是载机类、但对空面板=0（数据可能把防空值记到对舰字段）: ' + seqNoAaPanel.length);
seqNoAaPanel.slice(0, 10).forEach(x => P(x));

P('');
P('========== ④ 武器名损坏（名字是段落标题 / 占位数据） ==========');
const broken = W.filter(x => /^([一二三四五六七八九十]+、|\d+[.、]|补充说明|注[:：])/.test(String(x.w.name || '').trim()));
P('  名字像段落标题的武器: ' + broken.length);
broken.slice(0, 8).forEach(x => P('  ' + x.ship.name + ' / ' + x.w.name.slice(0, 40) + ' 单发' + x.w.singleDmg + ' 面板' + JSON.stringify(x.w.dpm)));

P('');
P('========== ⑤ 面板 vs 引擎标称（改完 shotsPerCycle 后再核一遍） ==========');
let ok = 0, bad = 0; const badList = [];
W.forEach(x => {
  const d = x.w.dpm || {};
  const panel = Math.max(d.antiShip || 0, d.siege || 0, d.antiAir || 0);
  const cyc = (x.w.cooldown || 0) + (x.w.atkDuration || 0);
  if (!(panel > 0) || !(x.w.singleDmg > 0) || !(cyc > 0)) return;
  const spc = x.w.shotsPerCycle > 0 ? x.w.shotsPerCycle : (x.w.ammo || 1) * (x.w.attacks || 1) * (x.w.mounts || 1);
  const base = Math.max(d.antiShip || 0, d.siege || 0) > 0 ? Math.max(d.antiShip || 0, d.siege || 0) : d.antiAir;
  const h = hit(x.w, base !== d.antiAir) ?? 0.6;
  const eng = x.w.singleDmg * spc * 60 / cyc * h;
  const r = base / eng;
  if (r > 0.85 && r < 1.18) ok++; else { bad++; if (badList.length < 8) badList.push('  ' + x.ship.name + ' / ' + String(x.w.name).slice(0, 24) + ' 面板' + Math.round(base) + ' 引擎标称' + Math.round(eng) + ' r=' + r.toFixed(2) + ' spc=' + spc + ' 命中' + (h * 100).toFixed(0) + '%'); }
});
P('  标称吻合 ' + ok + ' 门 ｜ 仍差 >15% ' + bad + ' 门');
badList.forEach(x => P(x));

P('');
P('========== ⑥ 系统血量（现在应该所有船都有） ==========');
const noSysHp = db.filter(s => !(s.sysHp > 0));
P('  舰船级 sysHp 有值: ' + (db.length - noSysHp.length) + ' / ' + db.length + '（引擎已对没值的默认 25500）');
P('  没值的: ' + noSysHp.map(s => s.name).slice(0, 8).join('、') + (noSysHp.length > 8 ? ' …' : ''));

P('');
P('========== ⑦ 加点节点：解析不出属性的 ==========');
let emptyN = 0, addable = 0, unmapped = 0;
Object.keys(st.nodes).forEach(id => {
  const r = st.nodes[id];
  if (r.empty) emptyN++;
  if (r.addable) { addable++; if (r.stat === 'unmapped' || !r.stat) unmapped++; }
});
P('  空槽 ' + emptyN + ' ｜ 可加点 ' + addable + ' ｜ 其中属性未识别 ' + unmapped);

P('');
P('========== ⑧ 载机的 flightMode / 去回程 ==========');
const ac = db.filter(s => s.position === 'aircraft');
const recip = ac.filter(s => s.flightMode === 'reciprocating');
const recipNoFly = recip.filter(s => !(s.departSec > 0) || !(s.returnSec > 0));
const noMode = ac.filter(s => !s.flightMode);
P('  载机 ' + ac.length + ' 艘 ｜ 往复式 ' + recip.length + ' ｜ 缺去/回程 ' + recipNoFly.length + ' ｜ 没写模式 ' + noMode.length);
P('  缺去/回程: ' + recipNoFly.map(s => s.name).join('、'));
P('  没写模式: ' + noMode.map(s => s.name).join('、'));

console.log(R.join('\n'));
