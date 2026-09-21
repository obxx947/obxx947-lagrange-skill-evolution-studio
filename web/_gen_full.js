/* 生成【完整】的 缺少 / 冲突 / 不明确 全清单 → 桌面/拉格朗日-缺少冲突不明确-全清单.md
   用户要求：① 前几次的格式（留空给用户填）② 每条数据前带舰船名 ③ 不隐瞒、不留侥幸
   四部分：一 冲突 · 二 缺少 · 三 不明确 · 四 策略全表（367）
*/
const fs = require('fs');
const ROOT = 'C:/Users/Administrator/Desktop/拉格朗日智能体3';
const OUT = 'C:/Users/Administrator/Desktop';
const bp = JSON.parse(fs.readFileSync(ROOT + '/data/blueprint_all.json', 'utf8'));
const st = JSON.parse(fs.readFileSync(ROOT + '/data/blueprint_stats.json', 'utf8'));
const db = JSON.parse(fs.readFileSync(ROOT + '/data/ship_database.json', 'utf8'));
const ships = Array.isArray(db) ? db : db.ships;
const bmap = JSON.parse(fs.readFileSync(ROOT + '/data/blueprint_map.json', 'utf8'));
const sysmap = JSON.parse(fs.readFileSync(ROOT + '/data/blueprint_sysmap.json', 'utf8'));
const BL = '____________';
const esc = s => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ／ ');
const clean = s => String(s || '').replace(/<[^>]+>/g, '');

/* ========== 收集 ========== */
/* A. 同位置二选一 */
const altGroups = [];
bp.forEach(b => b.systems.forEach(y => {
  const byPos = {};
  y.nodes.forEach(n => { if (!n.name) return; const p = (n.position || []).join(','); (byPos[p] = byPos[p] || []).push(n); });
  Object.entries(byPos).filter(([, v]) => v.length > 1).forEach(([p, v]) => altGroups.push({ ship: b.shipName, cdn: b.id, sys: y.sysName, pos: p, nodes: v }));
}));
const stratAlt = altGroups.filter(g => g.nodes.some(n => n.type >= 2));

/* B. 模块变体 × 策略 */
const varStrat = [];
ships.forEach(s => {
  const cdn = String((bmap[s.id] || {}).cdnId || '');
  const b = bp.find(x => String(x.id) === cdn); if (!b) return;
  const sm = (sysmap[cdn] || {}).systems || {};
  const byVariant = {};
  b.systems.forEach(y => {
    const m = sm[y.sysId]; if (!m || m.scope !== 'module') return;
    const list = y.nodes.filter(n => n.type >= 2 && n.name);
    if (list.length) (byVariant[m.key + (m.variant || '')] = byVariant[m.key + (m.variant || '')] || []).push(...list.map(n => ({ type: n.type, name: n.name, desc: clean(n.baseDesc) })));
  });
  const bySlot = {};
  Object.entries(byVariant).forEach(([vk, l]) => { const slot = vk.replace(/\d+$/, '') || vk; (bySlot[slot] = bySlot[slot] || {})[vk] = l; });
  Object.entries(bySlot).forEach(([slot, vs]) => { if (Object.keys(vs).length >= 2) varStrat.push({ ship: s.name, slug: s.id, slot, vs }); });
});

/* C. 术语代号 */
const pureRefs = [], embedRefs = [], multiFails = [];
const knownCodes = Object.keys(st.decoded || {});
bp.forEach(b => b.systems.forEach(y => y.nodes.forEach(n => {
  if (!n.name) return;
  const c = st.nodes[n.id] || {}, d = String(n.baseDesc || '');
  if (c.pureRef) pureRefs.push({ ship: b.shipName, sys: y.sysName, node: n.name, token: c.pureRef, lv: n.levelValue || [] });
  else if (c.needsManual) multiFails.push({ ship: b.shipName, sys: y.sysName, node: n.name, desc: d, vals: (n.levelValue || [])[1] || [], ph: (d.match(/\{[^}]+\}/g) || []).join(' ') });
  const toks = [...new Set(d.match(/\{[A-Za-z]+\d+\}/g) || [])].filter(t => knownCodes.indexOf(t) < 0);
  if (toks.length && !c.pureRef) embedRefs.push({ ship: b.shipName, node: n.name, toks, desc: d });
})));
multiFails.sort((a, b) => a.ship.localeCompare(b.ship, 'zh'));

/* D. 条件触发 */
const cond = [], condBroad = [];
bp.forEach(b => b.systems.forEach(y => y.nodes.forEach(n => {
  if (!n.name) return;
  const d = clean(n.baseDesc);
  const c = st.nodes[n.id] || {};
  /* 只用【引擎实际识别出来的条件】（stats 里的 cond 字段），这样表里显示的条件参数是准的 */
  if (c.cond && c.addable) cond.push({ ship: b.shipName, sys: y.sysName, node: n.name, desc: d, addable: true, stat: c.stat, cond: c.cond });
  else if (/血量(首次)?(低于|降至|下降至)|结构比例降至|每运行|每连续|每\s*\{?[^}\s]{0,4}\}?\s*轮|每轮工作|击破(目标|武器|动力)|战斗开始时|战斗开始后|单场战斗只|一场战斗只|直到战斗结束|可叠加|层\//.test(d))
    condBroad.push({ ship: b.shipName, sys: y.sysName, node: n.name, desc: d, stat: c.stat, mech: c.mechanic && c.mechanic.kind });
})));
const condAll = cond.length + condBroad.length;

/* E. 策略全表 */
const strategics = [];
bp.forEach(b => b.systems.forEach(y => y.nodes.forEach(n => {
  if (n.type !== 2 && n.type !== 3) return;
  if (!n.name) return;
  const c = st.nodes[n.id] || {};
  strategics.push({ ship: b.shipName, sys: y.sysName, node: n.name, type: n.type, desc: clean(n.baseDesc), stat: c.stat, mech: c.mechanic && c.mechanic.kind, addable: !!c.addable });
})));

/* F. 冲突数据（沿用上一次扫描） */
const dpmBad = [];
ships.forEach(s => Object.entries(s.modules || {}).forEach(([mk, m]) => {
  if (mk[0] === '_') return;
  const gs = m.variants ? Object.entries(m.variants) : [[mk, m]];
  gs.forEach(([vk, g]) => (g.weapons || []).forEach(w => {
    const d = w.dpm || {}, panel = Math.max(d.antiShip || 0, d.antiAir || 0, d.siege || 0);
    const total = (w.atkDuration || 0) + (w.cooldown || 0);
    if (!panel || !total) return;
    const calc = Math.floor((w.singleDmg || 0) * (w.ammo || 1) * (w.attacks || 1) * 60 / total);
    if (!calc) return;
    const r = calc / panel;
    if (r < 0.85 || r > 1.18) dpmBad.push({ ship: s.name, name: w.name, single: w.singleDmg, ammo: w.ammo || 1, atk: w.attacks || 1, dur: w.atkDuration || 0, cd: w.cooldown || 0, panel, calc, r: Math.round(r * 100) / 100 });
  }));
}));
dpmBad.sort((a, b) => a.r - b.r);

const badW = [], unsourced = [];
ships.forEach(s => Object.entries(s.modules || {}).forEach(([mk, m]) => {
  if (mk[0] === '_') return;
  const gs = m.variants ? Object.values(m.variants) : [m];
  gs.forEach(g => (g.weapons || []).forEach(w => {
    const n = w.name || '', d = w.dpm || {};
    if (/^[一二三四五六七八九十\d]+[、.．]/.test(n) || /补充说明|无武器|未标注|无相关数据/.test(n) ||
      (/系统[（(]/.test(n) && !(d.antiShip > 0) && !(d.antiAir > 0) && !(d.siege > 0))) badW.push({ ship: s.name, name: n, single: w.singleDmg });
    if (w._sysBreakUnsourced) unsourced.push({ ship: s.name, name: w.name, v: w.subSystemTargets });
  }));
}));

const noW = [], noHp = [], noBp = [], noMode = [], withMode = [];
ships.forEach(s => {
  let wn = 0;
  Object.entries(s.modules || {}).forEach(([k, m]) => { if (k[0] === '_') return; const gs = m.variants ? Object.values(m.variants) : [m]; gs.forEach(g => wn += (g.weapons || []).length); });
  if (!wn) noW.push(s);
  if (!s.hp) noHp.push(s);
  const cdn = (bmap[s.id] || {}).cdnId;
  if (!(cdn && fs.existsSync(ROOT + '/data/blueprint/' + cdn + '.json'))) noBp.push(s);
});
ships.filter(s => /战机|护航艇|轰炸机|攻击机|战斗机|侦察机|炮艇|导弹艇|鱼雷艇|飞行坦克|拦截机/.test(s.name || '')).forEach(s => (s.flightMode ? withMode : noMode).push(s));

/* ========== 写 ========== */
let T = '';
const H = (n, s) => T += '\n' + '#'.repeat(n) + ' ' + s + '\n\n';

T += '# 拉格朗日 · 缺少 / 冲突 / 不明确 —— 全清单\n\n';
T += '> **用法**：每条数据**最前面都是舰船名**；需要你定的地方写了 `✍️ 填写`，直接写答案。\n';
T += '> 生成于 2026-09-21，对着 `ship_database.json`、`blueprint_all.json`（官网公开加点数据）、187 份《舰船资料》、《战斗机制》文档逐条核过。\n';
T += '> **不隐瞒、不留侥幸** —— 凡是"机制里提到但没做"「数据里没有」「两个来源对不上」的，全部在下面。\n\n';

T += '## 目录\n\n';
T += '| 部分 | 内容 | 数量 |\n|---|---|---|\n';
T += '| **一** | **冲突**（两个来源对不上 / 规则冲突） | ' + (stratAlt.length + varStrat.length + dpmBad.length + badW.length + unsourced.length) + ' 条 |\n';
T += '| 二 | 缺少（数据里完全没有） | 10 类 |\n';
T += '| 三 | 不明确（有但读不出 / 未实现） | ' + (pureRefs.length + embedRefs.length + multiFails.length + cond.length + 38) + ' 条 |\n';
T += '| 四 | 策略全表（type=2 指挥策略 + type=3 战术技能） | ' + strategics.length + ' 个节点 |\n';

/* ================= 一、冲突 ================= */
H(1, '一、冲突');
T += '> 这一类是**最要紧的**：不是"没有"，而是"有但对不上"，会直接算出错的战斗结果。\n';

H(2, '1.1 ★★ 加点「二选一」（' + altGroups.length + ' 组，其中策略类 ' + stratAlt.length + ' 组）');
T += '**判据**：同一系统里 `position` 完全相同 + 游戏数据自带的 **`priorty`** 字段不同（1 / 2）→ **游戏里只能选一个**。\n\n';
T += '**priorty 取值**：`0` 普通节点（6996 个）｜`1` 选项一（55 个）｜`2` 选项二（55 个）。\n';
T += '全库 **55 组同位置**：**' + altGroups.length + ' 组两边都有实际内容**（需要玩家选一个）+ ' + (55 - altGroups.length) + ' 组两边都是空槽（游戏预留位置、还没放内容）。\n\n';
T += '**✅ 已在加点页实现**（`addpoint.html`）：二选一渲染成**一张金框卡 + 右上角 ①② 切换器**；\n';
T += '点其中一个就把另一个的点数退回；切换也退。实测 `test/addpoint_alt_choice.js` **14/14 通过**。\n\n';
T += '> 数据来源：2026-09-21 重抓官网 CDN 核对，与上次一致（177 艘 / 7106 节点 / priorty 分布相同）。\n\n';
stratAlt.forEach(g => {
  T += '**' + g.ship + '** ／ ' + g.sys + ' ／ 位置[' + g.pos + '] —— ' + g.nodes.length + ' 选 1\n\n';
  T += '| 舰船 | 选项 | 类型 | 效果 | ✍️ 填写（哪个是正确/推荐的？或"两个都对，只是二选一"） |\n|---|---|---|---|---|\n';
  g.nodes.forEach(n => {
    T += '| ' + g.ship + ' | **' + esc(n.name) + '** | ' + (n.type === 2 ? '指挥策略' : n.type === 3 ? '战术技能' : '普通') + ' | ' + esc(clean(n.baseDesc).slice(0, 90)) + ' | ' + BL + ' |\n';
  });
  T += '\n';
});
const plainAlt = altGroups.filter(g => !g.nodes.some(n => n.type >= 2));
if (plainAlt.length) {
  T += '\n**另有 ' + plainAlt.length + ' 组是普通数值节点的二选一**（同样是我的引擎没做互斥）：\n\n';
  T += '| 舰船 | 系统 | 位置 | 选项 | ✍️ 填写 |\n|---|---|---|---|---|\n';
  plainAlt.forEach(g => { T += '| ' + g.ship + ' | ' + g.sys + ' | [' + g.pos + '] | ' + g.nodes.map(n => esc(n.name)).join(' ／ ') + ' | ' + BL + ' |\n'; });
}

H(2, '1.2 ★★ 模块变体多选一（' + varStrat.length + ' 个船×槽位）—— 选哪个变体就拿到哪套策略');
T += '**这是什么**：超主力的每个模块槽（M/A/B/C/D）有多个变体，**只能装一个**；\n';
T += '而**每个变体带的是完全不同的策略** —— 这是配队最核心的取舍。\n\n';
T += '**现状**：引擎已按"当前装的变体"生效（实测正确），**但加点页/配队页没有把这个对照摆出来**，玩家看不出"装 M2 会拿到什么、丢掉什么"。\n\n';
varStrat.forEach(r => {
  T += '**' + r.ship + '**（`' + r.slug + '`）　' + r.slot + ' 槽 —— ' + Object.keys(r.vs).length + ' 选 1\n\n';
  T += '| 舰船 | 变体 | 策略 | 类型 | 效果 |\n|---|---|---|---|---|\n';
  Object.entries(r.vs).forEach(([vk, list]) => {
    list.forEach((x, i) => {
      T += '| ' + r.ship + ' | ' + (i === 0 ? '**' + vk + '**' : '') + ' | ' + esc(x.name) + ' | ' + (x.type === 2 ? '指挥策略' : '战术技能') + ' | ' + esc(x.desc.slice(0, 80)) + ' |\n';
    });
  });
  T += '\n';
});

H(2, '1.3 ★武器面板 DPM 与各项数值算不出来（' + dpmBad.length + ' 门）');
T += '按文档公式 `单发 × 安装数 × 攻击轮次 × 每轮次数 × 60 ÷ (持续时间+冷却)`，算出来的和面板差很多（比值 0.08~1.0）。\n';
T += '**这是"某些船打出来伤害不对"的一个原因。**\n\n';
T += '> 💡 两个选择：**A. 你一条条填** ｜ **B. 说一句「自动修」**，我用面板 DPM 反推（已验证误差 1~3%）。\n\n';
T += '| # | 舰船 | 武器 | 单发 | 弹×次 | 持续 | 冷却 | 面板DPM | 算出来 | 比值 | ✍️ 填写 |\n|---|---|---|---|---|---|---|---|---|---|---|\n';
dpmBad.forEach((x, i) => { T += '| ' + (i + 1) + ' | ' + x.ship + ' | ' + esc(x.name) + ' | ' + x.single + ' | ' + x.ammo + '×' + x.atk + ' | ' + x.dur + ' | ' + x.cd + ' | ' + x.panel + ' | ' + x.calc + ' | ' + x.r + ' | ' + BL + ' |\n'; });

H(2, '1.4 ★武器名损坏（' + badW.length + ' 门）—— 名字是段落标题，数据是占位的');
T += '**这就是"某些船打不出伤害"的真因**：武器名是从资料里把段落标题抓进来了，单发多为 100、DPM 全 0。\n\n';
T += '| # | 舰船 | 库里现在写的是 | 单发 | ✍️ 正确的武器名 | ✍️ 单发 | ✍️ 次数 | ✍️ 冷却 |\n|---|---|---|---|---|---|---|---|\n';
badW.forEach((x, i) => { T += '| ' + (i + 1) + ' | ' + x.ship + ' | `' + esc(x.name) + '` | ' + x.single + ' | ' + BL + ' | ' + BL + ' | ' + BL + ' | ' + BL + ' |\n'; });

H(2, '1.5 系统破坏数值完全雷同（疑复制错误）');
const bySig = {};
ships.forEach(s => Object.entries(s.modules || {}).forEach(([mk, m]) => {
  if (mk[0] === '_') return;
  const gs = m.variants ? Object.values(m.variants) : [m];
  gs.forEach(g => (g.weapons || []).forEach(w => {
    if (!w.subSystemTargets) return;
    (bySig[JSON.stringify(w.subSystemTargets)] = bySig[JSON.stringify(w.subSystemTargets)] || []).push({ ship: s.name, name: w.name, src: w._sysBreakSrc || w._sysBreakUnsourced || '(无出处)' });
  }));
}));
Object.entries(bySig).filter(([, v]) => v.length > 1).forEach(([sig, v]) => {
  T += '**数值**：`' + esc(sig) + '`\n\n| 舰船 | 武器 | 出处 | ✍️ 正确数值 / 或"确认无误" |\n|---|---|---|---|\n';
  v.forEach(x => { T += '| ' + x.ship + ' | ' + esc(x.name) + ' | ' + x.src + ' | ' + BL + ' |\n'; });
  T += '\n';
});

H(2, '1.6 系统破坏数据【找不到出处】（' + unsourced.length + ' 条）');
T += '| # | 舰船 | 武器 | 数值 | ✍️ 留 / 改 / 删 | ✍️ 若"改"，正确值 |\n|---|---|---|---|---|---|\n';
unsourced.forEach((x, i) => { T += '| ' + (i + 1) + ' | ' + x.ship + ' | ' + esc(x.name) + ' | `' + esc(JSON.stringify(x.v)) + '` | ' + BL + ' | ' + BL + ' |\n'; });
T += '\n> ⚠️ 其中**米斯特拉**那条与**维塔斯A021**完全一样，而米斯特拉的资料里一个"系统"字都没有。\n';

H(2, '1.7 同名武器数值不同');
const byName = {};
ships.forEach(s => Object.entries(s.modules || {}).forEach(([mk, m]) => {
  if (mk[0] === '_') return;
  const gs = m.variants ? Object.values(m.variants) : [m];
  gs.forEach(g => (g.weapons || []).forEach(w => { const n = w.name || ''; if (n && n.length >= 3) (byName[n] = byName[n] || []).push({ ship: s.name, single: w.singleDmg, cd: w.cooldown, dur: w.atkDuration, ammo: w.ammo, atk: w.attacks }); }));
}));
Object.entries(byName).filter(([, v]) => v.length > 1 && new Set(v.map(x => x.single + '|' + x.cd + '|' + x.dur + '|' + x.ammo + '|' + x.atk)).size > 1).slice(0, 15).forEach(([n, v]) => {
  T += '\n**`' + esc(n) + '`**\n\n| 舰船 | 单发 | 冷却 | 持续 | 弹 | 次 | ✍️ |\n|---|---|---|---|---|---|---|\n';
  v.slice(0, 5).forEach(x => { T += '| ' + x.ship + ' | ' + x.single + ' | ' + x.cd + ' | ' + x.dur + ' | ' + x.ammo + ' | ' + x.atk + ' | ' + BL + ' |\n'; });
});

/* ================= 二、缺少 ================= */
H(1, '二、缺少（数据里完全没有）');
T += '### 2.1 舰载机作战模式（' + noMode.length + ' 艘缺）\n\n';
T += '《战斗机制》：舰载机分 **独立作战**（飞过去一直打，索敌无视阵型）和 **往复打击**（打一次飞回母舰补弹再出去，飞行途中冷却和锁定同时进行）。\n';
T += '库里 52 艘战机/护航艇只有 ' + withMode.length + ' 艘有标注，**引擎里这个字段出现 0 次**。\n\n';
T += '| # | 舰船 | ✍️ 填写（独立 / 往复 + 去程__秒 返程__秒） |\n|---|---|---|\n';
noMode.forEach((s, i) => { T += '| ' + (i + 1) + ' | ' + s.name + ' | ' + BL + ' |\n'; });
T += '\n参考已有值：维塔斯B 去12返8 · 米斯特拉 去3返3 · 雷火V022 去3返3 · 孢孑A404 去3返3 · 维塔斯A021 去5返3 · 天璇A 去5返5\n';

T += '\n### 2.2 系统独立血量\n\n';
T += '《战斗机制》：「系统拥有独立的血量，这个数字只有编辑」。文档给了例子：大帝 主武器 22000 / 动力 20000；CV3000 动力 28000 + 机库 26500。\n';
T += '**现状：数据里一个字段都没有。**\n\n';
T += '| # | 舰船 | 系统 | ✍️ 血量 |\n|---|---|---|---|\n';
for (let i = 1; i <= 12; i++) T += '| ' + i + ' | ' + BL + ' | ' + BL + ' | ' + BL + ' |\n';

T += '\n### 2.3 ★系统攻击效率（低 / 中 / 高）\n\n';
T += '《战斗机制》：「系统伤害效率高中低指的是**命中分流比率，分别是 60% / 40% / 20%**」。\n';
T += '资料里的写法：「系统打击（概率损毁目标舰船系统，打击序列：X系统效率低/中/高）」。\n';
T += '**现状：412 门武器里只有 14 门有这个数据**，剩下 398 门打不出系统伤害。\n\n';
T += '| # | 舰船 | 武器 | ✍️ 打击序列（例：动力系统效率高 / 主武器系统效率中 / 指挥系统效率低） |\n|---|---|---|---|\n';
for (let i = 1; i <= 10; i++) T += '| ' + i + ' | ' + BL + ' | ' + BL + ' | ' + BL + ' |\n';

T += '\n### 2.4 防空相关\n\n';
T += '| 项 | 文档怎么说 | 现状 | ✍️ 填写 |\n|---|---|---|---|\n';
T += '| 防空命中率 | 舰船防空武器基础命中率 **15%**，机载防空武器 **60%** | 我们所有武器共用同一套命中区间表 | 这两个数字通用吗？ |\n';
T += '| 主动防空名单 | 米斯特拉（最强）· 沙龙大气层拦截机 · CVT800脉冲炮艇 · 狼西级防御护卫舰 · 锆石级突击护卫舰 · 刺水母防御护卫舰 | 引擎没有"主动防空" | 名单对不对？我们库里对应哪些船？ |\n';
T += '| 武器轻重 | 轻型打小型命中更高；重型打大型更好、瞄小型大幅降低 | 数据和引擎**都没有这个属性** | 要吗？怎么判？ |\n';

T += '\n### 2.5 三个系数\n\n';
T += '| 项 | 文档 | 现状 | ✍️ 填写 |\n|---|---|---|---|\n';
T += '| 武器调校系数 | 单发 = 基础×(1+调校系数)×…，例子都是 1.3 | 只有全局 1.3 | 要按武器区分吗？ |\n';
T += '| 系统攻击伤害系数 | 不全是 1.5，测得 1.25 / 1.5 / 3（新大地=3、刺鳐=1.25或1.5） | 数据里没有 | 每门是多少？ |\n';
T += '| 打结构的系数 | 不全是 0.8，有些低于 0.1（可能 BUG） | 数据里没有 | 哪些是多少？ |\n';

T += '\n### 2.6 整艘船整块缺失\n\n';
T += '**一门武器都没有（' + noW.length + ' 艘）**\n\n| # | 舰船 | ✍️ 真没武器 / 漏了（漏了请给数据） |\n|---|---|---|\n';
noW.forEach((s, i) => { T += '| ' + (i + 1) + ' | ' + s.name + ' | ' + BL + ' |\n'; });
T += '\n**连结构值都没有（' + noHp.length + ' 艘）**\n\n| # | 舰船 | ✍️ 结构值 |\n|---|---|---|\n';
noHp.forEach((s, i) => { T += '| ' + (i + 1) + ' | ' + s.name + ' | ' + BL + ' |\n'; });
T += '\n**完全没有加点数据（' + noBp.length + ' 艘）**\n\n| # | 舰船 | ✍️ 有就写，没有写"没有" |\n|---|---|---|\n';
noBp.forEach((s, i) => { T += '| ' + (i + 1) + ' | ' + s.name + ' | ' + BL + ' |\n'; });

/* ================= 三、不明确 ================= */
H(1, '三、不明确（有数据，但读不出含义 / 未实现）');

H(2, '3.1 术语代号（' + (pureRefs.length + embedRefs.length) + ' 个节点 / 16 种代号）');
T += '游戏数据里这些节点的说明**只存了一串代号**（官网没公开术语表），本工具翻译不出来。\n';
T += '请**在游戏里点开这条**，把完整效果说明抄下来。\n\n';
T += '**A. 整条说明就是一个代号（' + pureRefs.length + ' 个）**\n\n';
T += '| 编号 | 舰船 | 系统 | 节点 | 代号 | 各等级数值 | ✍️ 完整效果说明 |\n|---|---|---|---|---|---|---|\n';
pureRefs.forEach((x, i) => { T += '| P' + String(i + 1).padStart(2, '0') + ' | ' + x.ship + ' | ' + x.sys + ' | ' + x.node + ' | `' + x.token + '` | ' + (x.lv || []).map(v => Array.isArray(v) ? v.join('/') : String(v)).join(' → ') + ' | ' + BL + ' |\n'; });
T += '\n**B. 代号夹在说明文字中间（' + embedRefs.length + ' 个）**\n\n';
T += '| 编号 | 舰船 | 节点 | 待解代号 | 说明原文 | ✍️ 代号含义 |\n|---|---|---|---|---|---|\n';
embedRefs.forEach((x, i) => { T += '| Q' + String(i + 1).padStart(2, '0') + ' | ' + x.ship + ' | ' + x.node + ' | `' + x.toks.join('` `') + '` | ' + esc(x.desc) + ' | ' + BL + ' |\n'; });

H(2, '3.2 一条说明多个「{}」数值位，对不上（' + multiFails.length + ' 个）');
T += '请按 `{数值位} = 含义` 的格式填（例：`{101}=概率% ; {201}=暴击伤害%`）。\n';
T += '（标「**无占位符**」的是数字写死在文字里，请告诉我它加成什么。）\n\n';
T += '| 编号 | 舰船 | 系统 | 节点 | 每级数值 | 数值位 | 说明原文 | ✍️ 填写 |\n|---|---|---|---|---|---|---|---|\n';
multiFails.forEach((x, i) => { T += '| A' + String(i + 1).padStart(3, '0') + ' | ' + x.ship + ' | ' + x.sys + ' | ' + x.node + ' | `' + JSON.stringify(x.vals) + '` | ' + (x.ph ? '`' + x.ph + '`' : '**无占位符**') + ' | ' + esc(x.desc).slice(0, 60) + ' | ' + BL + ' |\n'; });

H(2, '3.3 ★★ 条件触发（' + cond.length + ' 个节点）—— ✅ 已实现');
T += '**原来错在哪**：这批节点被管线归类成"可汇总数值"后直接累加，\n\n';
T += '> **条件被丢掉，效果被当成「开场就永久生效」。**\n\n';
T += '例：「自身结构比例降至 50% 时，闪避率提升 20%，持续 10 秒，一场战斗只触发一次」\n';
T += '→ 原引擎给的是 **开局永久 +20% 闪避**，不看血量、不限期、可以无限次。\n\n';
T += '**✅ 2026-09-21 已实现**：管线侧识别条件写进 `rec.cond`，引擎侧 `processCondEffects()` 每 tick 求值\n';
T += '（条件由假变真 → 加上效果；到期或条件失效 → 撤掉；`once` 的触发一次后不再触发）。\n';
T += '已识别并实现 **' + cond.length + ' 个**（全库 119 个 `addable` 条件节点，只剩 1 个"叠加层数"类没做）。\n';
T += '另有 ' + condBroad.length + ' 个虽然也提到条件，但属于【机制未实现 / 需手填 / 空白】，本来就没生效。\n\n';
T += '| 条件类型 | 数量 | 引擎行为 |\n|---|---|---|\n';
T += '| `hpBelow` 自身血量 ≤ X% | ' + cond.filter(x => x.cond && x.cond.kind === 'hpBelow').length + ' | 血量掉到阈值才生效；带"持续X秒"的到期撤掉；"一场只触发一次"的触发过就锁死 |\n';
T += '| `battleStartSec` 战斗开始后 X 秒内 | ' + cond.filter(x => x.cond && x.cond.kind === 'battleStartSec').length + ' | 开场生效，过 X 秒撤掉 |\n';
T += '| `battleStart` 战斗开始后（整场） | ' + cond.filter(x => x.cond && x.cond.kind === 'battleStart').length + ' | 开场生效直到战斗结束 |\n';
T += '| `everySec` / `everyRounds` 周期性 | ' + cond.filter(x => x.cond && (x.cond.kind === 'everySec' || x.cond.kind === 'everyRounds')).length + ' | 按周期开/关 |\n';
T += '| `firstRounds` 前 N 轮 | ' + cond.filter(x => x.cond && x.cond.kind === 'firstRounds').length + ' | 折算成秒（⚠️ 近似，不是逐轮计数） |\n';
T += '\n**实测** `test/addpoint_cond_effects.js` **7/7 通过**（满血不生效 → 掉血生效 → 到期撤掉 → once 不再触发）。\n\n';
T += '<details><summary>全部条件节点明细（' + cond.length + ' 个）</summary>\n\n';
T += '| # | 舰船 | 系统 | 节点 | 条件 | 说明 |\n|---|---|---|---|---|---|\n';
cond.forEach((x, i) => {
  const c = x.cond || {};
  const ctxt = c.kind === 'hpBelow' ? '血量≤' + c.threshold + '%' + (c.dur ? ' 持续' + c.dur + 's' : '') + (c.once ? ' 仅一次' : '')
    : c.kind === 'battleStartSec' ? '开场' + c.sec + '秒内'
      : c.kind === 'battleStart' ? '开场整场'
        : c.kind === 'firstRounds' ? '前' + c.rounds + '轮'
          : c.kind === 'everyRounds' ? '每' + c.rounds + '轮' + (c.dur ? '/持续' + c.dur + 's' : '')
            : c.kind === 'everySec' ? '每' + c.threshold + '秒' + (c.dur ? '/持续' + c.dur + 's' : '')
              : (c.kind || '—');
  T += '| ' + (i + 1) + ' | ' + x.ship + ' | ' + x.sys + ' | ' + x.node + ' | ' + ctxt + ' | ' + esc(x.desc).slice(0, 62) + ' |\n';
});
T += '\n</details>\n';

H(2, '3.4 《战斗机制》里提到、但引擎/数据没有的（38 条）');
T += '| 编号 | 机制 | 文档怎么说 | 现状 |\n|---|---|---|---|\n';
[
  ['M01', '系统伤害（打系统 vs 打结构）', '武器发射后先被闪避/拦截，剩下看对目标系统的效率；VA战机对动力系统效率高，70%-90%打系统、10%-30%打结构', '只扣结构值，没有"打系统"路径；仅 14/412 门有数据'],
  ['M02', '系统独立血量', '系统拥有独立血量（大帝主武器22000/动力20000、CV3000动力28000+机库26500）', '数据里一个字段都没有'],
  ['M03', '系统可破坏次数', '有的只能破坏1次，有的能2次', '按系统类型一刀切，没有逐系统差异'],
  ['M04', '机库被毁 → 载机无法起降', '被破坏后舰载机无法起降', '只让该模块停火'],
  ['M05', '机库被毁 → 往复式返回后无法出击', '同上', '没做'],
  ['M06', '机库被毁 → 独立式失去机库增幅', '同上', '没做'],
  ['M07', '指挥系统被毁 → 所有策略失效', '被破坏后舰船所有策略无法使用', '没做'],
  ['M08', '指挥系统：3修后无法再被锁定', '第3次维修后无法被再次锁定', '没做'],
  ['M09', '动力系统被毁 → 失去闪避', '被破坏后舰船失去闪避能力', '只做了扣5%结构值'],
  ['M10', '动力系统被毁 → 无法紧急避险脱离', '同上', '引擎没有"脱离战斗"这个动作'],
  ['M11', '反击防空', '受舰载机攻击时触发，受击舰船+同排未被攻击的友方都触发', '没有'],
  ['M12', '区域防空 · 防空支援词条', '可打击以同排友方舰船为目标的敌方空中单位', '没有'],
  ['M13', '区域防空 · 周期性大范围防空', '加点让武器周期锁定临近排战机/护航艇', '没有"防空范围"概念'],
  ['M14', '区域防空 · 枪骑兵/圆锥综合', '枪骑兵→全阵型；圆锥综合→同排扩大到临近排', '没有'],
  ['M15', '主动防空', '无需被攻击即可自主锁敌全场，优先打威胁最高的', '没有'],
  ['M16', '防空命中率', '舰载防空 15%、机载防空 60%', '用统一命中区间表'],
  ['M17', '舰载机往复打击循环', '出舱→飞→打→返→机库内等冷却和锁定', 'flightMode 数据有 21 艘，引擎 0 处引用'],
  ['M18', '往复机：机库内不被防空锁定', '此阶段不会被防空武器锁定', '没做'],
  ['M19', '往复机：锁定≤冷却才能再出击', '锁定目标时间需小于或等于武器冷却时间', '没做'],
  ['M20', '出舱后丢目标 → 敌阵内重新锁敌', '未完成攻击就丢失目标，会在对方阵营内重新锁敌，而非返回', '没做'],
  ['M21', '聚焦空战目标', '让舰载机优先攻击对方战斗机和拦截机', 'targetPriority 只做了超主力/小型主力/战巡'],
  ['M22', '分伤机制', '可被攻击的舰船 ÷2.5 取整，平均分摊', '完全没做'],
  ['M23', '1点物理护甲 = 0.25% 受维修加成', '最高到 150%', '没做'],
  ['M24', '轰炸距离 → 往复时间 +2秒/吉米', '每 1 吉米舰载机飞行往复时间加 2 秒', '命中 ±2%/吉米 做了，飞行时间没做'],
  ['M25', '策略系数', '进单发伤害、也进最终冷却', '引擎 0 处引用'],
  ['M26', '敌方锁定延长', '锁定时间 = 基础×(1-锁定减少+敌方锁定延长)', '引擎 0 处引用'],
  ['M27', '敌方暴击伤害下降', '暴击伤害 = 基础×(1+爆伤加成-敌方暴击下降)', '引擎 0 处引用'],
  ['M28', '伤害加成稀释', '70抗性的电磁59 面对 50% 伤害加成，实际免伤只有 47%', '待验算（现公式可能已符合）'],
  ['M29', '旗舰效果 × 指挥系统联动', '指挥系统被损坏/摧毁 → 旗舰无法生效', '旗舰有，联动没有'],
  ['M30', '紧急避险 / 脱离战斗', '15 个加点节点提及', '没做'],
  ['M31', '状态系统（溶解/层数/可叠加）', '【溶解】层数、附加状态、可叠加 N 层', '引擎没有 buff/debuff 框架'],
  ['M32', '航速 / 飞行速度 / 移速', '独立作战的飞行距离取决于飞行速度，可以加成', '234 个加点节点提及，引擎没有这个维度'],
  ['M33', '攻击序列可任选类型', '每一列可勾选任意舰船类型、可只选一部分', '有 priority 字段但选择逻辑没建模'],
  ['M34', '总发弹量 = Miss弹 + 命中弹', '命中弹 = 结构伤害弹 + 系统伤害弹', '没做（战报统计维度）'],
  ['M35', '击毁一个系统 = 一轮攻击结束', '文档自己标注"需更广泛数据最终确认"', '没做（待确认，建议先别做）'],
  ['M36', '暴击伤害 = 系统伤害×(1+暴击系数×系统伤害系数)', '——', '系统伤害系数没有，做不了'],
  ['M37', '策略增伤：加算/乘算两种', '加算=策略先加基础伤害再乘调校', '策略系数没有'],
  ['M38', '载具增加伤害 / 科技点增加伤害', '进公式的位置与舰船不同', '加点部分做了，"载具加成"这层没有'],
].forEach(([no, name, doc, cur]) => { T += '| ' + no + ' | ' + name + ' | ' + doc + ' | ' + cur + ' |\n'; });

H(2, '3.5 太阳鲸 C2 到底打什么');
T += '- 舰船：太阳鲸-武装战略航空母舰 ／ 模块 C2「攻城无人机系统」\n';
T += '- 现状：资料只写「优先目标：**建筑**」，没有任何系统破坏描述；"建筑"这个目标类型引擎里也不存在。\n';
T += '- ✍️ ① 是否破坏系统？　是 / 否 → ' + BL + '\n';
T += '- ✍️ ② 打击序列：' + BL + '\n';
T += '- ✍️ ③ "建筑"是什么？' + BL + '\n';

H(2, '3.6 拦截率 / 闪避率');
T += '现状：全库只有 **5 艘**有拦截率（雷火之星B2 27% / 光锥级 23% / 大盾B3 12.8% / 太阳鲸C3 5% / CV3000 A2 12%）；**闪避率一艘都没有**。\n\n';
T += '| # | 舰船 | ✍️ 拦截率 | ✍️ 范围（自身/同排/全域） | ✍️ 模块 | ✍️ 闪避率 |\n|---|---|---|---|---|---|\n';
for (let i = 1; i <= 10; i++) T += '| ' + i + ' | ' + BL + ' | ____% | 自身/同排/全域 | ' + BL + ' | ____% |\n';

/* ================= 四、策略全表 ================= */
H(1, '四、策略全表（' + strategics.length + ' 个节点）');
T += '游戏加点树里 `type=2`（指挥策略）和 `type=3`（战术技能），共 ' + strategics.length + ' 个。\n';
T += '**这一类在加点页里现在没有单独分类**，和普通节点长得一样。\n';
T += '「引擎」列含义：`数值`=已当数值生效 ／ `机制:xxx`=已按战场机制实现 ／ `未实现`=还没做。\n\n';
T += '| # | 舰船 | 系统 | 节点 | 类型 | 引擎 | 说明 |\n|---|---|---|---|---|---|---|\n';
strategics.forEach((x, i) => {
  T += '| ' + (i + 1) + ' | ' + x.ship + ' | ' + x.sys + ' | ' + x.node + ' | ' + (x.type === 2 ? '指挥策略' : '战术技能') + ' | ' +
    (x.addable ? '数值:' + x.stat : (x.mech ? '机制:' + x.mech : '**未实现**')) + ' | ' + esc(x.desc).slice(0, 72) + ' |\n';
});

/* ================= 汇总 ================= */
H(1, '汇总');
T += '| 部分 | 项 | 数量 |\n|---|---|---|\n';
T += '| 一 冲突 | 同位置二选一 | **' + altGroups.length + ' 组**（策略类 ' + stratAlt.length + '） |\n';
T += '| 一 冲突 | 模块变体多选一（各带不同策略） | ' + varStrat.length + ' 个船×槽位 |\n';
T += '| 一 冲突 | 面板 DPM 算不出 | ' + dpmBad.length + ' 门 |\n';
T += '| 一 冲突 | 武器名损坏 | ' + badW.length + ' 门 |\n';
T += '| 一 冲突 | 系统破坏数值雷同 / 无出处 | ' + Object.entries(bySig).filter(([, v]) => v.length > 1).reduce((a, x) => a + x[1].length, 0) + ' / ' + unsourced.length + ' |\n';
T += '| 二 缺少 | 舰载机作战模式 | ' + noMode.length + ' 艘 |\n';
T += '| 二 缺少 | 系统独立血量 / 系统攻击效率 / 防空命中率 / 主动防空 / 武器轻重 / 三个系数 | 6 类 |\n';
T += '| 二 缺少 | 零武器 / 无hp / 无加点 | ' + noW.length + ' / ' + noHp.length + ' / ' + noBp.length + ' 艘 |\n';
T += '| 三 不明确 | 术语代号 | ' + (pureRefs.length + embedRefs.length) + ' 节点 |\n';
T += '| 三 不明确 | 多数值位对不上 | ' + multiFails.length + ' 个 |\n';
T += '| 三 不明确 | **条件触发（现在被当成永久效果）** | **' + cond.length + ' 个** |\n';
T += '| 三 不明确 | 机制未实现 | 38 条 |\n';
T += '| 四 策略 | type=2/3 策略节点 | ' + strategics.length + ' 个 —— **其中 ' + strategics.filter(x => !x.addable && !x.mech).length + ' 个引擎没实现（' + Math.round(strategics.filter(x => !x.addable && !x.mech).length / strategics.length * 100) + '%）** |\n';
T += '| 四 策略 | ├ 已当数值生效 | ' + strategics.filter(x => x.addable).length + ' 个 |\n';
T += '| 四 策略 | ├ 已按战场机制实现 | ' + strategics.filter(x => x.mech).length + ' 个 |\n';
T += '| 四 策略 | └ **未实现** | **' + strategics.filter(x => !x.addable && !x.mech).length + ' 个** |\n';

fs.writeFileSync(OUT + '/拉格朗日-缺少冲突不明确-全清单.md', T, 'utf8');
['拉格朗日-数据缺口清单.md'].forEach(f => { try { fs.unlinkSync(OUT + '/' + f); console.log('已删除：' + f); } catch (e) { } });
console.log('已生成：桌面/拉格朗日-缺少冲突不明确-全清单.md');
console.log('  ' + T.split('\n').length + ' 行 / ' + (Buffer.byteLength(T, 'utf8') / 1024).toFixed(0) + ' KB');
console.log('  同位置二选一 ' + altGroups.length + '（策略类 ' + stratAlt.length + '）· 模块变体多选一 ' + varStrat.length +
  ' · 条件触发 ' + cond.length + ' · 策略节点 ' + strategics.length + ' · DPM对不上 ' + dpmBad.length + ' · 坏武器名 ' + badW.length);
