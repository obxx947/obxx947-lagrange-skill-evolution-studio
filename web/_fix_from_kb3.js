/* 用知识库补齐最后 14 门"名字是段落标题、面板全 0"的武器
   数据来源：知识库2\舰船资料向量拆解\护卫舰资料*.txt（每条都标了出处舰船）
   跑法：node _fix_from_kb3.js [--write] */
const fs = require('fs');
const db = require('./data/ship_database.json');
const WRITE = process.argv.includes('--write');

/* 按【损坏武器的名字片段】定位要替换哪一门，避免影响同船其它正常武器 */
const SPEC = [
  { ship: '云海级-轻型登陆舰（突击型A）', match: '突击登陆无人机系统', w: {
    name: 'CST-2型攻城无人机吊舱', dmgType: 'physical', weaponType: 'projectile',
    singleDmg: 630, ammo: 1, attacks: 1, atkDuration: 10, lockTime: 8, cooldown: 15,
    priority: '大型舰船', dpm: { antiShip: 96, antiAir: 0, siege: 1512 },
    targets: [{ types: ['大型舰船'], hitMin: 50, hitMax: 70 }] } },
  { ship: '刺水母级-无人机登陆舰（登陆型C）', match: '通用火炮系统', w: {
    name: '"堡垒"MK1-BG-245型通用火炮(×2)', dmgType: 'physical', weaponType: 'direct',
    singleDmg: 15, ammo: 2, attacks: 1, atkDuration: 3, lockTime: 2, cooldown: 5,
    priority: '舰载机', dpm: { antiShip: 240, antiAir: 162, siege: 28 },
    targets: [{ types: ['舰载机'], hitMin: 15, hitMax: 30 }, { types: ['驱逐舰', '护卫舰'], hitMin: 50, hitMax: 70 }] } },
  { ship: '卡利莱恩级-侦察护卫舰（侦察型A）', match: '对舰快速火炮系统', w: {
    name: 'CG-1118A型快速火炮(×2)', dmgType: 'physical', weaponType: 'direct',
    singleDmg: 36, ammo: 1, attacks: 3, atkDuration: 3, lockTime: 3, cooldown: 5,
    priority: '小型舰船', dpm: { antiShip: 1203, antiAir: 372, siege: 330 },
    targets: [{ types: ['小型舰船'], hitMin: 50, hitMax: 70 }] } },
  { ship: '卡利莱恩级-侦察护卫舰（侦察型A）', match: '近防火炮系统', w: {
    name: 'CG-1118A型近防火炮(×1)', dmgType: 'physical', weaponType: 'direct',
    singleDmg: 36, ammo: 1, attacks: 3, atkDuration: 3, lockTime: 3, cooldown: 5,
    priority: '舰载机', dpm: { antiShip: 0, antiAir: 372, siege: 0 },
    targets: [{ types: ['舰载机'], hitMin: 15, hitMax: 30 }] } },
  { ship: '瑶光级-特种护卫舰（特种型B）', match: '护盾无人机系统', w: {
    name: 'ENT-5型护盾无人机吊舱(×4)', dmgType: 'physical', weaponType: 'projectile',
    singleDmg: 0, ammo: 1, attacks: 1, atkDuration: 24, lockTime: 6, cooldown: 27,
    priority: '大型舰船', dpm: { antiShip: 0, antiAir: 0, siege: 0 },
    targets: [] } },
  { ship: '瑶光级-特种护卫舰（特种型B）', match: '舰首轨道炮系统', w: {
    name: 'ER-850A型舰首轨道炮', dmgType: 'physical', weaponType: 'direct',
    singleDmg: 252, ammo: 1, attacks: 1, atkDuration: 0, lockTime: 5, cooldown: 12,
    priority: '小型舰船', dpm: { antiShip: 1260, antiAir: 0, siege: 0 },
    targets: [{ types: ['小型舰船'], hitMin: 50, hitMax: 70 }] } },
  { ship: '迅捷级-TE-高速载机运输船（载机型A）', match: '系统机制', w: {
    name: 'FG-2283型双联装快速火炮(×2)', dmgType: 'physical', weaponType: 'direct',
    singleDmg: 40, ammo: 2, attacks: 3, atkDuration: 3, lockTime: 4, cooldown: 6,
    priority: '舰载机', dpm: { antiShip: 2400, antiAir: 720, siege: 256 },
    targets: [{ types: ['舰载机'], hitMin: 15, hitMax: 30 }, { types: ['小型舰船'], hitMin: 50, hitMax: 70 }] } },
  { ship: '诺玛M470级-重型登陆舰（攻城型A）', match: '攻城无人机保障系统', w: {
    name: 'CST-4型攻城无人机吊舱', dmgType: 'physical', weaponType: 'projectile',
    singleDmg: 630, ammo: 1, attacks: 1, atkDuration: 10, lockTime: 8, cooldown: 15,
    priority: '大型舰船', dpm: { antiShip: 96, antiAir: 0, siege: 1512 },
    targets: [{ types: ['大型舰船'], hitMin: 50, hitMax: 70 }] } }
];
const NOTE = /^(\s*[一二三四五六七八九十]+\s*、|\s*\d+\s*[.、])|补充说明|系统机制|无武器输出|无武器属性|效率(低|中|高)|仅标注系统名称|整体基础参数/;

let ok = 0, miss = [];
SPEC.forEach(sp => {
  const s = db.find(x => String(x.name).trim() === sp.ship);
  if (!s) { miss.push(sp.ship); return; }
  let done = false;
  Object.keys(s.modules || {}).filter(k => !k.startsWith('_')).forEach(k => {
    if (done) return;
    const m = s.modules[k]; if (!m.weapons) return;
    const i = m.weapons.findIndex(w => String(w.name).includes(sp.match) && NOTE.test(String(w.name)));
    if (i < 0) return;
    console.log('  ' + s.name.slice(0, 16).padEnd(18) + m.weapons[i].name.slice(0, 26).padEnd(28) + '→ ' + sp.w.name + ' 面板' + JSON.stringify(sp.w.dpm));
    if (WRITE) m.weapons[i] = JSON.parse(JSON.stringify(sp.w));
    done = true; ok++;
  });
  if (!done) miss.push(sp.ship + '（未找到匹配的损坏武器）');
});
console.log('\n处理 ' + ok + ' 门' + (miss.length ? '；未处理: ' + miss.join('、') : ''));
if (WRITE) { fs.writeFileSync('data/ship_database.json', JSON.stringify(db), 'utf8'); console.log('已写入（单行）'); }
