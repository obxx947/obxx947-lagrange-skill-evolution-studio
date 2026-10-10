// js_reference.mjs — JS 侧参考公式（作为对拍 oracle）
//
// 逐行对应 拉格朗日智能体3/simulator.html 的【现行】实现（2026-10-11 核对）：
//   · 能量伤害    #5347-5352  （加算制；能抗≥100% 不免疫，10% 保底兜底）
//   · 实弹伤害    #5358-5362  （先乘调校再减甲；不破防 10% 保底×调校）
//   · 命中率      #5189 / #5224 / #5243（区间随机 ×(1+(加成−闪避)/100)；clamp 10%~95%）
//   · 三层拦截    （引擎内标准式：1−(1−self)·Π(1−同排)·Π(1−全局)，再乘 (1−反拦截)）
//   · 调校系数 tuningCoeff = 1.0（#5312-5317：2026-09-26 决定"面板即真值"）
//
// 用法：node js_reference.mjs  → stdout 输出 JSON 数组（用例名 → 值）

const TUNING = 1.0;   // simulator.html #5311

// 能量：#5347-5352
function energyDamage(singleDmg, shieldPct, bonusRate) {
  const resist = shieldPct / 100;                          // #5348
  const baseVal = singleDmg * (1 + bonusRate);             // #5317
  let dmg = singleDmg * (1 + bonusRate - resist);          // #5349 ★加算同一括号
  if (dmg <= 0) dmg = baseVal * 0.1;                       // #5350 保底=baseVal×0.1
  dmg *= TUNING;                                           // #5352
  return dmg;
}

// 实弹：#5358-5362（armor 传"有效装甲"= 目标护甲 − 穿甲）
function physicalDamage(singleDmg, armor, bonusRate) {
  const baseVal = singleDmg * (1 + bonusRate);             // #5317
  let dmg = baseVal * TUNING - armor;                      // #5360 ★先乘调校再减甲
  if (dmg <= 0) dmg = baseVal * 0.1 * TUNING;              // #5361
  return dmg;
}

// 命中：#5189 + #5224 + #5243（roll 模拟 RNG() 取到的区间位置）
function hitChance(hitMin, hitMax, roll, evasionPct, hitBonusPct) {
  let hitRate = (hitMin + roll * (hitMax - hitMin)) / 100; // #5189
  hitRate *= (1 + (hitBonusPct - evasionPct) / 100);       // #5224
  return Math.max(0.10, Math.min(0.95, hitRate));          // #5243（HIT_MIN/HIT_MAX）
}

// 三层拦截（标准式，与引擎一致）
function interceptRate(self, same, glob, anti) {
  let total = 1 - self;
  for (const r of same) total *= (1 - r);
  for (const r of glob) total *= (1 - r);
  let intercept = 1 - total;
  intercept *= (1 - anti);
  return Math.max(0, Math.min(1, intercept));
}

const results = {
  "能量-85%盾+20%":      energyDamage(600, 85, 0.20),
  "能量-100%盾无加成":   energyDamage(600, 100, 0.0),
  "能量-100%盾+20%":     energyDamage(600, 100, 0.20),
  "能量-0%盾无加成":     energyDamage(600, 0, 0.0),
  "实弹-140甲+20%":      physicalDamage(300, 140, 0.20),
  "实弹-100甲(穿甲40)":  physicalDamage(300, 100, 0.20),
  "实弹-540甲保底":      physicalDamage(300, 540, 0.20),
  "命中-下沿":           hitChance(50, 70, 0.0, 0, 0),
  "命中-上沿":           hitChance(50, 70, 1.0, 0, 0),
  "命中-闪避30":         hitChance(50, 70, 0.5, 30, 0),
  "命中-下限clamp":      hitChance(50, 70, 0.0, 85, 0),
  "命中-上限clamp":      hitChance(50, 70, 1.0, 0, 100),
  "拦截-三层":           interceptRate(0.10, [0.05, 0.05], [0.02], 0.0),
  "拦截-反拦截减半":     interceptRate(0.10, [0.05, 0.05], [0.02], 0.5),
};

console.log(JSON.stringify(results));
