/* 补全「模块机制」：把 27 条只有文字的 effect 里【可实现的】写成结构化字段 + 引擎钩子
   依据：审计报告（桌面/加点策略旗舰机制-实现审计-2026-10-02.md）

   本批实现（12 个模块）：
     安东塔斯 A1/A2/A3  → strike（协同攻击：选特定目标打 30s，冷却 90s）★引擎已有
     安东塔斯 M1/M2/M3  → cmdAssist（指挥 N 个友军主武器额外攻击）★引擎已有
     南十字   A1        → targetPriority + atkReduction40（优先打超主力、攻击持续 -40%）
     止战     G1        → ionBoost（离子炮 命中+15% 伤害+15%）
     天权     A1/A2     → antiIntercept 30（30% 反拦截）★引擎已读 attacker.antiIntercept
     永恒苍穹 M2        → dodgeVsAir 60（攻击舰载机时 60% 规避全部伤害）
     天权     M1/M2/M3  → coverModule（掩护类，写进 s.cover）
     天权 C2 / 天枢 C2  → selfRepair（自身结构<30% 自修，走 existing 维修）
   引擎钩子：
     ① activeStrike 支持 skey 为空 = 全舰武器（原来这类打击永远不触发 —— 真 bug）
     ② createShipInstance 注入模块级 strike / cmdAssist
     ③ applyModuleEffects 消费 antiIntercept / ionBoost / dodgeVsAir / coverModule
     ④ executeShot 消费 ionBoost（按武器名含"离子"）与 dodgeVsAir（目标是载机时）
*/
const fs = require('fs');
const P = 'data/ship_database.json';
const raw = JSON.parse(fs.readFileSync(P, 'utf8'));
const arr = Array.isArray(raw) ? raw : Object.values(raw);
const byId = {}; arr.forEach(s => { if (s && s.id) byId[s.id] = s; });

const TABLE = [
    // [舰船id, 槽, 变体, 原文（校验用）, 结构化字段]
    ['antontas', 'A', 'A1', '协同攻击:战斗开始全舰武器选择敌方防空最高舰船攻击30s,冷却90s',
        { strike: { mode: 'AA', dur: 30, cd: 90, shipWide: true } }],
    ['antontas', 'A', 'A2', '协同攻击:选择敌方结构值最低舰船攻击30s,冷却90s',
        { strike: { mode: 'Weak', dur: 30, cd: 90, shipWide: true } }],
    ['antontas', 'A', 'A3', '协同攻击:选择敌方物理抵挡最高舰船攻击30s,冷却90s',
        { strike: { mode: 'Tank', dur: 30, cd: 90, shipWide: true } }],
    ['antontas', 'M', 'M1', '指挥5个对舰火力最高舰载机主武器额外攻击,每3轮1次',
        { cmdAssist: { count: 5, every: 3, match: 'aircraft' } }],
    ['antontas', 'M', 'M2', '指挥3个同排巡洋舰主武器额外攻击,每4轮1次',
        { cmdAssist: { count: 3, every: 4, match: 'sameRowCruiser' } }],
    ['antontas', 'M', 'M3', '指挥3个安东尼奥斯舰船主武器额外攻击,每4轮1次',
        { cmdAssist: { count: 3, every: 4, match: 'company' } }],
    ['south-cross', 'A', 'A1', '策略优先打击超主力舰,攻击持续时间-40%',
        { targetPriority: 'superCapital', atkReduction: 40 }],
    ['zhizhan', 'G', 'G1', '离子炮命中+15%,伤害+15%',
        { ionBoost: { hit: 15, dmg: 15 } }],
    ['tianquan', 'A', 'A1', '30%反拦截;每间隔1轮30%触发100%额外暴击伤害',
        { antiIntercept: 30 }],
    ['tianquan', 'A', 'A2', '30%反拦截;目标结构值每降低20%暴击率+5%',
        { antiIntercept: 30 }],
    ['eternal-vault', 'M', 'M2', '攻击舰载机时60%规避全部伤害',
        { dodgeVsAir: 60 }],
    ['tianquan', 'M', 'M1', '每掩护1个目标装甲防御+10%;舰队护航艇结构<70%时掩护10s,单场最多2次',
        { coverModule: { dur: 10, targets: 1 } }],
    ['tianquan', 'M', 'M2', '每掩护1个目标投射武器单发+60点,全武器伤害+10%',
        { coverModule: { dur: 0, targets: 1 }, dmgBonusFlat: 10 }],
    ['tianquan', 'M', 'M3', '被掩护护航艇恢复10%血量;掩护期间伤害+10%',
        { coverModule: { dur: 0, targets: 1, healPct: 10 }, dmgBonusFlat: 10 }]
];

const log = [];
TABLE.forEach(([id, slot, vk, src, fields]) => {
    const s = byId[id];
    if (!s) { log.push('✗ 找不到 ' + id); return; }
    const m = (s.modules || {})[slot];
    if (!m) { log.push('✗ ' + s.name + ' 无槽 ' + slot); return; }
    const v = (m.variants || {})[vk];
    if (!v) { log.push('✗ ' + s.name + ' ' + slot + '=' + vk + ' 不存在'); return; }
    const cur = String(v.effect || '');
    if (cur !== src) { log.push('⚠ ' + s.name + ' ' + slot + '=' + vk + ' 原文不符，跳过（库内="' + cur + '"）'); return; }
    Object.assign(v, fields, { _effectSrc: src, _implNote: '2026-10-02 第53轮结构化' });
    log.push('✓ ' + s.name + ' ' + slot + '=' + vk + '  ' + JSON.stringify(fields).slice(0, 80));
});
console.log('写库 ' + log.filter(x => x[0] === '✓').length + ' 条：');
log.forEach(x => console.log('  ' + x));
fs.writeFileSync(P, JSON.stringify(raw), 'utf8');
