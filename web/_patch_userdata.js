/* 按用户填写的《你要的.txt》补录数据（2026-09-24）
   内容：
   A. 31 艘载机的【作战模式 + 去程/回程秒数】
   B. 超主力【所有系统独立血量 25500】（船级 sysHp，引擎侧配套改）
   C. 雷火之辉 结构值/护甲/抗性/载机位
   D. 4 艘【基础闪避】
   E. 10 艘空白船（库里连模块都没有）的【完整武器数据】
   写回必须单行 JSON.stringify（带缩进会把库写成 2 万行）。
   跑法：node _patch_userdata.js
*/
const fs = require('fs');
const P = './data/ship_database.json';
const db = JSON.parse(fs.readFileSync(P, 'utf8'));
const SRC = '你要的.txt（用户 2026-09-24 手填）';
const by = n => { const s = db.find(x => x.name === n); if (!s) throw new Error('找不到舰船：' + n); return s; };
const rep = [];

/* ================= A. 作战模式 + 去程/回程 ================= */
const FLIGHT = [
  ['S-列维9号-重型鱼雷艇', 'reciprocating', 9, 5],
  ['鳐-装甲护航艇', 'independent'],
  ['鳐-特种护航艇', 'independent'],
  ['CV-M011型-重炮艇', 'independent'],
  ['CV-M011型-高速导弹艇', 'independent'],
  ['RB7-13型-导弹艇', 'independent'],
  ['RB7-13型-突防护航艇', 'independent'],
  ['野火-格斗护航艇-B型（区域防空）', 'independent'],
  ['野火-TE-鱼雷艇', 'independent'],
  ['坦普尔1号-预警护航艇', 'independent'],
  ['天玑-攻击护航艇（攻击B型）', 'independent'],
  ['野火-TE-鱼雷艇（对舰A型）', 'independent'],
  ['天枪-战术护航艇', 'reciprocating', 12, 6],
  ['天枪-重型鱼雷艇', 'independent'],
  ['AT021-脉冲攻击机-A（脉冲型）', 'reciprocating', 8, 4],
  ['AT021-战术攻击机-B（干扰型）', 'reciprocating', 5, 5],
  ['AT021-重型攻击机-C（多功能型）', 'reciprocating', 9, 5],
  ['BR050-多用途轰炸机-B（防御型）', 'reciprocating', 10, 6],
  ['BR050-鱼雷轰炸机-C（鱼雷型）', 'reciprocating', 10, 6],
  ['天璇-战斗攻击机-B', 'reciprocating', 5, 5],
  ['理智A101-战斗攻击机-B', 'reciprocating', 6, 4],
  ['雷火V022-特种战斗机-B', 'reciprocating', 3, 3],
  ['雷火V022-两栖战斗机-C（干扰型）', 'reciprocating', 3, 3],
  ['佩刀Aer410-强击攻击机', 'reciprocating', 3, 3],
  ['牛蛙-两栖轰炸机', 'reciprocating', 6, 4],
  ['海氏追随者型-脉冲攻击机', 'independent'],
  ['林鸮A100型-联合攻击机', 'reciprocating', 6, 4],
  ['砂龙-大气层拦截机', 'reciprocating', 6, 4],
  ['平衡安德森SC020-侦察机', 'reciprocating', 6, 4],
  ['SC002型-量子侦察机', 'reciprocating', 6, 4],
  ['理智级A101-TE-战斗机', 'reciprocating', 6, 4],
];
FLIGHT.forEach(([n, mode, d, r]) => {
  const s = by(n);
  s.flightMode = mode;
  if (mode === 'reciprocating') { s.departSec = d; s.returnSec = r; }
  s._flightSrc = SRC;
});
const recip = FLIGHT.filter(x => x[1] === 'reciprocating').length;
rep.push('A. 作战模式：' + FLIGHT.length + ' 艘（往复 ' + recip + ' / 独立 ' + (FLIGHT.length - recip) + '）');

/* ================= B. 超主力系统独立血量 25500 ================= */
const SC = ['battlecruiser', 'battleship', 'aircraftcarrier', 'support'];
const scShips = db.filter(s => SC.includes(s.type));
scShips.forEach(s => { s.sysHp = 25500; s._sysHpSrc = SRC; });
rep.push('B. 系统独立血量 25500：' + scShips.length + ' 艘超主力（' + scShips.map(s => s.name).length + ' 艘已写船级 sysHp）');

/* ================= C. 雷火之辉 ================= */
(() => {
  const s = by('雷火之辉');
  const before = { hp: s.hp, energyArmor: s.energyArmor, physicalArmor: s.physicalArmor };
  s.hp = 286370;
  s.energyArmor = 15;
  s.physicalArmor = 26.25;
  s.commandValue = 35;          // 用户：指挥值35
  s.serviceLimit = 5;           // 用户：服役上限5
  s.airSlots = { byModule: {
    A2: [{ kind: 'corvette', size: 'corvette', cap: 5 }],   // A2 大型护航艇坞舱 → 5 护航艇
    A3: [{ kind: 'fighter',  size: 'large',    cap: 5 }]    // A3 大型舰载机系统 → 5 大型战机
  }, base: [] };
  s._dataSrc = SRC;
  rep.push('C. 雷火之辉：hp ' + before.hp + '→286370 · 能甲 ' + before.energyArmor + '→15 · 物甲 ' + before.physicalArmor + '→26.25 · A2=5护航艇 A3=5大型战机');
})();

/* ================= D. 基础闪避 ================= */
[['yueshenxing-A', '阅神星Ⅰ级-机动突击驱逐舰', 25],
 ['yueshenxing-C', '阅神星Ⅰ级-装甲驱逐舰', 25],
 ['kalilaien-C',   '卡利莱恩级-特种护卫舰', 35],
 ['kaiyang-A',     '开阳级-机动驱逐舰', 20]].forEach(([id, name, ev]) => {
  const s = db.find(x => x.id === id);
  if (!s) { rep.push('D. ⚠ 找不到 ' + id + '（' + name + '）'); return; }
  s.evasion = ev; s._evasionSrc = SRC;
});
rep.push('D. 基础闪避：4 艘已写（25/25/35/20）');

/* ================= E. 10 艘空白船的武器 ================= */
function W(o) { return Object.assign({ _src: SRC }, o); }
function setMod(name, mods) {
  const s = by(name);
  s.modules = Object.assign({ _systems: {} }, s.modules || {}, mods);
  s._dataSrc = SRC;
  return s;
}
const 战机 = { types: ['战机'], hitMin: 70, hitMax: 100 };
const 艇 = { types: ['护航艇', '登陆舰'], hitMin: 70, hitMax: 100 };

/* 理智级A101-TE-战斗机 */
setMod('理智级A101-TE-战斗机', { A: { name: '机载武器系统', type: 'weapon', selfRepair: true, weapons: [
  W({ name: 'FG-181D型重型机炮', dmgType: 'physical', weaponType: 'direct', singleDmg: 100,
      ammo: 1, attacks: 5, atkDuration: 25, lockTime: 12, cooldown: 5, mounts: 1, priority: '小型舰船',
      dpm: { antiShip: 675, antiAir: 0, siege: 60 },
      targets: [{ types: ['驱逐舰', '护卫舰'], hitMin: 70, hitMax: 100 }, { types: ['巡洋舰'], hitMin: 70, hitMax: 100 }],
      subSystemTargets: { '主武器系统': 'low' } }),
  W({ name: 'FG-232B/D型机载反击火炮(×2)', dmgType: 'physical', weaponType: 'direct', singleDmg: 10,
      ammo: 2, attacks: 1, atkDuration: 0, lockTime: 3, cooldown: 5, mounts: 2, priority: '舰载机',
      antiAirType: 'counter', dpm: { antiShip: 0, antiAir: 230, siege: 0 },
      targets: [战机, 艇] })
] } });

/* 天枪-重型鱼雷艇 */
(() => {
  const s = setMod('天枪-重型鱼雷艇', {
    M: { name: '鱼雷轰炸系统', type: 'weapon', selfRepair: true, weapons: [
      W({ name: 'ET-105A型能量鱼雷轰炸系统(×2)', dmgType: 'energy', weaponType: 'projectile', singleDmg: 120,
          ammo: 2, attacks: 2, atkDuration: 10, lockTime: 12, cooldown: 25, mounts: 2, priority: '大型舰船',
          dpm: { antiShip: 1645, antiAir: 0, siege: 131 },
          targets: [{ types: ['战列巡洋舰'], hitMin: 70, hitMax: 100 }, { types: ['巡洋舰'], hitMin: 70, hitMax: 100 }],
          subSystemTargets: { '主武器系统': 'medium', '指挥系统': 'low', '动力系统': 'low' } })
    ] },
    A: { name: '信息增强系统', type: 'support', selfRepair: true, weapons: [] },
    B: { name: '独立式指挥系统', type: 'support', selfRepair: true, weapons: [] }
  });
  s.hp = 7700; s.physicalArmor = 5; s.commandValue = s.commandValue || 0;
  s._moduleMech = { 信息增强系统: '战斗前90秒，驱动己方击破效率前三舰载机，优先集火敌方火力最强、主武器未受损的2艘舰船' };
})();

/* 天枪-战术护航艇 */
(() => {
  const s = setMod('天枪-战术护航艇', {
    M: { name: '机载等离子发射系统', type: 'weapon', selfRepair: true, weapons: [
      W({ name: 'EIM-110M型机载等离子发射器(×2)', dmgType: 'energy', weaponType: 'projectile', singleDmg: 180,
          ammo: 1, attacks: 4, atkDuration: 15, lockTime: 10, cooldown: 18, mounts: 2, priority: '大型舰船',
          dpm: { antiShip: 1694, antiAir: 0, siege: 1304 },
          targets: [{ types: ['战列舰', '航空母舰', '战列巡洋舰', '巡洋舰', '支援舰'], hitMin: 70, hitMax: 100 }],
          subSystemTargets: { '动力系统': 'high', '主机库系统': 'low', '主武器系统': 'low' } })
    ] },
    A: { name: '信息增强系统', type: 'support', selfRepair: true, weapons: [] },
    B: { name: '往复式指挥系统', type: 'support', selfRepair: true, weapons: [] }
  });
  s.hp = 7700; s.physicalArmor = 5;
  s._moduleMech = { 信息增强系统: '战斗前90秒，驱动己方击破效率前三舰载机，优先集火敌方火力最强、主武器未受损的2艘舰船' };
})();

/* 佩刀Aer410-强击攻击机 —— 用户写「无防御能力」→ 护甲归 0 */
setMod('佩刀Aer410-强击攻击机', { A: { name: '弹炮攻击系统', type: 'weapon', selfRepair: true, weapons: [
  W({ name: '"十字"MK1-AG-335D型机载格斗火炮(×2)', dmgType: 'physical', weaponType: 'direct', singleDmg: 5,
      ammo: 3, attacks: 4, atkDuration: 16, lockTime: 10, cooldown: 10, mounts: 2, priority: '舰载机',
      antiAirType: 'counter', dpm: { antiShip: 1416, antiAir: 1194, siege: 246 },
      targets: [战机, 艇] }),
  W({ name: 'AM-2100D型机载导弹发射器(×1)', dmgType: 'physical', weaponType: 'projectile', singleDmg: 75,
      ammo: 1, attacks: 4, atkDuration: 20, lockTime: 10, cooldown: 9, mounts: 1, priority: '小型舰船',
      dpm: { antiShip: 1416, antiAir: 0, siege: 246 },
      targets: [{ types: ['驱逐舰', '护卫舰'], hitMin: 70, hitMax: 100 }],
      subSystemTargets: { '主武器系统': 'medium', '指挥系统': 'medium', '动力系统': 'low' } })
] } });
(() => { const s = by('佩刀Aer410-强击攻击机'); s.physicalArmor = 0; s.energyArmor = 0; })();

/* 牛蛙-两栖轰炸机（暴击 20% 概率 350% 暴伤） */
setMod('牛蛙-两栖轰炸机', { A: { name: '机载投弹系统', type: 'weapon', selfRepair: true, weapons: [
  W({ name: 'BT-2-3100型鱼雷轰炸系统', dmgType: 'physical', weaponType: 'projectile', singleDmg: 262,
      ammo: 1, attacks: 2, atkDuration: 15, lockTime: 12, cooldown: 5, mounts: 1, priority: '大型舰船',
      crit: true, critRate: 20, critDmg: 350,
      dpm: { antiShip: 1010, antiAir: 0, siege: 462 },
      targets: [{ types: ['战列舰'], hitMin: 70, hitMax: 100 },
                { types: ['战列巡洋舰'], hitMin: 70, hitMax: 100 },
                { types: ['航空母舰'], hitMin: 50, hitMax: 70 },
                { types: ['支援舰'], hitMin: 70, hitMax: 100 }],
      subSystemTargets: { '指挥系统': 'medium', '主机库系统': 'medium', '主武器系统': 'low' } })
] } });

/* 海氏追随者型-脉冲攻击机 */
setMod('海氏追随者型-脉冲攻击机', { A: { name: '"逐星"聚能脉冲炮系统', type: 'weapon', selfRepair: true, weapons: [
  W({ name: '逐星-GP-12020型聚能脉冲炮', dmgType: 'energy', weaponType: 'direct', singleDmg: 125,
      ammo: 1, attacks: 2, atkDuration: 13, lockTime: 18, cooldown: 6.5, mounts: 1, priority: '舰载机',
      dpm: { antiShip: 1538, antiAir: 738, siege: 507 },
      targets: [{ types: ['护航艇', '登陆舰'], hitMin: 50, hitMax: 70 },
                { types: ['航空母舰', '巡洋舰'], hitMin: 70, hitMax: 100 }] })
] } });

/* 林鸮A100型-联合攻击机 */
setMod('林鸮A100型-联合攻击机', { A: { name: '聚能脉冲炮系统', type: 'weapon', selfRepair: true, weapons: [
  W({ name: '"湛蓝守望者-BP-X50T/D实验型"聚能短距脉冲炮', dmgType: 'energy', weaponType: 'direct', singleDmg: 130,
      ammo: 1, attacks: 4, atkDuration: 32, lockTime: 12, cooldown: 5, mounts: 1, priority: '舰载机',
      dpm: { antiShip: 663, antiAir: 459, siege: 132 },
      targets: [{ types: ['护航艇', '登陆舰', '驱逐舰', '护卫舰'], hitMin: 70, hitMax: 100 },
                { types: ['战机'], hitMin: 50, hitMax: 70 }],
      subSystemTargets: { '指挥系统': 'medium', '主机库系统': 'low', '主武器系统': 'low' } })
] } });

/* 砂龙-大气层拦截机（武器2 主动防空） */
setMod('砂龙-大气层拦截机', { A: { name: '对空弹炮攻击系统', type: 'weapon', selfRepair: true, weapons: [
  W({ name: 'BM-275B/D型对空格斗导弹', dmgType: 'physical', weaponType: 'projectile', singleDmg: 40,
      ammo: 1, attacks: 1, atkDuration: 0, lockTime: 3, cooldown: 4, mounts: 1, priority: '舰载机',
      antiAirType: 'counter', dpm: { antiShip: 0, antiAir: 360, siege: 0 },
      targets: [战机, 艇] }),
  W({ name: 'BG-330D型机载格斗火炮(×2)', dmgType: 'physical', weaponType: 'direct', singleDmg: 10,
      ammo: 1, attacks: 8, atkDuration: 24, lockTime: 12, cooldown: 5, mounts: 2, priority: '舰载机',
      antiAirType: 'active', dpm: { antiShip: 24, antiAir: 177, siege: 0 },
      targets: [战机, 艇, { types: ['驱逐舰', '护卫舰'], hitMin: 70, hitMax: 100 }] })
] } });

/* 平衡安德森SC020-侦察机 */
setMod('平衡安德森SC020-侦察机', { A: { name: '机载火炮系统', type: 'weapon', selfRepair: true, weapons: [
  W({ name: '"雷火"MK1.5-J/CG-430D型机载火炮(×2)', dmgType: 'physical', weaponType: 'direct', singleDmg: 10,
      ammo: 1, attacks: 1, atkDuration: 0, lockTime: 3, cooldown: 4, mounts: 2, priority: '舰载机',
      dpm: { antiShip: 0, antiAir: 172, siege: 0 },
      targets: [战机, 艇] })
] } });

/* SC002型-量子侦察机（防空/对舰双模式，合并成一条攻击序列：先舰载机后驱护） */
setMod('SC002型-量子侦察机', { A: { name: '机载火炮系统', type: 'weapon', selfRepair: true, weapons: [
  W({ name: 'SG-5300型机载火炮(×1)', dmgType: 'physical', weaponType: 'direct', singleDmg: 25,
      ammo: 1, attacks: 5, atkDuration: 20, lockTime: 4, cooldown: 12, mounts: 1, priority: '舰载机',
      dpm: { antiShip: 140, antiAir: 140, siege: 0 },
      targets: [战机, 艇, { types: ['驱逐舰', '护卫舰'], hitMin: 70, hitMax: 100 }] })
] } });

rep.push('E. 补武器：10 艘（共 ' + ['理智级A101-TE-战斗机','天枪-重型鱼雷艇','天枪-战术护航艇','佩刀Aer410-强击攻击机','牛蛙-两栖轰炸机','海氏追随者型-脉冲攻击机','林鸮A100型-联合攻击机','砂龙-大气层拦截机','平衡安德森SC020-侦察机','SC002型-量子侦察机']
  .reduce((n, x) => n + (Object.values(by(x).modules).reduce((m, mo) => m + ((mo.weapons || []).length), 0)), 0) + ' 门）');


/* ================= F. 伪装舰种（用户 2026-09-25）=================
   FSV830「用模块伪装为驱逐舰」—— 这样"只能修驱逐舰/护卫舰"的奶船也能修它。
   ⚠️ 资料里查不到是【哪个模块】做的伪装 → disguiseModule 先留空；
      留着空 = 一直按伪装算。等你告诉我模块名（M/A/B/C/D/E），我填进去就变成"装那个模块才伪装"。
   引擎侧已支持：ship.disguiseAs / 模块变体上的 disguiseAs（见 createShipInstance）。 */
(() => {
  const s = db.find(x => /FSV830/.test(x.name || ''));
  if (!s) { rep.push('F. ⚠ 找不到 FSV830'); return; }
  s.disguiseAs = '驱逐舰';
  s.disguiseModule = null;                       // ← 待用户确认是哪个模块
  s._disguiseSrc = '用户 2026-09-25 口述：FSV830 用模块伪装为驱逐舰';
  rep.push('F. FSV830 伪装为驱逐舰（disguiseAs=驱逐舰；disguiseModule 待确认是哪个模块）');
})();

fs.writeFileSync(P, JSON.stringify(db));   // ★ 必须单行
rep.forEach(r => console.log('  ' + r));
console.log('已写回（单行）');
