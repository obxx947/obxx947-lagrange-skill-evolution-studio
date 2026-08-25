# 拉格朗日智能体 — 静态版

基于《无尽的拉格朗日》的 AI 战术推演中心。**纯前端静态版本**，可直接部署到 GitHub Pages，无需后端服务器。

> 此页面为方便使用的静态版。完整版（本地部署、实时模拟器联动、更强检索）请前往仓库下载源代码本地运行：
> 🔗 https://github.com/obxx947/lagrange-ai

## 功能

- ⚔️ **配舰星港模拟器** — 舰队配队 / 战斗模拟 / 舰船图鉴（169艘舰船）
- 🤖 **AI 战术顾问** — 多模型对话、知识库检索、子代理集群、战斗推演、质检闭环
- ⚙️ **API 设置** — 配置你自己的大模型 API Key（DeepSeek / OpenAI 等任意兼容接口）

## 使用

1. 打开 `index.html` 或部署到 GitHub Pages
2. 先到「⚙️ API 设置」填入你的大模型 API Key（支持多模型管理）
3. 到「🤖 AI 对话」提问

## 架构（纯前端）

```
index.html ── 入口页
  ├── simulator.html ── 模拟器（舰队/战斗/图鉴，纯JS引擎）
  ├── chat.html ── AI对话（前端Agent）
  │     ├── js/kb.js ── 知识库加载 + TF-IDF检索 + 缓存
  │     ├── js/agent.js ── Agent引擎（LLM调用/工具/质检/子代理）
  │     └── data/knowledge/*.txt ── 67份知识库资料
  └── settings.html ── API配置（localStorage存储）
```

### 工作原理

用户提问 → 子代理集群检索知识库（舰船/机制/范例/人口/黑话/实例）→ 联网搜索 → 主Agent推理（function calling 工具：知识库检索/舰船查询/战斗推演/联网）→ 独立质检 → 达标输出

### 联网搜索（三选一）
1. **搜索代理地址**（推荐，无需Key）：设置页填原版服务器地址 `http://192.168.1.49:3000/api/search`（原版已提供Bing代理接口，带CORS）
2. **Tavily API Key**：设置页填写（浏览器直连，免费1000次/月）
3. **Cloudflare Worker**：部署一个转发Bing的Worker后填入地址（适合GitHub Pages公网部署）

### 安全说明

- API Key 只存储在**你自己的浏览器 localStorage**，不上传任何服务器
- 知识库文件为游戏公开资料

## 部署到 GitHub Pages

1. 把本文件夹内容推送到仓库
2. 仓库 Settings → Pages → 选择分支 → 保存
3. 访问 `https://<用户名>.github.io/<仓库名>/`
