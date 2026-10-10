/* ============================================================
   用【知识库真数据】修复三型载机的武器（原来 name 是段落标题、面板全 0）
   数据来源：知识库2\舰船资料向量拆解\护航艇资料.txt / 战机资料.txt
   ------------------------------------------------------------
   ① 天玑-攻击护航艇（攻击B型）  id=tianji   护航艇资料.txt:217
        A：鱼雷发射系统 = ET-250T型能量鱼雷轰炸系统
        ×2 ｜ 能量 ｜ 优先大型舰船 ｜ 单发100 ｜ 对舰1600/攻城560 ｜ 2×2
        持续15 冷却15 锁定5.0 ｜ 目标：战列巡洋舰/巡洋舰 70~100%
   ② 理智A101-战斗攻击机-B  id=lizhi   战机资料.txt:121
        武器1 FG-181D型重型机炮：实弹 ｜ 优先小型舰船 ｜ 单发100 ｜ 对舰675/攻城60 ｜ 1×5
              持续25 锁定12 冷却5 ｜ 驱逐舰/护卫舰(1级)、巡洋舰(2级) 70~100%
        武器2 FG-232B/D型机载反击火炮：实弹 ｜ 优先舰载机 ｜ 单发10 ｜ 防空230/对舰48 ｜ 2×1
   ③ BR050-多用途轰炸机-B（防御型）  id=br050   战机资料.txt:449
        一、机载投弹系统 = ST-328D型机载鱼雷发射器 ×2（注意是 ×2，不是 BR050-A 的 ×3）
        实弹 ｜ 优先大型舰船 ｜ 单发472 ｜ 对舰1321/攻城472 ｜ 1×1
        持续16 锁定15.0 冷却10 ｜ 航母/战巡/巡洋 50~70%，支援舰 70~100%

   跑法：node _fix_from_kb.js           (只报告)
        node _fix_from_kb.js --write
============================================================ */
const fs = require('fs');
const db = require('./data/ship_database.json');
const WRITE = process.argv.includes('--write');

const KB = {
  tianji: [{
    module: 'M1',
    w: {
      name: 'ET-250T型能量鱼雷轰炸系统(×2)', dmgType: 'energy', weaponType: 'projectile',
      singleDmg: 100, ammo: 2, attacks: 2, atkDuration: 15, lockTime: 5, cooldown: 15,
      priority: '大型舰船',
      dpm: { antiShip: 1600, antiAir: 0, siege: 560 },
      targets: [{ types: ['战列巡洋舰', '巡洋舰'], hitMin: 70, hitMax: 100 }],
      subSystemTargets: { '主武器系统': 'low', '主机库系统': 'low', '指挥系统': 'low', '动力系统': 'low' },
      _src: '知识库·护航艇资料.txt（天玑-攻击护航艇B）'
    }
  }],
  lizhi: [{
    module: 'M1',
    w: {
      name: 'FG-181D型重型机炮', dmgType: 'physical', weaponType: 'direct',
      singleDmg: 100, ammo: 1, attacks: 5, atkDuration: 25, lockTime: 12, cooldown: 5,
      priority: '小型舰船',
      dpm: { antiShip: 675, antiAir: 0, siege: 60 },
      targets: [{ types: ['驱逐舰', '护卫舰'], hitMin: 70, hitMax: 100 }, { types: ['巡洋舰'], hitMin: 70, hitMax: 100 }],
      subSystemTargets: { '主武器系统': 'low' },
      _src: '知识库·战机资料.txt（理智A101-B 武器1）'
    }
  }, {
    module: 'M1',
    w: {
      name: 'FG-232B/D型机载反击火炮', dmgType: 'physical', weaponType: 'direct',
      singleDmg: 10, ammo: 2, attacks: 1, atkDuration: 6, lockTime: 6, cooldown: 4,
      priority: '舰载机',
      dpm: { antiShip: 48, antiAir: 230, siege: 0 },
      targets: [{ types: ['战机', '护航艇'], hitMin: 70, hitMax: 100 }],
      _src: '知识库·战机资料.txt（理智A101-B 武器2）'
    }
  }],
  br050: [{
    module: 'M1',
    w: {
      name: 'ST-328D型机载鱼雷发射器(×2)', dmgType: 'physical', weaponType: 'projectile',
      singleDmg: 472, ammo: 1, attacks: 1, atkDuration: 16, lockTime: 15, cooldown: 10,
      priority: '大型舰船',
      dpm: { antiShip: 1321, antiAir: 0, siege: 472 },
      targets: [{ types: ['航空母舰', '战列巡洋舰', '巡洋舰'], hitMin: 50, hitMax: 70 },
                { types: ['支援舰'], hitMin: 70, hitMax: 100 }],
      subSystemTargets: { '指挥系统': 'low', '动力系统': 'low', '主机库系统': 'low' },
      _src: '知识库·战机资料.txt（BR050-多用途轰炸机B）'
    }
  }]
};

let n = 0;
Object.keys(KB).forEach(id => {
  const s = db.find(x => x.id === id);
  if (!s) { console.log('  ⚠️ 库里没有 ' + id); return; }
  console.log('=== ' + s.name + '（' + id + '）===');
  KB[id].forEach(spec => {
    const m = s.modules[spec.module];
    if (!m) { console.log('  ⚠️ 没有模块 ' + spec.module); return; }
    if (spec.module === 'M1' && m.weapons) {
      console.log('  原武器: ' + m.weapons.map(w => String(w.name).slice(0, 26) + ' 面板' + JSON.stringify(w.dpm)).join(' ｜ '));
      if (WRITE) {
        /* M1 只保留 KB 给的真武器；把占位的补丁武器删掉（那些面板全 0、只会稀释） */
        m.weapons = m.weapons.filter(w => /^ET-250T|^FG-181D|^FG-232B|^ST-328D/.test(String(w.name)));
        m.weapons.push(JSON.parse(JSON.stringify(spec.w)));
      }
      console.log('  新武器: ' + spec.w.name + ' 面板' + JSON.stringify(spec.w.dpm));
      n++;
    }
  });
});
console.log('\n写入 ' + n + ' 门（--write 才真写）');
if (WRITE) {
  fs.writeFileSync('data/ship_database.json', JSON.stringify(db), 'utf8');
  console.log('已写入 data/ship_database.json（单行）');
}
