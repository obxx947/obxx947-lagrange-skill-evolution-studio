> ⚠️ **重要告知 / IMPORTANT**
> 本项目仅限**个人非商业学习、技术研究**使用，**严禁任何形式的商业商用**；所有输出内容**仅供游戏参考，不构成决策依据**，使用风险自行承担。仓库**不附带、不分发任何第三方短视频（如抖音）转录文本/音频素材**，用户自抓取的短视频内容仅供个人研究、版权/人格/个信风险自担。完整法律约束请查阅仓库根目录 [`DISCLAIMER.md`](DISCLAIMER.md)。

# 🚀 LagrangeAgent — 无尽的拉格朗日 · AI 战术参谋
### Endless Lagrange — AI Tactical Advisor · Multi-Agent · RAG · Self-Evolving Skill Studio

> **🇨🇳 中文**：一个面向《无尽的拉格朗日》的 AI 战术顾问：多智能体协同 + 知识库 RAG 检索 + 战斗模拟，能**配队 / 查舰船 / 讲机制 / 复盘战报 / 推演战斗**，并支持**自进化 × 人工干预式进化**（点赞/反思/技能沉淀 + Skill 管理页可增删改）。网页版 · 后端版 · 安卓 APK。
> **🇬🇧 English**: A multi-agent AI tactical advisor for *Endless Lagrange* (无尽的拉格朗日): fleet-building assistant, ship encyclopedia, battle simulator, RAG knowledge base, and a **self-evolving × human-curated skill studio**. Web · Backend · Android APK.

> 🌐 **Live demo / 在线体验**：[https://obxx947.github.io/lglr/](https://obxx947.github.io/lglr/) ｜ 📱 **Android APK / 下载安卓版**：[`download/lglr.apk`](https://github.com/obxx947/lglr/raw/main/download/lglr.apk)（含离线知识库 / offline KB）

[![Python](https://img.shields.io/badge/Python-3.12-blue)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green)](https://fastapi.tiangolo.com)
[![Frontend](https://img.shields.io/badge/Frontend-%E7%BA%AF%E9%9D%99%E6%80%81/static-cyan)](https://github.com)
[![License](https://img.shields.io/badge/License-NonCommercial-red)](LICENSE)
[![Agents](https://img.shields.io/badge/MultiAgent-8%2B-purple)](.)
[![Evolving](https://img.shields.io/badge/Self%20Evolution%20%C3%97%20Human%20Curated-%E2%9C%85-brightgreen)](.)

---

## 🌐 English Overview

**Endless Lagrange AI Tactical Advisor (无尽的拉格朗日 AI 战术参谋)** — a **multi-agent LLM platform** that plays the war-tactics game *Endless Lagrange* for you.

**What it does**
- 🚢 **Fleet advisor** — asks your ship/score, recommends optimal fleet & ship builds; validates with a **battle simulator**.
- 📚 **Knowledge-base RAG** — 1125+ ship/mechanism/battle-report docs + 499+ expert commentaries; TF-IDF sparse + **bge semantic** (512-dim) + RRF fusion + redline + CRAG gating.
- ⚔️ **Battle simulator** — real game formulas (armor/shield/crit/intercept/system-breakdown), 4-fleet / reinforcement / flagship / custom ships.
- 🧬 **Self-Evolving × Human-Curated Skill Studio** — auto-reflection turns 👍👎 ratings into **skills / anti-patterns / user profile**; a **Skill Manager page** lets you **enable / disable / delete / create / run** skills & tools — a two-way feedback loop.
- 🤖 **8+ agents** — main + intent gate + 4 domain retrievers + retrieval fleet (lead/≤3 subs) + QC (A-audit / B-judge ≥75 PASS) + supervisor + reflection.
- 🆓 **Zero-config free** — site-wide **GLM server proxy** (multi-key rotation + 429 backoff retry), no per-user key, no shared-key rate limit; strict ≤1 concurrency.
- 📱 **Web · Backend(:3000) · Android APK** (bundled KB, offline retrieval).

**Keywords** · endless lagrange 无尽的拉格朗日 · AI agent 智能体 · multi-agent 多智能体 · RAG 知识库 · fleet advisor 配队助手 · battle simulator 战斗模拟 · self-evolving 自进化 · skill studio 技能 · chatbot · FastAPI · game AI.

---

## 📖 中文详情 / Chinese Details

### 🌟 核心特点 / Key Features

- 🧠 **多智能体协同 / Multi-Agent**：主对话 + 意图门 + 4 领域检索子代理 + 检索舰队(总/子) + 质检(A审计/B裁判) + 监督 + 反思，8+ Agent 各司其职
- 📚 **知识库驱动 RAG**：1125+ 舰船/机制/战报资料 + 499+ 实战讲解，TF-IDF 稀疏 + bge 语义(512维) + RRF 融合 + 红线 + CRAG 门控
- ⚔️ **战斗模拟器**：真实游戏公式（装甲/护盾/暴击/拦截/系统破坏），四舰队/援军/旗舰/缝合/自定义船
- 🚢 **舰船图鉴**：完整 HP/装甲/武器模块/评级 (S-D)，舰船名精确检索 + 黑话
- 🚀 **自进化 × 人工干预式进化**（核心卖点）：👍👎 打分 → 自动反思 → 沉淀 Skill/画像 → **越用越懂你**；也可**人工雕琢**——手动写/新建 Skill、`/`命令、Skill 管理页**启停/删除/运行**、上下文压缩——AI 与你的「双向喂养」
- 🔧 **Skill / 工具管理页**：可视化**启用/停用/删除/新建/运行** Skill 与工具，`create_tool` 自建自检，自进化结果随手可改
- 🔍 **多种检索**：分类检索 / 舰船名精确 / 联网搜索(可配) / A资料 1-400 高优先
- 📱 **三种形态**：网页版(GitHub Pages) · 后端版(:3000) · 安卓 APK(含离线知识库)
- 🆓 **零配置免费可用**：站内 GLM 服务端代理（多 key 轮换 + 429 退避重试），**无需自配 key、无共享限流**；并发严格 ≤1

---

### 🧬 进化引擎 / Evolution Engine（自进化 × 人工干预式进化）
> **它不只是问答机器人，而是一个「越用越懂你、还能被你亲手雕琢」的成长型智能体。**

**自进化（Agent 自动 / Auto-evolution）**
```
每次对话结束 → 自动反思(AUTO_REFLECT) → 提炼 Skill / anti_patterns / 用户画像
             → 下次相关对话【按需注入】→ 越用越精准，经验自动沉淀
```
- 自动反思：对话后后台自动评估，把"成功思路"存为 **Skill**、把"踩坑教训"记为 **anti_patterns**。
- 用户画像：每轮携带精简画像摘要，让回答贴合你的号型/刻度/偏好。
- 上下文压缩：长对话超限自动摘要续接，不丢重点。

**人工干预式进化（你说了算 / Human-curated）**
```
👍 点赞 → 自动沉淀为经验 Skill（让它记住这次做对了什么）
👎 点踩 → 触发反思，写进反模式，下次避开
✍️ 手动写 / 新建 Skill ｜ 用 /命令 注入 ｜ 在 Settings 里自己填 API key / 模型
🔧 Skill 管理页：可视化【启用 / 停用 / 删除 / 新建 / 运行】你的技能库
🧰 工具管理页：查看自检记录、启停、删除；create_tool 让 AI 自建安全工具
```
> **双向喂养 / Two-way loop**：AI 自进化产生的 Skill，你可在管理页随手**增删改**；你培养的 Skill 又会注入 AI → 反馈回路。

**Skill / 工具管理页（`skills.html`）**
- 列表展示全部 Skill / 工具（含自检记录、状态）
- 一键 **启用 / 停用 / 删除 / 新建 / 运行**
- 支持 `create_tool` 让 LLM 自主创建工具并自动安全审查

---

### 🏗️ 完整架构 / Architecture

```
【前端 · 纯静态 Web】(chat.html + js/)
  输入 ──► 意图门(需求理解/闲聊判定) ──► 领域子代理(本地KB,4个)
        ──► 主检索(TF-IDF + RAG语义 + RRF融合) ──► 组装【系统提示词+知识库+Skill+历史】
        ──► agentLoop(主循环: 7+工具 / ask_user / 计划审批 / 中断)
        ──► 质检(Agent-A审计 + Agent-B裁判, ≥75 PASS) ──► 监督Agent(合规标记)
        ──► 每轮折叠块(已思考/运行状态) ──► 操作条(👍👎🔊🌿) ──► 反思/沉淀
        ⚠️ 全局并发锁 ≤1(LLMLock) · 子Agent池≤7 · 检索舰队子Agent≤3

【后端 · FastAPI :3000】(可选，用于弥补无后端取舍)
  ├─ /web/           全功能前端(同步版)
  ├─ /v1/chat/completions   站内 GLM 服务端代理(多key轮换+429重试)
  ├─ /api/agent/chat        SSE 流式 Agent 流水线(子代理/质检/工具/联网)
  ├─ /api/search            免key Bing 搜索代理
  ├─ /api/*                 用户/Token计费/模拟器/存档
  └─ rag_service            服务端 RAG(TF-IDF+向量) · 计费/限流/会话记录
```

---

### 🤖 多 Agent 协同逻辑 & 每个 Agent 定位 / Agents & Roles

| Agent / 智能体 | 定位 / Role | 职责 / Duty |
|---|---|---|
| **主 Agent / Main** | 总指挥(SYSTEM_PROMPT) | 唯一读全量系统提示词：按知识库强制校验查数据、配队、查机制、出计划、五轮评测、输出附打分与理由 |
| **意图门 / Intent Gate** | 需求理解 | 理清用户意图 + 判定日常闲聊；闲聊则直接回答，非闲聊才进入检索/工具/质检 |
| **领域子代理 ×4**（舰队配置/舰船数据/战斗机制/讲解范例） / Domain Retriever ×4 | 本地知识库快检 | 按各自关键词兜底检索知识库，多路召回素材 |
| **检索舰队 · 总Agent / Fleet Lead** | 检索汇总 | 汇总 ≤3 子Agent素材，去噪合并，5维提炼【检索素材包】 |
| **检索舰队 · 子Agent ×≤3 / Fleet Sub** | 检索执行 | 两阶段：出检索意图→代码多路检索(≤50)→解析标注并萃取原文，只产素材 |
| **质检 Agent-A / QC-A (Audit)** | 审计 | 六步审计查编造/数值/约束遗漏/逻辑矛盾，输出漏洞清单 |
| **质检 Agent-B / QC-B (Judge)** | 裁判 | 三维度打分(数据/推演/思路)，≥75 PASS / <75 FAIL，复核A查漏判 |
| **监督 Agent / Supervisor** | 合规 | 对照全部Agent提示词重点，监督输出/提问是否遵守硬性规则，只标记不重写 |
| **反思 / Reflection** | 自我进化 | 对话后自动/手动反思，把失败教训凝练为 Skill/anti_patterns，下次按需注入 |

---

### 🔄 一条用户输入触发的完整流程 / End-to-End Flow

> 例 / e.g.：`"我是平民玩家想玩南十字，前排带什么好？双矛+斗牛+无限枪骑兵怎么样？"`

1. **输入/意图门**：解析需求（南十字平民、前排配队、是否闲聊）→ 非闲聊，进入检索链路。
2. **领域子代理**(本地KB)：舰队配置/舰船数据/战斗机制/讲解范例 4 子代理各按关键词召回资料。
3. **主检索**：TF-IDF 稀疏 + bge 语义(RAG 512维) + RRF 融合 + 噪声过滤 + 元数据加权 + 相邻块扩展 + MD红线 + CRAG门控 + **A资料1-400优先**。
4. **检索舰队**(非默认模型)：总Agent派 ≤3 子Agent出意图→多路检索(≤50)→标注萃取→5维【检索素材包】。
5. **组装上下文**：系统提示词 + 知识库素材包 + 相关 Skill + 用户画像摘要 + 对话历史。
6. **agentLoop 主循环**：可调 `search_knowledge_base/get_ship_data/battle_simulate/web_search/create_tool/create_skill/ask_user` 工具；配队类问题自动调**战斗模拟器推演**；需要用户决定时 `ask_user` 提问并暂停；**计划模式**先出计划书等批准。
7. **质检**：Agent-A 审计 → Agent-B 裁判(≥75 PASS)；(非默认) 监督Agent 合规标记。
8. **输出**：最终回答 + 来源标注 + **每轮折叠块(已思考·用时 / 运行状态)** + 操作条(👍👎🔊🌿分叉)。
9. **进化**：👍👎 打分→反思→沉淀 Skill/画像；上下文超限自动压缩；下次相关对话按需注入。

---

### 🔎 检索方式 / Retrieval Methods（混合检索管线 / Hybrid Pipeline）

| 方式 / Method | 说明 / Description |
|---|---|
| TF-IDF 稀疏检索 / Sparse | 中文 bigram 分词 + 余弦相似度 |
| RAG 语义检索(bge) / Semantic | transformers.js 加载 bge-small-zh-v1.5 静态向量库(512维×1125分块)，离线免费 |
| 分类检索 / Category | 按舰船数据/战斗机制/实例/黑话/人口等类别定向检索 |
| 舰船名精确检索 / Ship exact | SHIP_DB 精确匹配舰船 |
| RRF 倒数排名融合 / Fusion | 融合稀疏+稠密两路结果综合排序 |
| 元数据分层加权 / Metadata weight | 音频口语稿降权、结构化舰船/配队数据升权 |
| 相邻块上下文扩展 / Context expand | 补同一来源前后 chunk |
| MD 红线白名单 / Redline | 仅允许知识库内来源进入结果 |
| 噪声过滤 / Noise filter | 去碎片/重复/口语冗余/空白实例 |
| 质量门控 CRAG / Quality gate | 召回低分→改写二次检索 |
| A资料 1-400 高优先 / Priority | 编号靠前优先参考 |
| 检索舰队(非默认模型) / Retrieval fleet | 子Agent出意图→多路检索→标注→5维素材包 |
| 联网搜索(可配) / Web search | 搜索代理→Tavily→免key Bing 降级 |

---

### 🧰 工具集 / Tools（agentLoop 可调）
`search_knowledge_base` · `get_ship_data` · `battle_simulate` · `web_search` · `ask_user` · `create_tool`(自建+自检) · `create_skill` (+ 自定义工具 / custom tools)

### ⚖️ 并发与优化约束 / Constraints
- **全局并发锁 ≤1**（`LLMLock`，任何时刻只 1 个 LLM 请求，杜绝 429）
- 子 Agent 池 ≤7；本批检索子 Agent ≤3
- 默认 GLM-4.7-Flash **精简模式**：规则意图门、跳过检索舰队/A/B质检、40s 超时、1 并发、本地 RAG 仍启用
- **429 保留进度后台自动续跑**：退避 5/10/15/20s，最多 6 次，期间免手动重发

---

### 🛠️ 技术栈 / Tech Stack
- **前端 / Frontend**：纯静态 HTML/CSS/JS · transformjs(bge) · 多 Agent 前端引擎
- **后端 / Backend**：Python 3.12 · FastAPI · httpx · scikit-learn(TF-IDF) · faiss/numpy(向量) · jieba · SQLite · uvicorn
- **移动端 / Mobile**：Kotlin + WebView 壳（打包静态资源，离线检索）→ GitHub Actions 云端构建 APK

---

### 🚀 部署方式 / Deploy

#### 1️⃣ 网页版 Web（纯静态 · GitHub Pages）
直接托管，默认内置 GLM key 兜底（会限量；配置自己 key 更稳）。

#### 2️⃣ 后端版 Backend（:3000，推荐，可免费零配置）
```bash
pip install -r requirements.txt
copy .env.template .env   # 填 DeepSeek key（旧路径用）；GLM 代理可用 GLM_API_KEYS（多key逗号分隔，可选）
python main.py            # http://<内网IP>:3000
```
- 全功能前端：`http://<host>:3000/web/`
- 前端默认走站内 GLM 代理（免 key、多 key 轮换、429 重试）

#### 3️⃣ 安卓 APK / Android
- 打包静态前端 + 知识库（离线检索）+ WebView，默认走后端 GLM 代理（地址可在设置改）
- 由 `.github/workflows/build-apk.yml` 云端构建 → `download/lglr.apk` → 落地页「📱 下载安卓 APK」

---

### 📁 项目结构 / Structure
```
├── main.py                 # FastAPI 入口（路由/静态挂载/包绕）
├── config.py               # 配置（含 GLM 代理多 key）
├── llm_proxy.py            # 站内 GLM 服务端 LLM 代理（/v1）
├── api_routes.py           # /api/*（用户/计费/模拟器/搜索）
├── agent_orchestrator.py   # SSE 流式 Agent 流水线
├── agent_*.py              # 子代理/质检/工具
├── rag_service.py          # 服务端 RAG（TF-IDF+向量）
├── chat_service.py         # 经典 /api/chat（DeepSeek+RAG+计费）
├── simulator_service.py    # 战斗模拟器服务
├── web/                    # 全功能前端（多Agent对话/知识库/模拟器）
├── static/                 # 旧模拟器 SPA + 旧 chat
├── data/ knowledge/        # 舰船/机制/战报知识库 + rag_index.json
└── requirements.txt
```

---

### 📄 License / 许可
**非商用许可 / Non-Commercial License** — 仅供学习、研究、个人自用，**严禁用于任何商业用途**（详见 [LICENSE](LICENSE)）。© LagrangeAgent

### 💬 支持 / Support
- 想让「点进来就免费即用、免429」→ 用**后端版**或 **APK**（站内 GLM 多 key 轮换）。
- 想网页版也免 429 → 把后端部署到公网即可。

> 别忘了 ⭐ Star & 关注，支持开源！ / Don't forget to ⭐ Star & follow!
