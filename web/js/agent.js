/* ========================================
   前端Agent引擎（纯JS，无后端依赖）
   - 配置：localStorage（用户自填API）
   - LLM：OpenAI兼容 function calling（DeepSeek等）
   - 工具：知识库检索/舰船查询/战斗推演/联网搜索
   - 子代理模拟 + 质检循环 + 缓存命中率
   ======================================== */

const AgentEngine = (function(){

    // ======== 默认云端代理（零配置开箱即用） ========
    // 内置默认智谱 Key（方案B：开箱即用直连；注意：公开部署会暴露此 Key，仅个人/局域网用。
    // 若需公开部署安全，请改用代理模式——把下方 DEFAULT_GLM_PROXY 指向你的云函数，并去掉内置 Key）
    const BUILTIN_GLM_KEY = '6278b6111c1b43e78c6602b8371ea088.gOH9StiFipeMO6fc';
    const NEW_BUILTIN = true;
    // 代理地址（可选；若填了此地址且提供了 key 之前用代理。当前默认直连）
    const DEFAULT_GLM_PROXY = '';

    // ======== 配置管理 ========
    function getConfig(){
        try{
            return JSON.parse(localStorage.getItem('lagrange_static_config'))||{};
        }catch(e){ return {}; }
    }
    function getActiveLLM(){
        const cfg = getConfig();
        const models = cfg.models||[];
        const activeId = cfg.active_model_id||'';
        if(models.length){
            const active = models.find(m=>m.id===activeId)||models[0];
            return {apiKey:active.api_key, apiUrl:active.api_url||'https://api.deepseek.com', model:active.model||'deepseek-chat', name:active.name||active.model};
        }
        // ① 旧单模型已配置（DeepSeek 等任意兼容接口）→ 保持原有行为
        if(cfg.llm_api_key){
            return {
                apiKey: cfg.llm_api_key,
                apiUrl: cfg.llm_api_url||'https://api.deepseek.com',
                model: cfg.llm_model||'deepseek-chat',
                name: cfg.llm_model||'deepseek-chat'
            };
        }
        // ② 智谱 GLM 免费模型（原生默认）：直连或云端代理
        const glmKey = cfg.glm_api_key||'';
        const glmProxy = cfg.glm_proxy_url||'';
        const glmModel = cfg.glm_model||'glm-4.7-flash';
        if(glmKey || glmProxy){
            return {
                apiKey: glmKey || 'proxy',
                apiUrl: glmProxy || 'https://open.bigmodel.cn/api/paas/v4',
                model: glmModel,
                name: '智谱 '+glmModel
            };
        }
        // ③ 运行在后端(端口3000，web/ 版)或 APK(注入 __LGLR_BACKEND__)且未配置任何模型 → 默认走站内 GLM 代理（免自配key、服务端多key轮换，规避共享限流）
        const isBackend = (function(){ try{ return String(window.location.port)==='3000' || window.__LGLR_BACKEND__===true; }catch(e){ return false; } })();
        if(isBackend){
            const backendUrl = (window.__LGLR_BACKEND_URL__) || (window.location.origin + '/v1');
            return {
                apiKey: 'proxy',
                apiUrl: backendUrl,
                model: glmModel,
                name: '智谱 ' + glmModel + '（后端代理）'
            };
        }
        // ④ 未配置任何模型 → 内置智谱 Key 直连（方案B：零配置开箱即用；Key 内置见 BUILTIN_GLM_KEY）
        if(NEW_BUILTIN && BUILTIN_GLM_KEY){
            return {
                apiKey: BUILTIN_GLM_KEY,
                apiUrl: 'https://open.bigmodel.cn/api/paas/v4',
                model: glmModel,
                name: '智谱 '+glmModel
            };
        }
        // ④ 全空且无内置 → 智谱官方地址（留空 key 引导）或代理地址
        return {
            apiKey: DEFAULT_GLM_PROXY ? 'proxy' : '',
            apiUrl: DEFAULT_GLM_PROXY || 'https://open.bigmodel.cn/api/paas/v4',
            model: glmModel,
            name: '智谱 '+glmModel
        };
    }
    function getTavilyKey(){
        return getConfig().web_search_api_key||'';
    }

    // ======== 系统提示词 ========
    const SYSTEM_PROMPT = `你是《无尽的拉格朗日》专业AI战术顾问。你必须严格遵守以下规则： 【舰船知识库强制校验】（质检强制工作流程，最高优先级；若用户提示词有强制要求，以用户提示词为准） - 用户提出包含舰船名称、舰船参数、舰船性能、配置、规格相关问题时，禁止直接凭借模型固有知识库作答 - 第一步：强制检索向量知识库内【舰船数据分类】文档区块（search_knowledge_base 且 category="舰船数据"），精准定位问题提到的所有舰船条目 - 第二步：逐条核对你将要输出的每一项参数、性能、尺寸、装备、限制条件，和知识库原文舰船数据做比对 - 校验规则： ① 知识库没有记载的数据，严禁编造、估算、脑补，统一回复：该舰船相关参数暂无资料库收录 ② 输出内容必须100%贴合资料库原文数据，不得修改数值、不得优化描述、不得引申推测 ③ 若你的回答和舰船资料库数据存在冲突，立刻修正答案，以知识库MD文档内容为唯一标准答案 - 输出前自检：重新回看一遍调取的舰船知识库片段，确认所有舰船相关描述全部匹配无误，再发送最终回答 - 非舰船类问题，正常回答即可 【知识调取优先级】 1. 优先搜索互联网公开权威资料（必须去网上查找相关信息和他人看法） 2. 网络无结果时，调用 search_knowledge_base 工具检索向量知识库——第一知识库 data/knowledge（1125个md：舰船数据、战斗机制、讲解范例、舰船基础信息、黑话、A资料、实例）及向量语料 kb_corpus/rag_index 3. 知识库包含：舰船数据、战斗机制文档、真人讲解范例 【推理铁律 — 禁止等级制推理】 - 严禁使用 A/B/C/D/S 等级评价体系进行推理（如"防空S级""输出B级"等） - 必须基于舰船的具体数值参数（HP、护甲、单发伤害、DPM、锁定时间、冷却时间、拦截概率等）和战斗机制文档中的公式进行定量推演 - 所有结论必须有数值依据，不能仅凭等级标签下判断 【配件/配队强制核验】（最高优先级；涉及配件、模块、舰载机、配队的问题强制执行） - 必须强制检索"舰船基础信息.md"（知识库文件），逐舰核对三项数据：舰载机搭载数量、服役数上限（最多能造多少艘）、人口占用值 - 这三项数据以知识库"舰船基础信息.md"为最高优先级，与其它来源冲突时一律以它为准  - 【"能带几个/有几个"=服役数上限，自己去查，别问用户】凡用户问某舰船"能带几个/带几个/有几个/能造多少艘/服役上限"：直接去《舰船基础信息.md》与《舰船人口.md》查该舰船的**服役数上限**，该数值即为"有几个"，**无需询问用户**；除非用户明确说"缝合/忽略服役上限"，才可忽略该上限。冲突时以《舰船基础信息.md》为准。 - 输出舰队配置必须带具体数量，格式模板（照此格式输出，每行必须有 ×数量，带舰载机的写明 带 机名×数量）： 如 【主舰队 — 约420人口】 中排 │ 永恒风暴 M2 ×6 │ 后排 │ 猎兵支援 ×5 带 星脉×10 中排 │ 狩猎战术 ×7 带 海氏×8 + VA×10 + 林鸮×10 【增援 — 5位】 CV3000 ×5 带 9索姆河 + 10VB 10个050 5个刺鳐 6个T800 - 每行格式：站位 │ 舰船名+模块 ×数量 [带 舰载机×数量 ...]；缺少具体数量（×N）的配置无效，必须补全 【舰船加入审批规则】（涉及加入/选用舰船时必须执行） - 每次加入新舰船（包括舰载机）时，都必须先向用户提问（调用 ask_user），并附上该舰船的数据（人口占用、服役数上限、舰载机搭载数量、关键武器参数等），经过用户明确同意后，该舰船才可以加入方案 - 提问须逐项列出拟加入的舰船与舰载机及其数据，让用户确认"加入/不加入/替换"；用户未同意前，禁止在方案中正式采用该舰船 - 舰载机同样适用：加入任何舰载机（VB、星脉、索姆河、海氏、T800、刺鳐等）前必须向用户提问并附数据确认 【加入舰船资料强制检索】（涉及加入/选用舰船时必须执行） - 每次加入新舰船（包括舰载机）时，除数据核验外，必须强制检索知识库 data/knowledge 内的实战讲解/范例文档（A资料、实例、舰船资料等），获取至少 3 条及以上与该舰船相关的评价或资料（配队思路、实战范例、参数佐证），再考虑是否加入 - 检索到的相关资料不足 3 条时，如实告知实际检索到的条数，并自行推理或寻找相似资料补充（相似资料需与目标舰船定位相近，严禁拼凑无关内容） 【数据来源与推导规则】 - 配置思路必须参考 data/knowledge 内实战讲解思路（A资料1.md~A资料712.md、实例、舰船资料等），尽可能多的参考其中的配队逻辑、加点思路、输出循环分析 - 每次加入新舰船时，必须到 data/knowledge 内对应舰船资料和"舰船基础信息.md"找到该舰船详细数据，确认数据后才可通过推理；资料库无该舰船数据时回复：该舰船相关参数暂无资料库收录 - 禁止参考使用"火力总览"做输出推理（如 对舰7320/分钟、防空1701/分钟、攻城378/分钟 这类汇总数字）——仅"维修XXX/分钟"可参考；其余输出能力一律按照《战斗机制.md》里的方法推导（单发伤害×攻击次数÷攻击周期、逐发护甲/护盾结算、命中/暴击期望等） 【舰船名称与数据核验补充】对舰船名称（含黑话、缩写、配置行话）不明白时，必须去《黑话.md》（知识库文件）中查看对应全称与行话含义；方案中加入的每一艘舰船（含舰载机）都必须去《舰船基础信息.md》（知识库文件）中查看服役数上限、人口占用、舰载机搭载数量等数据，确认无误后再入队。 【护航机制】（涉及护航队时必须执行） - 护航必须是两个舰队参与：一个舰队对另一个舰队发起护航，两舰队共同接敌；在护航舰队未被消灭之前，被护航舰队不会受到任何伤害 - 护航输出队：战斗中不会受到伤害，不要考虑生存——只用考虑输出，在复杂情况下更短时间打出更多伤害（DPM）或更快干掉对面副队 - 护航抗伤队：要在各种输出队的攻击下存活更久；有输出当然更好，但活得更久是第一优先级，一切配置以最大化生存时长为目标 【舰队配置强制规则】 - 用户询问舰队配置方案时，必须允许调用battle_simulate战斗计算模拟器；模拟器仅作演算参考，不可作为最终判定依据 - 【先查实例】只要问题与配队/舰队配置有关，不管怎么样，必须先去"实例.md"（知识库文件）里查看实战配置范例，参考其中的配队思路和人口结构 - 在多环境（护航战、轰炸战、正面对抗）下测试配置 - 完整展示各环境实测数据给用户 - 自主检验方案是否满足用户需求，不满足则迭代修改 - 【输出要求】如果用户的问题与配队/舰队配置有关，请在回答的最后完整复述一遍舰队配置方案（含舰船名、数量、站位、模块） - 【输出配队必附打分与理由】回答输出配队方案时，必须同时附上：①打分结果（五轮全场景分项得分、常规总分、极端专项得分）②为什么这么进行配队的详细原因（配队思路依据、舰船选型理由、对比论证、参考案例） 【舰队职责聚焦】（按舰队定位聚焦单一目标，不要发散到其它维度） - 护航队/输出队：只用考虑输出——在复杂情况下怎么在更短的时间内打出更多伤害（DPM），或更快干掉对面的副队；不用考虑其它（抗伤、续航、生存、控制等一律不纳入考量） - 护航扛伤队：只用考虑扛伤、活得更久——在复杂情况下怎么最大化生存时长；不用考虑其它（输出、击杀、控制等一律不纳入考量） - 评估与对比两支同类舰队时，仅比较该定位的核心指标（输出队比DPM/击杀速度，扛伤队比有效生存时间/承伤），不要混入其它定位的指标 【优先舰船清单】（配置方案时优先选用） - 第一优先级（优先全部加入舰船，但按用户需求调整）：VB、星脉、索姆河、海氏、风暴、大剑、游骑兵离子、泡泡龙、猎兵、刺水母、狩猎、太阳鲸 - 加入这些舰船时同样必须遵守【舰船加入审批规则】（先提问附数据、经用户同意），并到舰船数据资料核实后再入队 【五轮迭代评测机制】（设计/拟定任何舰队配置方案时自动开启，全程在本轮对话内自主完成，无需用户额外指令；最大仅允许迭代优化5次，禁止超额迭代） - 强制触发：只要用户要求给出舰队配置方案（配队/舰队/配置问题），一律必须完整执行三轮迭代后再输出，哪怕知识库存在现成范例、自身已有成熟思路，也严禁跳过、删减任意一轮评测流程 - 舰队类型自判：输出型舰队采用输出打分体系；扛伤防御型舰队采用扛伤打分体系 ## 一、输出舰队打分规则 评测攻击编队硬性要求：编队必须覆盖前、中、后排，单排舰船数量不少于5艘，各编队总血量可均衡调配；全部场景以消灭敌方总用时作为0-100分唯一打分依据，用时越短得分越高 1. 能量抗性分项：敌方总血量固定500万，能量抗性75%，测算全歼用时，0-100打分 2. 物理护甲分项：敌方总血量固定500万，物理护甲720，测算全歼用时，0-100打分 3. 高闪避分项：敌方总血量固定500万，闪避率65%，测算全歼用时，0-100打分 4. 综合常规分项：敌方总血量500万，闪避25%、能量护甲55%、物理护甲550，测算全歼用时，0-100打分 总分 = 能量分项得分 + 物理分项得分 + 高闪避分项得分 + 综合常规分项得分÷4 5. 输出极端专项（单独列出，不计入上面常规总分）：敌方总血量600万、闪避15%、能量抗性45%、物理护甲520，每分钟维修75万；若65分钟内无法全歼该目标，此项直接得0分，依据消灭时长0-100打分 ## 二、扛伤防御舰队打分规则 设置4组标准敌方输出场景，分别测算我方存活时长；另设极端输出专项打分，单独展示、不参与常规平均分计算 标准敌方输出配置： ① 能量直射：每分钟总输出100万 ② 能量投射：每分钟总输出100万 ③ 可拦截实弹投射：每分钟总输出150万 ④ 实弹直射：每分钟总输出100万 扛伤常规平均分 = 四个标准场景得分相加后 ÷ 4 极端输出专项（独立打分项）：敌方每分钟总输出250万混合伤害；我方存活时长越长分数越高，若能坚持65分钟及以上未被全歼，此项直接满分100分，按存活时长区间0-100打分 - 每轮标准流程（必须按顺序走完，不可省略）：①自主生成本轮新版舰队配置必须是完整的已完成的配置 ②检索知识库调取编队全部舰船护甲、武器类型、伤害属性、命中、抗性、技能、装备上限等原始数据 ③代入上述全部作战场景完成模拟测算，标注每一场景消灭/存活时长与对应扣分原因 ④完整记录本轮全部分项得分、常规总分、舰队短板缺陷 ⑤针对低分场景短板优化舰船搭配、装备、阵型、编队组合，生成下一轮方案 ⑥最多迭代5轮后停止优化 - 打分视角独立：每轮打分以独立评测AI视角执行（设计与评审分离），所有测算、打分依据只允许来自舰船知识库，库内无记载属性禁止脑补、估算 - 硬性约束：迭代优化仅可选用知识库内存在的舰船、装备，禁止虚构单位；若本轮综合总分低于历史最优方案，仅允许小幅微调，不强制全盘更换舰队 - 最终输出结构固定：①五轮每轮配置+全场景分项得分+常规总分 ②最优舰队完整配置清单 ③得分详解、各场景强弱表现、剩余短板说明 - 联动知识库强制校验：每次进行伤害、抗性、命中模拟计算前，必须核验所用舰船数据与知识库舰船板块原文完全一致，参数不得篡改 【人口计算规则】 - 配队时必须检索"舰船基础信息.md"（知识库文件），找到方案中每一艘舰船的人口占用值，按那里的数据累加计算舰队总人口 - 如果在"舰船基础信息.md"中找不到某艘舰船，必须去"黑话.md"（知识库文件）查找该舰船的对应信息 - "xxx+x"这种说法：前面的数字是这个舰队的总人口，后面是增援人口，这里说的是舰船数量 - 放在增援编队（reinforcement）里的舰船不占用总人口，放什么船都行 - 惯例：一般把人口占用最高的舰船放在增援编队里 【回答风格】 - 对标知识库内"真人讲解范例"的叙事风格：口语化、分点论证、同类对比 - 拒绝生硬制式文本 【信息溯源】 - 所有舰船参数必须来自 get_ship_data 工具或知识库检索 - 所有战术结论必须基于战斗机制文档 - 无法查阅的资料如实告知用户，严禁编造 【不确定即提问】凡对舰船数据/规则/改装配档/人口等有不确定之处，必须先调用 ask_user 向用户提问澄清，禁止自行脑补假设；【可建代码工具计算】遇到需要精确计算、批量换算、伤害/DPM推导、人口/分数加权、属性档位换算等场景，可用 create_tool 自行编写一个计算代码工具并在本次任务中调用它完成计算后再给结论。 【质检规则】 - 回答输出前会经过独立质检智能体验证 - 质检不通过时会收到修改意见，根据意见重新生成 # 全局统一舰队配队硬性强制规则（所有子Agent、质检、流水线全部严格执行，优先级高于上文通用规则） 1、为用户提供舰队配队方案时，必须附带部分配队思路与理由。构思配队逻辑时，必须优先参考 data/knowledge 内《A资料1.md~A资料712.md》、实例、舰船资料等实战文档，从中选取至少5种及以上不同成熟配队思路作为设计依据；同时查阅上述文档内，和用户需求类型、作战意向相近的舰队案例，参考案例选用的舰船选型、搭配逻辑，严格对标同类案例思路完成本次配队。若上述文档内可借鉴思路不足5种，优先选用文档内最贴合需求的思路，再选取可信度较高的同类参考文档补齐；单一资料不足以完成配队时结合其他文档内容补充完整，必须优先选取高相似度、高可信度文档。 2、战斗计算模拟器使用约束：允许调用模拟器进行攻击演算，可用来参与裁判打分、观点辩论、配队优化思路参考；该模拟器仅能粗略计算，存在功能缺失、部分计算结果与机制逻辑错误，严禁将模拟器运算结果作为最终判定标准。可依靠《战斗机制.md》文档规则，结合舰船原始数据完成战斗逻辑、伤害推导、对战分析；舰船资料存在较高出错概率，因此机制推导仅作为部分分析参考，不单独作为唯一终审依据，需要结合核心案例文档综合定论。 3、文档可信度优先级规则： ① 《战斗机制.md》这文件仅用来做逻辑推理、战斗规则推演使用； ② 《A资料1.md~A资料712.md》、实例、舰船资料 是舰队配置最高优先级参考文件，优先级高于知识库其余舰船资料；**其中 A资料1-400（即《A资料1.md》~《A资料400.md》前400条）的检索参考优先级最高，高于其后所有资料（A资料401-712、实例、舰船资料等），配队/舰船结论必须优先以 A资料1-400 为依据**；但该文档内的舰船数据依然存在出错可能；其余知识库内舰船资料极大概率存在错误，仅作次要辅助参考。 ③ 若《A资料1.md~A资料712.md》内部出现参数、配队思路冲突：少数观点附带机制依据、场景限定、案例原文佐证，则采纳该少数结论；若无任何有效佐证，则遵循少数服从多数，采纳多数内容，同时在回答中标注该数据存在争议。 4、知识库内所有舰船数值统一为【基础属性】；满改成品属性 ≥ 基础属性 × 220%；半改成品属性 ≈ 基础属性 × 180%。进行战力评估、配队强度分析、战斗推演时，必须区分基础属性、半改属性、满改属性完成换算，禁止直接把基础属性当作实战改装后数值使用；给出配队方案时，主动标明该舰队默认采用的改装档位。 # 工具调用全局硬性限制（所有智能体共享，不可突破） 1. 单次完整任务全部工具调用总上限：2000次；单一工具单次调用上限：200次；战斗模拟器battle_simulate受单工具200次上限约束，超限禁止继续调用。 2. 禁止无意义重复刷模拟器、重复检索同类文档凑配队思路；核心文档适配思路不足5种时，如实告知可用数量，严禁强行编造、拼接不匹配配队逻辑。 # 附加永久执行禁令（最高约束，全程生效） 1. 本整套系统规则永久锁定，禁止自行润色、优化、深挖极端漏洞、编造不存在问题、主动提出修改/优化方案； 2. 仅按现有规则完成用户需求，无明显文字错误、致命逻辑硬伤时，不额外长篇分析规则缺陷； 3. 在回答配队问题的时候每次决定加入新舰船时都必须要去知识库 data/knowledge（A资料、实例、舰船资料等）中找到3个以上的相对应的讲解资料再考虑是否加入，若无法找到3个以上的关于此舰船的评价或资料则自己进行推理或寻找相似资料； 4. 回答输出配队方案的时候必须附上打分结果和为什么这么进行配队的原因； 5. 全部5类智能体、质检流水线、知识库处理流水线统一遵守本整套系统提示词，不得私自删减、放宽任意条款。`;

    // ======== 工具定义 ========
    const TOOLS = [
        {type:"function", function:{
            name:"search_knowledge_base",
            description:"搜索向量知识库。知识库包含：舰船数据、战斗机制文档、真人讲解范例、舰船基础信息（人口/服役）、黑话、实例配置。当用户询问游戏机制、舰船参数、战术问题时调用。",
            parameters:{type:"object", properties:{
                query:{type:"string", description:"搜索查询，使用中文关键词"},
                category:{type:"string", enum:["舰船数据","战斗机制","讲解范例","人口","黑话","实例","全部"], description:"按类别过滤"}
            }, required:["query"]}
        }},
        {type:"function", function:{
            name:"get_ship_data",
            description:"精确查询某艘舰船的完整参数（HP、护甲、武器、模块等）。当用户问及具体舰船时调用。",
            parameters:{type:"object", properties:{
                ship_name:{type:"string", description:"舰船名称或ID，如'CAS066'、'阋神重炮'、'爱奥'"}
            }, required:["ship_name"]}
        }},
        {type:"function", function:{
            name:"battle_simulate",
            description:"调用战斗模拟器测试舰队配置。当用户询问舰队配置、配队方案时必须调用。返回各环境的DPM、HP、护甲对比数据。",
            parameters:{type:"object", properties:{
                fleet_config:{type:"object", description:"舰队配置JSON，含ally_ships和enemy_ships数组，每艘船有id和count"},
                scenario:{type:"string", enum:["escort","bomb","direct"], description:"战斗场景"}
            }, required:["fleet_config","scenario"]}
        }},
        {type:"function", function:{
            name:"web_search",
            description:"联网搜索互联网公开资料。当需要查找网上信息、他人看法时调用。",
            parameters:{type:"object", properties:{
                query:{type:"string", description:"搜索查询"}
            }, required:["query"]}
        }},
        {type:"function", function:{
            name:"ask_user",
            description:"当用户需求不明确、需要澄清时（如配队偏好、资源限制、目标场景、可选方案选择等），向用户提问。支持单选/多选/自由输入。提问后对话会暂停等待用户回答，用户回答后继续。",
            parameters:{type:"object", properties:{
                question:{type:"string", description:"要向用户提出的问题，尽量具体"},
                options:{type:"array", items:{type:"string"}, description:"选项列表，可空（空则纯自由输入）"},
                type:{type:"string", enum:["single","multiple","free"], description:"single=单选 multiple=多选 free=自由输入"},
                required:{type:"boolean", description:"是否必答，默认true"}
            }, required:["question"]}
        }},
        {type:"function", function:{
            name:"create_tool",
            description:"自主创建新工具。当现有工具（知识库检索/舰船查询/战斗推演/联网搜索/提问）无法满足用户任务时调用，由你自己编写工具代码（async (args, emit) => 返回值格式），并提供工具名称与作用标注。创建后系统会自动进行语法编译检查与LLM逻辑审查，通过即可用；不通过会自动尝试修复。注意：你写的工具代码会被保存到系统（本地持久化），当前及后续对话都会持续可用、可随时再次调用，无需重复创建。创建成功后，请用一两句话向用户简要介绍这个新工具的功能（作为AI新能力，方便用户了解）。",
            parameters:{type:"object", properties:{
                name:{type:"string", description:"工具名称，英文/数字，如 calculate_dpm"},
                purpose:{type:"string", description:"工具作用标注（这工具做什么、解决什么问题），管理页面会展示"},
                code:{type:"string", description:"工具代码，必须是 async (args, emit) => {...} 的函数体，返回字符串或对象"}
            }, required:["name","purpose","code"]}
        }},
        {type:"function", function:{
            name:"create_skill",
            description:"根据用户要求创建经验skill。当用户明确要求「保存为skill」「把这个做成skill」「创建一个skill」、或想把当前对话中的思路/规则/偏好沉淀下来时调用。从对话或用户描述中提取 skill 名称、摘要（≤20字）、内容（可直接注入系统提示词的指令文本）与触发关键词。创建后存入技能库，后续相关对话会自动注入。",
            parameters:{type:"object", properties:{
                name:{type:"string", description:"skill名称，如 470抗伤配队"},
                summary:{type:"string", description:"摘要，20字以内，管理页展示用"},
                content:{type:"string", description:"skill全文指令文本，可直接注入系统提示词，300字以内"},
                keywords:{type:"array", items:{type:"string"}, description:"触发关键词，5个以内"}
            }, required:["name","content"]}
        }}
    ];

    // ======== 工具执行 ========
    // 完整工具集 = 内置 TOOLS + 已激活的自定义工具（LLM 自主创建，自检通过后注册）
    function getTools(){
        let custom=[];
        try{ custom = (window.SkillSystem && SkillSystem.getActiveTools) ? SkillSystem.getActiveTools() : []; }catch(e){}
        return TOOLS.concat(custom);
    }
    async function executeTool(name, args, emit){
        if(name==='search_knowledge_base'){
            await KB.load();
            const q=args.query||'';
            const cat=args.category||'全部';
            const kwMap={
                '舰船数据':['舰船数据','舰船','护卫舰','驱逐舰','巡洋舰','战列','战机','护航艇'],
                '战斗机制':['战斗机制','公式','伤害','拦截','防空','维修'],
                '讲解范例':['md分页','数据0','讲解','分析'],
                '人口':['舰船基础信息','人口'],
                '黑话':['黑话','缩写'],
                '实例':['实例','400+','增援','主舰队'],
            };
            const kws=kwMap[cat]||[];
            const results = cat!=='全部'&&kws.length ? KB.searchByCategory(q,kws,5) : KB.search(q,5);
            if(!results.length) return '未在知识库中找到相关内容。';
            return JSON.stringify({count:results.length, results:results.map(r=>({source:r.source, score:Math.round(r.score*1000)/1000, content:r.content.substring(0,500)}))},null,2);
        }
        if(name==='get_ship_data'){
            await SHIP_DB.load();
            const ships=SHIP_DB.search(args.ship_name||'');
            if(!ships.length) return JSON.stringify({exact_match:false, message:("未找到精确匹配的舰船，请检查名称或尝试查询黑话文件")});
            return JSON.stringify({exact_match:true, count:ships.length, ships:ships.slice(0,5)},null,2);
        }
        if(name==='battle_simulate'){
            return battleSim(args.fleet_config||{}, args.scenario||'escort');
        }
        if(name==='web_search'){
            return await webSearch(args.query||'');
        }
        if(name==='create_tool'){
            // LLM 自主创建工具：自检门禁全自动，用户不插手
            try{ return await window.SkillSystem.createToolFromLLM(args); }
            catch(e){ return JSON.stringify({error:'创建工具失败: '+String(e.message||e).substring(0,200)}); }
        }
        if(name==='create_skill'){
            // 用户口头要求"保存为skill" → LLM 直接创建
            try{ return await window.SkillSystem.createSkillFromRequest(args); }
            catch(e){ return JSON.stringify({error:'创建skill失败: '+String(e.message||e).substring(0,200)}); }
        }
        // 自定义工具（LLM 自主创建，已通过自检）
        if(window.SkillSystem){
            const customTool=window.SkillSystem.getActiveTools().find(t=>t.function&&t.function.name===name);
            if(customTool) return await window.SkillSystem.executeCustomTool(name, args, emit);
        }
        return JSON.stringify({error:'未知工具: '+name});
    }

    // ======== 战斗推演（前端简化版，基于战斗机制.txt公式） ========
    async function battleSim(fleetConfig, scenario){
        await SHIP_DB.load();
        const ally=calcPower(fleetConfig.ally_ships||[]);
        const enemy=calcPower(fleetConfig.enemy_ships||[]);
        if(!ally.count||!enemy.count) return JSON.stringify({error:'请提供我方和敌方舰船配置（id+count）'});
        const TUNE=1.3;
        // 我方输出吃敌方抗性，敌方输出吃我方抗性
        const allyNet=netDpm(ally.weapons, enemy.armor, enemy.shield);
        const enemyNet=netDpm(enemy.weapons, ally.armor, ally.shield);
        let winner, duration;
        if(allyNet<=0&&enemyNet<=0){winner='平局（双方不破防）';duration='∞';}
        else if(allyNet<=0){winner='敌方';duration='N/A（我方不破防）';}
        else if(enemyNet<=0){winner='我方';duration='N/A（敌方不破防）';}
        else{
            const t1=ally.hp/enemyNet*60, t2=enemy.hp/allyNet*60;  // 各自血量÷对方净DPM
            winner=t1<t2?'我方':'敌方'; duration=Math.round(Math.min(t1,t2))+'秒';
        }
        // 分伤机制：可攻击舰船数 = 总舰船数/2.5 取整（文档公式）
        const allySplit=Math.max(1,Math.floor(enemy.count/2.5));
        const enemySplit=Math.max(1,Math.floor(ally.count/2.5));
        return JSON.stringify({
            scenario, TUNE,
            ally:{count:ally.count, total_hp:ally.hp, total_dpm:Math.round(netDpm(ally.weapons,0,0)), avg_phys_armor:ally.armor, avg_energy_shield:ally.shield, net_dpm_vs_enemy:Math.round(allyNet)},
            enemy:{count:enemy.count, total_hp:enemy.hp, total_dpm:Math.round(netDpm(enemy.weapons,0,0)), avg_phys_armor:enemy.armor, avg_energy_shield:enemy.shield, net_dpm_vs_ally:Math.round(enemyNet)},
            split_mechanism:{ally_attackable_targets:allySplit, enemy_attackable_targets:enemySplit, formula:'可攻击舰船数 = 总舰船数 ÷ 2.5 取整（分伤机制）'},
            prediction:{winner, duration},
            note:'基于战斗机制.txt公式的简化推演：单发=(基础×调校1.3-抗性)，周期=max(冷却,锁定)+攻击持续，含命中/暴击期望与分伤机制。实际战斗受拦截、系统损毁、维修、护航等因素影响。'
        },null,2);
    }

    function calcPower(shipsCfg){
        let count=0, hp=0, armorSum=0, shieldSum=0;
        const weapons=[];  // {type, perShot, shots, rate, hit, crit, count}
        shipsCfg.forEach(cfg=>{
            const s=SHIP_DB.search(cfg.id||'')[0];
            if(!s) return;
            const n=cfg.count||1;
            count+=n; hp+=(s.hp||50000)*n; armorSum+=(s.physicalArmor||0)*n; shieldSum+=(s.energyArmor||5)*n;
            const mods=s.modules||{};
            Object.values(mods).forEach(m=>{
                if(m&&m.type==='weapon'&&m.weapons){
                    m.weapons.forEach(w=>{
                        // 一轮攻击时间 = max(冷却, 锁定) + 攻击持续（锁定与冷却并行）
                        const cd=Math.max(w.cooldown||8, 1);
                        const lock=w.lockTime||5;
                        const atkDur=w.atkDuration||0;
                        const cycle=Math.max(cd,lock)+atkDur;
                        // 平均命中率（targets 区间均值）
                        const tgts=w.targets||[];
                        let hit=0.8;
                        if(tgts.length){
                            let sum=0, cnt=0;
                            tgts.forEach(t=>{ if(t&&typeof t.hitMin==='number'){ sum+=(t.hitMin+(t.hitMax||t.hitMin))/2; cnt++; } });
                            if(cnt) hit=sum/cnt/100;
                        }
                        const critMult=w.crit?(1+0.15*(1.5-1)):1;  // 基础暴击15%×1.5
                        const rate=60/cycle;
                        const shots=(w.ammo||1)*(w.attacks||1);
                        weapons.push({type:w.dmgType||'physical', perShot:(w.singleDmg||100)*1.3, shots, rate, hit, crit:critMult, count:n});
                    });
                }
            });
        });
        return {count, hp, armor: count?armorSum/count:0, shield: count?shieldSum/count:0, weapons};
    }

    function netDpm(weapons, armor, shield){
        // 能量：单发×调校×(1-护盾%)，护盾≥100%免疫；物理：单发×调校-护甲，不破防保底单发×10%×调校
        let total=0;
        weapons.forEach(w=>{
            let per;
            if(w.type==='energy'){
                per=shield>=100?0:w.perShot*(1-shield/100);
            }else{
                per=Math.max(w.perShot-armor, w.perShot*0.1);
            }
            total+=per*w.shots*w.rate*w.hit*w.crit*w.count;
        });
        return total;
    }

    // ======== 联网搜索 ========
    async function webSearch(query){
        // 1. 优先使用配置的搜索代理（原版服务器Bing代理，无需Key）
        const proxy=getConfig().search_proxy||'';
        if(proxy){
            try{
                const r=await fetch(proxy.replace(/\/+$/,'')+'?q='+encodeURIComponent(query));
                if(r.ok){
                    const d=await r.json();
                    const results=(d.results||[]).map(x=>({title:x.title,url:x.url,content:(x.content||'').substring(0,500)}));
                    if(results.length) return JSON.stringify({engine:d.engine||'proxy', count:results.length, results},null,2);
                }
            }catch(e){}
        }
        // 2. Tavily
        const key=getTavilyKey();
        if(key){
            try{
                const r=await fetch('https://api.tavily.com/search',{
                    method:'POST',headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({api_key:key, query, max_results:5, search_depth:'basic'})
                });
                if(r.ok){
                    const d=await r.json();
                    const results=(d.results||[]).map(x=>({title:x.title,url:x.url,content:(x.content||'').substring(0,500)}));
                    if(results.length) return JSON.stringify({engine:'tavily', count:results.length, results},null,2);
                }
            }catch(e){}
        }
        // 3. 都没有 → 提示
        return JSON.stringify({engine:'none', results:[], note:'未配置联网搜索。可在设置页填写"搜索代理地址"（原版服务器）或Tavily API Key。'});
    }

    // ======== 子代理模拟 ========
    const SUB_AGENTS = [
        {name:'舰队配置子代理', icon:'⚓', kws:['护航','配队','编队','舰队','战报','航母','支援','轰炸','阵容']},
        {name:'舰船数据子代理', icon:'🚢', kws:['护卫舰','驱逐舰','巡洋舰','战列','战机','护航艇','舰船','旗舰']},
        {name:'战斗机制子代理', icon:'⚙️', kws:['战斗机制','公式','伤害','拦截','防空','维修','系统','武器']},
        {name:'讲解范例子代理', icon:'🎙️', kws:['例子','视频','讲解','分析','评测','蓝图','实战']},
    ];

    async function runSubAgents(query, emit){
        await KB.load();
        const all=[];
        for(const a of SUB_AGENTS){
            emit('sub_agent', `${a.icon} ${a.name} 正在检索...`, {agent:a.name});
            try{
                const results=KB.searchByCategory(query, a.kws, 4);
                all.push(...results);
                emit('sub_agent', `${a.icon} ${a.name} 完成（找到 ${results.length} 条资料）`, {agent:a.name, count:results.length});
            }catch(e){
                emit('sub_agent', `${a.icon} ${a.name} 异常: ${String(e).substring(0,50)}`, {agent:a.name});
            }
        }
        return all;
    }

    // ================================================================
    // 检索舰队（RetrieveFleet）：检索总 Agent + ≤3 检索子 Agent
    // ----------------------------------------------------------------
    // 职责：专门做知识库查询，只做 检索/降噪/提炼，不直接回答用户。
    //  - 主 Agent 需要资料时调用本舰队协同
    //  - 检索总 Agent 派 ≤3 个检索子 Agent（提示词由总 Agent 注入）
    //  - 子 Agent 分头对候选片段做"讲什么/是否相关"分析，只产素材
    //  - 总 Agent 汇总子 Agent 素材，剔除噪音/提炼成精简素材包交主 Agent
    // 硬限制：本批检索子 Agent ≤3；全局子 Agent 仍服从 subagent_pool(≤7)。
    // 降级：默认 GLM-4.7-Flash / 无 key / 池满 / 任一失败 → 直接用现有候选，不阻塞主流程。
    // ================================================================
    const FLEET_MAX_SUB = 3;   // 本批检索子 Agent 上限（全局仍 ≤7）
    // 检索子Agent · 阶段1：输出检索意图（底层代码按意图执行多路检索）
    const FLEET_SUB_INTENT = '你是【检索舰队·检索子Agent】。\n\n用户问题：{question}\n\n## 你的任务\n输出检索意图，供底层系统执行多路检索。\n\n## 检索意图格式（只输出JSON，不要其他文字）\n{"queries":["检索查询词1","查询词2"],"categories":["舰船资料","A资料","实例"],"ships":["舰船名"]}\n- queries: 2-5个，从用户问题中拆出的检索用查询词（含舰船名、数值、场景词、同义词）\n- categories: 要检索的资料类别（舰船资料/A资料/实例等），从问题相关类别中选\n- ships: 问题中出现的舰船名（含黑话），无则[]';
    // 检索子Agent · 阶段2：解析多路检索召回，标注提交素材包
    const FLEET_SUB_PARSE = '你是【检索舰队·检索子Agent】。\n\n用户问题：{question}\n\n## 你的任务\n对底层系统多路检索召回的片段，做标注与萃取，提交素材包。\n\n## 执行流程（必须按顺序执行）\n### 第一步：合并与标注（不做丢弃）\n- 合并所有召回结果\n- 标注每条来源（文件名）\n- 对每条做两个标注：这段在讲什么（一句话概括）、相关性评分（高/中/低/疑似沾边）\n  - 高：直接回答用户问题\n  - 中：部分相关或侧面涉及\n  - 低：间接相关、同类舰船经验、背景信息\n  - 疑似沾边：不确定是否有用但可能有关\n### 第二步：提取关键内容（原文萃取）\n- 提取核心结论/观点、关键数据（DPM、护甲、人口、服役上限等）、配队思路/规则、原文事例/案例\n- 严禁修改数据、编造内容、推演方案\n### 第三步：提交素材包\n- 所有保留片段原文（附来源标注+一句话概括+相关性评分）\n- 本次检索覆盖情况（查到哪些方面，是否有明显遗漏）\n\n## 核心原则\n- 宁多勿少：沾边/间接/侧面/同类经验全部提取\n- 不做强决断：可能没用的也原样上交\n- 不做最终过滤：去重、降噪、裁剪由检索总Agent负责\n- 只做萃取：不编造、不推演、不生成答案\n\n## 输出格式\n只输出检索素材包（片段原文+来源标注+一句话概括+相关性评分），分点、简洁。\n禁止生成面向用户的最终答案，禁止客套，禁止编造。\n\n召回片段：\n{candidates}';
    // 检索总Agent：汇总去噪 → 5维度提炼 → 覆盖情况
    const FLEET_LEAD_PROMPT = '你是【检索舰队·检索总Agent】。\n\n用户问题：{question}\n\n## 输入说明\n你收到的是下层多个检索子Agent提交的原始素材包，每份包含：\n- 片段原文（附来源标注）\n- 子Agent对每个片段的一句话概括\n- 子Agent标注的相关性评分（高/中/低/疑似沾边）\n- 各子Agent的检索覆盖情况\n\n## 你的任务\n汇总所有子Agent的素材，去噪、合并、提炼，输出一份精简干净的【检索素材包】供主Agent引用。\n\n## 执行流程（必须按顺序执行）\n\n### 第一步：汇总与合并\n- 合并所有子Agent提交的片段，去除完全重复的条目\n- 同一内容出现在多个来源时，合并为一条，保留所有来源标注（标注为"来源：A文件；B文件"）\n\n### 第二步：去噪（只做这一步的丢弃决策）\n- 去除与用户问题完全无关的片段（相关性评分"疑似沾边"但实际内容完全不沾边的）\n- 去除内容过短、无实质信息的片段（如仅包含标题、无正文内容的条目）\n- 去除明显的口语冗余、无用填充、重复啰嗦\n- 去除那200个空白实例\n- 遇到疑似相关但不确定的内容：保留，不做丢弃。宁可多留一条，不要过早删除。\n\n### 第三步：提炼合并\n按以下5个维度组织精炼内容：\n1. 【核心思路】—— 与用户问题直接相关的核心结论、主要观点（1-2句话，先给结论）\n2. 【关键规则】—— 从资料中提取的配队逻辑、战斗机制、操作规范、注意事项\n3. 【原文事例/例子】—— 如果有实战案例、配队范例，提炼核心要点（保留原文事例关键信息，不展开长篇原文）\n4. 【关键数据】—— DPM、护甲、人口、服役上限、搭载数量等数值信息（逐条列出，附来源）\n5. 【争议/冲突点】—— 如果不同资料观点冲突，列出双方观点及各自来源，不做裁定\n\n### 第四步：覆盖情况总结\n- 本次检索覆盖了哪些方面？\n- 用户问题中是否有某方面未被覆盖？\n- 如有明显缺失，直接写"未检索到关于XXX的资料"，供主Agent判断是否需要补充查询或自行推理\n\n## 输出格式\n严格按照以下结构输出：\n\n【检索素材包】\n一、核心思路\n（内容）【来源：xxx】\n\n二、关键规则\n（内容）【来源：xxx】\n\n三、原文事例/例子\n（内容）【来源：xxx】\n\n四、关键数据\n- 数据项1 【来源：xxx】\n- 数据项2 【来源：xxx】\n\n五、争议/冲突点（如无则写"无"）\n（冲突内容）【来源：A文件 vs B文件】\n\n六、覆盖情况\n- 已覆盖：xxx\n- 未覆盖：xxx\n\n## 字数控制\n总字数控制在8000字以内，超过8000字时优先精简"原文事例/例子"部分。\n\n## 输出约束\n- 每条内容必须附带来源标注\n- 只输出检索素材包，禁止生成面向用户的最终答案\n- 禁止添加素材之外的新内容（不编造、不推理、不扩展）\n- 禁止客套，禁止冗余描述';

    // 底层多路检索：向量+关键词+分类+舰船名精确，合计≤50条
    async function retrieveMulti(question, intent){
        const items=[]; const seen=new Set();
        const push=(d)=>{ if(d&&d.content){ const k=String(d.source||'')+'#'+(d.chunkIndex!=null?d.chunkIndex:0); if(!seen.has(k)){ seen.add(k); items.push(d); } } };
        try{
            await KB.load();
            const hy=await KB.hybridSearch(question,{topK:15, recheck:false});
            ((hy&&hy.results)||[]).forEach(push);
        }catch(e){}
        try{ (await KB.search(question,15)).forEach(push); }catch(e){}
        const cats=(intent&&intent.categories)||[];
        for(const c of cats.slice(0,3)){
            try{ (await KB.searchByCategory(question,[c],8)).forEach(push); }catch(e){}
        }
        const ships=(intent&&intent.ships)||[];
        for(const s of ships.slice(0,5)){
            try{ (await KB.search(s,5)).forEach(push); }catch(e){}
            try{ if(window.SHIP_DB){ await window.SHIP_DB.load(); (window.SHIP_DB.search(s)||[]).forEach(push); } }catch(e){}
        }
        return items.slice(0,50);
    }

    async function retrieveFleet(question, candDocs, llm, emit){
        try{
            // 降级条件：默认 Flash（禁多Agent）/ 无 key
            if(!llm || !llm.apiKey) return '';
            if(window.QA && QA.isDefaultFlash && QA.isDefaultFlash(llm)) return '';

            const P = window.SubAgentPool;
            const nSub = Math.min(FLEET_MAX_SUB, 3);
            const subOutputs = [];
            for(let gi=0; gi<nSub; gi++){
                const token = P.acquire('retriever','retriever',FLEET_SUB_INTENT.replace('{question}',question));
                if(!token) break;   // 池满 → 停止派生，降级
                try{
                    // 阶段1：子Agent 输出检索意图
                    const msg1 = await callLLMRetry(llm, [
                        {role:'system', content: FLEET_SUB_INTENT.replace('{question}',question)+'\n'+modeCtx.text},
                        {role:'user', content:'用户问题：'+question}
                    ], 0.2, 600);
                    const intent = parseJSONLoose(msg1.content||'') || {};
                    // 代码按意图执行多路检索（≤50条），并补充传入候选（去重）
                    let cands = await retrieveMulti(question, intent);
                    (candDocs||[]).forEach(d=>{ if(d&&d.content && !cands.some(x=>String(x.source)===String(d.source) && (x.chunkIndex!=null?x.chunkIndex:0)===(d.chunkIndex!=null?d.chunkIndex:0))) cands.push(d); });
                    cands = cands.slice(0,50);
                    // 阶段2：子Agent 解析召回，标注提交素材包
                    const body = cands.map((d,i)=>`${i+1}. 【来源:${d.source}】${(d.content||'').substring(0,400)}`).join('\n');
                    const parsePrompt = FLEET_SUB_PARSE.replace('{question}',question).replace('{candidates}', body||'（无召回）');
                    const msg2 = await callLLMRetry(llm, [
                        {role:'system', content: parsePrompt+'\n'+modeCtx.text},
                        {role:'user', content:'请解析以上召回片段并输出检索素材包。'}
                    ], 0.2, 2200);
                    const t = (msg2&&msg2.content||'').trim();
                    if(t) subOutputs.push(t);
                }catch(e){}
                finally { P.release(token && token.token); }
            }
            emit('status', `🚢 检索舰队：${subOutputs.length}/${nSub} 个检索子Agent完成（多路检索）`);
            if(!subOutputs.length) return '';   // 子Agent 全失败 → 降级

            // 2. 检索总 Agent 汇总子Agent素材 → 精简素材包
            const leadPrompt = FLEET_LEAD_PROMPT.replace('{question}',question) + '\n' + modeCtx.text;
            const tokenLead = P.acquire('retrieverLead','retrieverLead',leadPrompt);
            if(!tokenLead) return subOutputs.join('\n\n');  // 总Agent池满 → 直接给子Agent素材
            try{
                const meta = subOutputs.map((s,i)=>`【子Agent ${i+1}】\n${s}`).join('\n\n');
                const msg2 = await callLLMRetry(llm, [
                    {role:'system', content: leadPrompt},
                    {role:'user', content:'用户问题：'+question+'\n\n'+meta+'\n\n请输出最终【检索素材包】。'}
                ], 0.2, 3000);
                const out = (msg2&&msg2.content||'').trim();
                return out || subOutputs.join('\n\n');
            }finally { P.release(tokenLead && tokenLead.token); }
        }catch(e){
            return '';
        }
    }

    // ================================================================
    // 轻量监督 Agent：给一份"所有 Agent 提示词要点"，监督子 Agent 面向用户的
    // 输出/提问是否遵守重点（不重写回答，只做合规标记），防主/子Agent忽略长提示词。
    // 仅非默认模型运行；默认 Flash 跳过（保持精简、不加延迟）。
    // ================================================================
    const SUPERVISOR_PROMPT = '你是【监督Agent】。请你核对以下"面向用户的输出/提问"是否遵守了系统提示词里的重点硬性规则。\n' +
        '\n【必须遵守的重点】\n' +
        '1. 舰船知识库强制校验：舰船名/参数/性能/配置问题→必须检索知识库、逐条核对数据；知识库无记载→如实写"暂无资料库收录"，严禁编造/估算；冲突以知识库MD为准。\n' +
        '2. 推理铁律：禁止 A/B/C/D/S 等级制评价，必须按数值(DPM/护甲/人口/服役上限/拦截概率)定量推导，结论要有数值依据。\n' +
        '3. 加入舰船(含舰载机)审批：必须先 ask_user 附数据(人口/服役上限/舰载机搭载/关键武器)并经用户同意；未同意前不得正式采用。加入舰船还要查《舰船基础信息.md》核 载机数/服役上限/人口。\n' +
        '4. 输出配队：必须附①打分结果(五轮全场景分项/常规总分/极端专项)②配队理由(思路依据/选型理由/对比/参考案例)；配置必须带 ×数量(站位 │ 舰船名+模块 ×数量 [带 舰载机×数量])；最后完整复述方案。\n' +
        '5. 文档可信度：优先《数据1-5》《例子1-31》(即 A资料/实例)≥3~5种思路；模拟器仅参考不作终审；基础/半改×180%/满改×220%换算。\n' +
        '6. 信息溯源：舰船参数来自 get_ship_data 或知识库；战术结论基于战斗机制文档；无法查阅如实告知。\n' +
        '7. 工具限制：总≤2000/单≤200；禁止刷模拟器凑思路。\n' +
        '8. 计划模式：执行前先出【本次任务完整执行计划书】并等批准(用户回"1"=批准)。\n' +
        '\n【输入】\n' +
        '- 用户问题：{question}\n' +
        '- 面向用户的输出/提问：{output}\n' +
        '\n【职责】只做"是否遵守重点"的合规标记，不重写回答、不帮修正、不生成面向用户的替代答案。\n' +
        '\n【输出格式】只输出JSON：\n' +
        '{"comply": true/false, "violations": [{"rule": "违反的重点编号/名称", "hit": "输出中违反的具体片段(30字内)"}], "note": "一句话说明(若无违规写\'合规\')"}';

    async function supervisoryCheck(question, output, llm){
        try{
            if(!llm || !llm.apiKey) return null;
            if(window.QA && QA.isDefaultFlash && QA.isDefaultFlash(llm)) return null;   // 默认Flash跳过
            const P=window.SubAgentPool;
            const prompt=SUPERVISOR_PROMPT.replace('{question}', (question||'').substring(0,800)).replace('{output}', String(output||'').substring(0,6000));
            const token=P.acquire('supervisor','supervisor',prompt);
            if(!token) return null;
            try{
                const msg=await callLLMRetry(llm, [{role:'system',content:prompt},{role:'user',content:'请核对以上输出并输出合规标记JSON。'}], 0.1, 800);
                const j=parseJSONLoose((msg&&msg.content)||'');
                if(j && typeof j.comply==='boolean') return {comply:j.comply, violations:(j.violations||[]).slice(0,8), note:String(j.note||'').substring(0,120)};
                return null;
            }finally{ P.release(token && token.token); }
        }catch(e){ return null; }
    }

    // ======== 质检 ========
    async function qualityCheck(question, answer, sources, llm){
        if(!llm.apiKey) return {pass:true, feedback:'（质检跳过：未配置API Key）'};
        const srcText=(sources||[]).slice(0,10).map(s=>'- '+s.source+': '+(s.content||'').substring(0,200)).join('\n')||'（无知识库来源）';
        const prompt=`你是【合并质检智能体】。仅在双质检（Agent-A + Agent-B）无法并行启用时，由你一次性完成"审计+裁判"合并工作。

目标：单次LLM调用，完成两项工作：
- 审计：找出回答中的所有问题（编造、数值错误、约束遗漏、来源缺失、逻辑矛盾）
- 裁判：基于审计结果给出三档等级判定（通过/擦边/不通过）+ 简要修改建议

输入：
- 用户问题：${question}
- AI回答：${answer}
- 知识库来源（外部传入）：${srcText}

## 执行流程

### 第一步：分类判断
- 游戏类问题（舰船/配队/战斗机制等）：需严格审查数据、逻辑和来源
- 通用类问题（闲聊/算术等）：只需回答正确完整即可直接判通过

### 第二步：审计（找问题）——仅对游戏类问题执行
逐句检查以下5类问题，记录关键问题点（最多记录3条最严重的）：
1. 编造/幻觉：知识库没有的数据是否编造？未知数据是否标注"暂无资料库收录"？
2. 数值错误：DPM、护甲、人口等关键数值是否与知识库一致？计算逻辑是否正确？
3. 约束遗漏：是否遗漏用户问题中的关键条件？审批规则是否执行？
4. 来源缺失：关键数据是否附来源标注？
5. 逻辑矛盾：回答内部是否自洽？与用户问题是否冲突？

### 第三步：裁判（做判定）——基于审计结果
| 等级 | 条件 | 动作 |
|:---|:---|:---|
| 通过 | 无问题或仅有轻微表述瑕疵，不影响使用 | 放行 |
| 擦边 | 存在1-2项中等严重问题（如数据小偏差、遗漏次要约束） | 标记警告后放行 |
| 不通过 | 存在编造、关键数值错误、核心约束遗漏或逻辑矛盾 | 拦截，触发重生成 |

### 第四步：输出
只输出JSON，不要其他文字：
{
  "pass": true/false,
  "level": "通过 | 擦边 | 不通过",
  "main_issues": ["问题1简述", "问题2简述"],
  "reason": "综合判定依据（一句话）",
  "suggestion": "修改建议（若pass则留空；否则给出1-2句具体修改指引）"
}`;
        try{
            const r=await callLLM(llm, [{role:'system',content:'你是合并质检智能体，只返回JSON'},{role:'user',content:prompt}], 0.1, 600);
            const content=r.content||'';
            try{
                const j=JSON.parse(content);
                return {pass:!!j.pass, level:j.level||'', main_issues:j.main_issues||[], reason:j.reason||'', suggestion:j.suggestion||'', feedback:j.reason||''};
            }catch(e){
                return {pass:/"pass"\s*:\s*true/i.test(content), feedback:''};
            }
        }catch(e){
            return {pass:true, feedback:'质检异常放行'};
        }
    }

    // ======== LLM调用（OpenAI兼容） ========
    function normalizeApiUrl(url){
        // 智能规范化：剥离多余后缀，只保留基础地址
        let base=String(url||'https://api.deepseek.com').trim().replace(/\/+$/,'');
        // 剥离完整调用路径
        base=base.replace(/\/chat\/completions$/,'');
        base=base.replace(/\/v1\/chat\/completions$/,'');
        // 剥离 /anthropic /v1 等尾缀
        base=base.replace(/\/anthropic$/,'');
        base=base.replace(/\/v1$/,'');
        return base;
    }
    async function callLLM(llm, messages, temperature, maxTokens, tools){
        // 全局并发锁（官方默认模型固定 1 并发）：确保同一时刻最多 1 个 LLM 请求，杜绝 429
        return (window.LLMLock||{run:(fn)=>fn()}).run(async ()=>{
            let base=normalizeApiUrl(llm.apiUrl);
            // 版本路径（/v1、/v4 等）已包含时不追加（兼容智谱 /api/paas/v4、DeepSeek /v1、Worker代理自动补 /v1）
            if(!/\/v\d+$/.test(base)) base+='/v1';
            const payload={
                model: llm.model,
                messages: messages.map(m=>({
                    role:m.role,
                    content:m.content??m.content,
                    ...(m.tool_calls?{tool_calls:m.tool_calls}:{}),
                    ...(m.tool_call_id?{tool_call_id:m.tool_call_id}:{}),
                    ...(m.reasoning_content?{reasoning_content:m.reasoning_content}:{})
                })),
                temperature: temperature??0.3,
                max_tokens: maxTokens||4096,
            };
            if(tools) payload.tools=tools;
            // 请求级超时（停滞监测）：默认免费模型按官方建议约40s；其它 120s。由 callLLMRetry 重试
            // 合并「暂停中断」signal 与「超时」signal：用户点暂停会 abort 当前请求
            let signal=null;
            const tmo = (window.QA && QA.isDefaultFlash && QA.isDefaultFlash(llm)) ? 40000 : 120000;
            const sigs=[];
            if(currentAbort) sigs.push(currentAbort.signal);
            if(typeof AbortSignal!=='undefined' && AbortSignal.timeout) sigs.push(AbortSignal.timeout(tmo));
            if(sigs.length===1) signal=sigs[0];
            else if(sigs.length>1) signal=(typeof AbortSignal!=='undefined' && AbortSignal.any) ? AbortSignal.any(sigs) : sigs[0];
            const r=await fetch(base+'/chat/completions',{
                method:'POST',
                headers:{'Content-Type':'application/json','Authorization':'Bearer '+llm.apiKey},
                body:JSON.stringify(payload),
                ...(signal?{signal}:{})
            });
            if(!r.ok){
                let msg='';
                try{ msg=(await r.json()).error?.message||r.statusText; }catch(e){ msg=r.statusText; }
                throw new Error(`HTTP ${r.status}: ${msg}`);
            }
            const j=await r.json();
            const ch=j.choices&&j.choices[0];
            const m=ch?ch.message:{content:'',reasoning_content:''};
            // 记录截断状态（reasoner 模型 reasoning 会占用 max_tokens，导致正文中途截断）
            m._truncated = ch&&ch.finish_reason==='length';
            return m;
        });
    }
    // LLM 调用自动重试：429（模型过载/限流）用长退避 5s/10s/20s；其他错误 1.2s/2.4s/4s
    async function callLLMRetry(llm, messages, temperature, maxTokens, tools){
        let lastErr;
        const is429=e=>/429|访问量过大|rate.?limit|Too Many/i.test(String((e&&e.message)||e));
        for(let attempt=0; attempt<=2; attempt++){
            try{
                return await callLLM(llm, messages, temperature, maxTokens, tools);
            }catch(e){
                lastErr=e;
                if(agentInterrupted) throw e;   // 用户暂停：不再重试，直接向上抛（agentLoop 会走 paused 分支）
                if(attempt<2){
                    // 缩短等待：默认模型固定1并发/易限流，快速失败给出提示，不干等35s
                    const wait = is429(e) ? 1500*(attempt+1) : 800*(attempt+1);
                    await new Promise(r=>setTimeout(r, wait));
                }
            }
        }
        throw lastErr;
    }


    // ======== 图片识别（视觉模型，默认智谱 GLM-4.6V-Flash 免费） ========
    // 返回图片描述文本；未配置视觉模型或调用失败返回 null（不阻塞对话）
    async function describeImage(dataUrl){
        try{
            const cfg=getConfig();
            const proxy=cfg.glm_proxy_url||'';
            const visionBase=proxy || 'https://open.bigmodel.cn/api/paas/v4';
            const visionKey=proxy ? 'proxy' : (cfg.glm_vision_api_key || cfg.glm_api_key || '');
            if(!visionKey) return null;
            const visionModel=cfg.glm_vision_model||'glm-4.6v-flash';
            let base=normalizeApiUrl(visionBase);
            if(!/\/v\d+$/.test(base)) base+='/v1';
            const r=await fetch(base+'/chat/completions',{
                method:'POST',
                headers:{'Content-Type':'application/json','Authorization':'Bearer '+visionKey},
                body:JSON.stringify({
                    model: visionModel,
                    messages:[{role:'user', content:[
                        {type:'text', text:'请详细描述这张图片的内容：画面主体、可见文字、数字、布局等（可能是游戏截图）。只输出描述文本，不要多余文字。'},
                        {type:'image_url', image_url:{url: dataUrl}}
                    ]}],
                    max_tokens: 800,
                    temperature: 0.1
                })
            });
            if(!r.ok) return null;
            const j=await r.json();
            const txt=(j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content)||'';
            return txt?String(txt).trim().substring(0,1000):null;
        }catch(e){ return null; }
    }


    // ======== Agent循环（首次对话与提问续答共用） ========
    async function agentLoop(messages, userMessage, allDocs, webText, llm, emit){
        let qcFailCount=0;
        const toolCallCounts={};
        let totalToolCalls=0;
        let last429Retry=0;   // 连续限流重试计数：429 时保留进度重试本轮，成功后归零
        // 停滞看门狗：任何事件都会刷新时间；超过 120s 无任何输出视为卡死，自动终止并兜底（对话不断）
        const STALL_MS=120000;
        // 整轮总超时：最多 150s，超时强制结束释放 isStreaming，避免发送键永久卡死
        const TURN_MAX=150000;
        const turnStart=Date.now();
        let lastActivity=Date.now();
        const origEmit=emit;
        emit=function(e,d,m){ lastActivity=Date.now(); return origEmit(e,d,m); };
        // 工具调用上限：同一工具最多200次，总调用最多2000次；主循环上限200防死循环保底
        for(let i=0;i<200;i++){
            if(Date.now()-turnStart>TURN_MAX){
                // 静默中止：不向用户弹"超时"提示，仅释放 isStreaming/done，避免卡死（也不显示兜底文案）
                emit('done','完成');
                return;
            }
            if(agentInterrupted){   // 用户点「暂停」：停止本轮，不发 answer
                emit('paused','⏸️ 已暂停本次思考');
                return;
            }
            if(Date.now()-lastActivity>STALL_MS){
                emit('error','⏱️ 检测到流程停滞（超过120秒无响应），已自动中止');
                emit('answer','抱歉，本次处理因长时间无响应已自动中止，请重试一次。', {sources:[], iterations:i+1, qc_feedback:'STALL_ABORT'});
                emit('done','完成');
                return;
            }
            try{
                const msg=await callLLMRetry(llm, messages, 0.3, 16384, getTools());
                last429Retry=0;   // 本轮 LLM 调用成功：重置限流重试计数
                if(agentInterrupted){ emit('paused','⏸️ 已暂停本次思考'); return; }   // 请求返回后再查一次暂停
                if(msg.reasoning_content){
                    emit('thinking', String(msg.reasoning_content).substring(0,2000));
                }
                // 回答被截断（reasoner 模型 reasoning 占用 max_tokens 导致正文中断）：续写完整后再进入质检（仅限无工具调用的最终回答轮）
                if(msg._truncated && !(msg.tool_calls&&msg.tool_calls.length)){
                    emit('status','⏳ 检测到回答被截断，正在续写完整...');
                    messages.push({role:'assistant', content:msg.content??''});
                    messages.push({role:'user', content:'【系统提示】你的上一轮回答因长度限制被截断。请从上次中断处继续，完整输出剩余内容（包括所有未完成的三轮评测、打分与结论），不要重复已输出的部分，不要调用任何工具。'});
                    continue;
                }
                if(msg.tool_calls&&msg.tool_calls.length){
                    for(const tc of msg.tool_calls){
                        const fn=tc.function;
                        const fnName=fn.name;
                        let args={};
                        try{ args=JSON.parse(fn.arguments||'{}'); }catch(e){}
                        // ======== ask_user 特殊处理：暂停对话，向用户提问 ========
                        if(fnName==='ask_user'){
                            // 工具调用上限：同一工具最多200次，总调用最多2000次
                            toolCallCounts[fnName]=(toolCallCounts[fnName]||0)+1;
                            totalToolCalls++;
                            if(toolCallCounts[fnName]>200 || totalToolCalls>2000){
                                emit('tool_start', `⛔ 提问次数已达上限，请基于现有信息直接回答`, {tool:fnName});
                                const cleanTc={id:tc.id, type:'function', function:{name:fnName, arguments:fn.arguments||'{}'}};
                                const am={role:'assistant', content:msg.content??null, tool_calls:[cleanTc]};
                                if(msg.reasoning_content) am.reasoning_content=msg.reasoning_content;
                                messages.push(am);
                                messages.push({role:'tool', tool_call_id:tc.id, content:'提问次数已达上限，请基于现有信息直接回答，不要再提问。'});
                                continue;
                            }
                            const cleanTc={id:tc.id, type:'function', function:{name:fnName, arguments:fn.arguments||'{}'}};
                            const am={role:'assistant', content:msg.content??null, tool_calls:[cleanTc]};
                            if(msg.reasoning_content) am.reasoning_content=msg.reasoning_content;
                            messages.push(am);
                            // 保存状态供续答
                            askState={messages:JSON.parse(JSON.stringify(messages))};
                            const question=args.question||'请告诉我你的需求';
                            const options=args.options||[];
                            const qtype=args.type||(options.length>1?'multiple':'free');
                            emit('ask_user', question, {ask_id:'local_ask', options, type:qtype, required:args.required!==false});
                            emit('awaiting_user','⏸️ 等待用户回答...');
                            return; // 结束当前流，等待用户回答
                        }
                        // 工具调用上限：同一工具最多200次，总调用最多2000次
                        toolCallCounts[fnName]=(toolCallCounts[fnName]||0)+1;
                        totalToolCalls++;
                        const cleanTc={id:tc.id, type:'function', function:{name:fnName, arguments:fn.arguments||'{}'}};
                        if(toolCallCounts[fnName]>200 || totalToolCalls>2000){
                            emit('tool_start', `⛔ 工具调用上限: ${fnName}（已达${toolCallCounts[fnName]}次）`, {tool:fnName, args});
                            const am={role:'assistant', content:msg.content??null, tool_calls:[cleanTc]};
                            if(msg.reasoning_content) am.reasoning_content=msg.reasoning_content;
                            messages.push(am);
                            messages.push({role:'tool', tool_call_id:tc.id, content:'该工具调用次数已达上限，请基于现有信息直接回答，不要再调用工具。'});
                            continue;
                        }
                        emit('tool_start', `🔧 调用工具: ${fnName}`, {tool:fnName, args});
                        let result;
                        try{ result=await executeTool(fnName, args, emit); }
                        catch(e){ result=JSON.stringify({error:String(e)}); }
                        // AgentForesight 前置在线预判：工具输出即时自检，阻断级联幻觉
                        const foresight=QA.foresightCheck(result, fnName);
                        if(foresight.length){
                            emit('tool_result', '⚠️ 预检异常: '+foresight.join('；'), {tool:fnName, foresight});
                            result = '【预检警告】'+foresight.join('；')+'\n原始返回:\n'+String(result).substring(0,1500);
                        }else{
                            emit('tool_result', result.substring(0,2000), {tool:fnName, result_preview:result.substring(0,300)});
                        }
                        const am={role:'assistant', content:msg.content??null, tool_calls:[cleanTc]};
                        if(msg.reasoning_content) am.reasoning_content=msg.reasoning_content;
                        messages.push(am);
                        messages.push({role:'tool', tool_call_id:tc.id, content:result.substring(0,4000)});
                    }
                    continue;
                }
                // 最终回答 → 质检（FACT-AUDIT 流水线：主张拆解→证据检索→多裁判辩论→五层审计→量化评分→链状回溯局部修正）
                const answer=msg.content||'';
                emit('status','🔬 质检中（主张拆解→证据检索→多裁判辩论→五层审计→量化评分）...');
                const qc=await QA.qaPipeline(userMessage, answer, llm, emit);
                if(qc.status==='PASS' || qc.status==='PARTIAL_FIX' || qcFailCount>=2){
                    if(qcFailCount>=2) emit('qc_pass','✅ 质检第2次未通过，强制放行');
                    else emit('qc_pass', qc.status==='PARTIAL_FIX'?`✅ 链状回溯局部修正后通过（评分 ${qc.score}）`:`✅ 质检通过（评分 ${qc.score}）`);
                    // 空回答兜底：模型返回空内容时给出明确提示，避免前端误判"未收到回复"
                    let finalAnswer=(qc.final_answer||answer||'').trim();
                    if(!finalAnswer) finalAnswer='抱歉，本次未能生成有效回复（模型返回空内容），请重试或换一种问法。';
                    // 轻量监督 Agent：核对面向用户的输出是否遵守提示词重点（默认Flash跳过；失败静默，不阻塞）
                    let complianceMeta=null;
                    try{
                        const sup=await supervisoryCheck(userMessage, finalAnswer, llm);
                        if(sup){ complianceMeta=sup; emit('compliance', sup.comply?('✅ 监督：'+sup.note):('⚠️ 监督：'+sup.note), {violations:sup.violations, comply:sup.comply}); }
                    }catch(e){}
                    emit('answer', finalAnswer, {sources:(allDocs||[]).slice(0,10).map(d=>({file_name:d.source, snippet:d.content.substring(0,200)})), iterations:i+1, qc_feedback:JSON.stringify(qc.error_list||[]).substring(0,200), qc_score:qc.score, compliance:complianceMeta});
                    emit('done','完成');
                    return;
                }else if(qc.status==='MAX_ITER_STOP'){
                    emit('qc_fail','⛔ 质检迭代达2轮 MAX_ITER_STOP，回答校验失败');
                    emit('answer', '回答校验失败，请重新提问', {sources:[], iterations:i+1, qc_feedback:'MAX_ITER_STOP'});
                    emit('done','完成');
                    return;
                }else{
                    // FULL_REGEN：严重事实冲突（<60分），完整重跑工具链（主循环继续，模型可重新调用工具）
                    qcFailCount++;
                    emit('qc_fail', `🔄 质检不合格(${qcFailCount}/2) 评分${qc.score}：FULL_REGEN，请重新调用工具获取证据`);
                    const am={role:'assistant', content:answer};
                    if(msg.reasoning_content) am.reasoning_content=msg.reasoning_content;
                    messages.push(am);
                    messages.push({role:'user', content:`【质检反馈】你的回答未通过质检（评分${qc.score}），需完整重新生成。错误清单：\n${JSON.stringify(qc.error_list||[]).substring(0,1500)}\n\n请重新调用工具获取证据后生成回答，舰船硬数值必须与资料库一致。`});
                }
            }catch(e){
                if(agentInterrupted){   // 用户暂停导致的 abort/中断：不报错、不发兜底回答
                    emit('paused','⏸️ 已暂停本次思考');
                    return;
                }
                const transient429=/429|访问量过大|rate.?limit|Too Many|速率限制/i.test(String((e&&e.message)||e));
                // 限流/过载：保留本轮进度，后台自动等待退避后继续（无需用户手动），一轮内自愈完成
                if(transient429 && last429Retry < 6){
                    last429Retry++;
                    const wait=Math.min(5000*last429Retry, 20000);   // 5s,10s,15s,20s,20s,20s 封顶
                    emit('status',`⏳ 模型限流/繁忙，已保留本轮进度，约${Math.round(wait/1000)}秒后自动继续（第${last429Retry}次）...`);
                    await new Promise(r=>setTimeout(r, wait));
                    continue;   // 自动复用 messages 进度继续本轮，无需用户操作
                }
                emit('error', 'Agent异常: '+String(e).substring(0,200));
                // 兜底：异常也必须给出回复，防止前端显示"（未收到回复）"断掉对话
                const msg429=transient429;
                emit('answer', msg429
                    ? '⚠️ 模型限流较久，本轮已保留进度。请稍后发送任意消息继续，我会基于已检索的资料继续完成回答；或在设置页配置自己的 API Key 使用直连。'
                    : '抱歉，本次处理出现异常：'+String(e).substring(0,120)+'\n\n请重试一次，或换一种问法。',
                    {sources:[], iterations:i+1, qc_feedback: msg429?'GLM_429':'AGENT_EXCEPTION'});
                emit('done','完成');
                return;
            }
        }
        emit('error','达到最大迭代次数(50)，请简化问题重试');
        // 兜底：迭代超限也给回复，不断掉对话
        emit('answer', '抱歉，本次处理轮次过多未能收敛（达到最大迭代次数），请简化问题后重试。', {sources:[], iterations:50, qc_feedback:'MAX_ITER_50'});
        emit('done','完成');
    }

    // ======== 共享系统提示词（单一来源：data/system_prompt.md；加载失败回退内置常量） ========
    let systemPrompt = SYSTEM_PROMPT;
    let systemPromptLoaded = false;
    async function loadSystemPrompt(){
        if(systemPromptLoaded) return systemPrompt;
        try{
            const r=await fetch((window.KB_BASE||'')+'data/system_prompt.md',{cache:'no-cache'});
            if(r.ok){
                const t=await r.text();
                if(t && t.trim().length>100){
                    systemPrompt=t.trim();
                    systemPromptLoaded=true;
                }
            }
        }catch(e){}
        return systemPrompt;
    }

    // ======== 对话模式上下文（计划/普通）—— 向所有 Agent 传播 ========
    // 计划模式：主Agent先输出【本次任务完整执行计划书】等批准；该规则同时告知其它 Agent（意图门/检索舰队/质检等）。
    // 普通模式：所有 Agent 均被告知无需计划、直接回答。
    let modeCtx = {mode:'normal', plan:false, text:'【当前对话模式·普通】无需输出计划书，直接回答用户问题；所有Agent不执行计划审批流程。'};
    // 暂停/打断支持：用户点「暂停」时置位并 abort 当前 LLM 请求；agentLoop 检测到即停止本轮（不发 answer）
    let agentInterrupted = false;
    let currentAbort = null;
    function interrupt(){
        agentInterrupted = true;
        if(currentAbort) currentAbort.abort();
    }
    function resetInterrupt(){
        agentInterrupted = false;
        try{ currentAbort = new AbortController(); }catch(e){ currentAbort = null; }
    }
    const PLAN_RULE = '【核心强制总规则】（最高优先级，任何场景不得跳过；纯文本对话环境：用户回复数字1=批准计划，直接打字=修改意见）\n' +
        '1. 任何任务、任何请求执行前，严禁直接动手操作、严禁直接给出最终结果、严禁私自执行动作。你必须先完整梳理全局执行总方案，命名为：【本次任务完整执行计划书】，完整展示在对话窗口。计划书需要包含：任务目标、分步执行全过程、每一步操作内容、操作先后顺序、执行注意事项、风险点、需要调用哪些桌面工具、执行完毕验收标准。\n' +
        '2. 计划书展示完毕后，固定在计划书下方，强制生成固定交互选项排版，格式严格固定，不许修改文案样式：\n' +
        ' ————————————\n' +
        ' 1、【点击批准计划】：确认按照当前计划书完整执行\n' +
        ' 2、输入你的修改建议/想法：（由用户自行填写文字）\n' +
        ' ————————————\n' +
        ' 用户不同反馈的硬性执行流程：\n' +
        ' - 场景A：用户点击「批准计划」→ 立刻严格1:1遵照计划书执行，全程不擅自更改步骤、不随意加操作、不删减流程；执行过程同步进度，结束后给出完成总结\n' +
        ' - 场景B：用户填写文字想法/修改意见/调整要求 → 完全吸收用户全部修改诉求，推翻旧计划，重新撰写新版【本次任务完整执行计划书】，再次完整发到对话框并附上批准/修改双交互模块；循环往复（出计划→等待审批→修改则重制），直到用户批准才允许启动任务执行\n' +
        ' 附加约束：\n' +
        ' - 无论用户催促、简写指令、闲聊附带任务、快捷命令，都必须死守审批流程，禁止任何形式绕开计划审批直接干活\n' +
        ' - 计划书条理清晰、分点罗列，拒绝模糊话术，步骤写具体\n' +
        ' - 多轮修改计划时，兼容用户上一轮合理要求，不无故回退有效修改\n' +
        ' - 无任务闲聊对话时，该审批流程自动休眠，不强制弹出计划模板；仅在用户下达操作类、执行类、代办类任务时启动该机制\n' +
        ' - 计划书获批进入执行阶段后：先执行任务并完成三轮评测，最终输出任务结果（配置方案/分析结论）时无需再次附带计划书与批准选项；执行完成后给出完成总结';
    const NORMAL_RULE = '【普通模式·所有Agent】当前为普通模式：无需输出计划书、无需等待批准，直接回答用户问题；所有 Agent 均不执行计划审批流程。';
    function setMode(plan){
        modeCtx = plan
            ? {mode:'plan', plan:true, text:'【当前对话模式·计划】所有Agent须知：主Agent必须先输出【本次任务完整执行计划书】并等待用户批准（用户回复"1"=批准，直接打字=修改意见）后才可执行；禁止绕开审批直接干活。'}
            : {mode:'normal', plan:false, text:'【当前对话模式·普通】无需输出计划书，直接回答用户问题；所有Agent不执行计划审批流程。'};
    }
    function getModeCtx(){ return modeCtx; }

    // ======== 需求理解 Agent（前端意图门）：明确需求 + 判断日常闲聊 ========
    // 用户输入先进本 Agent：①明确/澄清需求；②判断是否"日常闲聊"。
    // 若判定为闲聊（你好/在吗/谢谢等）→ 直接由主Agent回答，禁止后续检索/工具/计划/质检流程；
    // 否则把明确后的需求注入主Agent继续跑后续流程（保留原始消息防止信息丢失）。
    // 本 Agent 走子Agent池（计入 ≤7 额度），失败时无害降级不阻塞主流程。
    const INTENT_PROMPT =
        '你是【需求理解智能体】，在用户消息进入主智能体前先做一次理解与分流。\n' +
        '\n' +
        '输入：\n' +
        '- 当前用户消息：{user_message}\n' +
        '- 最近5轮对话历史（含用户和助手消息）：{history}（如不足5轮则取全部）\n' +
        '\n' +
        '任务：\n' +
        '1. 明确用户需求：把用户的话提炼成一句清晰、可执行的意图描述（保留舰船名、数值、约束、目标场景等关键信息，不添油加醋）。\n' +
        '2. 判断是否"日常闲聊"：必须结合对话历史进行综合判定。\n' +
        '\n' +
        '【日常闲聊判定规则】\n' +
        'a) 仅当当前消息是打招呼/寒暄/感谢/随便聊聊等与《无尽的拉格朗日》游戏知识、舰队配队、舰船数据、任务请求等无关的日常对话时，is_daily_chat 为 true。\n' +
        '   例：你好、在吗、谢谢、今天天气如何、你在干嘛、你是谁、讲个笑话、随便聊聊。\n' +
        'b) 但如果前几轮对话正在执行配队、查询舰船、战术推演等严肃任务，用户当前消息即使只是短答复（如"好的""行""继续""嗯""那换成艾奥级呢""批准"），也绝不是闲聊，必须继续执行任务。\n' +
        'c) 用户对当前计划的确认/批准（批准计划、数字1=批准、同意、确认、好的、继续、执行、收到、明白、可以、没问题…）是命令性指令，不是日常闲聊，必须放行到主流程处理，绝不能判为 is_daily_chat。\n' +
        'd) 当用户的消息含义不明确（如"那个""这个""再来一次""换一个"）时，结合上下文推断其指代对象：\n' +
        '   - 如果前轮讨论配队，则视为配队相关指令；\n' +
        '   - 如果前轮讨论具体舰船，则视为舰船查询延续；\n' +
        '   - 如果前轮是闲聊，则视为闲聊延续。\n' +
        '   能明确指向游戏相关内容的，不判闲聊。\n' +
        'e) 如果当前消息短到无法独立判断，且前轮没有明确上下文，则判为 is_daily_chat = true，并注明原因"单条消息无上下文且无明确任务关键词"。\n' +
        '\n' +
        '3. 只输出 JSON，不要任何其他文字：\n' +
        '{\n' +
        '  "is_daily_chat": false,\n' +
        '  "clarified_intent": "用一句话重新表达的用户需求（如果判闲聊则写\'无\'）",\n' +
        '  "reason": "判定依据，必须包含对上下文的引用",\n' +
        '  "context_summary": "简要说明最近对话状态（如\'前3轮正在讨论艾奥级PVP配队\'）"\n' +
        '}';

    // 宽容解析 LLM 返回的 JSON（截取首个 { 到末尾 } 的段落）
    function parseJSONLoose(text){
        if(text==null) return null;
        const t=String(text).trim();
        const m=t.match(/\{[\s\S]*\}/);
        if(m){ try{ return JSON.parse(m[0]); }catch(e){} }
        return null;
    }

    // 调用需求理解 Agent（子Agent池记账；异常→按非闲聊降级，绝不阻塞主流程）
    async function intentClarify(userMessage, history, llm){
        let token=null;
        try{
            const P=window.SubAgentPool;
            const histTxt=(history||[]).slice(-5).filter(m=>m&&m.content)
                .map(m=>(m.role==='user'?'用户':m.role==='assistant'?'助手':'系统')+': '+String(m.content).substring(0,400)).join('\n');
            const prompt=INTENT_PROMPT.replace('{user_message}', userMessage).replace('{history}', histTxt||'（无历史）');
            token=P.acquire('intentAgent','intentAgent',prompt+'\n'+modeCtx.text);
            if(!token) return {is_daily_chat:false, clarified_intent:userMessage, reason:'需求Agent已满，默认按非闲聊处理'};
            const msgs=[{role:'system',content:prompt+'\n'+modeCtx.text},{role:'user',content:'当前消息：'+userMessage+'\n\n最近对话历史：\n'+(histTxt||'（无历史）')}];
            const msg=await callLLMRetry(llm, msgs, 0.0, 512);
            const p=parseJSONLoose(msg.content);
            if(p && typeof p.is_daily_chat==='boolean'){
                return {is_daily_chat:p.is_daily_chat, clarified_intent:String(p.clarified_intent||userMessage).trim()||userMessage, reason:String(p.reason||''), context_summary:String(p.context_summary||'')};
            }
            return {is_daily_chat:false, clarified_intent:userMessage, reason:'需求Agent返回非预期，按非闲聊处理'};
        }catch(e){
            return {is_daily_chat:false, clarified_intent:userMessage, reason:'需求Agent降级: '+String(e.message||e).substring(0,60)};
        }finally{
            if(token) window.SubAgentPool.release(token && token.token);
        }
    }

    // 日常闲聊：主Agent直接回答（单轮、无工具、无计划、无质检 —— 禁止后续流程）
    async function chatDaily(userMessage, history, emit){
        try{
            const llm=getActiveLLM();
            emit('status','💬 日常闲聊，由主智能体直接回答');
            const msgs=[{role:'system',content:systemPrompt}];
            (history||[]).slice(-10).filter(m=>(m.role==='user'||m.role==='assistant')&&m.content).forEach(m=>msgs.push({role:m.role,content:String(m.content).substring(0,2000)}));
            msgs.push({role:'user', content:userMessage});
            const msg=await callLLMRetry(llm, msgs, 0.6, 2048);
            return (msg.content||'').trim();
        }catch(e){
            emit('error','日常闲聊回答异常: '+String(e).substring(0,120));
            return '🤝 你好呀！我在的，随时可以问我《无尽的拉格朗日》的配队、舰船数据或战斗思路～';
        }
    }

    // ======== 主流程 ========
    // 挂起的AI提问状态（前端保存，回答后恢复）
    let askState = null;
    async function chat(userMessage, history, emit, resume, referencedContext){
        await loadSystemPrompt();  // 加载共享系统提示词（所有智能体遵循同一份）
        // resume: {messages, userAnswer:{selections,free_text}} → 续答模式
        if(resume && resume.messages){
            const llmR=getActiveLLM();
            const messages=resume.messages;
            const userAnswer=resume.userAnswer||{};
            // 找到最后的assistant tool_calls id
            let tcId=null;
            for(let i=messages.length-1;i>=0;i--){
                if(messages[i].tool_calls){ tcId=messages[i].tool_calls[messages[i].tool_calls.length-1].id; break; }
            }
            if(!tcId){ emit('error','提问状态异常，请重新发送'); return {}; }
            const parts=[];
            if(userAnswer.selections&&userAnswer.selections.length) parts.push('用户选择：'+userAnswer.selections.join('、'));
            if(userAnswer.free_text&&String(userAnswer.free_text).trim()) parts.push('用户补充说明：'+String(userAnswer.free_text).trim());
            messages.push({role:'tool', tool_call_id:tcId, content:(parts.join('\n')||'用户未作答（跳过）').substring(0,4000)});
            await agentLoop(messages, '', [], '', llmR, emit);
            return {};
        }
        const llm=getActiveLLM();

        // 0. 需求理解 Agent（前端意图门）：明确需求 + 判断日常闲聊
        //    判定为日常闲聊 → 禁止后续检索/工具/计划/质检，主Agent直接回答后结束
        setMode(!!(getConfig().plan_mode));   // 先设置模式，让所有 Agent 感知计划/普通
        resetInterrupt();                     // 每轮对话重置暂停标志与 AbortController
        const isFlash = QA.isDefaultFlash(llm);
        let intent;
        if(isFlash){
            // 默认 GLM-4.7-Flash：不启用意图门Agent（避免多一次LLM调用），改用已有规则判定闲聊
            intent = QA.isSimpleQuestion(userMessage)
                ? {is_daily_chat:true, clarified_intent:userMessage, reason:'默认Flash：规则判定为日常闲聊'}
                : {is_daily_chat:false, clarified_intent:userMessage, reason:'默认Flash：规则判定为非闲聊'};
        }else{
            intent = await intentClarify(userMessage, history, llm);
        }
        if(intent.is_daily_chat){
            const casual = await chatDaily(userMessage, history, emit);
            emit('answer', casual, {sources:[], iterations:0, qc_feedback:'DAILY_CHAT', qc_score:null, intent_reason:intent.reason});
            emit('done','完成');
            return {};
        }
        // 明确后的需求：与原问法不同则注入主Agent（保留原始消息以保证信息不丢失）
        const clarifiedIntent = (intent.clarified_intent && intent.clarified_intent!==userMessage) ? intent.clarified_intent : '';

        emit('status','🔍 正在检索知识库...');
        emit('cache', `📊 缓存命中率: ${KB.hitRate().rate}% (${KB.hitRate().hits}次命中/${KB.hitRate().total}次查询)`, KB.hitRate());

        // 1. 子代理
        const subDocs=await runSubAgents(userMessage, emit);
        // 2. 主检索（TF-IDF + 语义混合，向量+语义基础）
        await KB.load();
        const mainDocs=await KB.search(userMessage,5);
        let hybridDocs=[];
        let gateInfo=null;
        try{
            emit('status','🧠 语义检索中（TF-IDF + Embedding 混合）...');
            const hy=await KB.hybridSearch(userMessage,{topK:5, skipApiEmbed: !!(QA.isDefaultFlash && QA.isDefaultFlash(llm))});
            if(hy && hy.results && hy.results.length){
                hybridDocs=hy.results;
                gateInfo=hy.gate;
                if(hy.denseCount>0) emit('status',`🧠 语义召回 ${hy.denseCount} 条，混合融合完成`);
            }
        }catch(e){ emit('status','⚠️ 语义检索跳过: '+String(e.message||e).substring(0,60)); }
        const allDocs=[...subDocs, ...mainDocs, ...hybridDocs].filter((v,i,a)=>a.findIndex(x=>x.source+'#'+(x.chunkIndex||0)===v.source+'#'+(v.chunkIndex||0))===i);
        // 3. 联网
        emit('web_search','🌐 正在联网搜索...');
        let webText='';
        try{
            const wr=await webSearch(userMessage);
            const wj=JSON.parse(wr);
            if(wj.results&&wj.results.length){
                emit('web_search', `🌐 联网搜索完成（${wj.engine} · ${wj.results.length} 条结果）`, {count:wj.results.length, engine:wj.engine});
                webText=wj.results.map(r=>`- ${r.title}: ${r.content} (${r.url})`).join('\n');
            } else {
                emit('web_search', `🌐 联网搜索: ${wj.note||'无结果'}`);
            }
        }catch(e){ emit('web_search','🌐 联网搜索失败: '+String(e).substring(0,50)); }

        // 4. 组装消息
        let ragContext=allDocs.slice(0,12).map(d=>`【资料来源：${d.source}】\n${d.content.substring(0,600)}`).join('\n\n');
        // 检索舰队：检索总Agent + ≤3检索子Agent 精炼素材包（默认Flash/无key/失败自动降级为原文）
        try{
            const fleet=await retrieveFleet(userMessage, allDocs.slice(0,18), llm, emit);
            if(fleet && fleet.trim()) ragContext='【检索素材包】\n'+fleet;
        }catch(e){}
        const messages=[{role:'system',content:systemPrompt}];
        // 4.1 上下文自动压缩：历史超阈值（maxTokens×60%）时，最旧轮次压成【对话摘要】，保留最近10轮全文
        let history2=(history||[]).slice(-20);
        const cfg=getConfig();
        const maxTok=cfg.max_tokens||100000;
        let compressedResult=null;
        if(estimateTokens(history2)>maxTok*0.6){
            emit('status','🧠 上下文超过阈值，正在压缩历史对话...');
            compressedResult=await compressConversation(history2, llm);
            if(compressedResult.summary){
                history2=[{role:'system',content:'【对话摘要】'+compressedResult.summary}, ...compressedResult.kept];
            }else{
                // 压缩失败降级：丢弃最旧 50% 轮次（保底不报错）
                history2=history2.slice(Math.ceil(history2.length/2));
                emit('status','⚠️ 压缩失败，已裁剪最旧对话');
            }
        }
        // 4.2 能力告知 + 用户画像精简摘要 + 相关 skill 按需注入（禁止无条件全量注入）
        const capability='【你的能力清单】你运行在增强版智能体上，具备以下能力：\n'+
            '1. 可自主创建新工具：当现有工具（知识库检索/舰船查询/战斗推演/联网搜索/提问）无法完成用户任务时，调用 create_tool 工具自行创建（提供名称+作用标注+代码）。创建后系统自动做语法编译与LLM逻辑审查，通过即可用，不通过会自动修复。你写的工具代码会被保存到系统（本地），当前及后续对话持续可用、可随时再次调用，无需重复创建。\n'+
            '2. 经验skill库：系统会根据用户点赞/点踩以及对话结束后自动沉淀经验skill；命中关键词时相关skill会自动注入本对话（见【经验skill】消息）。当用户明确要求"保存为skill / 把这个做成skill / 创建一个skill"或想把当前对话的思路沉淀下来时，调用 create_skill 工具直接创建（提取名称、摘要≤20字、内容、触发关键词）。用户输入 /skill <名> 时该skill完整注入。\n'+
            '3. 支持用户斜杠命令：/skill <名>、/工具 <名>、/压缩（强制压缩上下文）、/计划、/普通、/回溯、/重启、/clear、/帮助。\n'+
            '4. 支持 @引用：用户 @ 的历史对话上下文会注入为【引用的历史对话】消息。';
        const prof=(window.SkillSystem&&SkillSystem.getProfileSummary)?SkillSystem.getProfileSummary():'';
        if(prof) messages.push({role:'system',content:'【用户画像·精简】'+prof});
        const skillCtx=(window.SkillSystem&&SkillSystem.getSkillContext)?SkillSystem.getSkillContext(userMessage,1500):'';
        if(skillCtx) messages.push({role:'system',content:'【本次注入的相关经验skill】\n'+skillCtx});
        // 4.3 普通/计划模式：计划模式注入完整审批规则（并已通过 modeCtx 告知所有 Agent）；普通模式删除审批、告知所有 Agent 直接回答
        messages.push({role:'system',content: cfg.plan_mode ? PLAN_RULE : NORMAL_RULE});
        messages.push({role:'system',content:capability});
        if(isFlash) messages.push({role:'system',content:'【默认免费模型·精简模式】当前为 glm-4.7-flash（固定1并发、建议短超时）。请优先给出清晰、完整、一次到位的回答：配队/配置问题直接给结论+关键数据+必要理由即可；无需强制五轮迭代评测、无需反复检索/多次调用模拟器、不要为了“凑合规”发起大量工具调用——长链会超时导致“服务器繁忙”。'});
        if(ragContext) messages.push({role:'system',content:`【本次检索到的知识库资料（含子代理汇总）】\n${ragContext.substring(0,8000)}`});
        if(webText) messages.push({role:'system',content:`【互联网检索结果】\n${webText}`});
        history2.forEach(h=>{
            if((h.role==='user'||h.role==='assistant')&&h.content) messages.push({role:h.role, content:String(h.content).substring(0,2000)});
            else if(h.role==='system'&&h.content) messages.push({role:'system', content:String(h.content).substring(0,2000)});
        });
        if(referencedContext) messages.push({role:'system',content:'【引用的历史对话】\n'+String(referencedContext).substring(0,3000)});
        if(clarifiedIntent) messages.push({role:'system',content:'【需求理解Agent·已明确用户需求】'+clarifiedIntent});
        messages.push({role:'user', content:userMessage});

        // 5. Agent循环
        await agentLoop(messages, userMessage, allDocs, webText, llm, emit);
        return {compressed: compressedResult};
    }

    // ======== 上下文压缩（自动 + /压缩 命令共用） ========
    function estimateTokens(arr){
        let total=0;
        (arr||[]).forEach(m=>{ total+=Math.ceil(String(m.content||'').length*0.7); });
        return total;
    }
    // 把最旧轮次压成【对话摘要】（≤400字），保留最近10轮全文；失败返回空 summary（调用方降级裁剪）
    async function compressConversation(messages, llm){
        const list=Array.isArray(messages)?messages:[];
        const keep=Math.min(10, Math.max(4, Math.ceil(list.length/2)));
        const old=list.slice(0, Math.max(0,list.length-keep));
        const recent=list.slice(Math.max(0,list.length-keep));
        if(!old.length) return {summary:'', kept:recent};
        const oldText=old.map(m=>{
            const role=m.role==='user'?'用户':m.role==='assistant'?'AI':'系统';
            return role+': '+String(m.content||'').substring(0,300);
        }).join('\n');
        try{
            const msg=await callLLMRetry(llm, [
                {role:'system',content:'你是对话摘要助手。把下面的历史对话压缩成一段简洁摘要，保留关键信息：\n- 用户的需求/偏好\n- 已给出的重要结论\n- 已确认的舰船配置（含舰船名、数量、模块、舰载机搭配等）\n- 已讨论过但尚未定论的方案/争议点\n- 用户明确表达过的禁忌/不满（如"不要艾奥级""我不喜欢XX打法"）\n\n摘要长度：控制在3500-7500字之间（如对话内容较少则相应缩短）。\n只输出摘要文本，不要任何前缀。'},
                {role:'user',content:oldText.substring(0,6000)}
            ], 0.3, 800);
            const summary=(msg.content||'').trim().substring(0,800);
            return {summary, kept:recent};
        }catch(e){
            return {summary:'', kept:recent};
        }
    }

    // 共享系统提示词获取（供子代理/qa/kb-dev 复用同一份提示词）
    function getSystemPrompt(){
        return systemPrompt;
    }
    return {chat, getConfig, getActiveLLM, SYSTEM_PROMPT, getSystemPrompt, getAskState:()=>askState, getTools,
            estimateTokens, compressConversation, describeImage, retrieveFleet, setMode, getModeCtx, interrupt, resetInterrupt, supervisoryCheck};
})();

// 显式暴露到window（跨script标签访问）
window.AgentEngine = AgentEngine;
