/* 用知识库《战机资料.txt》修复损坏武器（第二批）
   数据手工抄自 知识库2\舰船资料向量拆解\战机资料.txt，每个条目都写了出处段落的舰船名。
   跑法：node _fix_from_kb2.js [--write] */
const fs = require('fs');
const db = require('./data/ship_database.json');
const WRITE = process.argv.includes('--write');

const SPEC = [
  { shipName: '天璇-战斗攻击机-B', shipIdHint: 'tianxuan', w: {
    name: 'EG-100型快速火炮(×2)', dmgType: 'physical', weaponType: 'direct',
    singleDmg: 80, ammo: 8, attacks: 1, atkDuration: 15, lockTime: 3, cooldown: 15,
    priority: '大型舰船', dpm: { antiShip: 1680, antiAir: 0, siege: 153 },
    targets: [{ types: ['大型舰船'], hitMin: 50, hitMax: 70 }] } },
  { shipName: '雷火V022-特种战斗机-B', shipIdHint: 'leihuoV022-B', w: {
    name: 'HM-120C型机载防空导弹(×2)', dmgType: 'physical', weaponType: 'projectile',
    singleDmg: 30, ammo: 2, attacks: 2, atkDuration: 12, lockTime: 5, cooldown: 12,
    priority: '舰载机', dpm: { antiShip: 320, antiAir: 460, siege: 52 },
    targets: [{ types: ['战机'], hitMin: 70, hitMax: 100 }, { types: ['护航艇', '登陆舰'], hitMin: 70, hitMax: 100 }] } },
  { shipName: '雷火V022-两栖战斗机-C', shipIdHint: 'leihuoV022-C', w: {
    name: 'HM-120A型机载对舰导弹(×2)', dmgType: 'physical', weaponType: 'projectile',
    singleDmg: 100, ammo: 2, attacks: 1, atkDuration: 10, lockTime: 5, cooldown: 18,
    priority: '大型舰船', dpm: { antiShip: 635, antiAir: 0, siege: 21 },
    targets: [{ types: ['大型舰船'], hitMin: 50, hitMax: 70 }] } },
  { shipName: 'BR050-鱼雷轰炸机-C', shipIdHint: 'br050-C', w: {
    name: 'ST-180DT型试验型燃烧鱼雷发射器(×3)', dmgType: 'physical', weaponType: 'projectile',
    singleDmg: 85, ammo: 1, attacks: 1, atkDuration: 16, lockTime: 15, cooldown: 10,
    priority: '大型舰船', dpm: { antiShip: 321, antiAir: 0, siege: 127 },
    targets: [{ types: ['大型舰船'], hitMin: 50, hitMax: 70 }] } },
  { shipName: 'AT021-脉冲攻击机-A', shipIdHint: null, w: {
    name: 'SP-1900型大口径脉冲机炮(×1)', dmgType: 'energy', weaponType: 'projectile',
    singleDmg: 218, ammo: 1, attacks: 2, atkDuration: 35, lockTime: 10, cooldown: 6,
    priority: '小型舰船', dpm: { antiShip: 494, antiAir: 296, siege: 14 },
    targets: [{ types: ['小型舰船'], hitMin: 50, hitMax: 70 }] } },
  { shipName: 'AT021-战术攻击机-B', shipIdHint: null, w: {
    name: 'SG-1300D型速射机炮(×2)', dmgType: 'physical', weaponType: 'direct',
    singleDmg: 25, ammo: 1, attacks: 5, atkDuration: 20, lockTime: 3, cooldown: 12,
    priority: '小型舰船', dpm: { antiShip: 281, antiAir: 225, siege: 32 },
    targets: [{ types: ['小型舰船'], hitMin: 50, hitMax: 70 }] } }
];
const BADNAME = /^(\s*[一二三四五六七八九十]+\s*、|\s*\d+\s*[.、]|补充说明|注\s*[:：])/;

let done = 0, miss = [];
SPEC.forEach(spec => {
  const s = db.find(x => String(x.name).replace(/\s/g, '') === spec.shipName.replace(/\s/g, '') || x.id === spec.shipIdHint);
  if (!s) { miss.push(spec.shipName); return; }
  /* 找第一个"名损坏"的武器所在模块，替换成真武器 */
  let slot = null;
  Object.keys(s.modules || {}).filter(k => !k.startsWith('_')).forEach(k => {
    if (slot) return;
    const m = s.modules[k];
    if (m.weapons && m.weapons.some(w => BADNAME.test(String(w.name || '').trim()))) slot = k;
  });
  if (!slot) { miss.push(spec.shipName + '（找不到损坏武器）'); return; }
  console.log('  ' + s.name + '（' + s.id + '）' + slot + '  ' +
    (s.modules[slot].weapons || []).map(w => String(w.name).slice(0, 22)).join(' / ') + '  →  ' + spec.w.name + ' 面板' + JSON.stringify(spec.w.dpm));
  if (WRITE) {
    s.modules[slot].weapons = (s.modules[slot].weapons || []).filter(w => !BADNAME.test(String(w.name || '').trim()));
    s.modules[slot].weapons.push(JSON.parse(JSON.stringify(spec.w)));
  }
  done++;
});
console.log('\n处理 ' + done + ' 型' + (miss.length ? ('；未找到: ' + miss.join('、')) : ''));
if (WRITE) { fs.writeFileSync('data/ship_database.json', JSON.stringify(db), 'utf8'); console.log('已写入（单行）'); }
