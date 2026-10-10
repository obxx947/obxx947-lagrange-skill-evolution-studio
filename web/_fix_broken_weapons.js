/* ============================================================
   修复「武器名损坏」的 27 门武器（名字是段落标题、面板全 0）
   ------------------------------------------------------------
   现象（全库普查发现）：迅捷级/云海级/刺水母级/卡利莱恩级/瑶光级/天玑/BR050-B/理智A101 等
   载机与护卫舰的武器，name 是段落标题（"一、机载投弹系统（投射主武器系统）"、"1. 主武器系统：效率低"），
   dpm 全 0、单发 100（占位），但【单发/攻击持续/锁定/冷却】这些字段是真的。
   ⇒ B 队有 24 架载机（天玑-攻击×10 + 理智A101-B×10 + BR050-B×4）因此零输出，
     实测 B 队"除乌拉诺斯以外"的输出只有游戏的 1/5。

   做法：拿【正常的武器】当参照，按 (单发, 攻击持续, 锁定, 冷却) 完全一致来找兄弟；
   找到唯一匹配 → 沿用它的 name / dpm。找不到或歧义就不动（宁可保持现状也不写错）。

   跑法：node _fix_broken_weapons.js           (只报告)
        node _fix_broken_weapons.js --write   (写库)
============================================================ */
const fs = require('fs');
const db = require('./data/ship_database.json');
const WRITE = process.argv.includes('--write');

const BADNAME = /^(\s*[一二三四五六七八九十]+\s*、|\s*\d+\s*[.、]|补充说明|注\s*[:：])/;
const isBad = w => BADNAME.test(String(w.name || '').trim());

const all = [];
db.forEach(s => Object.keys(s.modules || {}).filter(k => !k.startsWith('_')).forEach(k => {
  const m = s.modules[k];
  const bags = (m.type === 'moduleGroup' && m.variants) ? Object.values(m.variants) : [m];
  (bags || []).forEach(v => (v && v.weapons || []).forEach(w => all.push({ ship: s, slot: k, w })));
}));

const good = all.filter(x => !isBad(x.w) && x.w.dpm && ((x.w.dpm.antiShip || 0) > 0 || (x.w.dpm.antiAir || 0) > 0 || (x.w.dpm.siege || 0) > 0));
const bad = all.filter(x => isBad(x.w));
const key = w => [w.singleDmg, w.atkDuration, w.lockTime, w.cooldown].join('|');

console.log('全库武器 ' + all.length + ' ｜ 名损坏 ' + bad.length + ' ｜ 可当参照的正常武器 ' + good.length);
let fixed = 0, ambiguous = 0, noMatch = 0;
const log = [];
/* ★ 精度更高的匹配：损坏的名字里往往【本身就写着真名】——
      "二、舰首轨道炮系统（搭载×1 ER-850A型舰首轨道炮）"  → 真名 ER-850A型舰首轨道炮
      "一、通用火炮系统（搭载×2"堡垒"MK1-BG-245型通用火炮）" → 真名 堡垒MK1-BG-245型通用火炮
   做法：把括号里的内容当候选真名，去【正常武器】里找包含关系（双向）；
        找不到再用"同族 + 4 个数字字段全同"兜底。 */
function nameFromDesc(desc) {
  const m = String(desc || '').match(/[（(]([^）)]*)[）)]/g) || [];
  const out = [];
  m.forEach(x => {
    let t = x.replace(/^[（(]|[）)]$/g, '');
    t = t.replace(/^搭载\s*×?\s*\d+\s*/, '').replace(/^[×*]\s*\d+\s*/, '').trim();
    if (t.length >= 4) out.push(t);
  });
  return out;
}
function matchByName(cands) {
  const names = [...new Set(cands.map(c => c.w.name))];
  return names.length === 1 ? names[0] : null;
}
bad.forEach(x => {
  const k = key(x.w);
  const fam = String(x.ship.id).replace(/[-_].*$/, '').toLowerCase();
  let hit = null;
  /* ① 从说明里提取真名去匹配正常武器 */
  const candNames = nameFromDesc(x.w.name);
  for (const cn of candNames) {
    const found = good.filter(g => {
      const gn = String(g.w.name || '');
      return gn && (gn.indexOf(cn) >= 0 || cn.indexOf(gn) >= 0);
    });
    const nm = matchByName(found);
    if (nm) { hit = found.find(f => f.w.name === nm); break; }
  }
  /* ② 兜底：同族 + 4 个数字字段全同 */
  if (!hit) {
    const found = good.filter(g => key(g.w) === k
      && String(g.ship.id).replace(/[-_].*$/, '').toLowerCase() === fam);
    const nm = matchByName(found);
    if (nm) hit = found.find(f => f.w.name === nm);
  }
  if (hit) {
    fixed++;
    if (log.length < 16) log.push('  ' + String(x.ship.name).slice(0, 13).padEnd(15) + JSON.stringify(String(x.w.name).slice(0, 24)).padEnd(28)
      + '→ ' + String(hit.w.name).slice(0, 24) + ' 面板' + JSON.stringify(hit.w.dpm));
    if (WRITE) { x.w.name = hit.w.name; x.w.dpm = JSON.parse(JSON.stringify(hit.w.dpm)); if (hit.w._src) x.w._src = hit.w._src; }
  } else {
    const cands = good.filter(g => key(g.w) === k);
    if ([...new Set(cands.map(c => c.w.name))].length > 1) ambiguous++; else noMatch++;
  }
});
console.log('★ 可唯一修复 ' + fixed + ' 门 ｜ 有歧义(多个候选) ' + ambiguous + ' 门 ｜ 找不到参照 ' + noMatch + ' 门');
log.forEach(l => console.log(l));
if (WRITE) {
  fs.writeFileSync('data/ship_database.json', JSON.stringify(db), 'utf8');
  console.log('\n已写入 data/ship_database.json（单行，' + Math.round(fs.statSync('data/ship_database.json').size / 1024) + ' KB）');
}
