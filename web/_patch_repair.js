/* 按用户 2026-09-24 提供的数据补录「维修」相关（天枢 A 槽 / 玉衡支援系统）
   用户明确：
     · 天枢A3 基础维修量 = 10800/分（资料121 写的 16290 与用户不符 → 用用户的 10800）
     · 天枢A2/A3 与 玉衡-维修巡洋舰A、玉衡-支援巡洋舰A 各携带 300 个一次性维修装甲
     · A3 自带「高效回收」：舰载机死亡后转成维修无人机 → 实测 124200 → 168700，比值 ×1.3583
   资料121/60 提供：天枢 A1 9930 / A2 12930 / C2 13152；玉衡-支援 CRT-9 16120（库里已有）
   写回单行 JSON。
*/
const fs = require('fs');
const P = './data/ship_database.json';
const db = JSON.parse(fs.readFileSync(P, 'utf8'));
const by = n => { const s = db.find(x => x.name === n); if (!s) throw new Error('找不到 ' + n); return s; };
const SRC = '你要的.txt（用户 2026-09-24）';
const rep = [];

/* 维修武器：用引擎现有字段（dpm.repair = 每分钟维修量）。
   repairDuration / repairCooldown 是「一轮维修」的时长 —— 资料只有玉衡给了冷却3秒，
   其余没有 → 先留空，等用户确认后补（引擎会用默认并在战报里标注）。 */
function repairW(name, perMin, opt) {
  return Object.assign({
    name, dmgType: 'none', weaponType: 'support',
    singleDmg: 0, ammo: 1, attacks: 1, atkDuration: 0, lockTime: 0, cooldown: 0,
    priority: '友方', dpm: { repair: perMin }, targets: [], _src: SRC
  }, opt || {});
}

/* ---------- 天枢 A 槽：北斗维修无人机系统（原来完全没有武器）---------- */
(() => {
  const s = by('天枢级-支援航空母舰');
  const A = s.modules.A;
  if (!A || A.type !== 'moduleGroup') throw new Error('天枢 A 不是 moduleGroup');
  A.variants.A1.weapons = [repairW('北斗I型维修无人机(5架)', 9930, { _note: '机制：每30秒下一轮维修时长/冷却−30%；可优先自修' })];
  A.variants.A2.weapons = [repairW('北斗II型维修无人机(5架)', 12930, { _note: '协同维修、快速维修' })];
  A.variants.A3.weapons = [repairW('北斗III型维修无人机(5架)', 10800, { _note: '快速维修；基础值10800按用户给，资料121写16290' })];
  A.variants.A2.armorCount = 300; A.variants.A2._armorSrc = SRC;     // 一次性维修装甲
  A.variants.A3.armorCount = 300; A.variants.A3._armorSrc = SRC;
  /* A3 自带「高效回收」：舰载机死亡 → 转维修无人机 → 维修量 。实测 124200→168700 = ×1.3583 */
  A.variants.A3.recyclePerDead = 0.09;      // 每死 1 架载机 +9%（4 架 = +36%）
  A.variants.A3._recycleSrc = '用户实测：4架存活共修124200 / 死亡共修168700 → ×1.3583（推为每架+9%）';
  const C = s.modules.C;
  if (C && C.variants && C.variants.C2) {
    C.variants.C2.weapons = [repairW('附加维修系统(2架)', 13152, { _note: '自舰结构<30%时自修效果+100%' })];
  }
  rep.push('天枢 A1/A2/A3 补维修武器（9930/12930/10800 每分钟）+ C2（13152）+ A2/A3 各 300 装甲 + A3 高效回收 +9%/架');
})();

/* ---------- 玉衡级-支援巡洋舰 A：已有 CRT-9，补「荧光」应急装甲维修系统 ---------- */
(() => {
  const s = by('玉衡级-支援巡洋舰');
  const A = s.modules.A;
  if (!A) throw new Error('玉衡支援没有 A');
  const ws = A.weapons || (A.weapons = []);
  if (!ws.some(w => /荧光/.test(w.name))) {
    ws.unshift(repairW('"荧光"应急装甲维修系统', 0, {
      _note: '功能：一次性维修装甲（本身不产生维修量）', repairOnly: true
    }));
  }
  A.armorCount = 300; A._armorSrc = SRC;
  const c9 = ws.find(w => /CRT-9/.test(w.name));
  rep.push('玉衡-支援巡洋舰 A：补「荧光」应急装甲维修系统 + 300 装甲' + (c9 ? '（CRT-9 维修量 ' + c9.dpm.repair + ' 库里已有）' : ' ⚠️ CRT-9 未找到'));
})();

/* ---------- 玉衡级-维修巡洋舰 A：巡洋支援系统（资料58 没写，按用户说法有 300 装甲）---------- */
(() => {
  const s = by('玉衡级-维修巡洋舰');
  if (!s.modules.A) {
    /* 蓝图里确实有「巡洋支援系统」，但 ship_database 里没建成模块 → 补一个 */
    s.modules.A = { name: '巡洋支援系统', type: 'support', selfRepair: true, armorCount: 300, _armorSrc: SRC, weapons: [] };
    s._dataGap = '维修量资料里没有（资料58 只写了综合武器系统），只有装甲数按用户给';
  } else {
    s.modules.A.armorCount = 300; s.modules.A._armorSrc = SRC;
  }
  rep.push('玉衡-维修巡洋舰 A：补「巡洋支援系统」模块 + 300 装甲（⚠️ 维修量资料缺失，暂为 0）');
})();

fs.writeFileSync(P, JSON.stringify(db));
rep.forEach(r => console.log('  ' + r));
console.log('已写回（单行）');
