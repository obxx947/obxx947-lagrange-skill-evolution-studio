/* 生成【给 AI 读的整理数据表】→ 桌面/拉格朗日-全量数据表-给AI.md
   要求（用户 2026-09-21）：每一条数据前面都要有【舰船名字】。
   结构：总表 → 按舰种分节 → 每艘船一节（模块/变体/武器逐行，每行都带舰名）→ 载机位 → 已知问题索引
*/
const fs = require('fs');
const ROOT = 'C:/Users/Administrator/Desktop/拉格朗日智能体3';
const OUT = 'C:/Users/Administrator/Desktop';
const db = JSON.parse(fs.readFileSync(ROOT + '/data/ship_database.json', 'utf8'));
const ships = Array.isArray(db) ? db : db.ships;
const bmap = JSON.parse(fs.readFileSync(ROOT + '/data/blueprint_map.json', 'utf8'));
const stats = JSON.parse(fs.readFileSync(ROOT + '/data/blueprint_stats.json', 'utf8'));

const KIND = { battlecruiser: '战列巡洋舰', battleship: '战列舰', aircraftcarrier: '航空母舰', support: '支援舰', cruiser: '巡洋舰', destroyer: '驱逐舰', frigate: '护卫舰', corvette: '护航艇', fighter: '战机' };
const ORDER = ['battlecruiser', 'battleship', 'aircraftcarrier', 'support', 'cruiser', 'destroyer', 'frigate', 'corvette', 'fighter'];
const WT = { direct: '直射', projectile: '投射' };
const DT = { energy: '能量', physical: '实弹' };
const esc = s => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
/* speed 在库里是对象 {cruise:'250-1200', warp:1250} */
const spd = v => !v ? '-' : (typeof v === 'object' ? '巡航 ' + (v.cruise || '-') + ' / 曲率 ' + (v.warp || '-') : String(v));

/* 给每艘船预计算 */
const rows = ships.map(s => {
  const gs = [];
  Object.entries(s.modules || {}).forEach(([k, m]) => {
    if (k[0] === '_') return;
    if (m.variants) Object.entries(m.variants).forEach(([v, mm]) => gs.push({ key: k + v, mod: mm }));
    else gs.push({ key: k, mod: m });
  });
  let wn = 0; gs.forEach(g => wn += (g.mod.wepons || g.mod.weapons || []).length);
  return { s, gs, wn };
});

let M = '';
M += '# 拉格朗日 · 全量数据表（给 AI 读）\n\n';
M += '> **来源**：`data/ship_database.json`（唯一数据源）+ `data/blueprint_map.json` + `data/blueprint_stats.json`。\n';
M += '> **生成**：2026-09-21，由 `_gen_aitable.js` 从库直接导出，未经人工修饰。\n';
M += '> **格式约定**：每条数据行**第一列固定是舰船名**，便于按船检索。\n';
M += '> **缺口与冲突**见另一份 `拉格朗日-数据缺口清单.md`。\n\n';

/* ---- 汇总 ---- */
const byKind = {}; ships.forEach(s => byKind[s.type] = (byKind[s.type] || 0) + 1);
let wTot = 0, airTot = 0;
/* airSlots 结构：{ byModule: { M1:[{kind,size,cap}], ... }, ...其它键 } —— 累加所有 cap */
const slotCap = s => {
  const a = s.airSlots; if (!a) return 0;
  let n = 0;
  const walk = o => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(x => { if (x && typeof x.cap === 'number') n += x.cap; else walk(x); }); return; }
    Object.values(o).forEach(walk);
  };
  walk(a); return n;
};
const slotList = s => {
  const a = s.airSlots; if (!a) return [];
  const out = [];
  const by = a.byModule || a;
  Object.entries(by).forEach(([k, v]) => {
    if (!Array.isArray(v)) return;
    v.forEach(x => { if (x && x.cap) out.push({ key: k, kind: x.kind || x.size, cap: x.cap, size: x.size }); });
  });
  return out;
};
rows.forEach(r => { wTot += r.wn; airTot += slotCap(r.s); });
M += '## 0. 汇总\n\n';
M += '| 项 | 值 |\n|---|---|\n';
M += '| 舰船总数 | ' + ships.length + ' |\n';
M += '| 武器总数 | ' + wTot + ' 门 |\n';
M += '| 载机位合计 | ' + airTot + ' |\n';
M += '| 各舰种 | ' + ORDER.filter(k => byKind[k]).map(k => KIND[k] + ' ' + byKind[k]).join(' · ') + ' |\n';
M += '| 有结构值的 | ' + ships.filter(s => s.hp).length + ' / ' + ships.length + ' |\n';
M += '| 有加点数据的 | ' + ships.filter(s => { const c = (bmap[s.id] || {}).cdnId; return c && fs.existsSync(ROOT + '/data/blueprint/' + c + '.json'); }).length + ' / ' + ships.length + ' |\n';
M += '| 有作战模式标注的载机 | ' + ships.filter(s => s.flightMode).length + ' / ' + ships.filter(s => /战机|护航艇|轰炸机|攻击机|战斗机|侦察机|炮艇|导弹艇|鱼雷艇|飞行坦克|拦截机/.test(s.name || '')).length + ' |\n';
M += '\n**字段含义**\n\n';
M += '| 字段 | 含义 |\n|---|---|\n';
M += '| `id` | 内部 slug（配队/加点页用它做 key） |\n';
M += '| `type` / `size` / `position` | 舰种 / 体型 / 站位（前·中·后排） |\n';
M += '| `commandValue` / `serviceLimit` | 指挥值（人口） / 服役上限 |\n';
M += '| `hp` / `physicalArmor` / `energyArmor` | 结构值 / 物理护甲 / 能量抗性 |\n';
M += '| `dmgType` | `energy` 能量（乘抗性，≥100% 则无效） / `physical` 实弹（减护甲，≤0 则 10% 保底） |\n';
M += '| `weaponType` | `direct` 直射（受阵型阻挡、不被拦截） / `projectile` 投射（无视阵型、可被拦截） |\n';
M += '| `singleDmg` / `ammo` / `attacks` | 单发伤害 / 每轮发数 / 攻击轮次 |\n';
M += '| `atkDuration` / `cooldown` / `lockTime` | 攻击持续时间 / 冷却 / 锁定时间（秒） |\n';
M += '| `dpm` | 面板标称：`antiShip` 对舰 / `antiAir` 对空 / `siege` 攻城 |\n';
M += '| `targets` | 目标类型 + 命中区间 `hitMin~hitMax`（%） |\n';
M += '| `priority` | 攻击序列（优先打哪类） |\n';
M += '| `subSystemTargets` | 系统破坏：`{系统名: low/medium/high}`（低/中/高 = 20%/40%/60% 分流） |\n';
M += '| `interceptRate` / `interceptType` | 拦截率 % / 范围（`self` 自身 · `sameRow` 同排 · `global` 全域） |\n';
M += '| `flightMode` | 载机作战模式：`independent` 独立 / `reciprocating` 往复（含 `baseFlightOut` 去程·`baseFlightBack` 返程 秒） |\n';
M += '| `airSlots` | 载机位：`{键: 容量}`，键形如 `M2|fighter`（模块位|机型） |\n';
M += '\n---\n\n';

/* ---- 总表 ---- */
M += '## 1. 总表（一行一艘）\n\n';
M += '| 舰船 | id | 舰种 | 体型 | 站位 | 人口 | 服役 | 结构值 | 物抗 | 能抗 | 模块|变体 | 武器 | 速度 |\n';
M += '|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
rows.forEach(({ s, gs, wn }) => {
  M += '| **' + esc(s.name) + '** | `' + s.id + '` | ' + (KIND[s.type] || s.type || '-') + ' | ' + (s.size || '-') + ' | ' + (s.position || '-') + ' | ' +
    (s.commandValue == null ? '-' : s.commandValue) + ' | ' + (s.serviceLimit == null ? '-' : s.serviceLimit) + ' | ' +
    (s.hp == null ? '**缺**' : s.hp) + ' | ' + (s.physicalArmor == null ? (s.physicalArmor === 0 ? 0 : '-') : s.physicalArmor) + ' | ' +
    (s.energyArmor == null ? (s.energyArmor === 0 ? 0 : '-') : s.energyArmor) + ' | ' + gs.length + ' | ' + (wn || '**0**') + ' | ' + spd(s.speed) + ' |\n';
});
M += '\n---\n\n';

/* ---- 逐船详情 ---- */
M += '## 2. 逐船明细（每门武器一行，行首带舰船名）\n\n';
ORDER.forEach(k => {
  const list = rows.filter(r => r.s.type === k);
  if (!list.length) return;
  M += '\n### 2.' + (ORDER.indexOf(k) + 1) + ' ' + KIND[k] + '（' + list.length + ' 艘）\n\n';
  list.forEach(({ s, gs, wn }) => {
    const cdn = (bmap[s.id] || {}).cdnId;
    M += '\n#### ' + s.name + '\n\n';
    M += '- **舰船**：' + s.name + '（`' + s.id + '`' + (cdn ? ' · 加点编号 `' + cdn + '`' : '') + '）\n';
    M += '- **舰船**：舰种 ' + (KIND[s.type] || s.type || '-') + ' ｜ 体型 ' + (s.size || '-') + ' ｜ 站位 **' + (s.position || '-') + '**\n';
    M += '- **舰船**：人口 ' + (s.commandValue == null ? '-' : s.commandValue) + ' ｜ 服役上限 ' + (s.serviceLimit == null ? '-' : s.serviceLimit) + ' ｜ 速度 ' + spd(s.speed) + '\n';
    M += '- **舰船**：结构值 **' + (s.hp == null ? '**缺**' : s.hp) + '** ｜ 物理护甲 ' + (s.physicalArmor == null ? '-' : s.physicalArmor) + ' ｜ 能量抗性 ' + (s.energyArmor == null ? '-' : s.energyArmor) + '\n';
    if (s.ratings) M += '- **舰船**：评分 对舰' + (s.ratings.antiShip || '-') + ' 对空' + (s.ratings.antiAir || '-') + ' 攻城' + (s.ratings.siege || '-') + ' 生存' + (s.ratings.survival || '-') + ' 策略' + (s.ratings.strategy || '-') + '\n';
    if (s.flightMode) M += '- **舰船**：载机模式 **' + (s.flightMode === 'independent' ? '独立作战' : '往复打击') + '**' + (s.baseFlightOut ? ' 去程 ' + s.baseFlightOut + 's · 返程 ' + s.baseFlightBack + 's' : '') + ' ｜ 编队 ' + (s.squadronSize || '-') + ' 架/组\n';
    if (s.interceptRate) M += '- **舰船**：拦截率 **' + s.interceptRate + '%** ｜ 范围 ' + (s.interceptType || '-') + '\n';
    const sl = slotList(s);
    if (sl.length) M += '- **舰船**：载机位 ' + sl.map(x => '`' + x.key + '` ' + x.kind + '×' + x.cap + (x.size && x.size !== x.kind ? '(限' + x.size + ')' : '')).join(' · ') + ' —— 合计 ' + slotCap(s) + ' 架\n';
    if (!gs.length) { M += '- ⚠️ **舰船**：' + s.name + ' —— **没有任何模块/武器数据**\n\n'; return; }
    /* 武器表 */
    M += '\n| 舰船 | 模块·变体 | 模块名 | 武器名 | 类型 | 单发 | 弹×次 | 持续 | 冷却 | 锁定 | 面板DPM | 目标(命中) | 序列 | 系统破坏 |\n';
    M += '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
    let anyW = false;
    gs.forEach(({ key, mod }) => {
      const wl = mod.weapons || [];
      if (!wl.length) {
        M += '| ' + esc(s.name) + ' | `' + key + '` | ' + esc(mod.name) + ' | _（无武器）_ | — | — | — | — | — | — | — | — | — | — |\n';
        return;
      }
      wl.forEach(w => {
        anyW = true;
        const d = w.dpm || {};
        const dpmS = [d.antiShip ? '对舰' + d.antiShip : '', d.antiAir ? '对空' + d.antiAir : '', d.siege ? '攻城' + d.siege : ''].filter(Boolean).join(' ') || '**0**';
        const tg = (w.targets || []).map(t => t.types.join('/') + '(' + t.hitMin + '~' + t.hitMax + ')').join(' ') || '-';
        const sb = w.subSystemTargets ? Object.entries(w.subSystemTargets).map(([k2, v]) => k2 + ' ' + v).join(' · ') : '-';
        M += '| ' + esc(s.name) + ' | `' + key + '` | ' + esc(mod.name) + ' | ' + esc(w.name) + ' | ' + (WT[w.weaponType] || '-') + (w.dmgType ? '/' + (DT[w.dmgType] || w.dmgType) : '') +
          ' | ' + w.singleDmg + ' | ' + (w.ammo || 1) + '×' + (w.attacks || 1) + ' | ' + (w.atkDuration == null ? '-' : w.atkDuration) + ' | ' + (w.cooldown == null ? '-' : w.cooldown) +
          ' | ' + (w.lockTime || 0) + ' | ' + dpmS + ' | ' + tg + ' | ' + esc(w.priority || '-') + ' | ' + sb + ' |\n';
      });
    });
    M += '\n';
    if (!anyW) M += '> ⚠️ **舰船**：' + s.name + ' —— 有模块但**一门武器都没有**（打不出伤害）\n\n';
  });
});

/* ---- 已知问题索引 ---- */
M += '\n---\n\n## 3. 已知数据问题（速查）\n\n';
M += '> 详细清单与填写位在 `拉格朗日-数据缺口清单.md`。\n\n';
M += '| 问题 | 涉及 | 去哪一节 |\n|---|---|---|\n';
M += '| 载机作战模式缺标注 | 31 艘 | 缺口清单 1.1 |\n';
M += '| 系统独立血量没有 | 全部 | 缺口清单 1.2 |\n';
M += '| 系统伤害效率只有 14/412 门有 | 398 门 | 缺口清单 1.3 |\n';
M += '| 术语代号无译文 | 13 个节点 | 缺口清单 2.1 |\n';
M += '| 一条说明多个数值位对不上 | 52 个节点 | 缺口清单 2.2 |\n';
M += '| 太阳鲸 C2 打什么不明 | 1 | 缺口清单 2.3 |\n';
M += '| 面板 DPM 与各项数值算不出 | 176 门 | 缺口清单 3.1 |\n';
M += '| 系统破坏数值完全雷同 | 8 门 | 缺口清单 3.2 |\n';
M += '| 同名武器数值不同 | 14 组 | 缺口清单 3.3 |\n';
M += '| **武器名损坏**（名字是段落标题，占位单发100/DPM0） | 31 门 | 缺口清单 3.4 |\n';
M += '| 系统破坏无出处 | 9 条 | 缺口清单 3.5 |\n';
M += '| 零武器 / 无hp / 无加点 | 12 / 4 / 19 艘 | 缺口清单 四 |\n';

fs.writeFileSync(OUT + '/拉格朗日-全量数据表-给AI.md', M, 'utf8');
console.log('已生成：桌面/拉格朗日-全量数据表-给AI.md');
console.log('  行数 ' + M.split('\n').length + ' / ' + (Buffer.byteLength(M, 'utf8') / 1024).toFixed(0) + ' KB');
console.log('  舰船 ' + ships.length + ' · 武器 ' + wTot + ' 门 · 载机位 ' + airTot);
