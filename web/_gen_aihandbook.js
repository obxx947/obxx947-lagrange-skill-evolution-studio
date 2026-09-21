/* 生成【给 AI 读的】机制缺口与实现手册 → 桌面/拉格朗日-战斗机制实现手册.md
   与旧版的区别：旧的《【待填】…清单》是给【人】填表格用的；
   这份是给【AI】读的接手文档 —— 每条都带：文档原文 / 当前代码行为 / 代码锚点 / 实现要点。
   生成后删除桌面上旧的 txt 清单。
*/
const fs = require('fs');
const ROOT = 'C:/Users/Administrator/Desktop/拉格朗日智能体3';
const OUT = 'C:/Users/Administrator/Desktop';
const bp = JSON.parse(fs.readFileSync(ROOT + '/data/blueprint_all.json', 'utf8'));
const st = JSON.parse(fs.readFileSync(ROOT + '/data/blueprint_stats.json', 'utf8'));
const db = JSON.parse(fs.readFileSync(ROOT + '/data/ship_database.json', 'utf8'));
const ships = Array.isArray(db) ? db : db.ships;
const bmap = JSON.parse(fs.readFileSync(ROOT + '/data/blueprint_map.json', 'utf8'));

/* ---- 收集 ---- */
const idx = {};
for (const f of fs.readdirSync(ROOT + '/data/blueprint')) {
  const b = JSON.parse(fs.readFileSync(ROOT + '/data/blueprint/' + f, 'utf8'));
  for (const y of b.systems) for (const n of y.nodes)
    idx[String(n.id)] = { ship: b.shipName, sys: y.sysName, type: n.type, name: n.name, desc: String(n.baseDesc || ''), lv: n.levelValue || [] };
}
const knownCodes = Object.keys(st.decoded || {});
const pureRefs = [], embedRefs = [], multiFails = [], condAll = [], stratAll = [];
for (const b of bp) for (const y of b.systems) for (const n of y.nodes) {
  if (!n.name) continue;
  const c = st.nodes[n.id] || {}, d = String(n.baseDesc || '');
  if (c.pureRef) pureRefs.push({ ship: b.shipName, sys: y.sysName, node: n.name, token: c.pureRef, lv: n.levelValue || [] });
  else if (c.needsManual) multiFails.push({ ship: b.shipName, sys: y.sysName, node: n.name, desc: d, vals: (n.levelValue || [])[1] || [], ph: (d.match(/\{[^}]+\}/g) || []).join(' ') });
  const toks = [...new Set(d.match(/\{[A-Za-z]+\d+\}/g) || [])].filter(t => knownCodes.indexOf(t) < 0);
  if (toks.length && !c.pureRef) embedRefs.push({ ship: b.shipName, node: n.name, toks, desc: d });
  if (n.type === 2 || n.type === 3) stratAll.push({ type: n.type, ship: b.shipName, node: n.name, stat: c.stat, addable: !!c.addable, desc: d });
  if (/血量(首次)?(低于|降至|下降至)|结构比例降至|每运行|每连续|每\s*\{?[^}\s]{0,4}\}?\s*轮|每轮工作|击破(目标|武器|动力)|战斗开始时|战斗开始后|单场战斗只|一场战斗只|直到战斗结束|可叠加|层\//.test(d))
    condAll.push({ ship: b.shipName, sys: y.sysName, node: n.name, desc: d, stat: c.stat, addable: !!c.addable });
}
const condTmpl = {};
condAll.forEach(x => { const k = x.desc.replace(/\{[^}]+\}/g, '{}').replace(/\d+(\.\d+)?/g, 'N').slice(0, 60); (condTmpl[k] = condTmpl[k] || []).push(x); });
const stratFleet = stratAll.filter(x => /舰队|战略打击|封锁|驻守|视野|行动力|吉米|隐蔽|对接|资源点|小队|联合体|每日|巡游|计划圈|指挥值/.test(x.desc || ''));

/* ---- 舰船缺口 ---- */
const noBp = [], noHp = [], zeroW = [];
let badW = [], allWeapons = 0;
ships.forEach(s => {
  const cdn = (bmap[s.id] || {}).cdnId;
  if (!(cdn && fs.existsSync(ROOT + '/data/blueprint/' + cdn + '.json'))) noBp.push(s);
  if (!s.hp) noHp.push(s);
  let wn = 0;
  Object.entries(s.modules || {}).forEach(([k, m]) => {
    if (k[0] === '_') return;
    const gs = m.variants ? Object.values(m.variants) : [m];
    gs.forEach(g => (g.weapons || []).forEach(x => {
      wn++; allWeapons++;
      const nm = x.name || '', d = x.dpm || {};
      if (/^[一二三四五六七八九十\d]+[、.．]/.test(nm) || /补充说明|无武器|未标注|无相关数据/.test(nm) ||
        (/系统[（(]/.test(nm) && !(d.antiShip > 0) && !(d.antiAir > 0) && !(d.siege > 0))) badW.push({ ship: s.name, name: nm });
    }));
  });
  if (wn === 0) zeroW.push(s);
});
const noMode = ships.filter(s => /战机|护航艇|轰炸机|攻击机|战斗机|侦察机|炮艇|导弹艇|鱼雷艇|飞行坦克|拦截机/.test(s.name || '') && !s.flightMode);
const withMode = ships.filter(s => s.flightMode);
const addable = Object.values(st.nodes).filter(x => x.addable).length;

/* ---- 正文 ---- */
let M = '';
const H = (n, t) => M += '\n' + '#'.repeat(n) + ' ' + t + '\n\n';

M += '# 拉格朗日战斗模拟器 · 机制缺口与实现手册\n\n';
M += '> **读者：AI**。这是一份接手文档 —— 把《战斗机制》文档里的规则逐条落进模拟器。\n';
M += '> 生成于 2026-09-21。文中所有「现状」都是**对着代码核过的**，不是估计。\n';
M += '> 原始机制文档：`data/knowledge/战斗机制.md`（GBK 存成了 UTF-8，718 行）。\n';
M += '\n**看这份文档前请先读第 0 节** —— 那里有代码锚点和三条踩过的坑，能省你半小时。\n';

/* ===== 0 ===== */
H(2, '0. 先读这一节');
H(3, '0.1 目录与三副本');
M += '| 目录 | 作用 | git |\n|---|---|---|\n';
M += '| `桌面/拉格朗日智能体3` | **唯一工作源**（改这里） | 非 git 仓库 |\n';
M += '| `桌面/lglr.html` | 部署源（GitHub Pages） | `github.com:obxx947/lglr.git` |\n';
M += '| `桌面/拉格朗日智能体/web` | 后端仓库的 web 副本 | `obxx947-lagrange-skill-evolution-studio` |\n';
M += '\n改完 `拉格朗日智能体3` 后必须同步到另两份（见 0.4）。\n';

H(3, '0.2 关键文件');
M += '| 文件 | 作用 |\n|---|---|\n';
M += '| `simulator.html` | **战斗引擎**（4000+ 行，单文件，无构建） |\n';
M += '| `addpoint.html` | 加点页（左系统列表 / 右加点网格 / 属性汇总面板） |\n';
M += '| `fleet.html` | 配队页（数据权威，加点入口在这里） |\n';
M += '| `data/ship_database.json` | 舰船/模块/武器数据（196 艘，单行 minify，**别用 `JSON.stringify(db,null,2)` 写回**） |\n';
M += '| `data/blueprint_stats.json` | 加点节点归类结果（**由 `_build_bpstats.js` 生成，别手改**） |\n';
M += '| `data/blueprint_sysmap.json` | 加点系统 ↔ 模块映射（由 `_build_sysmap.js` 生成） |\n';
M += '| `_build_bpstats.js` | 生成 stats 的管线（**属性分组的唯一定义在这里**） |\n';
M += '| `_build_sysmap.js` | 生成系统↔模块映射的管线 |\n';
M += '| `data/knowledge/战斗机制.md` | 本文档比对用的机制原文 |\n';
M += '| `test/*.js` | 44 个回归脚本（puppeteer + Edge） |\n';

H(3, '0.3 代码锚点（改之前先跳到这里看）');
M += '| 功能 | 位置 |\n|---|---|\n';
[
  ['战斗主循环（每 tick）', '`simulator.html:3380` `processBattleTick(dt)`'],
  ['单艘船的武器循环（锁定/攻击/冷却）', '`simulator.html:3541` `processShipWeapons(ship, enemies, dt, bs)`'],
  ['单发命中/拦截/伤害', '`simulator.html:3729` `executeShot(attacker, target, weapon, ws, bs)`'],
  ['命中率公式', '`simulator.html` `executeShot` 内 `hitRate *= (1 + (hitBonus + lockEff - evasion - ehd)/100)`'],
  ['伤害公式（实弹减甲 / 能量乘抗性 / 10%保底）', '`simulator.html` `executeShot` 后半段'],
  ['创建舰船实例（含 maxHp、weaponStates、subSystems）', '`simulator.html:3054` `createShipInstance(shipEntry, side, isEscort, isEscorted)`'],
  ['**系统（subSystems）构造与维修次数**', '`simulator.html:3144~3180`（`s.subSystems = []` 起）'],
  ['**系统被毁后的处理（停火/扣血）**', '`simulator.html:3850` 附近 `sysHpPenalty`'],
  ['**载机部署（机库加成在这里落地）**', '`simulator.html:3227` `deployAircraft(...)` 内的 `const acc = {...}` 段'],
  ['换模块变体', '`simulator.html:3182` `switchModuleVariant(shipInstance, slotKey, variantKey)`'],
  ['护航状态更新', '`simulator.html:3426` `updateEscortStatus(bs)`'],
  ['额外机制（协同指挥/三种打击/掩护/周期爆发）', '`simulator.html:3452` `processExtraMechanics(...)`'],
  ['加点汇总（节点 → 属性桶）', '`simulator.html:2336` `buildAddPointBonus(slug)`'],
  ['加点应用到舰船（开战自动生效）', '`simulator.html:2435` `applyAddPointShip(s)`'],
  ['加点应用到武器（按模块）', '`simulator.html:2513` `applyAddPointWeapons(s)`'],
  ['加点机制类解析', '`simulator.html:2537` `resolveAddPointMechanics(slug)`'],
  ['分组定义（唯一来源）', '`data/blueprint_stats.json` 的 `groups` 字段 ← `_build_bpstats.js` 的 `GROUPS`'],
  ['排版/目标类型匹配', '`simulator.html:934` `matchesType(ship, typeStr)`'],
  ['站位顺序', '`simulator.html:3716` `rowOrder = [\'前排\',\'中排\',\'后排\']`'],
].forEach(([a, b]) => M += '| ' + a + ' | ' + b + ' |\n');

H(3, '0.4 三条铁律（都是踩过的坑）');
M += '1. **新增属性必须只改一处**：属性分组的唯一定义在 `_build_bpstats.js` 的 `GROUPS`，写进 `blueprint_stats.json` 的 `groups` 字段，`simulator.html`（`buildApGroups()`）和 `addpoint.html`（`buildGroups()`）都读它。\n';
M += '   ⚠️ 历史上分组写在三个文件里，漏改一处就**静默失效**（已踩 3 次）。别退回去硬编码。\n';
M += '2. **改含转义的 JS 源码，用编辑器/Edit 工具，不要走 `shell + python/node -e` 做字符串替换**。\n';
M += '   实测：`\\d` 被吃成 `d` 导致正则永不匹配（"武器分散打击"那条就是因此没生效）；`\\n`/`\\s` 同理。\n';
M += '3. **`JSON.stringify(db, null, 2)` 会把单行 minify 的库写成 2 万行 / 558KB** —— 写回一律 `JSON.stringify(db)`。\n';
M += '\n同步到另两份（改完就跑）：\n';
M += '```bash\n';
M += 'cd "C:/Users/Administrator/Desktop/拉格朗日智能体3"\n';
M += 'for d in "C:/Users/Administrator/Desktop/lglr.html" "C:/Users/Administrator/Desktop/拉格朗日智能体/web"; do\n';
M += '  cp simulator.html addpoint.html fleet.html "$d/"\n';
M += '  cp data/ship_database.json data/blueprint_stats.json data/blueprint_sysmap.json "$d/data/"\n';
M += '  cp test/*.js "$d/test/"\n';
M += 'done\n';
M += '# 然后各自 git add 具体文件（禁止 git add -A）→ commit → push\n';
M += '```\n';

/* ===== 1 ===== */
H(2, '1. 现状总览（对着代码核过的数字）');
M += '| 维度 | 数字 | 说明 |\n|---|---|---|\n';
M += '| 加点节点总数 | 7106 | = 空槽 1920 + 可加点 5186 |\n';
M += '| ├ 可自动汇总（`addable:true`） | ' + addable + ' | |\n';
M += '| │ ├ **引擎真正读了的** | **4347** | 扣掉下面那 55 个 |\n';
M += '| │ └ **归了类但引擎没读** | **55** | 见第 4 节 |\n';
M += '| ├ 战场机制（掩护/周期爆发/优先打击/协同指挥/三种打击） | 62 | 已实现 |\n';
M += '| ├ 需手填（多数值位解不出） | ' + multiFails.length + ' | 见 6.2 |\n';
M += '| └ 无译文术语代号 | ' + pureRefs.length + ' 节点 / ' + (pureRefs.length + 4) + ' 代号 | 见 6.1 |\n';
M += '| **条件触发节点** | **' + condAll.length + ' / ' + Object.keys(condTmpl).length + ' 种** | ⚠️ 见第 3 节，**现在正在出错** |\n';
M += '| 策略类节点（type=2/3） | ' + stratAll.length + ' | 加点页没单独分类，见 2.39 |\n';
M += '| 武器总数 | ' + allWeapons + ' | |\n';
M += '| 武器名损坏 | ' + badW.length + ' | 见 6.3 |\n';
M += '| 舰载机总数 | 52 | 只有 ' + withMode.length + ' 艘有作战模式标注 |\n';
M += '| 回归脚本 | 44 | 见 6.4 |\n';

/* ===== 2 ===== */
H(2, '2. 逐条机制实现清单');
M += '格式：**文档原文 → 当前代码行为 → 实现要点 → 改哪里**。\n';
M += '`数据` 列含义：`有` = 数据齐全；`部分` = 有但不全；`无` = 数据里没有，**要外部输入**。\n';

const MECH = [
  ['M01', '系统伤害（打系统 vs 打结构）', '部分', '仅 14/412 门武器有 `subSystemTargets`',
    '文档：「武器发射后，会先被对方闪避、拦截，剩下的伤害还要看对目标系统的效率高低」「如VA战机对动力系统效率高，70%-90%的伤害打在目标系统上，10%-30%打在舰船结构值上；打在系统上的伤害全额生效，打在装甲上的伤害会被抗性抵抗」',
    '现在 `executeShot` 只扣目标 `hp`，完全没有"打系统"这条路径；`subSystems` 只有 destroyed 标记，没有血量。',
    '① 给 `subSystems` 加 `hp/maxHp`（数据见 M02）；② `executeShot` 命中后按 `weapon.subSystemTargets` 决定这一发打系统还是打结构；③ 打系统不减免、打结构走抗性；④ 系统 hp 归零 → `destroyed=true`（现有逻辑已能处理后果）',
    '`executeShot`(3729)、`subSystems` 构造(3144)'],
  ['M02', '系统独立血量', '无',
    '文档：「系统拥有独立的血量，这个数字只有编辑」「例：绝育大帝主武器22000 / 动力20000；CV3000 动力28000 + 机库26500」',
    '数据里**一个字段都没有**。`ship_database.json` 的模块没有系统血量。',
    '需要在模块或系统上补一个 `sysHp` 字段，**只能从用户/游戏里拿**。',
    '`subSystems` 构造(3144) —— 拿到数据后加 `hp/maxHp` 两个字段即可'],
  ['M03', '系统可被破坏的次数（1 次 or 2 次）', '部分',
    '文档：「有的系统只能被破坏一次，然后就无法修复，有的系统可以被破坏两次」+「主武器2次 / 机库2次 / 指挥3次 / 动力0次」',
    '维修次数按系统类型已实现（`maxRepairs`，3167~3172 行）。但文档那两句里的"1 次 vs 2 次"差异**没有**只按类型一刀切。',
    '确认是否每个系统还有独立次数（还是就是按类型）。若是按类型，现状已正确 —— 把结论写进注释。',
    '`simulator.html:3167~3172`'],
  ['M04', '机库被毁 → 载机无法起降', '无',
    '文档：「舰载机库系统：被破坏后舰载机无法起降」',
    '现在机库被毁只是让该模块的武器停火；载机照常起飞。',
    '在 `deployAircraft` 或 tick 里检查母舰对应模块 `subSystems[].destroyed`，为真则不让该位载机出击。',
    '`deployAircraft`(3227)、`subSystems` 构建处'],
  ['M05', '机库被毁 → 往复式返回后无法出击', '无',
    '文档：「往复式舰载机返回后无法出击」',
    '往复打击循环本身还没建模（见 M17），所以这条依赖 M17。',
    '先做 M17 的往复状态机，再在"出舱"这一步判断机库是否被毁。',
    '—'],
  ['M06', '机库被毁 → 独立式失去机库增幅', '无',
    '文档：「独立式舰载机失去机库增幅」',
    '机库加成（`acc`）在 `deployAircraft` 里一次性算好写进载机实例，之后不再变。',
    '把机库加成改成**每 tick 从母舰重算**，或在母舰模块被毁时把已部署载机的加成清零。',
    '`deployAircraft`(3227) 的 `const acc = {...}` 段'],
  ['M07', '指挥系统被毁 → 所有策略失效', '无',
    '文档：「指挥系统：被破坏后舰船所有策略无法使用，只能常规输出」',
    '`subSystems` 里指挥系统有 `destroyed` 标记，但没人读它去禁用策略。',
    '在 `resolveAddPointMechanics` 产出的机制（cmdAssist/strikes/cover/bursts）执行前，判断本舰指挥系统是否被毁。',
    '`processExtraMechanics`(3452)、`subSystems` 构建处'],
  ['M08', '指挥系统：3 修后无法再被锁定', '无',
    '文档：「战斗中可自维修3次，第3次维修后无法被再次锁定」',
    '`repairCount/maxRepairs` 有，但"之后不能被再锁定"没做。',
    '`repairCount >= maxRepairs` 时置一个 `lockImmune=true`，打系统的武器跳过它。',
    '`simulator.html:3167~3172` + 系统目标选择处'],
  ['M09', '动力系统被毁 → 失去闪避能力', '无',
    '文档：「动力系统：被破坏后舰船失去闪避能力」',
    '只实现了"动力系统被毁扣 5% 最大结构"（见 `sysHpPenalty`）。闪避没动。',
    '`executeShot` 里算 `evasion` 时，若目标动力系统 `destroyed` → `evasion = 0`。',
    '`executeShot`(3729) 的命中率公式行'],
  ['M10', '动力系统被毁 → 无法紧急避险脱离战斗', '无',
    '文档：「无法紧急避险脱离战斗」',
    '引擎没有"脱离战斗"这个动作（战斗一定打到一方全灭或超时）。',
    '需要先有"撤退/避险"机制，再谈禁用。优先级低。',
    '—'],
  ['M11', '反击防空', '无',
    '文档：「小范围防空机制，在受到舰载机攻击时触发，可攻击以自身或同排友方舰船为目标的敌方空中单位」「敌方舰载机攻击我方舰船时，受击舰船和同排未被攻击的友方舰船会触发反击防空」',
    '现在防空武器只是普通的对空武器，按自己的循环开火；没有"被攻击才触发"的反应式逻辑。',
    '在载机发起攻击时（`executeShot` 里判断 `attacker.size===\'aircraft\'`），给受击舰船 + 同排未被攻击的友方触发一次防空反击（限次数/限频率）。',
    '`executeShot`(3729)、`processShipWeapons`(3541)'],
  ['M12', '区域防空 · 防空支援词条', '无',
    '文档：「防空武器自带的词条，可打击以同排友方舰船为目标的敌方空中目标，不会因自身受击改变攻击目标」',
    '没有。',
    '给武器加 `aaSupport` 标记，选目标时把"正在攻击同排友方的敌方空中单位"纳入候选。',
    '目标选择逻辑（`processShipWeapons` 内）'],
  ['M13', '区域防空 · 周期性大范围防空', '部分（2 节点）',
    '文档：「通过加点获得，可让武器周期锁定临近排敌方战机或护航艇攻击，通常附加命中率提高或冷却降低效果」',
    '加点里 2 个节点提到；引擎没有"防空范围"概念。',
    '引擎**没有"排范围"维度**，需要先引入"武器可打击的排范围"字段。',
    '目标选择逻辑 + 新字段'],
  ['M14', '区域防空 · 枪骑兵 / 圆锥综合', '无',
    '文档：「枪骑兵：可将自身武器的防空范围扩展到我方阵型内所有舰船」「圆锥综合：可通过加点让同排船只的防空武器扩大到临近排」',
    '没有。依赖 M13 的"防空范围"。',
    '同上。',
    '—'],
  ['M15', '主动防空', '无',
    '文档：「舰船或舰载机无需被攻击，即可自主锁定并攻击战场上任意位置的敌方空中单位，拥有更高的锁敌优先级」「具有主动防空能力的：米斯特拉、沙龙大气层拦截机、CVT800脉冲炮艇、狼西级防御护卫舰、锆石级突击护卫舰、刺水母防御护卫舰」',
    '没有。现在所有对空都走同一套目标选择。',
    '给这些舰船/载机打 `activeAA: true`，目标选择时把敌方空中单位优先纳入（无视其是否在攻击我方）。',
    '目标选择逻辑 + `ship_database.json` 加字段'],
  ['M16', '防空命中率（舰载 15% / 机载 60%）', '无',
    '文档：「舰船防空武器基础命中率15%，机载防空武器基础命中率60%」',
    '现在所有武器共用 `targets[]` 里的 `hitMin/hitMax`，没有专门的防空命中率。',
    '在 `targets` 表里区分"对空格"的命中区间，或加 `aaHit` 字段。',
    '`ship_database.json` 的 `targets` + `matchesType`(934)'],
  ['M17', '舰载机往复打击循环', '部分（数据 21/52）',
    '文档：「完成一次完整打击后会返回载机舰船舱内补充弹药，再进行下一轮打击。完整流程：①在载机舱内初次锁敌 → ②按去程时间飞行到对方阵营攻击 → ③攻击结束后按返程时间返回 → ④在机库内等待武器冷却并锁定新目标（**此阶段不会被防空武器锁定**）→ ⑤冷却和锁定同时完成后再次出舱」',
    '`flightMode`（independent/reciprocating）+ `baseFlightOut` + `baseFlightBack` 数据有（21 艘），但 **`simulator.html` 里 `flightMode` 出现 0 次** —— 完全没用。载机现在一律当"一直能打"处理。',
    '给载机实例加一个状态机：`inHangar → flyingOut → attacking → flyingBack → inHangar`。飞行阶段按 `baseFlightOut/Back` 计时，机库阶段等冷却+锁定且**不可被防空选中**。',
    '`deployAircraft`(3227)、`processShipWeapons`(3541)、防空选目标处'],
  ['M18', '往复机：机库内等待时不被防空锁定', '无', '文档见 M17 第 ④ 步', '没做（依赖 M17）。', '同 M17。', '—'],
  ['M19', '往复机：锁定时间 ≤ 冷却才能再出击', '无',
    '文档：「选择目标时间下降：往复式舰载机回到机库后，锁定目标时间需小于或等于武器冷却时间，才能再次出击」',
    '没做（依赖 M17）。',
    '在 M17 的状态机里，出舱条件 = `lockTime 已完成 && cooldown 已完成`。',
    '—'],
  ['M20', '出舱后丢目标 → 敌阵内重新锁敌（不返回）', '无',
    '文档：「如果舰载机出舱后未完成攻击就丢失目标，会在对方阵营内重新锁敌，而非返回载机舰」',
    '没做（依赖 M17）。',
    'M17 状态机里加一条：`attacking` 阶段目标死亡且还有剩余攻击 → 留在 `attacking` 重新选目标。',
    '—'],
  ['M21', '聚焦空战目标', '无',
    '文档：「让舰载机优先攻击对方战斗机和拦截机，降低对方空军对空能力，但无法第一时间攻击轰炸机」',
    '`targetPriority` 机制实现了，但只解析出 `superCapital / smallCapital / battlecruiser` 三类（见 `_build_bpstats.js` 的 `targetPriority` 分支）。',
    '在 `targetPriority` 的 `pick` 枚举里加 `fighterInterceptor`（优先战机/拦截机），并在选目标时实现。',
    '`_build_bpstats.js` targetPriority 分支 + `simulator.html` 选目标逻辑'],
  ['M22', '分伤机制', '无',
    '文档：「所有战斗进行时，都遵循分伤机制 —— 舰队类所有可以攻击到敌方的一类舰船时平均分摊伤害到这些船上，公式（可被攻击的舰船除以2.5取整）。比如舰船A/B/D 可以攻击对面的 C/E，那么他们会按分摊攻击 C；即便 A 攻击序列更丰富，也会照顾攻击序列没那么丰富的 B/D」',
    '完全没做。现在每门武器各自独立选目标。',
    '这是个**舰队级**的分配器：统计"能打到某目标的己方舰船数"，按 `ceil(n/2.5)` 分摊目标，而不是全部火力的目标都堆在同一条船上。',
    '新增分配器，在 `processShipWeapons` 之前每 tick 算一次目标分配表'],
  ['M23', '1 点物理护甲 = 0.25% 受维修加成，最高 150%', '无',
    '文档：「一点物理护甲等于0.25%受维修加成最高到150%」',
    '没做。维修只用了 `repairBonus`。',
    '维修量计算处加一项：`+ min(150, 物理护甲 * 0.25)`。',
    '维修计算（`simulator.html:3914` 附近）'],
  ['M24', '轰炸距离：每 1 吉米往复飞行时间 +2 秒', '无',
    '文档：「轰炸距离用吉米表示。超过15吉米每增加1吉米时所有舰载机命中额外衰减2%；低于15吉米每靠近1吉米命中额外增加2%；每1吉米舰载机飞行往复时间加2秒」',
    '命中 ±2%/吉米 **已实现**（`executeShot` 里 `bombDistance` 那段）。**飞行时间 +2 秒/吉米没做**。',
    '在 M17 的飞行时间计算里加 `+ 2 * (bombDistance - 15 或 bombDistance)`。注意断言口径：前半句是"相对 15"，最后一句文档没写基准，需确认。',
    '`executeShot`(3729) 的 bombDistance 段 + M17 状态机'],
  ['M25', '策略系数', '无',
    '文档：`能量单发 = 基础伤害×(1+调校系数)×(1+伤害加成-目标能量护盾)×(1+策略系数)`；`最终冷却 = 基础冷却×(1-冷却加成)×(1-策略系数)`',
    '`simulator.html` 里 `策略系数` 出现 **0 次**。',
    '引擎里目前没有"策略"这个中间量 —— 加点的策略类节点走的是具体机制（burst/cover…），不是这个系数。要么引入 `strategyCoef`，要么确认文档里的"策略"指的是加点的策略节点。**先确认再动手。**',
    '`executeShot`(3729) 伤害公式 + 冷却计算'],
  ['M26', '敌方锁定延长', '无',
    '文档：`锁定时间 = 基础锁定时间×(1-锁定减少+敌方锁定延长)`',
    '`simulator.html` 里 `锁定延长` 出现 **0 次**。加点里也没有"给敌人加锁定"的字段。',
    '需要先有数据来源（哪个武器/加点会造成敌方锁定延长），否则无处可接。**大概率是资料里的敌方效果，属数据缺口。**',
    '—'],
  ['M27', '敌方暴击伤害下降', '无',
    '文档：`最终暴击伤害 = 基础暴击伤害×(1+爆伤加成-敌方暴击伤害下降)`',
    '`simulator.html` 里 `暴击伤害下降` 出现 **0 次**。',
    '同 M26：需要数据来源才能接。',
    '—'],
  ['M28', '伤害加成稀释', '待核对',
    '文档：「抗性会被伤害加成稀释，如70抗性的电磁59，面对总伤害加成50%的维塔斯B，实际免伤只有47%」',
    '现在的公式是 `能量单发 = 基础 × (1 + 伤害加成 - 目标能量护盾)`，**这本身就是"稀释"的形式**。文档的 47% 需要代入验算确认。',
    '**先验算**：把文档给的数（70 抗性、50% 加成）代进现在 `executeShot` 的公式，看是否得 47%。是 → 在文档里标注"已符合"；否 → 改公式。',
    '`executeShot`(3729) 能量伤害行'],
  ['M29', '旗舰效果 × 指挥系统联动', '无',
    '文档：「每一个舰队都只能有一个船为整个队提供旗舰效果；如果这个舰船死亡，或者他这个旗舰对应一个指挥系统，这个指挥系统在中途被损坏或被彻底摧毁，旗舰都无法生效」',
    '旗舰本身有（`fleet.html` 可选旗舰 + ⭐ 标记）。**"指挥系统被毁 → 旗舰失效"没有。**',
    '在 tick 里检查旗舰的指挥系统 `destroyed` 状态，为真则停用旗舰效果。',
    '旗舰效果应用处 + `subSystems`'],
  ['M30', '紧急避险 / 脱离战斗', '无',
    '文档：「无法紧急避险脱离战斗」（动力系统被毁时）',
    '引擎没有"撤退"动作；战斗只有"打到一方全灭"或超时。',
    '要先有撤退机制。15 个加点节点提及。优先级低。',
    '—'],
  ['M31', '状态系统（【溶解】层数 / 附加状态 / 可叠加 N 层）', '部分（12 节点）',
    '文档与加点：「系统内武器对目标系统进行打击时，对目标所有系统造成额外N%×目标【溶解】层数的伤害」「可叠加N层」「为目标附加{EN9139}状态」',
    '引擎**没有 buff/debuff 框架**，没有任何地方存"目标身上有几个层"。',
    '新建 `ship.statuses = {溶解: {stacks, until}}`，在 `executeShot` 命中后叠加，伤害计算时读层数。这是**新框架**，工作量大。',
    '新增；`executeShot`(3729) 接入'],
  ['M32', '航速 / 飞行速度 / 移速', '无',
    '文档：「独立作战就是从载机飞到敌方的位置，这个固定的值取决于它的飞行速度，也可以加成」',
    '234 个加点节点提及"移速/飞行速度"，**没有一个能归类**（引擎没有这个维度）。',
    '要给载机加 `flightSpeed` 字段并影响 M17 的飞行时间。数据要外部输入。',
    '`ship_database.json` + M17 状态机'],
  ['M33', '攻击序列可任选类型', '部分',
    '文档：「攻击序列分为第一、第二、第三，按优先级来。每一列攻击序列都可以是所有类型的舰船，每一列都可以勾选他优先打哪些船，然后这样复制三份」',
    '数据有 `priority`（405/412 门武器），但对空/对舰用的是 `targets[]` 的命中区间表，没有"三列可任选类型"的完整选择逻辑。',
    '把 `priority` 做成三层数组，选目标时逐层匹配；未匹配则回落到默认。',
    '目标选择逻辑（`processShipWeapons` 内）、`matchesType`(934)'],
  ['M34', '总发弹量 = Miss弹 + 命中弹；命中弹 = 结构伤害弹 + 系统伤害弹', '无',
    '文档：「总发弹量 = Miss弹 + 命中弹；命中弹 = 结构伤害弹 + 系统伤害弹」',
    '没做统计维度。',
    '这是**战报统计**需求，不是战斗逻辑。要实现需要在 `executeShot` 里分类计数。',
    '`executeShot`(3729) + 战报输出'],
  ['M35', '击毁一个系统 = 一轮攻击结束', '无',
    '文档：「当击毁一个系统视为一轮攻击结束（**需要更广泛数据来最终确认**）」',
    '没做。文档自己都标了"待确认"。',
    '**先别做** —— 文档标注了不确定。等用户确认。',
    '—'],
  ['M36', '暴击伤害 = 系统伤害×(1+暴击系数×系统伤害系数)', '无',
    '文档：「暴击伤害 = 系统伤害×(1+暴击系数×系统伤害系数)」',
    '系统伤害系数没有（见 M01 的数据缺口），这条**做不了**。',
    '依赖 M01 的数据。',
    '—'],
  ['M37', '策略增伤：加算 / 乘算两种', '无',
    '文档：「策略增伤参与计算的方式有乘算有加算，其中加算是策略先加基础伤害再乘调校」',
    '没做（依赖 M25 的策略系数）。',
    '依赖 M25。',
    '—'],
  ['M38', '载具增加伤害 / 科技点增加伤害', '部分',
    '文档：飞机公式里是 `[(舰船基础伤害 + 科技点增加伤害 + 载具增加伤害 + 策略对武器本身增幅伤害) × …]` ——「载具增加伤害」在括弧内、与舰船加成并列',
    '加点部分（科技点）做了；但"载具加成"这一层没有。',
    '先确认"载具"是不是指母舰机库加成。若是 → 现在 `deployAircraft` 的 `acc.dmg` 就是它，只需确认它在公式里的位置。',
    '`deployAircraft`(3227)'],
];
MECH.forEach(r => {
  /* 兼容两种写法：8 元素的带「数据补注」，7 元素的不带 */
  const [no, name, data] = r;
  const dataNote = r.length >= 8 ? r[3] : '';
  const doc = r.length >= 8 ? r[4] : r[3];
  const cur = r.length >= 8 ? r[5] : r[4];
  const how = r.length >= 8 ? r[6] : r[5];
  const where = r.length >= 8 ? r[7] : r[6];
  M += '\n### ' + no + ' · ' + name + '\n\n';
  M += '- **数据**：`' + data + '`' + (dataNote ? ' —— ' + dataNote : '') + '\n';
  M += '- **文档原文**：' + doc + '\n';
  M += '- **当前代码行为**：' + cur + '\n';
  M += '- **实现要点**：' + how + '\n';
  M += '- **改哪里**：' + where + '\n';
});

M += '\n### M39 · 策略类节点在加点页没有单独分类（不在机制文档，但同属缺口）\n\n';
M += '- type=2 指挥策略 **51** 个 + type=3 战术技能 **316** 个 = **' + stratAll.length + '** 个，加点页里和普通节点长得一样。\n';
M += '- 其中 **' + stratFleet.length + ' 个是舰队层面**的（战略打击范围/吉米、封锁指令、撤退时间、驻守资源点、视野、行动力、对接权限、每日任务）。\n';
M += '- **1v1 舰队对战引擎永远表达不了这一类** —— 需要"舰队 vs 星系地图"这一层，不是加点能解决的。\n';
M += '- 可做的部分：在 `addpoint.html` 给 `type=2/3` 加标签/筛选，让玩家能看出哪些是策略。\n';

/* ===== 3 ===== */
H(2, '3. 条件触发类（' + condAll.length + ' 个节点 / ' + Object.keys(condTmpl).length + ' 种）—— 最高优先级');
H(3, '3.1 问题：不是"没做"，是"做错了"');
M += '这批节点**约 100 个已经被归类成可汇总数值**（`addable: true`），意味着：\n\n';
M += '> **条件被丢掉，效果被当成「开场就永久生效」。**\n\n';
M += '实例（9 个节点，最多的一种）：\n\n';
M += '```\n文档/游戏：自身结构比例降至{X}%时，舰船闪避率提升{Y}%，持续{Z}秒，一场战斗只触发一次\n';
M += '引擎实际：开局就永久 +Y% 闪避 —— 不看血量、不限期、无视"只触发一次"\n';
M += '```\n\n';
M += '方向没反，但**时机和作用条件完全不对**。这比"没实现"更糟，因为它在悄悄给错误结果。\n';

H(3, '3.2 三档实现方案');
M += '| 档 | 类型 | 能否做 | 工作量 |\n|---|---|---|---|\n';
M += '| **一** | 「自身血量/结构比例低于 X% 时…」「战斗开始后 X 秒内…」 | ✅ 能做 | 约 200~300 行 |\n';
M += '| **二** | 「每运行 P 轮后，下一轮…」「每 P 秒…」 | ✅ 能做 | 中等（引擎已有 `atkBatch/batchesRemaining` 轮次概念，`burst` 已跑通） |\n';
M += '| **三** | 「携带【溶解】状态」「附加状态」「可叠加 N 层」 | ⚠️ 要新建模 | 大（引擎没有 buff/debuff 框架，见 M31） |\n';

H(3, '3.3 第一档设计建议（可直接动手）');
M += '在 `_build_bpstats.js` 给这类节点产出结构化字段，而不是现在的 `stat + perLevel`：\n\n';
M += '```js\n';
M += '// 节点记录里加：\n';
M += 'rec.cond = {\n';
M += '  kind: \'hpBelow\',        // hpBelow | battleStart | everySec | everyRound | onKillSys\n';
M += '  threshold: 50,          // 血量阈值（hpBelow 用）\n';
M += '  duration: 10,           // 持续秒数\n';
M += '  once: true,             // 一场只触发一次\n';
M += '  effect: { stat: \'evasion\', values: [0,4,8,12,16,20] }   // 按等级取值\n';
M += '};\n';
M += '```\n\n';
M += '然后在 `simulator.html` 的 `applyAddPointShip` 里，把这些**从 `shipB` 的常驻累加里剔除**，\n';
M += '改成塞进 `s.condEffects[]`；`processBattleTick` 每 tick 遍历一次，条件满足才把效果加进对应字段（并记 `until` 到时撤销）。\n\n';
M += '⚠️ **关键**：先从当前 `addable` 的累加里**摘出来**再改，否则会算两遍。\n';
M += '⚠️ 摘出来后 `_counted` 会掉，`addpoint.html` 的"自动汇总 N 个节点"数字要同步调整。\n';

H(3, '3.4 全部 ' + Object.keys(condTmpl).length + ' 种说明模板');
M += '| 数量 | 引擎现状 | 说明模板 |\n|---|---|---|\n';
Object.entries(condTmpl).sort((a, b) => b[1].length - a[1].length).forEach(([k, xs]) => {
  M += '| ×' + xs.length + ' | ' + (xs[0].addable ? '**当成永久数值用了**' : '未实现') + ' | `' + k.replace(/\|/g, '\\|') + '` |\n';
});

/* ===== 4 ===== */
H(2, '4. 「归了类但引擎没读」的 55 个节点');
M += '这些属性管线归了类、写进了 `blueprint_stats.json`，但 `simulator.html` 里**没有任何地方读它**。\n';
M += '（审计方法：grep 属性名并排除 `applyAddPoint*` 段落。机库类用短名 `g.dmg` 消费，会有假阴性，但下面这几个是真的没用。）\n\n';
M += '| 属性 | 节点数 | 现状 |\n|---|---|---|\n';
M += '| `weaponDuration`（攻击持续时间+） | **30** | 引擎 **0 处引用**，连赋值都没有 |\n';
M += '| `repairArmor`（一次性维修装甲 +N 点） | 10 | 只在 `simulator.html:2460` 赋值那行出现 |\n';
M += '| `positionFix`（站位调整） | 8 | 只在 `:2671` 重置那行出现 |\n';
M += '| `aaLockDown`（受防空锁定效率影响下降） | 4 | 只在 `:2453` 赋值那行出现 |\n';
M += '| `hangarAaResist`（载机抗防空锁定） | 3 | 只在 `:2468` 赋值那行出现 |\n';
M += '| `sysHp`（系统血量） | **0** | 数据里一个节点都没有 |\n';
M += '\n**结论：真正生效的是 4347，不是 4402。**\n';
M += '\n改法：`weaponDuration` 最容易 —— 引擎有 `w.atkDuration` 字段（`executeShot` 的 `atkDur` 计算里用了），\n';
M += '把 `sh.weaponDuration` 加成进去即可。`aaLockDown` / `hangarAaResist` 要先有 M13/M16 的"防空命中率"概念才能接。\n';

/* ===== 5 ===== */
H(2, '5. 需要外部数据才能做的（别浪费时间硬做）');
M += '| 项 | 为什么做不了 | 需要什么 |\n|---|---|---|\n';
M += '| 舰载机作战模式（' + noMode.length + ' 艘缺） | `flightMode` 数据只覆盖 ' + withMode.length + '/52 艘 | 每艘标"独立/往复"，往复的给去程/返程秒数 |\n';
M += '| 系统独立血量 | 数据里一个字段都没有 | 每艘每系统的血量（文档给了大帝/CV3000 的例子） |\n';
M += '| 系统伤害效率（低/中/高 = 20%/40%/60%） | 412 门里只有 14 门有 `subSystemTargets` | 每门"可攻击系统"武器的打击序列 |\n';
M += '| 武器调校系数 | 只有全局 1.3，不能按武器区分 | 是否真的按武器区分 |\n';
M += '| 系统攻击伤害系数（1.25/1.5/3） | 数据里没有 | 每门武器的系数 |\n';
M += '| 打结构的系数（0.8，部分 <0.1） | 数据里没有 | 哪些武器是多少 |\n';
M += '| 防空命中率（15%/60%） | 数据里没有 | 确认这两个数字是否通用 |\n';
M += '| 主动防空舰船名单 | 数据里没有 | 确认名单（文档给了 6 艘） |\n';
M += '| 武器轻重（轻型/重型） | 数据和引擎都没有 | 哪些武器是轻型/重型 |\n';
M += '| 移速/飞行速度（234 节点） | 引擎没有这个维度 | 载机飞行速度 |\n';
M += '| 敌方锁定延长 / 敌方暴击伤害下降 | 没有数据来源 | 哪个武器/加点会造成这两个效果 |\n';
M += '| 太阳鲸 C2 打什么 | 资料只写「优先目标：建筑」，引擎没有"建筑"目标类型 | 确认是否破坏系统、打击序列 |\n';
M += '| 系统破坏数据无出处的 5 条 | 库里原有、资料无依据 | 留/改/删（XT-8、雷里亚特、天玑、米斯特拉、孢孑A404）| \n';

/* ===== 6 ===== */
H(2, '6. 附录');
H(3, '6.1 术语代号（共 16 种，已译 1 种）');
M += '游戏数据里这些节点的说明只存了代号，官网没公开术语表。\n\n';
M += '**A. 整条说明就是一个代号（' + pureRefs.length + ' 个）**\n\n';
M += '| 舰船 | 系统 | 节点 | 代号 | 各等级数值 |\n|---|---|---|---|---|\n';
pureRefs.forEach(x => {
  M += '| ' + x.ship + ' | ' + x.sys + ' | ' + x.node + ' | `' + x.token + '` | ' + (x.lv || []).map(v => Array.isArray(v) ? v.join('/') : String(v)).join(' → ') + ' |\n';
});
M += '\n**B. 代号夹在说明文字中间（' + embedRefs.length + ' 个节点 / 4 个代号）**\n\n';
M += '| 舰船 | 节点 | 待解代号 | 说明原文 |\n|---|---|---|---|\n';
embedRefs.forEach(x => {
  M += '| ' + x.ship + ' | ' + x.node + ' | `' + x.toks.join('` `') + '` | ' + String(x.desc).replace(/\s*\n\s*/g, ' ／ ').replace(/\|/g, '\\|').slice(0, 100) + ' |\n';
});
M += '\n**已译**：`{ED9142}`（永恒苍穹 M1 协同打击）= 本系统机库内舰载机有 A% 概率造成 B% 暴击伤害（玩家口述确认）。\n';
M += '已译表在 `_build_bpstats.js` 的 `DECODED` 里，拿到新译文直接往那加。\n';

H(3, '6.2 加点多参数节点（' + multiFails.length + ' 个，取值解不出）');
M += '说明里有 2 个以上 `{}` 数值位，数据给的数值个数对不上 → `statValueAt()` 返回 null → `needsManual: true`。\n';
M += '解析逻辑在 `_build_bpstats.js` 的 `statValueAt()` + `KEY` 表。**要提升覆盖率，改 `KEY` 里的正则即可**（v4 已从 87 降到 ' + multiFails.length + '）。\n\n';
M += '| 舰船 | 系统 | 节点 | 每级数值 | 数值位 |\n|---|---|---|---|---|\n';
multiFails.slice(0, 80).forEach(x => {
  M += '| ' + x.ship + ' | ' + x.sys + ' | ' + x.node + ' | `' + JSON.stringify(x.vals) + '` | `' + x.ph + '` |\n';
});
if (multiFails.length > 80) M += '\n（其余 ' + (multiFails.length - 80) + ' 个略 —— 跑 `node _inv.js` 风格的自查脚本可全量列出）\n';

H(3, '6.3 舰船数据缺口');
M += '| 节 | 内容 | 数量 |\n|---|---|---|\n';
M += '| A | 完全没有加点数据的舰船 | ' + noBp.length + ' |\n';
M += '| B | 连结构值都没有 | ' + noHp.length + '（' + noHp.map(s => s.name).join('、') + '） |\n';
M += '| C | 一门武器都没有 | ' + zeroW.length + ' |\n';
M += '| D | **武器名损坏**（名字是段落标题，多为占位单发100/DPM0）→ **"某些船打不出伤害"的真因** | **' + badW.length + ' 门** |\n';
M += '| E | 系统破坏数据无出处的 5 条 | 5 |\n';
M += '| F | 太阳鲸 C2 待确认 | 1 |\n';
M += '| G | 拦截率仅 5 艘有、闪避率 0 艘有 | — |\n\n';
M += '**D 节明细（' + badW.length + ' 门）**\n\n';
M += '| 舰船 | 库里现在写的是 |\n|---|---|\n';
badW.slice(0, 60).forEach(x => { M += '| ' + x.ship + ' | `' + String(x.name).replace(/\|/g, '\\|') + '` |\n'; });
M += '\n**A 节明细（' + noBp.length + ' 艘无加点数据）**：' + noBp.map(s => s.name).join('、') + '\n';
M += '\n**C 节明细（' + zeroW.length + ' 艘零武器）**：' + zeroW.map(s => s.name).join('、') + '\n';

H(3, '6.4 回归测试清单（改完必跑）');
M += '跑法：先 `python -m http.server 3888 --bind 127.0.0.1`，再 `node test/<名字>.js`。\n\n';
M += '| 脚本 | 覆盖 | 上次结果 |\n|---|---|---|\n';
[
  ['battle_mechanics_regression.js', '开火循环/直射不被拦截/载机跟随母舰', '7/7'],
  ['intercept_regression.js', '拦截率合成/换模块/反拦截', '17/17'],
  ['module_in_combat_regression.js', '模块武器进实战/载机位', '5/5'],
  ['strengthen_and_module_regression.js', '强化值传入/结构值加成', '7/7'],
  ['addpoint_entry_regression.js', '配队页 → 加点页入口链路', '23/23'],
  ['addpoint_panel_probe.js', '加点页属性汇总面板渲染', '5/5'],
  ['split_stats_probe.js', '拆桶后的属性归属与端到端', '8/8'],
  ['module_scope_probe.js', '只选 M1 时 M2 加点不生效', '3/3'],
  ['ship_level_probe.js', '舰船级加点生效', '4/4'],
  ['addpoint_search_smoke.js', '加点页舰船搜索', '16/16'],
  ['aircraft_count_regression.js', '载机数不被母舰数放大', '7/7'],
  ['fleet_ui_regression.js', '配队页 UI 全量', '全 PASS'],
  ['fleet_text_roundtrip_regression.js', '配队文本导入导出', '7/7'],
  ['sim_audit.js', '13 项不变量（含已知的 aircraft 共享引用问题）', '1 处已知问题'],
].forEach(([a, b, c]) => M += '| `test/' + a + '` | ' + b + ' | ' + c + ' |\n');
M += '\n⚠️ `sim_audit.js` 会报一个**已知问题**：实例与条目共享 `aircraft` 数组（同引用）。这是记录在案的结构风险，不是回归。\n';

/* ===== 7 ===== */
H(2, '7. 建议的动手顺序');
M += '1. **条件触发第一档**（第 3 节）—— 127 个节点里约 100 个**正在出错**，比补新功能更该先做。「血量阈值」+「战斗开始后 X 秒」两类，约 200~300 行。\n';
M += '2. **补 55 个"归了类但没读"**（第 4 节）—— `weaponDuration` 30 个最容易，引擎有 `w.atkDuration` 字段。\n';
M += '3. **舰载机 `flightMode` 接进引擎**（M17）—— 数据已有 21 艘，状态机做完立刻能验证。\n';
M += '4. **系统破坏的后果**（M04~M10）—— 都是"读 `subSystems[].destroyed` 然后改行为"，彼此相似，一起做效率高。\n';
M += '5. **M28 伤害加成稀释验算** —— 只是算一遍，不用改代码，先确认现状是对的还是错的。\n';
M += '6. 条件触发第二档（轮次触发）→ 状态系统（M31，要新建模）。\n';
M += '\n**别先做**：M35（文档自己标了"待确认"）、M10/M30（依赖尚不存在的撤退机制）、M13/M14（依赖尚不存在的"防空范围"）。\n';

fs.writeFileSync(OUT + '/拉格朗日-战斗机制实现手册.md', M, 'utf8');
['【待填】战斗机制与数据缺口清单.txt', '【待填】舰船加点-缺数据描述.txt', '【待填】舰船数据缺口清单.txt'].forEach(f => {
  try { fs.unlinkSync(OUT + '/' + f); console.log('  已删除旧文件: ' + f); } catch (e) { }
});
console.log('已生成：桌面/拉格朗日-战斗机制实现手册.md');
console.log('  行数 ' + M.split('\n').length + ' / ' + (Buffer.byteLength(M, 'utf8') / 1024).toFixed(0) + ' KB');
console.log('  机制条目 ' + (MECH.length + 1) + ' 条 · 条件模板 ' + Object.keys(condTmpl).length + ' 种 · 术语代号 ' + (pureRefs.length + embedRefs.length) + ' 节点');
