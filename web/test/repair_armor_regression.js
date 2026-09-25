/* 一次性维修装甲回归（用户 2026-09-24）
   规则：一轮 = 锁定 + 冷却；每完成一轮消耗 1 个装甲；装甲耗尽后完全不再维修。
   超量维修（节点 808010503）：60 秒后每轮携带 2 个 → 维修量×2、消耗×2。
   高效回收（天枢A3）：每死 1 架载机 +9% 维修量。
   跑法：先起 http://127.0.0.1:3002，再 node test/repair_armor_regression.js
*/
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('PASS ' + n + (d ? ('  → ' + d) : '')); } else { fail++; console.log('FAIL ' + n + (d ? ('  → ' + d) : '')); } };

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  p.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  p.on('dialog', async d => { try { await d.accept(); } catch (e) { } });
  await p.goto('http://127.0.0.1:3002/simulator.html', { waitUntil: 'load', timeout: 90000 });
  await sleep(4500);

  const R = await p.evaluate(() => {
    const out = {};
    /* 造一艘"靶船 + 1 门维修无人机(300装甲/锁定1/冷却3)"的船，跑 200 秒 */
    const mk = (armor, cd, lock, dblAt) => {
      const s = { instId: 'x' + Math.random(), id: 'testship', name: '测试奶船', type: 'support', size: 'large',
        position: '中排', side: 'ally', alive: true, hp: 1000, maxHp: 100000, physicalArmor: 0,
        repairBonus: 0, repairArmor: 0, subSystems: [], weaponStates: [],
        modules: { A: { name: '维修系统', type: 'support', armorCount: armor, weapons: [
          { name: '测试维修无人机', dmgType: 'none', weaponType: 'support', singleDmg: 0, ammo: 1, attacks: 1,
            atkDuration: 0, lockTime: lock, cooldown: cd, repairCooldown: cd, priority: '友方',
            dpm: { repair: 6000 }, targets: [] }
        ] } }
      };
      if (dblAt) s.repairDoubleAt = dblAt;
      return s;
    };
    const bs = { time: 0, allyShips: [], enemyShips: [], battleMode: 'escort', allyEscortAlive: false, enemyEscortAlive: false };
    const run = (armor, cd, lock, dblAt, seconds) => {
      const s = mk(armor, cd, lock, dblAt);
      bs.allyShips = [s];
      s._rep = {};
      let t = 0;
      while (t < seconds) { bs.time = t; processRepairs(s, bs.allyShips, 0.1, bs); t += 0.1; }
      const st = Object.values(s._rep)[0] || {};
      return { used: st.used || 0, stopped: !!st.stopped, hp: Math.round(s.hp) };
    };
    // 装甲 5 个、一轮 4 秒（锁定1+冷却3）→ 20 秒后耗尽；跑 60 秒看是否停
    out.装甲5个 = run(5, 3, 1, 0, 60);
    // 装甲 0（普通奶船）→ 不应停、不算消耗
    out.装甲0个 = run(0, 3, 1, 0, 60);
    // 超量维修：60 秒后每轮 2 个；跑 100 秒
    out.超量维修 = run(20, 3, 1, 60, 100);
    /* 高效回收：天枢A3 每死 1 架载机 +9% */
    const s2 = mk(0, 3, 1, 0);
    s2.modules.A.recyclePerDead = 0.09;
    s2.instId = 'carrier1';
    bs.allyShips = [s2];
    const air = n => Array.from({ length: n }, (_, i) => ({ instId: 'a' + i, position: 'aircraft', carrierInstId: 'carrier1', alive: false, hp: 0, maxHp: 1 }));
    s2.hp = 1000;
    for (let k = 0; k < 40; k++) processRepairs(s2, bs.allyShips, 0.1, { ...bs, time: 0 });
    out.回收_0死 = Math.round(s2.hp - 1000);
    s2.hp = 1000; s2._rep = {}; bs.allyShips = [s2, ...air(4)];
    for (let k = 0; k < 40; k++) processRepairs(s2, bs.allyShips, 0.1, { ...bs, time: 0 });
    out.回收_4死 = Math.round(s2.hp - 1000);
    out.回收倍数 = +(out.回收_4死 / out.回收_0死).toFixed(3);
    return out;
  });

  console.log('  [调试] ' + JSON.stringify(R));
  check('装甲 5 个 → 用完就停（stopped）', R.装甲5个.stopped === true && R.装甲5个.used === 5, JSON.stringify(R.装甲5个));
  check('装甲 0 个（普通奶船）→ 不停、不消耗', R.装甲0个.stopped === false && R.装甲0个.used === 0, JSON.stringify(R.装甲0个));
  /* 20 个装甲、一轮4秒、100秒：前60秒 15 轮 ×1 = 15；后40秒 10 轮但只剩 5 个 → 2 轮×2=4，剩 1 个不足一对 → 停
     → used 应是 15+4 = 19，且 stopped。若没有超量维修，100 秒只会用 20 轮（装甲刚好 20 → 也停） */
  check('超量维修：60 秒后每轮消耗 2 个（15单 + 2双 = 19，剩 1 不足一对 → 停）',
    R.超量维修.used === 19 && R.超量维修.stopped === true, JSON.stringify(R.超量维修));
  check('高效回收：死 4 架载机 → 维修量 ×1.36', Math.abs(R.回收倍数 - 1.36) < 0.01, '0死=' + R.回收_0死 + ' 4死=' + R.回收_4死 + ' 倍数=' + R.回收倍数);

  await b.close();
  console.log('\n==== ' + pass + ' 通过 / ' + fail + ' 失败 ====');
  process.exit(fail ? 1 : 0);
})();
