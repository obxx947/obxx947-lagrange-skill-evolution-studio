/* 按【游戏面板】校正每门武器的输出口径（写进 ship_database.json）
   依据（用户给的公式）：面板每分钟伤害 = 单发 × 安装数 × 攻击轮次 × 每轮次数 × 60 ÷ (持续+冷却)
   + 引擎本来就按武器自带的【分目标命中表】(targets[].hitMin/hitMax) 抽命中率
     （如 战机 20~30%、驱逐舰/护卫舰 50~70%），而面板把命中算进去了 —— 所以：

     引擎实际输出 = 每轮发数 × 单发 × 60 ÷ (持续+冷却) × 命中率(目标类别)
     令 实际输出 == 面板  ⇒  每轮发数 = 面板 × 周期 ÷ (单发 × 60 × 命中率)

   ① shotsPerCycle 用【对舰/对空里较大的那个面板】当基准算出来
   ② vsAirMul / vsShipMul = 另一个面板 ÷ 基准面板 × (基准命中率 ÷ 该类命中率)
      —— 让"打载机"和"打舰船"的速率分别等于各自的面板
   不带 (×N) 的武器原来 面板/引擎 = 1.00 已经吻合（占比约一半），不动它们。

   跑法：node _patch_shots.js           (只报告)
        node _patch_shots.js --write   (写库，保持单行 JSON)
*/
const fs = require('fs');
const db = require('./data/ship_database.json');
const WRITE = process.argv.includes('--write');

const AIR = /战机|护航艇|登陆舰|无人机/;
function hitOf(w, wantAir) {
  const tg = w.targets || [];
  let hit = null;
  for (const t of tg) {
    const isAir = (t.types || []).some(x => AIR.test(String(x)));
    if (isAir !== wantAir) continue;
    hit = ((t.hitMin ?? 50) + (t.hitMax ?? 70)) / 2 / 100; break;
  }
  return hit == null ? null : hit;
}

let chShots = 0, same = 0, skip = 0, chAir = 0, chShip = 0, noHit = 0;
const log = [];
db.forEach(s => Object.keys(s.modules || {}).filter(k => !k.startsWith('_')).forEach(k => {
  const m = s.modules[k];
  const bags = (m.type === 'moduleGroup' && m.variants) ? Object.values(m.variants) : [m];
  (bags || []).forEach(v => (v && v.weapons || []).forEach(w => {
    const d = w.dpm || {};
    const pAS = Math.max(d.antiShip || 0, d.siege || 0);
    const pAA = d.antiAir || 0;
    /* ★★ 2026-09-26：基准该取哪个面板，先看【攻击序列首项】——
       全库 46 门防空武器的面板被记在了 antiShip 里（序列首项是"舰载机"、对空却是 0），
       例如 永恒风暴「防空导弹阵列」、雷火之星「HM-4x60B中程防空导弹阵列」、
       大帝「CP-3x220型三联装防空脉冲」—— 拿 antiShip 当基准会把发数标错。 */
    const _AIRW = /战机|护航艇|载机|无人机|登陆舰/;
    const _t0 = ((w.targets || [])[0] || {}).types || [];
    const _seqFirstAir = _t0.some(x => _AIRW.test(String(x)));
    const baseAir = _seqFirstAir || pAA >= pAS;      // 序列首项是载机类 → 就是打空的武器
    const base = baseAir ? pAA : pAS;
    const other = baseAir ? pAS : pAA;
    const cyc = (w.cooldown || 0) + (w.atkDuration || 0);
    if (!(base > 0) || !(w.singleDmg > 0) || !(cyc > 0)) { skip++; return; }
    let hBase = hitOf(w, baseAir);
    if (hBase == null) { hBase = 0.6; noHit++; }     // 没有该类命中行 → 用引擎默认区间 50~70 的中点
    const need = Math.round(base * cyc / (w.singleDmg * 60 * hBase));
    const natural = (w.ammo || 1) * (w.attacks || 1) * (w.mounts || 1);
    if (need >= 1) {
      if (Math.abs(need - natural) / Math.max(natural, 1) > 0.15) {
        chShots++;
        if (log.length < 10) log.push('  ' + String(s.name).slice(0, 11).padEnd(13) + String(w.name).slice(0, 22).padEnd(24)
          + '单发' + String(w.singleDmg).padEnd(6) + '命中' + (hBase * 100).toFixed(0) + '%'.padEnd(2)
          + '自然' + String(natural).padEnd(4) + '→ 应为 ' + need);
        if (WRITE) w.shotsPerCycle = need;
      } else { same++; if (WRITE) delete w.shotsPerCycle; }
    } else { skip++; return; }

    /* 另一类的折算：让它也等于它的面板 */
    if (other > 0 && base > 0) {
      const hOther = hitOf(w, !baseAir) ?? 0.6;
      const mul = (other / base) * (hBase / hOther);
      const rounded = Math.round(mul * 1000) / 1000;
      const field = baseAir ? 'vsShipMul' : 'vsAirMul';
      const otherField = baseAir ? 'vsAirMul' : 'vsShipMul';
      if (WRITE) delete w[otherField];
      if (Math.abs(rounded - 1) > 0.005) { if (WRITE) w[field] = rounded; baseAir ? chShip++ : chAir++; }
    } else if (WRITE) { delete w.vsAirMul; delete w.vsShipMul; }
  }));
}));
console.log('① shotsPerCycle：需改 ' + chShots + ' 门 ｜ 已吻合 ' + same + ' 门 ｜ 跳过 ' + skip + ' 门 ｜ 基准类无命中行(按60%) ' + noHit);
log.forEach(l => console.log(l));
console.log('② 折算系数：vsShipMul ' + chShip + ' 门 ｜ vsAirMul ' + chAir + ' 门');
if (WRITE) {
  fs.writeFileSync('data/ship_database.json', JSON.stringify(db), 'utf8');
  console.log('\n已写入（单行，' + Math.round(fs.statSync('data/ship_database.json').size / 1024) + ' KB）');
}
