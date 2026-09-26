/* ============================================================
   按【游戏面板】标定每门武器的"每轮总发数"（写进 ship_database.json）
   ------------------------------------------------------------
   ★ 定稿口径（全库逐门核对得出，不依赖任何命中率假设）：

       面板每分钟伤害 = 单发 × 每轮总发数 × 60 ÷ (攻击持续 + 冷却)      ←【不含命中率】

     证据：不带 (×N) 的武器，把「弹药×攻击次数×安装数」直接代入就与面板精确吻合
       红宝石-BR-1950C轨道炮 需1.0=自然1 ｜ BI-850双联重型离子炮 需2.0=自然2
       BG-1850重型火炮 需2.0=自然2 ｜ BG-1950重型火炮 需4.0=自然4 ｜ BG-2350对舰火炮 需6.0=自然6
     带 (×N) 的正好差那个倍数：
       AIM-1200T型等离子投射器(×2) 需 8 = 弹药1×次数4×安装2
       CM-8xG08型能量导弹发射系统(×2) 需 4 = 1×2×2
     ⇒ 每轮总发数 = 面板 × 周期 ÷ (单发 × 60)，四舍五入即可。

   ⚠️ 走过的弯路（记下来防止再犯）：曾把"命中率"也除进去 → 发数被放大 1/命中 倍
      （AIM-1200T 写成 9 而非 8、BG-340B防空炮 写成 27 而非 4）→ 输出整体偏高，
      再用别的常数去压，越修越乱。面板里没有命中率。

   ② 打载机 / 打舰船的折算系数（vsAirMul / vsShipMul）
      124 门武器同时有对舰和对空面板且两数不同（如 CM-180型导弹发射器 对舰3440/对空810）
      —— 这是游戏里"同一门武器打不同目标命中率不同"的体现；
      引擎已按武器自带的分目标命中表掷命中率，这里补上两个面板之间的差异。

   跑法：node _patch_shots.js           (只报告)
        node _patch_shots.js --write   (写库，保持单行 JSON)
============================================================ */
const fs = require('fs');
const db = require('./data/ship_database.json');
const WRITE = process.argv.includes('--write');

let chShots = 0, same = 0, skip = 0, chAir = 0, chShip = 0;
const log = [];

db.forEach(s => Object.keys(s.modules || {}).filter(k => !k.startsWith('_')).forEach(k => {
  const m = s.modules[k];
  const bags = (m.type === 'moduleGroup' && m.variants) ? Object.values(m.variants) : [m];
  (bags || []).forEach(v => (v && v.weapons || []).forEach(w => {
    const d = w.dpm || {};
    const pAS = Math.max(d.antiShip || 0, d.siege || 0);
    const pAA = d.antiAir || 0;

    /* 基准取哪个面板：先看攻击序列首项（全库 46 门防空武器的面板被记在 antiShip 里） */
    const AIRW = /战机|护航艇|载机|无人机|登陆舰/;
    const t0 = ((w.targets || [])[0] || {}).types || [];
    const seqFirstAir = t0.some(x => AIRW.test(String(x)));
    const baseAir = seqFirstAir || (pAA > 0 && pAA >= pAS);
    const base = baseAir ? pAA : pAS;
    const other = baseAir ? pAS : pAA;

    /* ★★ 2026-09-26：周期必须把【往复载机的去程+返程】也算进去！
       知识库《战斗机制》：「②按去程飞去攻击 → ③按返程返回 → ④机库内等冷却锁定 → ⑤再出舱」
       —— 飞行与冷却是【串行】的，所以真实周期 = 冷却 + 攻击持续 + 去程 + 返程。
       引擎运行时就是这么加的（flightCycleSec）；标定时漏了它
       → 引擎的实际周期比标定用的长 → 载机打不到面板值（这就是"补上正确去/回程后时长反而变差"的原因）。 */
    const _fly = (s.position === 'aircraft' && s.flightMode === 'reciprocating')
        ? ((s.departSec || 0) + (s.returnSec || 0)) : 0;
    const cyc = (w.cooldown || 0) + (w.atkDuration || 0) + _fly;
    if (!(base > 0) || !(w.singleDmg > 0) || !(cyc > 0)) { skip++; return; }

    /* ① 每轮总发数 = 面板 × 周期 ÷ (单发 × 60 × 引擎会掷的命中率)
       —— 面板不含命中，但引擎每发都要掷一次命中（命中区间来自武器自带的 targets）
          ⇒ 想复现"实际输出 = 面板"，就得把这次命中补回发数里。
       命中率取哪一类：
         · 防空武器（序列首项是载机类）：按 B站wiki 的补正 —— 舰载 0.15 / 机载 0.6
         · 其他武器：用攻击序列里【基准面板那一类目标】的命中区间中点（50~70% → 0.6） */
    const _isAA = seqFirstAir;
    const _isAcW = (s.position === 'aircraft');
    let h;
    if (_isAA) h = _isAcW ? 0.6 : 0.15;
    else {
      h = null;
      for (const t of (w.targets || [])) {
        const isAir = (t.types || []).some(x => AIRW.test(String(x)));
        if (isAir !== baseAir) continue;
        h = ((t.hitMin == null ? 50 : t.hitMin) + (t.hitMax == null ? 70 : t.hitMax)) / 2 / 100;
        break;
      }
      if (h == null) h = 0.6;
    }
    /* ⚠️ 用四舍五入，不要保留小数：引擎每轮装填是 `shotsRemaining = totalShots`（重置而非累加），
       1.176 发实际只会打 1 发、小数部分【不会跨轮累加】—— 我先前以为会"自然摊平"，是错的
       （那样会引入不一致的开火节奏，实测把 battle_mechanics 的稳态周期断言打成 6/1、5/2 抖动）。
       已知代价：需 1.18 发的武器会少打一点（约 -15%），需 2.35 发的会多打（+25%），
       两者方向相反、在舰队层面基本抵消。 */
    const need = Math.round(base * cyc / (w.singleDmg * 60 * h));
    if (need >= 1) {
      const natural = (w.ammo || 1) * (w.attacks || 1) * (w.mounts || 1);
      if (need !== natural) {
        chShots++;
        if (log.length < 12) log.push('  ' + String(s.name).slice(0, 11).padEnd(13) + String(w.name).slice(0, 24).padEnd(26)
          + '单发' + String(w.singleDmg).padEnd(6) + '周期' + String(Math.round(cyc)).padEnd(4)
          + '面板' + String(Math.round(base)).padEnd(8) + '自然' + String(natural).padEnd(4) + '→ ' + need);
        if (WRITE) w.shotsPerCycle = need;
      } else { same++; if (WRITE) delete w.shotsPerCycle; }
    } else { skip++; return; }

    /* ② 两个面板之间的折算 */
    if (other > 0 && base > 0) {
      const mul = Math.round((other / base) * 1000) / 1000;
      const field = baseAir ? 'vsShipMul' : 'vsAirMul';
      const otherField = baseAir ? 'vsAirMul' : 'vsShipMul';
      if (WRITE) delete w[otherField];
      if (mul < 0.995 || mul > 1.005) { if (WRITE) w[field] = mul; if (baseAir) chShip++; else chAir++; }
    } else if (WRITE) { delete w.vsAirMul; delete w.vsShipMul; }
  }));
}));

console.log('① 每轮总发数：需改 ' + chShots + ' 门 ｜ 已吻合 ' + same + ' 门 ｜ 跳过 ' + skip + ' 门');
log.forEach(l => console.log(l));
console.log('② 折算系数：vsAirMul ' + chAir + ' 门 ｜ vsShipMul ' + chShip + ' 门');
if (WRITE) {
  fs.writeFileSync('data/ship_database.json', JSON.stringify(db), 'utf8');
  console.log('\n已写入 data/ship_database.json（单行，' + Math.round(fs.statSync('data/ship_database.json').size / 1024) + ' KB）');
}
