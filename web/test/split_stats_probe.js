/* 拆桶后的端到端验证：
   ① 被命中率下降 = 让敌人更难打我（防御向），不再是我方命中提升
   ② 本舰船机库 6 种效果各走各的（伤害/命中/闪避/锁定/冷却/飞行时间）
   ③ 本系统机库只作用于该模块机位上的载机
   ④ 维修效率(%) 与 一次性维修装甲(点数) 分开
   ⑤ 全库统计：真正投到模块 / 落舰船级 / 仍无归属 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const say = (...a) => console.log(a.join(' '));
const res = []; const check = (n, ok, d) => { res.push(ok); say((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  → ' + d : '')); };

(async () => {
  const stats = JSON.parse(fs.readFileSync('data/blueprint_stats.json', 'utf8'));
  const G = stats.groups;

  /* ---------- 离线：统计归属 ---------- */
  const sysmap = JSON.parse(fs.readFileSync('data/blueprint_sysmap.json', 'utf8'));
  const AP_M = [].concat(G.moduleOnly, G.hangarModule);
  const SHIPLV = [].concat(G.attack, G.defense, G.misc, G.hangar);
  let toMod = 0, toShip = 0, dropped = 0;
  const dropStat = {};
  for (const f of fs.readdirSync('data/blueprint')) {
    const cdnId = f.replace('.json', '');
    const bp = JSON.parse(fs.readFileSync('data/blueprint/' + f, 'utf8'));
    const sm = sysmap[cdnId] ? sysmap[cdnId].systems : null;
    const nodeSys = {}; for (const s of bp.systems) for (const n of s.nodes) nodeSys[n.id] = s.sysId;
    for (const s of bp.systems) for (const n of s.nodes) {
      const st = stats.nodes[n.id];
      if (!st || st.empty || !st.addable) continue;
      const m = sm ? sm[nodeSys[n.id]] : null;
      const isMod = !!(m && m.scope === 'module'), isShip = !!(m && m.scope === 'ship');
      if (st.statMap) { isMod ? toMod++ : toShip++; continue; }
      const k = st.stat;
      if (AP_M.indexOf(k) >= 0) { if (isMod) toMod++; else if (isShip) toShip++; else { dropped++; dropStat[k] = (dropStat[k] || 0) + 1; } continue; }
      if (SHIPLV.indexOf(k) >= 0) { isMod ? toMod++ : toShip++; continue; }
    }
  }
  const addable = Object.values(stats.nodes).filter(x => x.addable).length;
  say('=== 全库归属（新数据）===');
  say('  可汇总节点        : ' + addable);
  say('  ✅ 投到模块        : ' + toMod);
  say('  ✅ 舰船级          : ' + toShip);
  say('  ❌ 仍无归属(丢弃)  : ' + dropped + '   ' + Object.entries(dropStat).map(([k, c]) => k + ' ' + c).join(' · '));
  check('丢弃降到 100 以内', dropped < 100, String(dropped));
  check('可汇总 ≥ 4400', addable >= 4400, String(addable));

  /* ---------- 浏览器：端到端 ---------- */
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1200, height: 900 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2500));

  /* 找一艘有「被命中率下降」节点的船 + 一艘有本舰船机库节点的船 */
  const bmap = JSON.parse(fs.readFileSync('data/blueprint_map.json', 'utf8'));
  const idx = {};
  for (const f of fs.readdirSync('data/blueprint')) {
    const bp = JSON.parse(fs.readFileSync('data/blueprint/' + f, 'utf8'));
    for (const s of bp.systems) for (const n of s.nodes) idx[String(n.id)] = { cdn: f.replace('.json', ''), sys: s.sysName, name: n.name };
  }
  const pick = (stat, n = 1) => {
    const out = [];
    for (const [id, st] of Object.entries(stats.nodes)) {
      if (st.addable && st.stat === stat && st.multi <= 1 && idx[id]) out.push({ id, ...idx[id], lv: st.perLevel });
      if (out.length >= n) break;
    }
    return out;
  };
  const ehdNodes = pick('enemyHitDown', 2);
  const hdmg = pick('hangarDmg', 2);
  say('   [debug] 节点等级上限: ehd=' + JSON.stringify(ehdNodes.map(x => x.lv.length - 1)) + ' hdmg=' + JSON.stringify(hdmg.map(x => x.lv.length - 1)));
  say('\n取样：被命中率下降 ' + JSON.stringify(ehdNodes.map(x => x.name)) + ' ／ 本舰船机库伤害 ' + JSON.stringify(hdmg.map(x => x.name)));

  const run = async (store, sel) => {
    await p.evaluate(s => localStorage.setItem('lagrange_addpoint', JSON.stringify(s)), store);
    await p.reload({ waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 3000));
    return await p.evaluate((store, sel) => {
      // ★ 必须用【配置加点的那艘船】建实例，不能固定拿大帝（否则读不到加点）
      const cdn = Object.keys(store)[0];
      const slug = (() => { for (const [k, v] of Object.entries(BP_MAP || {})) if (String(v.cdnId) === String(cdn)) return k; return null; })();
      const entry = slug && SHIP_DATABASE[slug];
      if (!entry) return { __err: '库里没有 ' + slug + '（cdnId ' + cdn + '）' };
      const e = JSON.parse(JSON.stringify(entry));
      e.selectedModules = Object.assign({}, sel);
      // 只保留这艘船真实存在的模块键
      Object.keys(e.selectedModules).forEach(k => { if (!e.modules || !e.modules[k]) delete e.selectedModules[k]; });
      const s = createShipInstance(e, 'ally', false, false);
      return { slug: slug, hp: s.maxHp, enemyHitDown: s.enemyHitDown || 0, aaLockDown: s.aaLockDown || 0,
               hangarDmg: s.hangarDmg || 0, hangarHit: s.hangarHit || 0, hangarByModule: s.hangarByModule || null,
               repairBonus: s.repairBonus || 0, repairArmor: s.repairArmor || 0,
               counted: s._apB ? s._apB._counted : 0, other: s._apB ? s._apB._other : 0,
               shipB: s._apB ? s._apB.ship : null };
    }, store, sel);
  };

  // ① 被命中率下降（★ 必须按节点自己的等级上限设，不能一律 5 —— 有的节点只有 1~2 级）
  if (ehdNodes.length) {
    const lv = {}; ehdNodes.forEach(x => lv[x.id] = x.lv.length - 1);
    const r = await run({ [ehdNodes[0].cdn]: { lv, manual: {} } }, {});
    say('   [debug] ' + JSON.stringify({ slug: r.slug, counted: r.counted, other: r.other, ehd: r.enemyHitDown, hit: r.shipB && r.shipB.hitBonus }));
    check('「被命中率下降」进了 enemyHitDown（防御侧）', r.enemyHitDown > 0, 'enemyHitDown=' + r.enemyHitDown);
    check('　且【没有】混进 hitBonus（旧版就是错在这）', !r.shipB || !r.shipB.hitBonus, 'hitBonus=' + (r.shipB ? r.shipB.hitBonus : '?'));
  }

  // ② 本舰船机库
  if (hdmg.length) {
    const lv = {}; hdmg.forEach(x => lv[x.id] = x.lv.length - 1);
    const r = await run({ [hdmg[0].cdn]: { lv, manual: {} } }, {});
    say('   [debug] ' + JSON.stringify({ slug: r.slug, counted: r.counted, other: r.other, hangarDmg: r.hangarDmg }));
    check('「本舰船机库·伤害」进了 hangarDmg', r.hangarDmg > 0, 'hangarDmg=' + r.hangarDmg);
  }

  // ④ 维修拆分：手填 repairArmor 应进 repairArmor，repairBonus 不该被它污染
  const r4 = await run({ '60401': { lv: {}, manual: { repairArmor: 3, repairBonus: 40, hangarBonus: 15 } } }, { M: 'M1', A: 'A1' });
  check('一次性维修装甲(点数) 进 repairArmor', r4.repairArmor === 3, 'repairArmor=' + r4.repairArmor);
  check('维修效率(%) 进 repairBonus', r4.repairBonus === 40, 'repairBonus=' + r4.repairBonus);

  check('无 JS 报错', errs.length === 0, errs.slice(0, 2).join(' | '));

  const pass = res.filter(Boolean).length;
  say('\n通过 ' + pass + '/' + res.length);
  await b.close();
})();
