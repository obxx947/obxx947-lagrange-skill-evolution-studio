# 《无尽的拉格朗日》AI 战术顾问 —— 全量功能清单

> **范围**：仅 `C:\Users\Administrator\Desktop\拉格朗日智能体3`（工作源目录）
> **写于**：2026-09-20
> **用途**：把该目录里**所有功能、模块、数据、脚本、存储键**逐条记录清楚，供接手/自查/继续开发。

---

## 0. 总览

| 项 | 值 |
|---|---|
| 形态 | **纯前端静态站点**（该目录 **0 个 Python 文件**，可直接扔 GitHub Pages） |
| 页数 | **11 个 HTML** |
| JS 模块 | **16 个**（`js/` 目录，另 1 个 `.bak`） |
| 前端代码量 | `simulator.html` 4153 行 · `index.html` 2219 行 · `chat.html` 2385 行 · `fleet.html` 1123 行 · `addpoint.html` 733 行 · `js/agent.js` 1467 行 · `js/qa.js` 770 行 |
| 数据 | 舰船库 196 艘 / 武器 412 门 / 知识库 1130 md / 向量索引 1130 块×512 维 / 加点 177 艘·947 系统·7106 节点 |
| 测试 | `test/` **40 个脚本**（其中 10 套核心回归 153 项） |
| 依赖（package.json） | `@huggingface/transformers`（浏览器端 bge 嵌入）、`puppeteer-core`（回归测试）、`sherpa-onnx`（本地语音） |
| 后端 | **本目录没有后端**。仅 `deploy/` 里有 3 个"藏 Key 代理"的部署包（Cloudflare Worker / 阿里云 FC / 腾讯 SCF） |

---

## 1. 目录与文件总清单

```
拉格朗日智能体3/
├─ index.html          AI 战术顾问（主入口，功能=chat.html）
├─ chat.html           AI 对话
├─ fleet.html          战舰配队（+ 数据校验器）
├─ addpoint.html       舰船加点（蓝点强化）
├─ simulator.html      战斗模拟器（配舰星港 v7）
├─ ships.html          舰船信息库（用户自有舰船）
├─ skills.html         技能/工具管理
├─ settings.html       API 设置
├─ features.html       项目介绍/功能架构（站内版）
├─ kb-dev.html         知识库开发中心
├─ voice_test.html     语音测试
├─ js/                 （16 个模块，见 §3）
├─ data/               （知识库 + 舰船库 + 加点数据 + 索引，见 §6）
├─ test/               （40 个测试脚本，见 §15）
├─ docs/               （9 份交付文档）
├─ deploy/             （3 个代理部署包 + 部署说明）
├─ assets/             （architecture.png、voice/）
├─ voice/sherpa/       （本地 ASR/TTS：encoder/decoder/joiner/model/silero_vad.onnx + wasm + 3 个 js 胶水）
├─ build_rag_index.mjs 离线重建向量索引
├─ clean_kb.js         离线知识库清洗
├─ _fetch_blueprint.js 官方加点数据全量抓取
├─ _build_bpmap.js     重建 舰船↔官方编号 映射
├─ _build_sysmap.js    重建 系统↔模块 映射
├─ _build_bpstats.js   重建 加点属性归类
├─ _classify_nodes.js  加点节点分类
├─ _patch_intercept.js 拦截数据补丁
├─ test_reliability.js 可靠性测试
├─ 一键推送Git.bat      同步+推送脚本（robocopy /MIR 到 lglr.html）
├─ README.md           静态版说明
└─ package.json
```

---

## 2. 前端页面 × 11 —— 逐个页面的全部功能

### 2.1 `chat.html` / `index.html` —— AI 对话（两页功能一致）

**对话核心**
- `doSend` 发送提问（含打断/续写、`finish_reason=length` 自动续写**上限 4 次并拼接各段**）
- `onInputChange` 输入框自适应；`speak` 本地朗读回答（`js/voice.js`）
- **运行模式切换** `setRunMode`/`switchMode`：⚡ 快速（拼装，只调 1 次 LLM）/ 📋 计划（先出计划书待批准）/ 🧠 普通（完整多 Agent）
- **模型切换** `switchModel`/`switchDefaultModel`/`toggleModelMenu`：多模型管理 + 一键切默认
- **提问卡片** `submitAsk`/`skipAsk`/`toggleAskOpt`：AI 用 `ask_user` 提问时弹选项卡片
- **计划批准** `approvePlan`
- **点赞/点踩** `rateAnswer`/`submitRate`/`closeRateModal`：可填理由 → 触发反思沉淀 Skill

**会话管理**
- `newChat` 新建 · `switchConv` 切换 · `clearAllChats` 清空
- `forkAt` 任意消息处**分叉**（快照成新会话）· `rollbackAt` **回溯**（删最新一轮）/ **重启**（回溯后原样重发）
- `gotoMsgIdx` + `toggleConvSearch`/`closeConvSearch` **搜索当前对话**（命中定位 + 高亮）
- `selectPickItem` **@引用**历史会话，把上下文注入本次提问
- `toggleAcc` 消息折叠 · `toggleMobileDrawer` 移动端抽屉

**输入与附件**
- `removeAttach` 附件（文本文件读入；图片可配视觉模型识别）
- `toggleQuickPanel`/`quickAct` 快捷操作面板
- `/` 斜杠命令：`/skill`、`/工具`、`/压缩`、`/回溯`、`/重启`、`/clear`

**配队联动**
- `openFleetFromAnswer`：AI 回答里若识别到舰队配置，消息下方出现「⚓ 打开配队」→ 跳 `fleet.html?import=1`

**提示条**：`acceptDisclaimer`（免责声明）、`closeAiTip`/`closeDefaultTip`/`closeSkillTip`

### 2.2 `fleet.html` —— 战舰配队（同时是**数据校验器**）

**配队编辑**
- `newPlan`/`savePlan`/`loadPlan`/`copyPlan`/`delPlan`/`delAllPlans` 方案增删改复制
- `addFleet`/`switchFleet`/`delFleet` 一个方案多支舰队
- `openPicker`/`togglePick`/`setPickFilter`/`confirmPick` **选船弹窗**（3 列 / 舰种筛选 / 多选 / 确认）
- `chQty` 数量 ±（服役上限按**整队**= 主舰队+增援 合计卡；缝合时忽略）
- `openMods`/`pickMod`/`saveMods` **模块弹窗**（逐槽单选，标注该模块带来的载机位）
- `addConfig` **`⧉` 再配一套**（同型舰多套模块组合）
- `cyclePos` 站位点击切换（前/中/后排）
- `openAirPicker`/`openAirQty`/`airSubmit`/`airDelete`/`delAir` **载机位选机**（按【模块来源×机型】分位，每位独立容量与机型限制）
- `rowTap`/`rowTapAir` 行点击排除（点按钮/输入框不误触）

**导出/联动**
- `toSimulator`/`simPick`/`simConfirm` → 复制到模拟器（**选目标舰队**：我方/敌方 × 护航/被护航 + 追加/覆盖）
- `sendToAI`/`sendPlanToAI` → 发给 AI 分析
- `exportAllPlans`/`exportLib`/`download` **导出 JSON**；`doImport`/`doImportLib`/`readFile` 导入（按 id+updatedAt 去重更新）

**配队库**
- `saveToLib` 存入（问名称/场景/标签/来源）· `renderLib` 列表 · `loadLibToEditor` 载入编辑 · `delLib` 删除 · `copyLibToLocal` 内置只读 → 转为可编辑

**校验器**（见 §10）：载机不得塞进无载机位、服役整队、增援 ≤9、启用舰船库时校验所有权

### 2.3 `addpoint.html` —— 舰船加点（蓝点强化）

- `pickSys` 左侧系统列表（带 `已用/上限` 进度条）→ 右侧加点网格（按官方 `position[行,列]` 排布、按 `parentId` 连线）
- `addPoint` 点节点加点 / `−` 退级 / `resetAll` 重置
- **前置规则：任一前置点开即解锁**（不是全部）
- **只显示所选模块对应的系统**；装甲/动力/指挥等舰船级系统永远显示
- `saveBuild`/`openBuilds`/`loadBuild`/`delBuild` **方案保存**（加点 + 模块组合一起存）
- `importCode`/`copyCode` **导入导出加点代码**
- `applyBuild` 应用到当前配队

### 2.4 `simulator.html` —— 战斗模拟器（配舰星港 v7）

**四个页面**：🏠 主菜单 / ⚓ 舰队配队 / ⚔️ 战斗模拟 / 📚 舰船图鉴（`navigateTo`）

**舰队配队**
- `toggleFleetPanel` 展开/收起舰队面板；`renderFleetPanels` 四舰队卡片（指挥值/舰船数/搭载数/增援数）
- `openShipPicker`/`spkToggle`/`spkSetFilter`/`spkSetTab`/`spkConfirm` **选船弹窗**（3 列 / 舰种筛选 / 多选；弹窗内可切目标舰队与主力/增援）
- `spkChangeTarget` 切目标舰队 · `quickAddToFleet` 单艘快速加
- `changeFleetShipCount` 数量 ±（服役**整队**口径、指挥值 ≤500、增援 ≤9）
- `openSimMods`/`simModPick`/`simModSave` **模块选择**（标注载机位；换模块致载机失去位时保存前确认）
- `openSimAirPicker`/`openSimAirPickerFirst`/`simAirSet`/`simAirDel` **载机位选机**
- `simCyclePos` 站位切换 · `simAddConfig` **`⧉` 再加一套**（同型舰多套配置）
- `setShipAsFlagship` 设旗舰 · `removeShipFromFleet` 移出（带载机时确认）
- `syncFleetsToBattle` 同步到战斗 · `applyFleetChanges` 保存
- `saveFleetPreset`/`loadFleetPreset` **舰队预设**；`saveModulePreset`/`loadModulePreset`/`deleteModulePreset` **模块预设**
- `openCustomShipForm`/`addCustomWeapon`/`createCustomShip`/`deleteCustomShip` **自定义舰船**（可建武器）
- `openStrengthen` **逐武器强化**（单发/锁定/冷却/暴击率/暴击伤害）+ 舰船级（物抗/能抗/结构值）
- `showShipDetail` 舰船详情 · `filterEncyclopedia` 图鉴筛选
- 缝合模式开关（忽略服役上限与指挥值）

**战斗模拟**
- `switchBattleMode`：🛡️ 护航战斗 / 💣 轰炸战斗（轰炸有距离滑块 + 四个舰队来源下拉）
- `startBattle`/`pauseBattle`/`resetBattle` + 速度 1x/2x/5x/10x
- 战斗界面：按护航/被护航分组渲染；载机显示为 `✈️ 名称 ×N`；战报（总伤害/存活/时长/逐舰存活%）

### 2.5 `ships.html` —— 舰船信息库（用户自有）

- 全 196 艘列表（长方形卡片，按舰种分组）
- `toggleOwned` 「添加此舰船 / 删除该舰船」切换
- `openMods`/`saveMods` 超主力弹窗**勾选拥有的模块**（多选）
- 技术点数（蓝点）0–5000，带分级（普通舰 40/75/100；超主力 60/120/200）
- **「允许 AI 检索舰船库」总开关（默认关）** → 开了 AI 才能用快照 + `get_user_ships` 工具

### 2.6 `skills.html` —— 技能/工具管理

- `toggleSkill`/`delSkill` 查看/删除 Skill · `createManualSkill` 手写 Skill（名称+摘要+关键词+全文）
- `toggleTool`/`delTool`/`recheckTool` 自建工具的查看/删除/重新审查 · `createManualTool` 手写工具
- `toggleBody` 展开正文

### 2.7 `settings.html` —— API 设置

| 分区 | 配置项 |
|---|---|
| **多模型管理** | `addModel`/`delModel`（名称 / API Key / URL / 模型名）；`switchDefaultModel` 设默认 |
| **智谱 GLM** | 直连 or 代理（`glm_mode`）；`glm_api_key` / `glm_proxy_url` / `glm_model` / `testGlm` |
| **视觉模型** | `glm_vision_api_key` / `glm_vision_model`（留空复用默认） |
| **生成长度** | `max_tokens` 滑杆（带 token 估算 `est`） |
| **联网搜索** | `search_proxy`（搜索代理地址）/ `web_search_api_key`（Tavily） |
| **向量嵌入** | `kb_embed_api` / `kb_embed_key` / `kb_embed_model`（留空则用 TF-IDF 兜底） |
| 其他 | `saveCfg`/`resetCfg`/`togglePwd`、知识库统计面板 `statsPanel` |

### 2.8 `features.html` —— 项目介绍（站内版）

功能架构总览，8 大板块：核心能力 / 经验沉淀 / 人工干预 / 对话控制 / 输入输出 / **🛠️ 舰船工具（7 张卡）** / 知识库 / 检索。

### 2.9 `kb-dev.html` —— 知识库开发中心

`js/kb-dev.js` 的 `runPipeline`：批量清洗 → 语义分块 → 实体抽取 → 冲突仲裁 → `exportProducts`/`downloadProduct` 导出（清洗文档 / 父子块 / 知识图谱 / 勘误报告）。

### 2.10 `voice_test.html` —— 语音测试

调用 `js/voice.js`（本地 sherpa-onnx）测 ASR / TTS。

---

## 3. 前端 JS 模块 × 16 —— 职责与导出 API

| 模块 | 行数 | 导出 | 职责 |
|---|---|---|---|
| `js/agent.js` | 1467 | `window.AgentEngine` | **主引擎**：`chat`/`chatDaily`/`assembleFleet`(快速模式)/`getTools`/`executeTool`/`callLLM(Retry)`/`agentLoop`/`runSubAgents`/`retrieveMulti`/`retrieveFleet`/`supervisoryCheck`/`qualityCheck`/`battleSim`/`calcPower`/`netDpm`/`webSearch`/`describeImage`/`compressConversation`/`interrupt` |
| `js/qa.js` | 770 | `window.QA` | **质检流水线**：`qaPipeline`/`agentAReview`(审计)/`agentBJudge`(三维度裁判)/`factAudit`(五层审计)/`claimSplit`/`evidenceRetrieve`/`judgeCluster`/`llmJudge`/`chainFix`/`foresightCheck`；兜底 `legacyQaPipeline` |
| `js/kb.js` | 402 | `KB` + `SHIP_DB` | **知识库引擎 + 舰船库**：`KB.load/buildIndex/search/searchByCategory/hybridSearch/rrfFuse/contextExpand/metadataWeight/isNoiseChunk/qualityGate/isRedlineSource/hitRate`；`SHIP_DB.load/search/get/all` |
| `js/kb_embed.js` | 128 | `window.KbEmbed` | 前端 bge 嵌入 + IndexedDB 向量缓存（`lagrange_rag_vectors`）+ `semanticRetrieve` |
| `js/rag_client.js` | 96 | `window.RAG` | 向量检索客户端（优先本地 bge，失败回落 API 嵌入） |
| `js/fleet_check.js` | 284 | `window.FleetCheck` | **舰队校验器 = 载机位唯一实现**：`airSlots/slotOf/usedIn/hasAir/assignSlots/slotsOf/allVariantCodes/modAirInfo/stats/check` |
| `js/fleet_io.js` | 167 | `window.FleetIO` | **配队 ↔ AI ↔ 模拟器 三向联动**：`matchShip`(黑话别名)/`parseFleetText`/`looksLikeFleet`/`fleetToText`/`toFleet/toSim/toChat` |
| `js/fleet_lib.js` | 131 | `window.FleetLib` | **配队库**：`all/entryFromPlan/search(Async)/entryToText/indexText/exportAll/importJSON/upsert/remove` |
| `js/ship_build.js` | 224 | `window.ShipBuild` | 加点数据读取与工具：`buildAddPoint`/`findSimEntries`/`apText`/`searchTool`（`get_ship_builds` 的底层） |
| `js/user_ships.js` | 154 | `window.UserShipDB` | **用户舰船库**：`aiEnabled/setAiAccess/isOwned/setOwned/toggleOwned/getShipMods/toggleMod/techTier/snapshot/searchTool/slotOptions` |
| `js/skills.js` | 528 | `window.SkillSystem` | **自进化**：Skill 增删/用户画像/`reflectExperience`/`autoReflectIfNeeded`/`getSkillContext`/`syntaxCheck`/`selfCheckTool`/`createToolFromLLM`/`repairTool`/`executeCustomTool` |
| `js/subagent_pool.js` | 82 | `window.SubAgentPool`/`LLMLock`/`LLMConcurrentLock` | 子代理池（**MAX=7**）+ 并发锁（Semaphore） |
| `js/llm_gate.js` | 32 | `window.LLMGate` | LLM 调用闸门（`callAs` 带池化） |
| `js/kb-dev.js` | 406 | `window.KbDev` | 知识库开发流水线（分块/实体/仲裁/导出） |
| `js/voice.js` | 127 | `window.Voice` | 本地语音：`init`/`asr`/`tts`/`ttsWithCallback`/缓存 |
| `js/chat.js` | 11 | — | 在页面右下角注入**悬浮「💬 AI 战术顾问」按钮**（跳 chat.html） |

---

## 4. 工具系统

### 4.1 十一个内置工具（`js/agent.js` 的 `getTools()`）

| 工具 | 参数要点 |
|---|---|
| `search_knowledge_base` | `query` / `category`（舰船数据 / 战斗机制 / 实例 / 黑话 / 人口…） |
| `get_ship_data` | 舰船名或 ID → 人口/服役/结构/护甲/模块/载机位/站位 |
| `get_ship_builds` | 查官方加点树与已存方案 |
| `battle_simulate` | 双方编队 → 跑一场算术 |
| `web_search` | 搜索代理 → Tavily → 免 key Bing 多级降级 |
| `ask_user` | 需求不清时提问（前端渲染选项卡片） |
| `make_fleet` | **配队输出专用**：结构化参数（main/reinforcement 每项 pos/ship/count/mods/air）→ 前端渲染**方框卡片** |
| `search_fleets` | 检索**配队库**，命中作骨架 |
| `get_user_ships` | 查用户舰船库（**仅用户开启时才注册**） |
| `create_tool` | AI 自写代码建工具（语法编译 + LLM 逻辑审查通过才激活，不过自动修复） |
| `create_skill` | 把经验沉淀成 Skill |

### 4.2 工具调用限制（**代码现状**）

- `js/agent.js`：`toolCallCounts[fn]>1e12 || totalToolCalls>1e12` → **无上限**；`STALL_MS=1e12`、`TURN_MAX=1e12`（有效"无限"）
- `data/system_prompt.md` 文本里仍写着"总上限 2000 次 / 单工具 200 次"——**提示词与代码口径不一致**（代码是无限）
- `make_fleet` 与 `search_fleets` **始终注册**；`get_user_ships` 受开关门控

---

## 5. Agent 提示词清单（16 处）

| # | 变量/文件 | 位置 | 职责 |
|---|---|---|---|
| 1 | `data/system_prompt.md` | 独立文件（21744 字节） | **主 Agent**（最核心，含五轮评测/审批/护航/配队硬规则） |
| 2 | `SYSTEM_PROMPT` | `js/agent.js:87` | 主提示词的**内联副本**（与 md 同步） |
| 3 | `INTENT_PROMPT` | `js/agent.js:1044` | 意图门（分类 + 抽人口预算/增援/场景） |
| 4 | `FLEET_LEAD_PROMPT` | `js/agent.js:508` | 检索舰队·总 Agent（汇总去噪提炼成素材包） |
| 5 | `fleetSubPrompt()` | `js/agent.js` | 检索舰队·子 Agent |
| 6 | `SUPERVISOR_PROMPT` | `js/agent.js:593` | 监督 Agent（核对硬规则遵守情况） |
| 7 | `qualityCheck` | `js/agent.js` | 旧质检（兜底） |
| 8 | `CLAIM_PROMPT` | `js/qa.js:148` | 主张拆解（拆成原子事实） |
| 9 | `JUDGE_VOTE_PROMPT` | `js/qa.js:269` | 独立校验裁判（逐条判三点） |
| 10 | `AUDIT_PROMPT` | `js/qa.js:333` | FACT-AUDIT 五层审计 |
| 11 | `JUDGE_SCORE_PROMPT` | `js/qa.js:372` | LLM-as-Judge 0-100 打分 + 错误清单 |
| 12 | `FIX_PROMPT` | `js/qa.js:427` | 链状回溯修正（只重写出错片段） |
| 13 | `AGENT_A_PROMPT` | `js/qa.js:466` | 质检 A·审计 |
| 14 | `AGENT_B_PROMPT` | `js/qa.js:555` | 质检 B·裁判（三维度各 1/3） |
| 15 | `REFLECT_PROMPT` | `js/skills.js:83` | 经验反思（用户评价触发） |
| 16 | `AUTO_REFLECT_PROMPT` | `js/skills.js:158` | 经验反思（自动触发） |
| + | `ASSEMBLE_SYSTEM` | `js/agent.js:1128` | **快速模式**的"舰队拼装工"提示词（玩家定稿版） |
| + | 工具元数据/安全审查/修复 | `js/skills.js:285/265/310` | 自建工具三件套 |
| + | 对话摘要压缩 | `js/agent.js` | 压缩历史对话框架 |
| + | `capability` / 模式注入 / Flash 精简 | `js/agent.js:1022/1032/1041` | 能力清单、模式、默认模型精简模式 |

**质检判定阈值（代码实测值）**：
- 质检 A/B：B 三维度各 1/3，**≥75 PASS**（<75 FAIL 触发重生成）
- FACT-AUDIT 管线：**≥80 PASS / 60–79 PARTIAL_FIX（链状回溯局部修正）/ <60 FULL_REGEN**，`MAX_ITER=2`（2 轮不过则 MAX_ITER_STOP 强制放行）

---

## 6. 数据层（`data/`）

| 文件/目录 | 内容 |
|---|---|
| **`ship_database.json`** | **舰船库·唯一数据源**，196 条（字段见 §6.1） |
| `ship_database.bak_*.json` ×4 | 各轮改动前的备份（hp / intercept / sysbreak / weapons） |
| **`knowledge/`** | **1130 个 md**（A资料 712 / 实例 222 / 舰船资料 187 / 战斗机制 / 舰船基础信息 / 舰船人口 / 舰船拦截率 / 黑话 / 舰船站位×4） |
| `knowledge_backup/` | 第二知识库（旧舰船资料/讲解/精炼数据，source 前缀 `backup/`） |
| `knowledge_clean/` | A资料清洗版 JSON（712 个） |
| **`rag_index.json`** | 向量索引：**1130 块 × 512 维**（bge-small-zh-v1.5） |
| **`kb_corpus.json`** | 语料（1130 块，content+source） |
| **`blueprint/`（177 个 json）** | 每艘的加点树（节点/坐标/前置/逐级消耗与数值/中文文案） |
| `blueprint_all.json` | 加点数据全量合并 |
| `blueprint_ships.json` | 有加点数据的舰船总表 |
| `blueprint_map.json` | 舰船 slug ↔ 官方编号（196 → 177） |
| `blueprint_sysmap.json` | **系统 ↔ 我们的模块**（决定"按系统生效"） |
| `blueprint_stats.json` | 每个节点的属性归类 + 逐级数值 + 机制参数 |
| `blueprint_company.json` | 177 艘的公司 id（"协同指挥 C"用） |
| `fleet_library.json` | 内置只读配队库（AI 可检索） |
| `system_prompt.md` | 主 Agent 系统提示词 |
| `system_prompt_optimize.md` | 提示词优化稿（参考） |
| `ARCHITECTURE_and_AGENTS.md` | 架构 + **全部 Agent 提示词原文** |
| `_old_kb_1787515257/` | 旧知识库备份 |

### 6.1 `ship_database.json` 字段（单条）

```jsonc
{
  "id":"uranus-spear", "name":"乌拉诺斯之矛", "variant":"", "type":"battlecruiser",
  "size":"large", "position":"前排",                     // 前排/中排/后排；战机=aircraft
  "hp":189493, "physicalArmor":240, "energyArmor":5,
  "commandValue":35, "serviceLimit":6,                   // 人口 / 服役上限
  "speed":{...}, "ratings":{...},                        // ⚠️ 只用于显示，不参与战斗
  "airSlots":{ "base":[], "byModule":{ "B2":[{ "kind":"corvette","size":"corvette","cap":3 }] } },
  "airSize":"large|small",                               // 战机/护航艇：能否进"仅中小型"位
  "modules":{
    "M":{ "type":"moduleGroup","name":"M舰首主武器","variants":{
        "M1":{ "name":"舰首轨道炮系统","weapons":[ ... ] } } },
    "_systems":{ ... }                                   // "_"开头会被引擎跳过
  }
}
```
**武器对象**：`{name, dmgType:'physical'|'energy', weaponType:'direct'|'projectile', singleDmg, ammo, attacks, atkDuration, lockTime, cooldown, priority, dpm:{antiShip,…}, targets:[{types:[…],hitMin,hitMax}], antiAirType:'counter'|'area', crit, _src}`

---

## 7. 知识库与检索链路

**检索四路**：TF-IDF 稀疏（中文 bigram + 余弦）· bge 稠密（512 维，前端 transformers.js 离线）· 分类检索（按资料类别）· 舰船名精确检索。

**后处理链**：`rrfFuse`（RRF 倒数排名融合）→ `metadataWeight`（元数据分层加权：音频口语稿降权 / 结构化舰船配队升权）→ `contextExpand`（补相邻块）→ `isNoiseChunk`（去碎片/重复/口语冗余/空白实例）→ `qualityGate`（CRAG：低分触发改写二次检索）→ `isRedlineSource`（**数据文件夹 md 红线白名单**）。

**A 资料优先级**：`A资料1-400` > `A资料401-712` / 实例 / 舰船资料（写进提示词）。

---

## 8. 战斗引擎（`simulator.html`）

### 8.1 已实现（与用户《战斗机制》文档一致）

| 机制 | 实现 |
|---|---|
| 时间 | `dt = 0.1 × 速度倍率` |
| 目标选择 | 优先超主力（勾选）→ **直射必须先清最前排**（`getDirectFireTargets`）→ 按武器 `targets` 序列匹配类型 → 随机；候选收缩 `max(1, round(n/2.5))` |
| 开火循环 | 首射不吃冷却；**锁定与冷却并行**；**同目标不重复锁定**；`弹药×攻击次数` 在 `攻击时长` 内分批；**目标死亡带剩余发数重锁、不重置冷却** |
| 命中 | `(hitMin+rand×(hitMax−hitMin))/100 × (1+(锁定效率−闪避)/100)`，clamp 0.01~0.99 |
| 拦截 | 按模块合成到舰船；`Π(1−r/100)` 累乘（全局/同排/自身）；**直射武器不被拦截** |
| 伤害 | 调校系数 **1.3**；物理=**减法**、能量=**乘法**；**不破防吃 10%**；能量抗性 ≥100% → 0 |
| 暴击 | `(武器crit?15%:0 + 强化暴击率) × (1.5 + 强化暴击伤害)`，作用于最终单发 |
| 加成 | 大盾旗舰全场 ×0.7；**被护航舰在护航存活时伤害=0** |
| 系统破坏 | 定向（`subSystemTargets`，效率 高60%/中40%/低20%）+ 10% 随机；被毁模块**全部武器停火**；25 秒修一次；维修次数 指挥3/自修2/其它0；**只有动力系统**破坏扣 5% maxHp |
| 载机 | 按**条目**平均分摊部署（总数=配队页填的数）；**母舰被毁 → 其载机一起被毁**（`carrierInstId`） |
| 维修 | `面板维修/60 × (1 + min(物甲×0.25,150)%)`，选血%最低友军 |
| 强化 | 7 项（单发/锁定/冷却/暴击率/暴击伤害/结构值/物抗能抗），按 `槽_变体[武器序号]` 存 |
| 加点 | 开战**自动套用**（船级在算 maxHp 之前；逐武器按系统投递） |
| 轰炸 | 距离每偏离 15 吉米 ±2% 命中 |

### 8.2 未实现（如实）

拦截率/闪避率（多数船无数据）· 防空三态与舰载 15%/机载 60% 命中 · 系统独立血量（"绝育"） · 策略系数 · 打系统武器打结构 ×0.8 · 战机两种模式（独立/往复）与飞行时间 · 母舰机库加成 · 旗舰技能（只做了大盾） · 速度/距离参与交战

---

## 9. 加点系统

- 数据：**177 艘 / 947 系统 / 7106 节点**，来源官网公开 CDN `res/blueprint/ship_info/<编号>.js`
- 实现率：5186 个节点已实现 **4466（86%）**
- 分组：**A 组**（10 项，自动汇总+手动追加）· **B 组**（4 项，全靠手填）· **H 组**（机库暴击 2 项）· **M 组**（只作用于本系统）
- 取值：`perLevel[等级]`，**不是累加**
- 两级机库作用域：「本舰船机库」→ 全舰载机 / 「本系统机库」→ 仅该模块载机
- 已实装的特殊机制：两列型暴击 · 掩护（拆 base/时长/目标数，受击伤害转由掩护舰承担）· 周期爆发 · 锁定效率（加命中）· 密集射击（攻击次数×2）· 系统内导弹拦截 · 武器分散打击 · 苍穹 M1 协同打击 · 主武器优先打击 · 安东塔斯三种打击 + 协同指挥 A/B/C

---

## 10. 校验器（`js/fleet_check.js`）—— 唯一实现

`check(fleet, opts)` → `{ok, errors, warnings, fixed, stats}`：
1. 舰船必须存在于舰船库
2. **载机不得强塞**（无载机位 / 所选模块不提供该机型位 / 仅中小型位塞大型机 / 单位容量超限）→ 报错并**从结果中剔除**
3. 服役上限按**整队**（主力+增援）合计
4. 增援 ≤ 9 艘
5. 载机服役上限也按整队
6. 启用舰船库时：舰船与模块必须是用户拥有的
7. `stats` 全部由舰船库重算（人口/增援/载机/载机位总量/模块数）

**接入点**：`fleet.html` 导入时、`js/agent.js` 的 `make_fleet`（违规**打回并让 AI 重做**）、`chat.html` 卡片统计。

---

## 11. 配队三向联动 + 配队库

| 方向 | 通道（localStorage） |
|---|---|
| AI → 配队页 | `lagrange_fleet_import`（点卡片或点「⚓ 打开配队」） |
| 配队页 → 模拟器 | `lagrange_sim_import`（选目标舰队 + 追加/覆盖） |
| 配队页 → AI | `lagrange_chat_prefill`（跳对话页自动填入并发送） |

配队库：结构化条目（每舰站位/数量/模块/载机）→ AI 用 `search_fleets` 检索；空库时回落知识库思路。

---

## 12. 离线数据管线（脚本）

| 脚本 | 作用 |
|---|---|
| `_fetch_blueprint.js` | 全量抓取官方加点数据（177 艘） |
| `_build_bpmap.js` | 重建 舰船 slug ↔ 官方编号 |
| `_build_sysmap.js` | 重建 系统 ↔ 模块 映射 |
| `_build_bpstats.js` | 重建属性归类（含人工译表 `DECODED`） |
| `_classify_nodes.js` | 加点节点分类 |
| `_patch_intercept.js` | 拦截数据补丁 |
| `build_rag_index.mjs` | **重建向量索引 + 语料**（⚠️ 约 17 分钟；批量嵌入会 OOM，必要时用增量重嵌） |
| `clean_kb.js` | 知识库清洗（断点续跑） |
| `test_reliability.js` | 可靠性测试 |

---

## 13. 后端 / 部署（`deploy/`）

**本目录没有 Python 后端**。`deploy/` 是三个"把 GLM Key 藏在服务端"的代理部署包：

| 包 | 平台 | 文件 |
|---|---|---|
| `glm-proxy-worker.js` | **Cloudflare Worker**（推荐，免费 10 万次/天） | 单文件 + 部署说明 |
| `aliyun-fc-proxy/` | 阿里云函数计算 | `index.js` / `app.js` / `app.py` + 3 个 zip |
| `tencent-scf-proxy/` | 腾讯云 SCF | `index.js` + zip + 部署说明 |

用途：静态站（GitHub Pages / 安卓 APP）公开部署时**不暴露 Key**。
联网搜索代理：填 `http://192.168.1.49:3000/api/search`（后端提供，带 CORS）。

---

## 14. 语音（本地离线）

`js/voice.js` + `voice/sherpa/`（`encoder/decoder/joiner/model/silero_vad.onnx`）→ 本地 **ASR**（语音转文字）与 **TTS**（文本朗读），纯离线、带缓存。

---

## 15. 测试（`test/` 40 个脚本）

### 15.1 十套核心回归（153 项，全绿）

`fleet_ui`(32) · `fleet_check`(39) · `simulator_fleet`(21) · `fleet_multiconfig`(17) · `position`(9) · `aircraft_count`(7) · `fleet_count_inflation`(7) · `fleet_text_roundtrip`(7) · `strengthen_and_module`(7) · `battle_mechanics`(7)

### 15.2 其它

`module_in_combat`(5) · `fleet_vs_reality`（配队对照工具）· `intercept_regression`(17) · `addpoint_entry_regression`(23) · `sim_audit`/`sim_audit2`（审计）· `engine_test` · `check_handlers` · `approval_test` · `llmlock_test` · `subagent_test` · `verify_*`（BGE/GLM/自动Skill/反思/语音）· `qa_*_browser_test`（十来个浏览器端质检/模式/暂停/意图测试）· `real_round_test` · `shots/`（截图）

---

## 16. 存储键（localStorage 全量，24 个）

| 键 | 用途 |
|---|---|
| `lagrange_static_config` | **全局配置**（模型/Key/模式/搜索/嵌入） |
| `lagrange_conversations` | 全部会话 |
| `lagrange_fleets` | 配队页方案（⚠️ 模拟器曾共用，已迁出） |
| `lagrange_sim_fleets` | 模拟器四舰队 |
| `lagrange_fleet_library` | 配队库（可编辑部分） |
| `lagrange_fleet_import` / `lagrange_sim_import` / `lagrange_chat_prefill` | 三向联动通道 |
| `lagrange_user_ships` | 用户舰船库（含 aiAccess 开关） |
| `lagrange_addpoint` | 加点配置（开战自动读） |
| `lagrange_addpoint_v0` | 加点旧格式（兼容用） |
| `lagrange_addpoint_builds` | 加点方案 |
| `lagrange_custom_ships` | 自定义舰船 |
| `lagrange_presets` | 模拟器舰队/模块预设 |
| `lagrange_skills` / `lagrange_tools` / `lagrange_user_profile` | Skill / 自建工具 / 用户画像 |
| `lagrange_auto_reflect` | 自动反思状态 |
| `lagrange_rag_vectors` | 前端向量缓存（IndexedDB） |
| `lagrange_voice` | 语音缓存 |
| `lglr_disclaimer_seen` / `lglr_ai_tip_closed` / `lglr_default_tip_closed` / `lglr_skill_tip_closed` | 各种一次性提示的关闭状态 |

---

## 17. 同步与部署机制

- `一键推送Git.bat`：`robocopy "拉格朗日智能体3" "." /MIR /XD .git node_modules __pycache__` → **镜像同步**到 `lglr.html`（会自动删掉源里没有的文件）→ 再走 git 提交推送
- 三副本：`拉格朗日智能体3`（工作源）→ `lglr.html`（GitHub Pages）→ `拉格朗日智能体/web`（后端托管）
- 线上：`https://obxx947.github.io/lglr/`；改完 **Ctrl+Shift+R** 强刷

---

## 18. 约束 / 踩坑 / 缺口

### 18.1 硬约束（5 条）
1. 未经同意**不得修改 `data/system_prompt.md`**
2. 只用"拉格朗日智能体3"当工作源；`git add` 禁止 `-A`
3. 后端只允许 GLM，不许用用户的 DeepSeek/其它个人 key
4. 技术评估**必须绝对诚实**：不编造、不知道就说不知道、不许把"没实现"说成"已实现"
5. **以"战舰配队"为准**（配队页是数据权威）

### 18.2 踩坑（10 条，详见 `docs/`）
shell 吃正则转义 · heredoc 吃反斜杠 · `JSON.stringify(x,null,2)` 破坏单行库 · `｜`(U+FF5C)≠`│`(U+2502) · 引入 uid 后要 grep 所有"拿参数查数据"处 · 载机条目必须完整舰船对象 · onnxruntime 批量嵌入 OOM · timeout+管道会让退出码变 0 · 比 DPM 要按武器主目标选字段 · headless 视口太矮会被 fixed 栏盖住

### 18.3 缺口（待数据 / 待做）

**待用户提供**：拦截率与闪避率（全库仅 5 艘有拦截、0 艘有闪避）· 剩余 **12 艘零输出船**的武器（天枪×2、佩刀、牛蛙、海氏、林鸮、砂龙、安德森、SC002、理智TE 无 modules；雷火之辉、FSV830 有模块无武器）· 11 个游戏术语代号译文 · 安东塔斯 M1/M2/M3 该配哪几门炮 · 太阳鲸 C2 打建筑还是系统 · 5 条无出处系统破坏数据留改清 · 各舰旗舰技能 · 配队+真实战果（7% 验证用）

**建议接着做**：重算原有 286 门固定模块武器的冷却（用面板 DPM 反推）· 修 41 门损坏的武器名（占 412 门的 10%，涉及 29 艘船，多为占位数据）· 系统独立血量 / 防空三态 / 战机两模式 · 243 个未实现加点 · 清 2 处旧副本（后端 `lagrange_docs`、小程序 `utils`，仍是 193 艘）
