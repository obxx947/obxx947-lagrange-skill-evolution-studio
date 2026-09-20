# 本轮对话工作记录 —— 完整实现现有舰船加点

**日期**：2026-09-19
**仓库**：lglr `cda49ce` ｜ 后端 `21f80fe`（均已推送）
**工作目录**：`桌面/拉格朗日智能体3`

---

## 一句话总结

把「舰船加点」从**能跑但不准**做到**能跑且语义正确**：
修好了系统↔模块映射（196 个加点从"被静默丢弃"变成"正确生效"），
拆开了 4 个"一个桶装好几种意思"的属性（其中 77 个节点的效果方向原来是反的），
并把"新增属性要同时改三处、漏一处静默失效"这个反复踩的坑彻底消除。

---

## 一、先说结论：原来的实现率我说错了

上一轮我说"4466/5186 = 86% 已实现"。全量复核后**这个数字是错的**，实际是：

| | 数量 | 说明 |
|---|---|---|
| 可加点节点总数 | 4404（现 4402） | 非空且能当数值算的 |
| ├ **真正被引擎应用** | 4208 | 85% |
| └ **被静默丢弃** | **196** | 我之前漏掉的 |
| 另外：战场机制（掩护等） | 62 | 已实现 |
| 另外：需手填 / 无译文 | 87 / 11 | 已给你清单 |
| 另外：非战斗（速度等） | 447 | 引擎没有这个维度 |

那 196 个为什么被丢？在 `data/blueprint_sysmap.json` 里它们的系统是 `scope: null`。

---

## 二、做了三件事

### ① 系统↔模块映射重做 —— 丢弃 196 → 14

**根因**：游戏里的「系统名」和资料里的「模块名」经常是同一件东西的两种叫法：

| 加点系统名 | 库里的模块名 |
|---|---|
| 护航艇坞**舱** | 护航艇坞**仓** |
| 大型**载机**系统 | 大型**舰载机**系统 |
| **舰船**维护系统 | **舰载机**维护系统 |
| 舰载机平台 | 舰载机**搭载**平台 |

原来的匹配只认「模块名以系统名开头」，这些全都匹配不上 → 落到 `scope: null` → 加点被丢掉。

**新算法**：三级打分 + 全船最优分配
1. 归一化后完全相同 → 2.0 分
2. 一方以另一方开头且后缀短 → 1.5 分
3. 去掉「系统/平台/搭载/舰/型…」等停用词后，做**字符二元组 Dice 相似度**

关键是第 3 步之后要做**全船的全局贪心分配**（分数高的先配、一个模块只配一次）——
不然「舰载机平台」会被「舰载机维护系统」抢走。

### ② 拆开"一桶多义"的属性（这是影响面最大的一件）

| 旧属性 | 数量 | 实际混着什么 |
|---|---|---|
| `hitBonus` | 789 | 648 个「我方命中提升」+ **77 个「被XX命中率下降」** + 64 其他 |
| `hangarModule` | 475 | 伤害 / 命中 / 闪避 / 锁定时间 / 武器冷却 / 飞行时间 **6 种** |
| `hangarBonus` | 264 | 受防空锁定下降 / 飞行时间 / 选目标时间 / 命中提升 / 无视提前锁定 |
| `repairBonus` | 84 | 维修效率(%) 和 **一次性维修装甲(+N 点，根本不是百分比)** |
| `lockEfficiency` | 123 | 119 个「我方锁定效率」+ **4 个「使自身受防空锁定效率影响下降」** |

**最严重的一条**：那 77 个「被命中率下降」是**防御向**的（让敌人打我更难），
而引擎的命中率公式是：

```js
hitRate *= (1 + (hitBonus + lockEff - evasion) / 100);   // 把 hitBonus 当【攻击方】加成
```

→ **方向整个反了**：本该让你更难被打中，结果变成了你的炮更准。
现在拆出 `enemyHitDown`，改成减在**受方**：

```js
hitRate *= (1 + (hitBonus + lockEff - evasion - target.enemyHitDown) / 100);
```

**机库 6 项各自落地**到载机的不同字段：`dmgBonus` / `hitBonus` / `evasion` /
`weaponStates.lockTimeReduction` / `weaponStates.cooldownReduction` / `weaponStates.flightTimeReduction`
（引擎本来就有这些字段，只是以前全塞进一个数当伤害+命中用）。

### ③ 分组改成"单一来源"

以前分组写在**三个文件**里（`_build_bpstats.js` 的 M/HK 组、`simulator.html` 的 `AP_M`、
`addpoint.html` 的 `GROUP_M`），**漏改一处就静默失效**——这个坑我踩过 3 次。

现在只在 `_build_bpstats.js` 定义一次，写进 `data/blueprint_stats.json` 的 `groups` 字段，
两个页面都 `buildApGroups()` / `buildGroups()` 读它。**坑从此不存在。**

---

## 三、踩到并修掉的坑（我自己造的）

1. **`hangarDmg` 被模块桶吃掉**：「**本舰船**机库内…」的节点，如果所在系统被映射成模块，
   就被塞进那个模块的桶 → 只有该模块的载机吃到。文字说"本舰船"就该整船生效
   → 加 `HANGAR_SHIP` 集合强制走舰船级。

2. **`hangarEffect()` 兜底写 `return ['Dmg']`**：把「基础**移速**提升」「**编队**均摊伤害」
   都当成了伤害。→ 改成**认不出就返回空数组归到未归类，不许猜**。

3. **`attacker` 变量写错**：在 `processShipWeapons(ship, ...)` 里我写了 `attacker.atkReduction`，
   导致 `intercept_regression` 直接崩（`attacker is not defined`）→ 改成 `ship`。

4. **机库兜底规则太贪**：`[/机库|载机|无人机/, '__HS__']` 把
   「使**来自舰载机**的攻击对自身的命中率下降」这种描述**敌方攻击**的句子也吞进机库了
   （47 个节点判错）→ 必须要求「机库内」或「载机的伤害/命中/闪避…」。

---

## 四、实测数字

**全库归属**（脚本 `test/split_stats_probe.js`）：

| | 改前 | 改后 |
|---|---|---|
| 可汇总节点 | 4404 | 4402 |
| 正确投到模块 | 2417 | **2753** |
| 舰船级 | 1791 | 1635 |
| **无归属（丢弃）** | **196** | **14** |
| 需手填 | 87 | **52** |
| 无译文 | 11 | 11 |

那 14 个是 `hangarModuleLock 5 / hangarModuleFlight 7 / hangarModuleHit 2`，
所在系统确实对不上任何模块，**保持丢弃，不硬猜**。

**功能实测**：
- `enemyHitDown` = 35 且 `hitBonus` = 0 → 方向修对了
- `hangarDmg` = 6（本舰船机库，即使系统映射到模块也整船生效）
- `repairArmor` = 3 / `repairBonus` = 40 → 两个概念分开了

**回归全绿**：

| 套件 | 结果 |
|---|---|
| battle_mechanics_regression | 7/7 |
| intercept_regression | 17/17 |
| module_in_combat_regression | 5/5 |
| strengthen_and_module_regression | 7/7 |
| addpoint_entry_regression | **23/23** |
| aircraft_count_regression | 7/7 |
| fleet_ui_regression | 全部 PASS |
| fleet_text_roundtrip | 7/7 |
| addpoint_panel_probe | 5/5 |
| split_stats_probe | 8/8 |
| module_scope_probe | 3/3 |
| addpoint_search_smoke | 16/16 |

**顺手修了两个陈旧测试**（不是功能坏了）：
- `addpoint_entry_regression` 的 3e~3h 找的是**旧占位页**的 `#shipName`/`#shipKv`/`#ctxBox`/`.card h3`，
  真加点页早没这些元素了 → 改按现页面结构断言
- `position_regression` 3b 期望"语料 1129 块"，实际早就是 1130

---

## 五、还没做的（如实）

**条件触发类节点**：「自身血量低于 X% 时…」「每运行 P 轮后…」「击破目标系统时…」
这类共约 40 个（在剩下的 52 个需手填里占多数）。
**要引擎支持战斗中条件判定才能做**，不是数据问题，属下一步。

其余 622 个"不可能当数值算"的：速度 447（非战斗）· 未归类 68 · 特殊机制 51 ·
舰队/指挥 43 · 武器持续时间 8 · 侦察/隐身 3 · 战术/弹药 2。

---

## 六、桌面文件更新

两份待填清单已按新数据重新生成：

- `【待填】舰船加点-缺数据描述.txt` —— 术语代号 11 个 + **多参数 52 个**（原 87）
- `【待填】舰船数据缺口清单.txt` —— A 19 / B 4 / C 12 / D 31门(19艘) / E 5

---

## 七、本轮改动的文件

**数据管线**
- `_build_sysmap.js` —— 重写匹配（v2）
- `_build_bpstats.js` —— 重写 RULES（v4），拆桶 + 分组单一来源
- `_gen_filllists.js` —— 头部数字更新

**页面**
- `simulator.html` —— 命中率公式修正、机库 6 项分流、`HANGAR_SHIP`、AP 分组从 JSON 读
- `addpoint.html` —— `buildGroups()` 从 JSON 读、搜索框（上一轮）、面板提示文案

**数据**
- `data/blueprint_stats.json`（v4，503 KB）
- `data/blueprint_sysmap.json`（99 KB）

**新增/更新的测试**
- `test/split_stats_probe.js`（新）
- `test/addpoint_panel_probe.js`（新）
- `test/module_scope_probe.js`、`test/ship_level_probe.js`（上一轮）
- `test/addpoint_search_smoke.js`（上一轮）
- `test/addpoint_entry_regression.js`（3e~3h 改为按现页面断言）
