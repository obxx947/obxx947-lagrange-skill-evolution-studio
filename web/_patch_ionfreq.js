/* 一次性数据补丁：5 门离子炮缺 ammo/attacks（= 伤害频率），引擎一直按 1 发打。
   反推依据：面板DPM = 单发 × 安装数 × 攻击次数 × 60 ÷ (攻击持续 + 冷却)
     （用户 2026-09-24 给的公式：(单发基础-抵抗+强化)×武器安装数×攻击轮次×每轮攻击次数×60÷(持续+冷却)）
   5 门反推值全是整数：艾奥攻坚12 / 艾奥高速5 / 棕熊6 / 全能6 / 游骑兵3
   用户口述核对：艾奥-攻坚「攻击持续8秒、伤害频率6次」→ 6 × 双联装2 = 12 ✓
                  艾奥-高速「4秒5发、间隔0.8秒」→ 4÷5 = 0.8 ✓
   写回格式必须是单行 JSON.stringify（带缩进会把 558KB 变成 2 万行）。 */
const fs = require('fs');
const P = './data/ship_database.json';
const db = JSON.parse(fs.readFileSync(P, 'utf8'));

// [船id, 武器名关键字, ammo, attacks]  ← attacks 决定批次（间隔 = 攻击持续/attacks）
const PATCH = [
  ['aio-A',        '雷式MK2-AI-2x720',   2, 6],   // 双联装 × 频率6 → 12 发，间隔 8/6=1.333s
  ['aio-B',        '雷式MK2-AI-420T',    1, 5],   // 5 发，间隔 4/5=0.8s（资料一致）
  ['brownbear-A',  'BI-750型重型离子炮',  1, 6],
  ['quanneng-TE',  'FI-750A型双联装',    2, 3],   // 双联装 × 3 → 6 发
  ['ranger-B',     '氦闪CI-700T',        1, 3],
];

let done = 0;
function walk(owner, arr, shipId) {
  if (!Array.isArray(arr)) return;
  arr.forEach(w => {
    for (const [sid, kw, ammo, attacks] of PATCH) {
      if (shipId === sid && String(w.name || '').includes(kw) && w.ammo === undefined) {
        w.ammo = ammo;
        w.attacks = attacks;
        w._freqSrc = '面板反推 + 用户口述核对：安装数' + ammo + ' × 频率' + attacks + ' = ' + (ammo * attacks) + ' 发/轮';
        done++;
        console.log('  ✔', shipId, w.name, '→ ammo=' + ammo + ', attacks=' + attacks, '=', ammo * attacks, '发');
      }
    }
  });
}

// 先确认这些 id 存在
PATCH.forEach(([sid]) => {
  const s = db.find(x => x.id === sid);
  if (!s) console.log('  ⚠ 找不到 id:', sid);
  else console.log('  船:', sid, s.name);
});

db.forEach(s => {
  walk(s, s.weapons, s.id);
  Object.values(s.modules || {}).forEach(m => {
    walk(m, m.weapons, s.id);
    Object.values(m.variants || {}).forEach(v => walk(v, v.weapons, s.id));
  });
});

console.log('共补', done, '门');
fs.writeFileSync(P, JSON.stringify(db));   // ★ 必须单行
console.log('已写回（单行）');
