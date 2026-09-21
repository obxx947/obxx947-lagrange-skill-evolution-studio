/* 生成【缺少 / 不明确 / 冲突】数据清单（Markdown，供用户填写）
   → 桌面/拉格朗日-数据缺口清单.md
   三类：
     一、缺少 —— 数据里完全没有
     二、不明确 —— 有，但读不出含义 / 要确认
     三、冲突 —— 两个来源对不上，需要裁定
     四、整体缺失 —— 整艘船整块没有
*/
const fs = require('fs');
const ROOT = 'C:/Users/Administrator/Desktop/拉格朗日智能体3';
const OUT = 'C:/Users/Administrator/Desktop';
const bp = JSON.parse(fs.readFileSync(ROOT + '/data/blueprint_all.json', 'utf8'));
const st = JSON.parse(fs.readFileSync(ROOT + '/data/blueprint_stats.json', 'utf8'));
const db = JSON.parse(fs.readFileSync(ROOT + '/data/ship_database.json', 'utf8'));
const ships = Array.isArray(db) ? db : db.ships;
const bmap = JSON.parse(fs.readFileSync(ROOT + '/data/blueprint_map.json', 'utf8'));
const BL = '___________________________';

/* ---------- 收集 ---------- */
const pureRefs = [], embedRefs = [], multiFails = [];
const knownCodes = Object.keys(st.decoded || {});
for (const b of bp) for (const y of b.systems) for (const n of y.nodes) {
  if (!n.name) continue;
  const c = st.nodes[n.id] || {}, d = String(n.baseDesc || '');
  if (c.pureRef) pureRefs.push({ ship: b.shipName, sys: y.sysName, node: n.name, token: c.pureRef, lv: n.levelValue || [] });
  else if (c.needsManual) multiFails.push({ ship: b.shipName, sys: y.sysName, node: n.name, desc: d, vals: (n.levelValue || [])[1] || [], ph: (d.match(/\{[^}]+\}/g) || []).join(' ') });
  const toks = [...new Set(d.match(/\{[A-Za-z]+\d+\}/g) || [])].filter(t => knownCodes.indexOf(t) < 0);
  if (toks.length && !c.pureRef) embedRefs.push({ ship: b.shipName, node: n.name, toks, desc: d });
}
multiFails.sort((a, b) => a.ship.localeCompare(b.ship, 'zh'));

/* 冲突 1：面板 DPM 与公式算不出 */
const dpmBad = [];
ships.forEach(s => Object.entries(s.modules || {}).forEach(([mk, m]) => {
  if (mk[0] === '_') return;
  const gs = m.variants ? Object.entries(m.variants) : [[mk, m]];
  gs.forEach(([vk, g]) => (g.weapons || []).forEach(w => {
    const d = w.dpm || {};
    const panel = Math.max(d.antiShip || 0, d.antiAir || 0, d.siege || 0);
    const total = (w.atkDuration || 0) + (w.cooldown || 0);
    if (!panel || !total) return;
    const calc = Math.floor((w.singleDmg || 0) * (w.ammo || 1) * (w.attacks || 1) * 60 / total);
    if (!calc) return;
    const r = calc / panel;
    if (r < 0.85 || r > 1.18) dpmBad.push({ ship: s.name, mod: vk, name: w.name, single: w.singleDmg, ammo: w.ammo || 1, atk: w.attacks || 1, dur: w.atkDuration || 0, cd: w.cooldown || 0, panel, calc, r: Math.round(r * 100) / 100 });
  }));
}));
dpmBad.sort((a, b) => a.r - b.r);

/* 冲突 2：系统破坏数据雷同 */
const bySig = {};
ships.forEach(s => Object.entries(s.modules || {}).forEach(([mk, m]) => {
  if (mk[0] === '_') return;
  const gs = m.variants ? Object.values(m.variants) : [m];
  gs.forEach(g => (g.weapons || []).forEach(w => {
    if (!w.subSystemTargets) return;
    const sig = JSON.stringify(w.subSystemTargets);
    (bySig[sig] = bySig[sig] || []).push({ ship: s.name, name: w.name, src: w._sysBreakSrc || w._sysBreakUnsourced || '(无出处)' });
  }));
}));
const dupSig = Object.entries(bySig).filter(([, v]) => v.length > 1);

/* 冲突 3：同名武器数值不同 */
const byName = {};
ships.forEach(s => Object.entries(s.modules || {}).forEach(([mk, m]) => {
  if (mk[0] === '_') return;
  const gs = m.variants ? Object.values(m.variants) : [m];
  gs.forEach(g => (g.weapons || []).forEach(w => {
    const n = w.name || ''; if (!n || n.length < 3) return;
    (byName[n] = byName[n] || []).push({ ship: s.name, single: w.singleDmg, cd: w.cooldown, dur: w.atkDuration, ammo: w.ammo, atk: w.attacks });
  }));
}));
const dupName = Object.entries(byName).filter(([, v]) => v.length > 1 && new Set(v.map(x => x.single + '|' + x.cd + '|' + x.dur + '|' + x.ammo + '|' + x.atk)).size > 1);

/* 冲突 4：武器名损坏 */
const badW = [];
ships.forEach(s => Object.entries(s.modules || {}).forEach(([mk, m]) => {
  if (mk[0] === '_') return;
  const gs = m.variants ? Object.values(m.variants) : [m];
  gs.forEach(g => (g.weapons || []).forEach(w => {
    const n = w.name || '', d = w.dpm || {};
    if (/^[一二三四五六七八九十\d]+[、.．]/.test(n) || /补充说明|无武器|未标注|无相关数据/.test(n) ||
      (/系统[（(]/.test(n) && !(d.antiShip > 0) && !(d.antiAir > 0) && !(d.siege > 0)))
      badW.push({ ship: s.name, name: n, single: w.singleDmg });
  }));
}));

/* 冲突 5：系统破坏无出处 */
const unsourced = [];
ships.forEach(s => Object.entries(s.modules || {}).forEach(([mk, m]) => {
  if (mk[0] === '_') return;
  const gs = m.variants ? Object.values(m.variants) : [m];
  gs.forEach(g => (g.weapons || []).forEach(w => { if (w._sysBreakUnsourced) unsourced.push({ ship: s.name, name: w.name, v: w.subSystemTargets }); }));
}));

/* 整体缺失 */
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

/* ---------- 写 md ---------- */
let T = '';
T += '# 拉格朗日 · 缺少 / 不明确 / 冲突 数据清单\n\n';
T += '> **用法**：每条下面有「✍️ 填写」，直接在那后面写答案。写完把本文件发回。\n';
T += '> 生成于 2026-09-21，对着 `data/ship_database.json`、`data/blueprint_stats.json` 和 187 份《舰船资料》核过。\n\n';
T += '**三类**：\n';
T += '- **一、缺少** —— 数据里完全没有\n';
T += '- **二、不明确** —— 有数据，但读不出含义 / 需要你确认\n';
T += '- **三、冲突** —— 两个来源对不上，需要你裁定\n';
T += '- **四、整体缺失** —— 整艘船整块没有\n\n';
T += '## 目录\n\n';
T += '| 章 | 内容 | 条数 |\n|---|---|---|\n';
T += '| 一 | 缺少的数据 | 8 类 |\n';
T += '| 二 | 不明确的数据 | ' + (pureRefs.length + embedRefs.length) + ' 个代号节点 + ' + multiFails.length + ' 个多数值位 |\n';
T += '| 三 | 冲突的数据 | ' + dpmBad.length + ' 门 DPM + ' + dupSig.reduce((a, x) => a + x[1].length, 0) + ' 门雷同 + ' + dupName.length + ' 组同名 + ' + badW.length + ' 门坏名 + ' + unsourced.length + ' 条无出处 |\n';
T += '| 四 | 整体缺失 | 零武器 ' + noW.length + ' · 无hp ' + noHp.length + ' · 无加点 ' + noBp.length + ' |\n';

/* ===== 一 ===== */
T += '\n---\n\n# 一、缺少的数据（数据里完全没有）\n';
T += '\n## 1.1 舰载机作战模式（' + noMode.length + ' 艘缺）\n\n';
T += '**为什么需要**：《战斗机制》说舰载机分"独立作战"和"往复打击"两种 ——\n';
T += '独立作战飞过去一直打；往复打击打一次飞回母舰补弹再出去（飞行途中冷却和锁定同时进行）。\n';
T += '库里 52 艘战机/护航艇，**只有 ' + withMode.length + ' 艘有标注**，引擎目前完全没用这个字段。\n\n';
T += '**怎么填**：往复的要给【去程秒数 / 返程秒数】；独立的只写"独立"两个字。\n';
T += '参考已有值：维塔斯B-轰炸机 去12返8 · 米斯特拉 去3返3 · 雷火V022 去3返3 · 孢孑A404 去3返3 · 维塔斯A021 去5返3 · 天璇A 去5返5。\n\n';
T += '| # | 舰船 | ✍️ 填写（独立 / 往复 + 去程__秒 返程__秒） |\n|---|---|---|\n';
noMode.forEach((s, i) => { T += '| ' + (i + 1) + ' | ' + s.name + ' | ' + BL + ' |\n'; });
T += '\n<details><summary>已有标注的 ' + withMode.length + ' 艘（不用填，供参考）</summary>\n\n';
withMode.forEach(s => { T += '- ' + s.name + ' —— ' + (s.flightMode === 'independent' ? '独立' : '往复 去' + (s.baseFlightOut || '?') + '返' + (s.baseFlightBack || '?')) + '\n'; });
T += '\n</details>\n';

T += '\n## 1.2 系统独立血量\n\n';
T += '**文档原文**：「系统拥有独立的血量，这个数字只有编辑」\n';
T += '**文档给的例子**：大帝 主武器 22000 / 动力 20000；CV3000 动力 28000 + 机库 26500。\n';
T += '**现状**：`ship_database.json` 里**一个字段都没有**。\n\n';
T += '| # | 舰船 | 系统 | ✍️ 填写（血量） |\n|---|---|---|---|\n';
for (let i = 1; i <= 15; i++) T += '| ' + i + ' | ' + BL + ' | ' + BL + ' | ' + BL + ' |\n';
T += '\n> 不一定要全部给 —— 先把 17 艘超主力给了就能做。\n';

T += '\n## 1.3 系统伤害效率（低 / 中 / 高）\n\n';
T += '**文档原文**：「系统伤害效率高中低指的是命中分流比率，分别是 **60% / 40% / 20%**」\n';
T += '**资料里的写法**：「系统打击（概率损毁目标舰船系统，打击序列：X系统效率低/中/高）」\n';
T += '**现状**：412 门武器里**只有 14 门**有这个数据，剩下 398 门打不出系统伤害。\n\n';
T += '| # | 舰船 | 武器 | ✍️ 填写（打击序列，例：动力系统效率高 / 主武器系统效率中 / 指挥系统效率低） |\n|---|---|---|---|\n';
for (let i = 1; i <= 12; i++) T += '| ' + i + ' | ' + BL + ' | ' + BL + ' | ' + BL + ' |\n';

T += '\n## 1.4 防空命中率\n\n';
T += '**文档原文**：「舰船防空武器基础命中率 **15%**，机载防空武器基础命中率 **60%**」\n';
T += '**现状**：我们所有武器共用同一套命中区间表，没有专门的防空命中率。\n\n';
T += '✍️ 这两个数字是通用的还是每艘不同？' + BL + '\n';

T += '\n## 1.5 主动防空舰船名单\n\n';
T += '**文档原文**：具有主动防空能力的有 —— **米斯特拉**（最强主动防空战机）、**沙龙大气层拦截机**、**CVT800脉冲炮艇**、**狼西级防御护卫舰**、**锆石级突击护卫舰**、**刺水母防御护卫舰**。\n';
T += '**现状**：引擎里没有"主动防空"这个概念。\n\n';
T += '✍️ 名单对不对？还有没有漏的？（我们库里对应的船名可能不同）\n' + BL + '\n\n';
T += '✍️ 我们库里对应：米斯特拉=____ · 沙龙=____ · CVT800=____ · 狼西=____ · 锆石=____ · 刺水母防御=____\n';

T += '\n## 1.6 武器轻重（轻型 / 重型）\n\n';
T += '**文档原文**：「轻型武器：攻击小型舰船命中率更高，单发伤害低」「重型武器：攻击装甲厚重、机动性差的大型舰船效果更好，瞄准小型目标时命中率大幅降低」\n';
T += '**现状**：`ship_database.json` 和引擎里**都没有"武器轻重"这个属性**。\n\n';
T += '✍️ 这个属性重要吗？如果要，怎么判？（按口径？按单发？还是每门单独标）\n' + BL + '\n';

T += '\n## 1.7 三个系数\n\n';
T += '| 项 | 文档怎么说 | 现状 | ✍️ 填写 |\n|---|---|---|---|\n';
T += '| 武器调校系数 | 单发 = 基础×(1+调校系数)×…，例子都是 1.3 | 只有全局 1.3 | 是否要按武器区分？ |\n';
T += '| 系统攻击伤害系数 | 不全是 1.5，同武器可变。测得有 1.25 / 1.5 / 3（新大地=3、刺鳐=1.25或1.5） | 数据里没有 | 每门武器是多少？ |\n';
T += '| 打结构的系数 | 可攻击系统的武器打结构有系数，不全是 0.8，有些低于 0.1（可能 BUG） | 数据里没有 | 哪些是多少？ |\n';

/* ===== 二 ===== */
T += '\n\n---\n\n# 二、不明确的数据（有，但读不出含义）\n';
T += '\n## 2.1 术语代号（' + (pureRefs.length + embedRefs.length) + ' 个节点 / 16 种代号）\n\n';
T += '游戏数据里这些节点的说明**只存了一串代号**，官网没公开术语表 —— 所以本工具翻译不出来。\n';
T += '请在游戏里点开这条，把【完整效果说明】抄下来。\n';
T += '\n### 2.1.1 整条说明就是一个代号（' + pureRefs.length + ' 个）\n\n';
T += '| 编号 | 舰船 | 系统 | 节点 | 代号 | 各等级数值 | ✍️ 填写（完整效果说明） |\n|---|---|---|---|---|---|---|\n';
pureRefs.forEach((x, i) => {
  T += '| P' + String(i + 1).padStart(2, '0') + ' | ' + x.ship + ' | ' + x.sys + ' | ' + x.node + ' | `' + x.token + '` | ' +
    (x.lv || []).map(v => Array.isArray(v) ? v.join('/') : String(v)).join(' → ') + ' | ' + BL + ' |\n';
});
T += '\n### 2.1.2 代号夹在说明文字中间（' + embedRefs.length + ' 个）\n\n';
T += '| 编号 | 舰船 | 节点 | 待解代号 | 说明原文 | ✍️ 填写（代号含义） |\n|---|---|---|---|---|---|\n';
embedRefs.forEach((x, i) => {
  T += '| Q' + String(i + 1).padStart(2, '0') + ' | ' + x.ship + ' | ' + x.node + ' | `' + x.toks.join('` `') + '` | ' +
    String(x.desc).replace(/\s*\n\s*/g, ' ／ ').replace(/\|/g, '\\|') + ' | ' + BL + ' |\n';
});
T += '\n> 已译 1 个：`{ED9142}` = 本系统机库内舰载机有 A% 概率造成 B% 暴击伤害（你上次口述确认的）。\n';

T += '\n## 2.2 一条说明有多个「{}」数值位，对不上（' + multiFails.length + ' 个）\n\n';
T += '说明里有 2 个以上 `{}`，但游戏数据给的数值个数对不上 → 不敢硬算，所以没进引擎。\n';
T += '请按 **`{数值位} = 含义`** 的格式填（例：`{101}=概率% ; {201}=暴击伤害%`）。\n';
T += '（说明里没有 `{}` 的会标「**无占位符**」—— 那种是数字写死在文字里，请告诉我它加成什么。）\n\n';
T += '| 编号 | 舰船 | 系统 | 节点 | 每级数值 | 数值位 | 说明原文 | ✍️ 填写 |\n|---|---|---|---|---|---|---|---|\n';
multiFails.forEach((x, i) => {
  T += '| A' + String(i + 1).padStart(3, '0') + ' | ' + x.ship + ' | ' + x.sys + ' | ' + x.node + ' | `' + JSON.stringify(x.vals) + '` | ' +
    (x.ph ? '`' + x.ph + '`' : '**无占位符**') + ' | ' + x.desc.replace(/\s*\n\s*/g, ' ／ ').replace(/\|/g, '\\|').slice(0, 70) + ' | ' + BL + ' |\n';
});

T += '\n## 2.3 太阳鲸 C2 到底打什么\n\n';
T += '资料只写「优先目标：**建筑**」，没有任何系统破坏描述；而"建筑"这个目标类型我们引擎里也不存在。\n\n';
T += '- ✍️ ① 它是否破坏系统？　是 / 否 → ' + BL + '\n';
T += '- ✍️ ② 打击序列（打哪个系统、效率高/中/低）：' + BL + '\n';
T += '- ✍️ ③ 游戏里的"建筑"是什么？' + BL + '\n';

/* ===== 三 ===== */
T += '\n\n---\n\n# 三、冲突的数据（两个来源对不上）\n';
T += '\n## 3.1 ★武器面板 DPM 与各项数值算不出来（' + dpmBad.length + ' 门）\n\n';
T += '**问题**：按文档的公式 `(单发伤害) × 武器安装数 × 攻击轮次 × 每轮攻击次数 × 60 ÷ (持续时间+冷却时间)`，\n';
T += '这批武器算出来的 DPM 和面板写的**差很多**（比值散在 0.08~1.0），说明"弹数/次数/冷却"的拆分口径不对。\n';
T += '这是"某些船打出来伤害不对"的一个原因。\n\n';
T += '> 💡 **两个选择**：\n';
T += '> - **A. 你填**：在下面写出正确的拆分（哪些是安装数、哪些是每轮次数、持续时间、冷却）。\n';
T += '> - **B. 我自动反推**：用面板 DPM 反推冷却 —— 这个方法在 127 门从《舰船资料》提取的武器上验证过，**误差 1~3%**。你只要说一句"自动修"。\n\n';
T += '| # | 舰船 | 武器 | 单发 | 现在记的弹×次 | 持续 | 冷却 | 面板DPM | 算出来 | 比值 | ✍️ 填写 |\n|---|---|---|---|---|---|---|---|---|---|---|\n';
dpmBad.forEach((x, i) => {
  T += '| ' + (i + 1) + ' | ' + x.ship + ' | ' + String(x.name).replace(/\|/g, '\\|') + ' | ' + x.single + ' | ' + x.ammo + '×' + x.atk + ' | ' + x.dur + ' | ' + x.cd + ' | ' + x.panel + ' | ' + x.calc + ' | ' + x.r + ' | ' + BL + ' |\n';
});

T += '\n## 3.2 系统破坏数据完全雷同（疑复制错误，' + dupSig.reduce((a, x) => a + x[1].length, 0) + ' 门）\n\n';
T += '这几组的数值**一模一样**，但它们是不同的船 —— 高度怀疑是从某一份资料复制过去的。\n\n';
dupSig.forEach(([sig, v]) => {
  T += '**数值**：`' + sig + '`\n\n';
  T += '| 舰船 | 武器 | 出处 | ✍️ 填写（正确数值 / 或"确认无误"） |\n|---|---|---|---|\n';
  v.forEach(x => { T += '| ' + x.ship + ' | ' + String(x.name).replace(/\|/g, '\\|') + ' | ' + x.src + ' | ' + BL + ' |\n'; });
  T += '\n';
});

T += '\n## 3.3 同名武器但数值不同（' + dupName.length + ' 组）\n\n';
T += '同一个武器名，在不同船上给的数值不一样 —— 是本来就不同，还是有抄错的？\n\n';
dupName.slice(0, 20).forEach(([n, v]) => {
  T += '**`' + n + '`**\n\n';
  T += '| 舰船 | 单发 | 冷却 | 持续 | 弹 | 次 | ✍️ |\n|---|---|---|---|---|---|---|\n';
  v.slice(0, 5).forEach(x => { T += '| ' + x.ship + ' | ' + x.single + ' | ' + x.cd + ' | ' + x.dur + ' | ' + x.ammo + ' | ' + x.atk + ' | ' + BL + ' |\n'; });
  T += '\n';
});
if (dupName.length > 20) T += '（其余 ' + (dupName.length - 20) + ' 组略）\n';

T += '\n## 3.4 ★武器名损坏（' + badW.length + ' 门）—— "某些船打不出伤害"的真因\n\n';
T += '这些武器的**名字是段落标题或说明文字**，不是武器名。绝大多数同时是占位数据（单发 100 / DPM 全 0）。\n';
T += '请写出**正确的武器名 + 单发伤害 + 攻击次数 + 冷却**。\n\n';
T += '| # | 舰船 | 库里现在写的是 | 单发 | ✍️ 正确的武器名 | ✍️ 单发 | ✍️ 次数 | ✍️ 冷却 |\n|---|---|---|---|---|---|---|---|\n';
badW.forEach((x, i) => {
  T += '| ' + (i + 1) + ' | ' + x.ship + ' | `' + String(x.name).replace(/\|/g, '\\|') + '` | ' + x.single + ' | ' + BL + ' | ' + BL + ' | ' + BL + ' | ' + BL + ' |\n';
});

T += '\n## 3.5 系统破坏数据【找不到出处】的 ' + unsourced.length + ' 条\n\n';
T += '这些是库里原有的，但 187 份《舰船资料》里查不到依据。请选：**留**（有依据）/ **改**（给正确值）/ **删**（确定不存在）。\n';
T += '（和 3.2 有重叠：3.2 看的是"和别的船雷同"，这里看的是"资料里查不到"。）\n\n';
T += '| # | 舰船 | 武器 | 数值 | ✍️ 留 / 改 / 删 | ✍️ 若"改"，正确值 |\n|---|---|---|---|---|---|\n';
unsourced.forEach((x, i) => {
  T += '| ' + (i + 1) + ' | ' + x.ship + ' | ' + String(x.name).replace(/\|/g, '\\|') + ' | `' + JSON.stringify(x.v) + '` | ' + BL + ' | ' + BL + ' |\n';
});
T += '\n> ⚠️ 其中**米斯特拉**那条与**维塔斯A021**的数值完全一样，而米斯特拉的资料里一个"系统"字都没有 —— 高度怀疑是复制错误。\n';

T += '\n## 3.6 拦截率 / 闪避率\n\n';
T += '**现状**：全库只有 **5 艘**有拦截率（雷火之星B2 27% / 光锥级 23% / 大盾B3 12.8% / 太阳鲸C3 5% / CV3000 A2 12%）；**闪避率一艘都没有**。\n\n';
T += '| # | ✍️ 舰船 | ✍️ 拦截率 | ✍️ 范围（自身/同排/全域） | ✍️ 模块 |\n|---|---|---|---|---|\n';
for (let i = 1; i <= 10; i++) T += '| ' + i + ' | ' + BL + ' | ____% | 自身/同排/全域 | ' + BL + ' |\n';
T += '\n| # | ✍️ 舰船 | ✍️ 闪避率 |\n|---|---|---|\n';
for (let i = 1; i <= 6; i++) T += '| ' + i + ' | ' + BL + ' | ____% |\n';

/* ===== 四 ===== */
T += '\n\n---\n\n# 四、整体缺失（整艘船整块没有）\n';
T += '\n## 4.1 一门武器都没有（' + noW.length + ' 艘）\n\n';
T += '请确认：是真没有武器，还是我们漏了？若是漏了，请给武器名 + 单发 + 次数 + 冷却。\n\n';
T += '| # | 舰船 | ✍️ 真没武器 / 漏了（漏了请给数据） |\n|---|---|---|\n';
noW.forEach((s, i) => { T += '| ' + (i + 1) + ' | ' + s.name + ' | ' + BL + ' |\n'; });

T += '\n## 4.2 连结构值都没有（' + noHp.length + ' 艘）\n\n';
T += '| # | 舰船 | ✍️ 填写结构值 |\n|---|---|---|\n';
noHp.forEach((s, i) => { T += '| ' + (i + 1) + ' | ' + s.name + ' | ' + BL + ' |\n'; });

T += '\n## 4.3 完全没有加点数据（' + noBp.length + ' 艘）\n\n';
T += '官网的加点数据里没有这些船。若游戏里能加点，请告诉我它们的系统和节点。\n\n';
T += '| # | 舰船 | ✍️ 填写（有就写，没有写"没有"） |\n|---|---|---|\n';
noBp.forEach((s, i) => { T += '| ' + (i + 1) + ' | ' + s.name + ' | ' + BL + ' |\n'; });

/* ===== 汇总 ===== */
T += '\n\n---\n\n# 汇总\n\n';
T += '| 章 | 项 | 条数 |\n|---|---|---|\n';
T += '| 一 | 舰载机作战模式 | ' + noMode.length + ' 艘 |\n';
T += '| 一 | 系统独立血量 / 系统伤害效率 / 防空命中率 / 主动防空名单 / 武器轻重 / 三个系数 | 6 类 |\n';
T += '| 二 | 术语代号 | ' + (pureRefs.length + embedRefs.length) + ' 个节点 |\n';
T += '| 二 | 多数值位对不上 | ' + multiFails.length + ' 个 |\n';
T += '| 二 | 太阳鲸 C2 | 1 项 |\n';
T += '| 三 | 面板 DPM 算不出 | ' + dpmBad.length + ' 门 |\n';
T += '| 三 | 系统破坏数值雷同 | ' + dupSig.reduce((a, x) => a + x[1].length, 0) + ' 门 |\n';
T += '| 三 | 同名武器数值不同 | ' + dupName.length + ' 组 |\n';
T += '| 三 | **武器名损坏** | **' + badW.length + ' 门** |\n';
T += '| 三 | 系统破坏无出处 | ' + unsourced.length + ' 条 |\n';
T += '| 三 | 拦截率 / 闪避率 | 5 艘有 / 0 艘有 |\n';
T += '| 四 | 零武器 / 无hp / 无加点 | ' + noW.length + ' / ' + noHp.length + ' / ' + noBp.length + ' 艘 |\n';
T += '\n> 第三类 3.1 那 ' + dpmBad.length + ' 门，如果你不想一条条填，直接说「**自动修**」，\n';
T += '> 我用面板 DPM 反推冷却（已验证误差 1~3%），修完再给你一份核对表。\n';

fs.writeFileSync(OUT + '/拉格朗日-数据缺口清单.md', T, 'utf8');
['拉格朗日-战斗机制实现手册.md'].forEach(f => { try { fs.unlinkSync(OUT + '/' + f); console.log('已删除：' + f); } catch (e) { } });
console.log('已生成：桌面/拉格朗日-数据缺口清单.md');
console.log('  行数 ' + T.split('\n').length + ' / ' + (Buffer.byteLength(T, 'utf8') / 1024).toFixed(0) + ' KB');
console.log('  缺少 ' + (noMode.length + 6) + ' 类 / 不明确 ' + (pureRefs.length + embedRefs.length + multiFails.length + 1) + ' 条 / 冲突 ' + (dpmBad.length + badW.length + dupSig.reduce((a, x) => a + x[1].length, 0) + unsourced.length) + ' 条 / 整体缺失 ' + (noW.length + noHp.length + noBp.length) + ' 艘');
