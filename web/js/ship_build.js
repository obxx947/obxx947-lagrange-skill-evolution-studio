/* ================= 舰船配置（加点 + 强化）AI 读取 =================
   把用户的「加点」（addpoint.html 存的）与「强化」（simulator.html 舰队里存的）
   汇总成 AI 能直接读的文字，供 chat 里的 get_ship_builds 工具调用。

   存储位置：
     localStorage['lagrange_addpoint']  = { [官方编号]: { lv:{节点id:等级}, manual:{攻城/维修/命中/机库} } }
     localStorage['lagrange_sim_fleets']= 模拟器舰队（条目里有 hpBonus/physResistBonus/… 与逐武器 strengthen）
   配置数据：
     data/blueprint_map.json  舰船库 slug → 官方编号
     data/blueprint_stats.json 节点 id → 属性归类 + 每级数值
*/
window.ShipBuild = (function () {
  const AP_KEY = 'lagrange_addpoint';
  const SIM_KEY = 'lagrange_sim_fleets';
  const A = ['hp', 'physResist', 'energyResist', 'dmgBonus', 'crit', 'lockReduction',
             'cooldownReduction', 'singleDmg', 'evasion', 'interceptRate'];
  const MANUAL = ['siege', 'repairBonus', 'hitBonus', 'hangarBonus'];
  const CN = {
    hp: '结构值', physResist: '物理抵抗', energyResist: '能量抗性', dmgBonus: '伤害加成',
    crit: '暴击', lockReduction: '锁定减免', cooldownReduction: '冷却减免', singleDmg: '单发伤害',
    evasion: '闪避', interceptRate: '拦截率',
    siege: '攻城伤害', repairBonus: '维修量加成', hitBonus: '命中加成', hangarBonus: '机库加成'
  };

  let MAP = null, STATS = null, SHIPS = null, DB = null, loading = null;

  function read(k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } }
  function apStore() { return read(AP_KEY, {}); }
  function simFleets() { return read(SIM_KEY, {}); }

  function loadData() {
    if (MAP && STATS && SHIPS && DB) return Promise.resolve(true);
    if (loading) return loading;
    loading = Promise.all([
      fetch('data/blueprint_map.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => ({})),
      fetch('data/blueprint_stats.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => null),
      fetch('data/blueprint_ships.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => []),
      // 舰船库：chat 页里没有 window.SHIP_DATABASE 这个全局（那是模拟器页的），自己拉一份
      fetch('data/ship_database.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => [])
    ]).then(([m, s, sh, db]) => { MAP = m; STATS = s; SHIPS = sh; DB = db || []; return !!(MAP && STATS); })
      .catch(() => false);
    return loading;
  }

  /* 名字/ID → 舰船库条目（slug） */
  function findShip(q) {
    if (!q) return null;
    const s = String(q).trim().toLowerCase();
    let list = [];
    if (DB && DB.length) list = DB;
    else { try { list = Object.values(window.SHIP_DATABASE || {}); } catch (e) { } }
    if (!list.length) return null;
    let hit = list.find(x => String(x.id).toLowerCase() === s || String(x.name).toLowerCase() === s);
    if (!hit) hit = list.find(x => String(x.name).toLowerCase().indexOf(s) >= 0 || String(x.id).toLowerCase().indexOf(s) >= 0);
    return hit || null;
  }

  /* 汇总一艘船的加点 */
  function buildAddPoint(slug) {
    if (!MAP || !STATS) return null;
    const e = MAP[slug]; if (!e || !e.cdnId) return null;
    const rec = apStore()[e.cdnId]; if (!rec) return null;
    const lv = rec.lv || {}, manual = rec.manual || {};
    const out = {}; A.forEach(k => out[k] = 0); MANUAL.forEach(k => out[k] = 0);
    let counted = 0, skipped = 0, other = 0, used = 0;
    Object.keys(lv).forEach(nid => {
      const L = lv[nid]; if (!L || L <= 0) return;
      used++;
      const st = STATS.nodes[nid]; if (!st || st.empty) return;
      if (A.indexOf(st.stat) >= 0 || MANUAL.indexOf(st.stat) >= 0) {
        if (st.multi > 1) { skipped++; return; }
        const v = st.perLevel ? st.perLevel[L] : null;
        if (typeof v !== 'number') { skipped++; return; }
        out[st.stat] += v; counted++;
      } else other++;
    });
    // 手填：A 组 10 项是「手动追加」（叠加在自动汇总上）；B 组 4 项引擎没有来源，直接用填的值
    let manualApplied = 0;
    A.forEach(k => { if (typeof manual[k] === 'number') { out[k] += manual[k]; manualApplied++; } });
    MANUAL.forEach(k => { if (typeof manual[k] === 'number') out[k] = manual[k]; });
    return { cdnId: e.cdnId, cdnName: e.cdnName, lv, out, counted, skipped, other, used, manual, manualApplied };
  }

  /* 找出模拟器舰队里这艘船的强化配置（可能有多条） */
  function findSimEntries(slug) {
    const fd = simFleets(); const res = [];
    const names = { 'ally-escort': '我方护航', 'ally-escorted': '我方被护航', 'enemy-escort': '敌方护航', 'enemy-escorted': '敌方被护航' };
    Object.keys(fd || {}).forEach(ft => {
      const f = fd[ft] || {};
      ['main', 'reinforcement'].forEach(sec => {
        (f[sec] || []).forEach(e => { if (e && e.id === slug) res.push({ 舰队: names[ft] || ft, 段: sec === 'main' ? '主舰队' : '增援', e }); });
      });
    });
    return res;
  }

  function simEntryText(x) {
    const e = x.e, L = [];
    L.push('  · ' + x.舰队 + '／' + x.段 + (e.count ? '　×' + e.count : ''));
    const ship = ['结构值+' + (e.hpBonus || 0) + '%', '物理抵抗+' + (e.physResistBonus || 0),
      '能量抗性+' + (e.energyResistBonus || 0) + '%', '伤害加成+' + (e.dmgBonus || 0) + '%',
      '闪避+' + (e.evasion || 0) + '%', '拦截率+' + (e.interceptRate || 0) + '%(' + ({ self: '自身', sameRow: '同排', global: '全域' }[e.interceptType] || '同排') + ')',
      '命中加成+' + (e.hitBonus || 0) + '%', '维修量+' + (e.repairBonus || 0) + '%',
      '机库加成+' + (e.hangarBonus || 0) + '%', '攻城+' + (e.siegeBonus || 0) + '%'];
    const nz = ship.filter(s => !/\+0(%|\))/.test(s));
    L.push('    舰船级：' + (nz.length ? nz.join('  ') : '（全 0）'));
    const st = e.strengthen || {};
    const ws = [];
    Object.keys(st).forEach(k => (st[k] || []).forEach((v, i) => {
      if (!v) return;
      const p = [];
      if (v.dmgBonus) p.push('单发+' + v.dmgBonus + '%');
      if (v.critRate) p.push('暴击+' + v.critRate + '%');
      if (v.critDmg) p.push('暴伤+' + v.critDmg + '%');
      if (v.lockReduction) p.push('锁定-' + v.lockReduction + '%');
      if (v.cooldownReduction) p.push('冷却-' + v.cooldownReduction + '%');
      if (p.length) ws.push('    ' + k + ' 武器' + (i + 1) + '：' + p.join(' '));
    }));
    if (ws.length) { L.push('    逐武器强化：'); L.push.apply(L, ws.slice(0, 12)); if (ws.length > 12) L.push('    …共 ' + ws.length + ' 条'); }
    return L.join('\n');
  }

  function apText(b) {
    const L = [];
    L.push('【加点】已点 ' + b.used + ' 个节点' + (b.counted ? '（其中 ' + b.counted + ' 个计入属性）' : ''));
    // A 组：把「节点自动汇总」和「手动追加」分开写，合计才是进引擎的值
    const A_CN = { hp: '结构值', physResist: '物理抵抗', energyResist: '能量抗性', dmgBonus: '伤害加成', crit: '暴击',
                   lockReduction: '锁定减免', cooldownReduction: '冷却减免', singleDmg: '单发伤害', evasion: '闪避', interceptRate: '拦截率' };
    const autoLine = [], plusLine = [];
    let anyPlus = false;
    A.forEach(k => {
      const m = (typeof b.manual[k] === 'number') ? b.manual[k] : 0;
      const total = Math.round(b.out[k] * 100) / 100;
      const auto = Math.round((total - m) * 100) / 100;
      const u = k === 'physResist' ? '' : '%';
      if (m) { anyPlus = true; plusLine.push(A_CN[k] + ' 自动' + auto + u + ' + 手填' + m + u + ' = ' + total + u); }
      else autoLine.push(A_CN[k] + '+' + total + u);
    });
    L.push('  A 组（引擎已支持，自动汇总）：' + autoLine.join('  '));
    if (anyPlus) L.push('  A 组手动追加：' + plusLine.join('；') + '　（已含在上面合计里）');
    const man = MANUAL.map(k => CN[k] + '+' + b.out[k] + '%');
    L.push('  B 组（引擎原本没有，全靠手填）：' + man.join('  '));
    if (b.skipped) L.push('  ⚠ ' + b.skipped + ' 个多参数节点（说明里有 ≥2 个数值位）未计入');
    if (b.other) L.push('  ⚠ ' + b.other + ' 个节点属于引擎暂未实现的机制（速度/系统血量/打击间隔等），未计入');
    return L.join('\n');
  }

  /* ===== AI 工具入口 ===== */
  async function searchTool(q) {
    const ok = await loadData();
    if (!ok) return JSON.stringify({ error: '加点数据文件读不到（data/blueprint_map.json / blueprint_stats.json）' });
    const all = apStore();
    const simAll = simFleets();
    const hasAny = Object.keys(all).length || Object.keys(simAll || {}).some(k => (simAll[k] || {}).main || (simAll[k] || {}).reinforcement);

    // 不传参数：列出配过加点/有舰队的所有舰船
    if (!q) {
      const out = [];
      const byCdn = {}; Object.keys(MAP).forEach(slug => { const c = MAP[slug] && MAP[slug].cdnId; if (c) byCdn[c] = slug; });
      Object.keys(all).forEach(cdn => {
        const slug = byCdn[cdn]; const sh = findShip(slug) || (SHIPS || []).find(x => String(x.id) === String(cdn));
        const b = buildAddPoint(slug);
        out.push('· ' + (sh ? sh.name : (b && b.cdnName) || cdn) + '（加点 ' + (b ? b.used : 0) + ' 个节点）');
      });
      const simShips = new Set();
      Object.keys(simAll || {}).forEach(ft => ['main', 'reinforcement'].forEach(sec =>
        (simAll[ft][sec] || []).forEach(e => e && e.id && simShips.add(e.id))));
      const simList = [...simShips].map(s => { const x = findShip(s); return '· ' + (x ? x.name : s) + '（模拟器里有强化配置）'; });
      if (!out.length && !simList.length) {
        return '用户还没有任何加点或强化配置。\n'
          + '（加点在「战舰配队」页勾「加点」后点舰船右上角 ⬆ 进入；强化在「模拟器」里点舰船的「强化」按钮）'
          + (hasAny ? '' : '\n');
      }
      return '用户的舰船配置清单：\n' + out.concat(simList).join('\n')
        + '\n\n用 get_ship_builds(ship_name:"舰船名") 看某一艘的详细加成。';
    }

    const sh = findShip(q);
    const slug = sh ? sh.id : null;
    const b = slug ? buildAddPoint(slug) : null;
    const sims = slug ? findSimEntries(slug) : [];
    if (!b && !sims.length) {
      return '「' + q + '」没有找到加点或强化配置。'
        + (sh ? '' : '（舰船库里也没有这艘船，请确认名称）');
    }
    const L = [];
    L.push('【' + (sh ? sh.name : q) + '】的配置');
    if (b) { L.push(apText(b)); L.push('  （官方加点编号 ' + b.cdnId + '，对应「' + b.cdnName + '」）'); }
    else L.push('【加点】没有配置');
    if (sims.length) { L.push('【强化】模拟器里有 ' + sims.length + ' 处：'); L.push(sims.map(simEntryText).join('\n')); }
    else L.push('【强化】模拟器里没有配置');
    L.push('');
    L.push('说明：加点与强化都会在模拟器里生效。要让加点进入战斗，需在模拟器的舰船「强化」弹窗里点「⬆ 从加点导入」。');
    return L.join('\n');
  }

  return { searchTool, loadData, findShip, buildAddPoint, KEY: AP_KEY };
})();
