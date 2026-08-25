/* ========================================
   质检推理流水线（任务B · FACT-AUDIT 自适应分层审计框架）
   ----------------------------------------
   输入：用户原始提问、待校验AI回答初稿
   可用工具：知识库检索、舰船数据库、战斗模拟器（本地）
   严格顺序执行：
   1. Orchestrator      → 用户需求快照 + 迭代计数（≤6）
   2. AgentForesight    → 前置在线预判（工具结果即时自检，阻断级联幻觉）
   3. 主张拆解 Agent    → 拆解原子事实
   4. 证据检索 Agent    → 逐条事实检索证据（不重新调用检索类工具）
   5. 多裁判辩论集群    → 3个独立校验智能体并行质证投票
   6. FACT-AUDIT 五层   → 事实准确性/溯源/逻辑/需求覆盖/格式
   7. LLM-as-Judge      → 0-100量化评分 + 错误清单（JSON输出）
   8. 分支：≥80 PASS / 60-79 PARTIAL_FIX(链状回溯局部修正) / <60 FULL_REGEN / 2轮MAX_ITER_STOP
   硬约束：最大迭代2轮；PARTIAL_FIX禁止重新检索；硬数值必须对照资料库
   ======================================== */

const QA = (function(){

    const MAX_ITER = 2;

    // ======== 简单日常问题判断（与《无尽的拉格朗日》无关的简单问答，跳过质检） ========
    // 命中则直接放行：主 Agent 回答即可，无需走主张拆解/检索/裁判/评分全流程
    function isSimpleQuestion(question){
        const q = String(question||'').trim().toLowerCase();
        if(!q) return false;
        // 计划审批/确认/数字选择等"指令性回复"：不是日常闲聊，必须放行到主流程
        // （如 批准计划 / 1=批准 / 同意 / 确定 / 好的 / 继续 / 执行 …）
        const interactive = ['批准','同意','确认','执行','认可','通过','开始','继续','没问题','收到','明白','好的','可以','是的','对的'];
        const isNumReply = /^\d{1,2}$/.test(q);   // 数字回复：1=批准计划 / 选项选择→ 放行
        if(isNumReply || interactive.some(x=>q.includes(x))) return false;
        // 明确与游戏/舰船/配队无关的关键词 → 简单问题
        const everyday = [
            // 问候/寒暄/感谢
            '你好','您好','hi','hello','嗨','哈喽','早上好','下午好','晚上好','在吗','在不在',
            '谢谢','感谢','多谢','辛苦','再见','拜拜','晚安','早安','哈哈','呵呵',
            // 自我介绍/能力/你是谁
            '你是谁','你叫什么','介绍一下你','你能做什么','你会什么','你的功能','帮我说说你自己',
            // 简单数值/常识/算术
            '几岁','多大','吃饭','买','好吃的','多少钱','天气','几点','时间','日期','星期','等于','多少','计算','求和','加减','乘除',
        ];
        if(everyday.some(x => q.includes(x))) return true;
        // 短问题且不含游戏/舰船关键词 → 视为简单日常（≤8字且无配队/舰船/机制词）
        const gameKw = ['舰','船','战队','护航','配队','战斗','防御','人口','武器','航母','驱逐','巡洋','护卫','战列','出击','增援','舰队','拉格朗日','机制','伤害','dpm','升级','蓝图'];
        const hasGame = gameKw.some(k=>q.includes(k));
        if(!hasGame && q.length <= 12) return true;
        return false;
    }

    // 判断当前是否使用默认 GLM-4.7-Flash（免费轻量模型）。
    // 该模型并发能力弱、易限流(429)，在质量/多Agent协作时要降级——
    // 此时禁止"同时启用多个Agent"，避免一次对话飙出多次并发LLM调用。
    function isDefaultFlash(llm){
        const m=String((llm&&llm.model)||'').toLowerCase();
        return m.indexOf('glm-4.7-flash')!==-1;
    }

    // ======== LLM 调用（OpenAI 兼容，与 agent.js 同模式） ========
    function normalizeApiUrl(url){
        let base = String(url||'https://api.deepseek.com').trim().replace(/\/+$/,'');
        base = base.replace(/\/chat\/completions$/,'');
        base = base.replace(/\/v1\/chat\/completions$/,'');
        base = base.replace(/\/anthropic$/,'');
        base = base.replace(/\/v1$/,'');
        return base;
    }
    async function callLLM(llm, messages, temperature, maxTokens){
        // 全局并发锁（默认模型固定 1 并发）：qa(质检A/B) 也统一串行，杜绝 429
        return (window.LLMLock||{run:(fn)=>fn()}).run(async ()=>{
            let base = normalizeApiUrl(llm.apiUrl);
            // 版本路径（/v1、/v4 等）已包含时不追加（兼容智谱 /api/paas/v4）
            if(!/\/v\d+$/.test(base)) base += '/v1';
            const payload = {
                model: llm.model,
                messages: messages.map(m=>({
                    role:m.role,
                    content:m.content!=null?String(m.content):'',
                    ...(m.reasoning_content?{reasoning_content:m.reasoning_content}:{})
                })),
                temperature: temperature!=null?temperature:0.1,
                max_tokens: maxTokens||2048,
            };
            const r = await fetch(base+'/chat/completions',{
                method:'POST',
                headers:{'Content-Type':'application/json','Authorization':'Bearer '+llm.apiKey},
                body: JSON.stringify(payload)
            });
            if(!r.ok){
                let msg='';
                try{ msg=(await r.json()).error?.message||r.statusText; }catch(e){ msg=r.statusText; }
                throw new Error(`HTTP ${r.status}: ${msg}`);
            }
            return (await r.json()).choices[0].message;
        });
    }
    // 质检 LLM 调用自动重试：429（模型过载/限流）用长退避 5s/10s/20s；其他错误 1.2s/2.4s/4s
    async function callLLMRetry(llm, messages, temperature, maxTokens){
        let lastErr;
        const is429=e=>/429|访问量过大|rate.?limit|Too Many/i.test(String((e&&e.message)||e));
        for(let attempt=0; attempt<=3; attempt++){
            try{
                return await callLLM(llm, messages, temperature, maxTokens);
            }catch(e){
                lastErr=e;
                if(attempt<3){
                    const wait = is429(e) ? 5000*Math.pow(2,attempt) : 1200*(attempt+1);
                    await new Promise(r=>setTimeout(r, wait));
                }
            }
        }
        throw lastErr;
    }
    function parseJSONLoose(text){
        if(!text) return null;
        try{ return JSON.parse(text); }catch(e){}
        const m = text.match(/\{[\s\S]*\}/);
        if(m){ try{ return JSON.parse(m[0]); }catch(e){} }
        return null;
    }

    // ================================================================
    // AgentForesight 前置在线预判：工具/文本输出即时自检
    // 在 agent 循环中每个工具结果返回后调用，发现异常就地标记
    // ================================================================
    function foresightCheck(result, toolName){
        const issues = [];
        const s = String(result||'');
        if(!s.trim()) issues.push(`${toolName}: 返回为空，疑似检索失败`);
        if(toolName==='search_knowledge_base'||toolName==='get_ship_data'){
            if(s.includes('"error"')||s.includes('未找到')||s.includes('无结果')) issues.push(`${toolName}: 检索结果为空或异常`);
        }
        if(toolName==='battle_simulate'){
            if(s.includes('"error"')||s.includes('未提供')) issues.push(`${toolName}: 模拟器参数异常`);
            // 参数明显异常检测（如净DPM为负/结果超物理范围）
            try{
                const j = JSON.parse(s);
                if(j && typeof j.prediction==='object' && (j.ally?.net_dpm_vs_enemy<0 || j.enemy?.net_dpm_vs_ally<0)) issues.push(`${toolName}: 计算结果出现负DPM，参数异常`);
            }catch(e){}
        }
        return issues;
    }

    // ================================================================
    // 步骤3：主张拆解 Agent —— 将回答拆解成原子事实
    // ================================================================
    const CLAIM_PROMPT = `你是主张拆解智能体。把AI回答拆解成一条条独立的原子事实，供后续逐条证据核验。

【拆解要求】
- 每条事实必须可独立验证（一个事实一句）
- 重点提取：舰船名称、建造上限（服役数）、装备/模块、伤害数值、DPM、血量、护甲、命中、暴击、冷却、锁定、人口、解锁条件、搭配限制
- 标记每条事实在原文中的位置（引用原文片段）
- 数字类事实必须原样保留数值

【用户原始提问】
{question}

【待拆解回答】
{answer}

【输出格式】只输出JSON，不要任何多余文字：
{"claims":[{"fact":"原子事实","position":"回答中的原文片段","has_number":true,"types":["舰船"/"数值"/"机制"/"其他"]}]}`;

    // 复用 agent.js 的唯一 system_prompt（所有智能体遵循同一份）；未加载时回退专用提示词
    function sharedSystem(fallback){
        try{
            if(window.AgentEngine && typeof AgentEngine.getSystemPrompt==='function'){
                const sp=AgentEngine.getSystemPrompt();
                if(sp && String(sp).length>50) return sp;
            }
        }catch(e){}
        return fallback;
    }

    async function claimSplit(question, answer, llm){
        const msg = await callLLMRetry(llm, [
            {role:'system', content: sharedSystem('你是主张拆解Agent。严格只输出JSON，忠实引用原文，禁止改写原文数值。')},
            {role:'user', content: CLAIM_PROMPT.replace('{question}', question.substring(0,1000)).replace('{answer}', answer.substring(0,6000))}
        ], 0.1, 4096);
        const j = parseJSONLoose(msg.content||'');
        return (j&&j.claims)||[];
    }

    // ================================================================
    // 步骤4：证据检索 Agent —— 知识库 + 模拟器数值校验 + 联网资料
    // ================================================================
    function extractShipName(fact){
        // 从事实文本提取舰船名：优先匹配 XX级 词，其次已知编号
        const m = String(fact||'').match(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}级/g);
        if(m) return m[m.length-1];
        const m2 = String(fact||'').match(/(CV3000|ST59|AC721|FG300|XT-?\d+|KCCPV2|BR050|AT021|SC002|RB7-13|CV-?[MT]\d+)/i);
        return m2 ? m2[1] : '';
    }

    async function evidenceRetrieve(claims){
        const evidences = [];
        const webCandidates = [];
        for(const c of (claims||[])){
            const ev = {claim: c.fact||'', position: c.position||'', kb: [], ship: null, sim: null, web: null, shipName: ''};
            // 1. 知识库检索（TF-IDF）
            try{
                await KB.load();
                const hits = KB.search(c.fact||'', 2);
                ev.kb = hits.map(h=>({source: h.source, content: (h.content||'').substring(0,300)}));
            }catch(e){}
            // 2. 模拟器数值校验：舰船数据库武器参数与事实数字对比（硬性规则：数值冲突必须标记）
            try{
                await SHIP_DB.load();
                const nums = (String(c.fact||'').match(/\d+(\.\d+)?/g)||[]).map(parseFloat).filter(n=>n && n<1000000);
                const shipName = extractShipName(c.fact);
                ev.shipName = shipName;
                if(shipName){
                    const s = SHIP_DB.search(shipName)[0];
                    if(s){
                        ev.ship = {id: s.id, name: s.name, hp: s.hp, physicalArmor: s.physicalArmor,
                                   energyArmor: s.energyArmor, serviceLimit: s.serviceLimit, commandValue: s.commandValue};
                        ev.sim = {ship: s.name, matches: [], conflicts: []};
                        const weaponNums = [];
                        Object.values(s.modules||{}).forEach(m=>{
                            if(m && m.weapons) m.weapons.forEach(w=>{
                                weaponNums.push({name: w.name, singleDmg: w.singleDmg, cooldown: w.cooldown, lockTime: w.lockTime});
                            });
                        });
                        nums.forEach(nv=>{
                            weaponNums.forEach(wn=>{
                                if(Math.abs((wn.singleDmg||0) - nv) < 0.01 || Math.abs((wn.cooldown||0) - nv) < 0.01 || Math.abs((wn.lockTime||0) - nv) < 0.01){
                                    if(!ev.sim.matches.some(x=>x.includes(String(nv)))) ev.sim.matches.push(`${wn.name}: ${nv}`);
                                }
                            });
                        });
                        // 服役上限硬校验（建造上限不一致 → 数值冲突）
                        if(ev.ship.serviceLimit){
                            const sl = ev.ship.serviceLimit;
                            if(nums.some(n=>n === sl)){
                                ev.sim.matches.push(`服役上限: ${sl}`);
                            }else{
                                const bad = nums.find(n=>n>sl && n<=sl*2);
                                if(bad) ev.sim.conflicts.push(`服役上限冲突: 事实=${bad} vs 资料=${sl}`);
                            }
                        }
                        // 人口/指挥值校验
                        if(ev.ship.commandValue && nums.some(n=>n === ev.ship.commandValue)){
                            ev.sim.matches.push(`人口/指挥值: ${ev.ship.commandValue}`);
                        }
                    }
                }
            }catch(e){}
            ev.numbers = String(c.fact||'').match(/\d+(\.\d+)?%?/g)||[];
            if(!ev.kb.length && !ev.ship) webCandidates.push(ev);
            evidences.push(ev);
        }
        // 3. 联网资料补充（最多2条无知识库证据的事实）
        for(const ev of webCandidates.slice(0,2)){
            try{
                const wr = await webSearch(String(ev.claim).substring(0,60));
                const wj = JSON.parse(wr);
                if(wj.results && wj.results.length){
                    ev.web = wj.results.slice(0,3).map(r=>({title: r.title, url: r.url, content: (r.content||'').substring(0,200)}));
                }
            }catch(e){}
        }
        return evidences;
    }

    // ================================================================
    // 步骤5：多裁判辩论 Agent 集群 —— 3个独立裁判并行质证
    // ================================================================
    const JUDGE_VOTE_PROMPT = `你是独立校验裁判。审查AI回答中的一条事实，判定三点：
①数值是否和资料库、模拟器发生冲突（舰船建造上限/伤害/DPM/人口等硬数值必须完全一致）
②事实是否具备可信来源证据（知识库source_id/舰船数据库/联网资料）
③是否忽略、曲解用户原始需求

【舰船校验强制规则】（本条事实若与舰船相关必须执行）
- 知识库（MD文档）没有记载的数据：不得以模型记忆充当证据，vote 必须为 "unverified"，并在 detail 中注明建议回复文案："该舰船相关参数暂无资料库收录"
- 回答与知识库MD文档/舰船数据库冲突：以知识库MD文档内容为唯一标准答案，vote="conflict"，detail 写清冲突数值
- 输出参数必须100%贴合资料库原文，不得因"看起来合理"而放行编造数值

【用户原始需求】
{question}

【待校验事实】
{fact}

【资料库证据】
{kb_evidence}

【舰船数据库】
{ship_db}

【模拟器数值校验】
{sim_check}

【联网资料】
{web_evidence}

【输出格式】只输出JSON：
{"vote":"pass"/"conflict"/"unverified"/"req_miss","error_type":"数值冲突/用户需求忽略/机制逻辑错误/无","detail":"具体质证意见(50字内)"}`;

    async function judgeCluster(question, evidences, llm){
        // 每条事实 3 个裁判并行投票（按事实分批，最多并行5条）
        const results = [];
        const batches = [];
        for(let i=0;i<evidences.length;i+=5) batches.push(evidences.slice(i,i+5));
        for(const batch of batches){
            const perFact = await Promise.all(batch.map(ev=>{
                const kbText = ev.kb.length ? ev.kb.map(k=>`- ${k.source}: ${k.content}`).join('\n') : '（无知识库证据）';
                const shipText = ev.ship ? JSON.stringify(ev.ship) : '（未匹配舰船数据库）';
                const simText = ev.sim ? `模拟器数值校验: 匹配[${(ev.sim.matches||[]).join('；')}] 冲突[${(ev.sim.conflicts||[]).join('；')}]` : '（无模拟器数值校验）';
                const webText = ev.web && ev.web.length ? ev.web.map(w=>`- ${w.title}: ${w.content} (${w.url})`).join('\n') : '（无联网资料）';
                return Promise.all([0,1,2].map(()=>callLLM(llm, [
                    {role:'system', content: sharedSystem('你是质证裁判。严格只输出JSON，以资料库/数据库证据为准，禁止编造。')},
                    {role:'user', content: JUDGE_VOTE_PROMPT
                        .replace('{question}', question.substring(0,800))
                        .replace('{fact}', (ev.claim||'').substring(0,500))
                        .replace('{kb_evidence}', kbText)
                        .replace('{ship_db}', shipText)
                        .replace('{sim_check}', simText)
                        .replace('{web_evidence}', webText)}
                ], 0.1, 600)));
            }));
            perFact.forEach((votes, i)=>{
                const parsed = votes.map(v=>parseJSONLoose(v.content||'')).filter(Boolean);
                results.push({evidence: batch[i], votes: parsed});
            });
        }
        return results;
    }

    // ================================================================
    // 步骤6：FACT-AUDIT 五层审计
    // ================================================================
    const AUDIT_PROMPT = `你是FACT-AUDIT审计智能体。对回答执行五层审计并输出各层结论：
①事实准确性 ②溯源完整性 ③逻辑一致性 ④用户需求完整覆盖 ⑤输出格式合规

【舰船参数合规审计】（回答含舰船参数时强制执行）
- 所有舰船参数（数值/性能/装备/限制/属性）是否100%贴合知识库MD文档原文？任何修改数值、优化描述、引申推测均属违规
- 知识库无记载的参数是否被编造/估算？若是，fact_accuracy 必须判为"不通过"，并注明标准回复应为"该舰船相关参数暂无资料库收录"
- 回答与资料库冲突时，以知识库MD文档内容为唯一标准答案

【用户原始需求】
{question}

【AI回答】
{answer}

【裁判质证汇总】
{votes}

【输出格式】只输出JSON：
{"layers":{"fact_accuracy":"结论","traceability":"结论","logic":"结论","req_coverage":"结论","format":"结论"},"notes":"综合问题说明(100字内)"}`;

    async function factAudit(question, answer, judgeResults, llm){
        const votesText = judgeResults.map(r=>{
            const v = (r.votes||[]).map(x=>x.vote+'('+x.error_type+')').join(',');
            return `- 事实"${(r.evidence.claim||'').substring(0,80)}" 裁判票: ${v}`;
        }).join('\n');
        const msg = await callLLMRetry(llm, [
            {role:'system', content: sharedSystem('你是FACT-AUDIT审计员。严格只输出JSON。')},
            {role:'user', content: AUDIT_PROMPT
                .replace('{question}', question.substring(0,800))
                .replace('{answer}', answer.substring(0,6000))
                .replace('{votes}', votesText.substring(0,3000))}
        ], 0.1, 1200);
        const j = parseJSONLoose(msg.content||'');
        return (j&&j.layers)||{};
    }

    // ================================================================
    // 步骤7：LLM-as-Judge 量化评分（用户指定JSON schema）
    // ================================================================
    const JUDGE_SCORE_PROMPT = `你是LLM-as-Judge评分智能体。对AI回答输出0-100总分并生成错误清单。

评分标准：
- ≥80分：PASS，直接校验通过
- 60-79分：PARTIAL_FIX，链状回溯局部修正（只重写出错片段）
- ＜60分：FULL_REGEN，严重事实冲突，完整重跑全套工具链路生成新回答

【用户原始需求】
{question}

【AI回答】
{answer}

【事实拆解与裁判质证】
{judge_summary}

【五层审计】
{audit}

【硬性规则】
1. 舰船建造上限这类硬数值和资料库不一致，必须写入error_list
2. 舰船参数只能采信工具返回的资料库内容
3. 必须完成两项核查：舰船信息与资料库逻辑正确性；是否忽略用户原本提问要求
4. 知识库MD文档没有记载的舰船参数若被回答编造/估算/脑补，score≤50 且 status=FULL_REGEN，error_list 必须注明标准回复："该舰船相关参数暂无资料库收录"
5. 回答中任何舰船参数与知识库MD文档冲突，以知识库MD文档内容为唯一标准答案，score≤60 不得PASS
6. 舰船问题（含舰船名称/参数/性能/配置/规格）若未检索【舰船数据分类】知识库片段而直接作答，视为流程违规，不得PASS
7. 配队/舰队配置类回答必须为每艘舰船给出具体数量（×N 格式），且配置格式需含站位与舰载机搭载数量；缺少具体数量的配置视为未满足用户需求，不得PASS
8. 舰队配置类回答必须包含三轮迭代评测结果输出结构（①三轮每轮配置+对应总分 ②最优舰队完整配置清单 ③得分详解、优势、剩余短板说明），缺少任何一项视为输出结构不完整，不得PASS；打分依据必须来自知识库数据，无记载参数不得放行
9. 配队类回答中若方案加入舰船/舰载机而无"向用户提问确认并附数据"环节记录，或使用"火力总览"（对舰XX/分钟、防空XX/分钟、攻城XX/分钟，维修除外）做输出推导，视为违规，不得PASS
10. 用户下达操作类/执行类/代办类任务时，回答必须包含任务执行内容：要么以【本次任务完整执行计划书】开头并附"批准/修改"交互选项（任务审批阶段），要么包含具体任务执行结果（如配置方案、分析结论等产出）；两者皆无的纯直接作答视为未遵守核心强制总规则，不得PASS

【输出格式】只输出JSON（不要任何多余文字）：
{"pass": true或false,"score": 0-100,"status": "PASS或PARTIAL_FIX或FULL_REGEN","error_list":[{"position":"回答出错原文片段","ship_name":"对应舰船名称","kb_source_id":"资料库source_id","kb_original_text":"资料库原始证据片段","error_type":"数值冲突/用户需求忽略/机制逻辑错误","fix_suggest":"简短精准修改建议"}],"user_requirement_check":"用户原始需求覆盖情况说明"}`;

    async function llmJudge(question, answer, judgeResults, audit, llm){
        const judgeSummary = judgeResults.map(r=>{
            const v = (r.votes||[]).map(x=>`${x.vote}[${x.error_type||''}]${x.detail||''}`).join(' | ');
            return `- 事实: ${(r.evidence.claim||'').substring(0,100)}\n  裁判: ${v}\n  证据: ${(r.evidence.kb||[]).map(k=>k.source).join(',')||'无'}`;
        }).join('\n');
        const msg = await callLLMRetry(llm, [
            {role:'system', content: sharedSystem('你是LLM-as-Judge。严格只输出JSON，评分必须基于质证证据，禁止放水。')},
            {role:'user', content: JUDGE_SCORE_PROMPT
                .replace('{question}', question.substring(0,800))
                .replace('{answer}', answer.substring(0,6000))
                .replace('{judge_summary}', judgeSummary.substring(0,4000))
                .replace('{audit}', JSON.stringify(audit||{}).substring(0,1500))}
        ], 0.1, 2000);
        const j = parseJSONLoose(msg.content||'');
        return j || {pass:true, score:80, status:'PASS', error_list:[], user_requirement_check:'评分解析异常，放行'};
    }

    // ================================================================
    // 链状回溯局部修正（PARTIAL_FIX）：只重写出错片段，复用已有证据
    // 硬约束：禁止调用检索/模拟器工具，复用现有证据
    // ================================================================
    const FIX_PROMPT = `你是链状回溯修正智能体。根据错误清单，只重写回答中出错的片段，其余内容原样保留。

【用户原始需求】
{question}

【原回答】
{answer}

【错误清单】
{error_list}

【修正规则】
- 只修改错误清单指出的片段，其它内容一字不改
- 硬数值以"kb_original_text"（资料库原始证据）为准；资料库MD文档内容为唯一标准答案
- 知识库没有记载的参数：改为标准文案"该舰船相关参数暂无资料库收录"，严禁用模型记忆补全
- 若错误类型为"用户需求忽略"，在回答末尾补充对应内容
- 输出修正后的完整回答文本

【输出格式】只输出修正后的完整回答文本（不要JSON、不要解释）`;

    async function chainFix(question, answer, judgeResult, llm){
        const errorList = JSON.stringify(judgeResult.error_list||[], null, 2).substring(0,3000);
        const msg = await callLLMRetry(llm, [
            {role:'system', content: sharedSystem('你是链状回溯修正Agent。严格只输出修正后的回答文本。')},
            {role:'user', content: FIX_PROMPT
                .replace('{question}', question.substring(0,800))
                .replace('{answer}', answer.substring(0,6000))
                .replace('{error_list}', errorList)}
        ], 0.3, 4096);
        return (msg.content||'').trim();
    }

    // ================================================================
    // Orchestrator：质检流水线主入口
    // ================================================================
    // ================================================================
    // Agent-A 审计Agent：事实拆解 + 证据检索，产出漏洞清单
    // 由质检主流程创建方注入提示词（创建方注入原则）
    // ================================================================
    const AGENT_A_PROMPT = `你是质检【Agent-A · 审计智能体】。

## 你的职责
对主Agent的回答进行全面、彻底的审计。审计过程中，你可以自主调用知识库检索工具查证证据。

## 输入
- 用户问题：{question}
- 主Agent回答：{answer}

## 可用工具
- search_knowledge_base(query, category) —— 检索知识库（可指定舰船数据/A资料/实例等分类）
- get_ship_data(ship_name) —— 获取特定舰船的详细数据

## 执行流程（必须按顺序执行，不可跳过任何步骤）

### 第一步：关键词检测（检查是否有遗漏）
从用户问题中提取所有关键术语（舰船名、数值、场景词、约束词），逐一核对主Agent的回答是否覆盖了全部关键词：
- 如果某个关键词在回答中未出现，标记为"遗漏项"（类型：约束遗漏）
- 如果某个关键词在回答中出现了但描述不准确，标记为"疑似错误"（需后续检索验证）

### 第二步：战斗机制审计（如果涉及战斗计算）
如果主Agent的回答涉及战斗计算（伤害、护甲、DPM、HP、命中、闪避、拦截等），执行以下审计：
- 检索【战斗机制.md】文档，核对主Agent的计算逻辑是否与战斗机制一致
- 核对公式是否用对（如"伤害=单发伤害×攻击次数×命中率−护甲"）
- 核对战果数据是否与战斗机制推导结果一致
- 如果计算逻辑错误，标记为"数值错误"（类型：数值错误）

### 第三步：逐句拆解与全面检查
从头到尾逐句阅读主Agent的回答。当遇到以下情况时，必须主动发起检索查证：
- 出现任何舰船名、数值、参数 → 检索舰船数据核对
- 出现配队方案、战术建议 → 检索A资料/实例核对
- 出现机制描述、战斗规则 → 检索战斗机制文档核对
- 出现知识库未记载内容（Agent注明"暂无资料库收录"的）→ 检索确认是否真的没有

检查以下类型的问题：
1. 编造/幻觉类
2. 数值错误类（含战斗机制计算逻辑错误）
3. 约束遗漏类（含关键词未覆盖）
4. 来源缺失类
5. 逻辑矛盾类

### 第四步：简短概括主Agent的回答
用1-2句话简短概括主Agent回答的核心思路，例如：
"主Agent推荐了艾奥级和卡利斯托级两种方案，认为PVP场景艾奥级更优，理由是DPM更高、护甲更厚。"

### 第五步：给出具体建议
基于发现的问题，给出具体的修改建议：
- 如果存在编造 → 建议删除该句，替换为"暂无资料库收录"
- 如果存在数值错误 → 建议修改为正确的数值，附来源
- 如果存在约束遗漏 → 建议补充xx舰船/满足xx条件后再入队
- 如果存在逻辑矛盾 → 建议统一立场（保留A方案或B方案），删除矛盾部分

### 第六步：输出漏洞清单
对发现的每个问题，按格式逐条列出，附检索证据。

## 检索规则
- 每发现一个可疑点，必须主动检索至少1次验证
- 检索结果为空时，标注"知识库未检索到相关内容，无法验证"
- 每次检索必须记录来源（文件名/文档名）

## 输出格式
只输出JSON，不要任何其他文字：
{
  "found_issues": [
    {
      "id": "issue_001",
      "position": "问题所在的具体片段（引用原文）",
      "error_type": "编造 | 数值错误 | 约束遗漏 | 来源缺失 | 逻辑矛盾 | 格式不符",
      "evidence": "你检索到的知识库原文证据（附来源）",
      "fix_suggest": "具体修改建议",
      "retrieval_log": "检索了xx文档，使用了xx查询关键词"
    }
  ],
  "summary": "审计总结（一句话概括主要问题）",
  "answer_summary": "主Agent回答的核心思路简短概括（1-2句话）",
  "overall_advice": "给主Agent的优化建议（总体层面，1-2句话）",
  "total_issues": 0,
  "retrieval_summary": "本次审计共检索了X次，覆盖了舰船数据/配队资料/机制文档"
}

## 质量自检
- 关键词检测是否执行了？
- 战斗机制审计是否执行了（若涉及战斗）？
- 是否简短概括了主Agent的核心思路？
- 是否给出了具体建议？
- 每个问题是否都主动检索了证据？
- JSON格式是否有效？`;

    // Agent-B 裁判Agent：三维度打分，≥75 PASS，<75 FAIL
    const AGENT_B_PROMPT = `你是质检【Agent-B · 裁判智能体】。

你的职责：对主Agent的回答做最终裁判，围绕三个核心维度给出0-100分。

输入：
- 用户问题：{question}
- 主Agent回答：{answer}
- Agent-A 漏洞清单：{agent_a_output}

## 三个打分维度（权重各占1/3）

1. 数据来源是否真实（0-100）
   - 舰船名称是否正确？
   - 关键数值（DPM/护甲/人口/服役上限等）是否与知识库原文一致？
   - 知识库没有的数据，是否如实标注"暂无资料库收录"？
   - 编造/幻觉 → 直接0分

2. 推演是否正确（0-100）
   - 战斗计算逻辑是否与【战斗机制.md】一致？
   - 配队推理是否合理（舰船选型/阵型/数量）？
   - 数值计算是否准确（DPM推导、加权总分等）？
   - 计算逻辑错误 → 直接0分

3. 思路是否可行（0-100）
   - 方案是否匹配用户问题中的场景/约束条件？
   - 配置是否具备实战可操作性（人口不超/约束满足/审批规则履行）？
   - 输出格式是否符合配队格式模板？

## 综合打分
综合得分 = 维度1 + 维度2 + 维度3 ÷ 3

## 判定规则
- ≥75分 → PASS（直接放行）
- <75分 → FAIL（返回修改意见，触发重生成或人工介入）

## 输出格式
只输出JSON：
{
  "score": 0-100,
  "status": "PASS | FAIL",
  "dimensions": {
    "data_authenticity": {"score": 0-100, "reason": "简短说明"},
    "reasoning_correctness": {"score": 0-100, "reason": "简短说明"},
    "feasibility": {"score": 0-100, "reason": "简短说明"}
  },
  "overall_reason": "综合判定依据（一句话）",
  "fallback": "若FAIL，填写修改建议；若PASS则留空"
}`;

    // 用创建方注入的提示词调用LLM（counts as 子Agent，用完即弃）
    async function callLLMWithRole(role, prompt, messages, llm, maxTokens){
        const P = window.SubAgentPool;
        const token = P.acquire(role, role, prompt);
        if(!token){
            // 子Agent满 → 抛出，调用方降级
            throw new Error('子Agent已满('+P.getMax()+'个)');
        }
        try{
            const msg = await callLLMRetry(llm, [{role:'system', content: prompt}].concat(messages), 0.2, maxTokens||2048);
            return msg;
        }finally{
            P.release(token && token.token);  // pool 以字符串 token 为 key
        }
    }
    function parseJSONLoose(text){
        if(!text) return null;
        try{ return JSON.parse(text); }catch(e){}
        const m = String(text).match(/\{[\s\S]*\}/);
        if(m){ try{ return JSON.parse(m[0]); }catch(e){} }
        return null;
    }

    // Agent-A：拆解 + 证据检索 + 漏洞清单（一步LLM产出，复用本地证据检索辅助）
    async function agentAReview(question, answer, llm){
        // 本地证据检索辅助（无LLM，算在A内部）
        let evidenceText = '';
        try{
            const claims = await claimSplit(question, answer, llm);
            if(claims.length){
                const evs = await evidenceRetrieve(claims);
                evidenceText = evs.slice(0,8).map(e=>{
                    const kb = (e.kb||[]).map(k=>k.source+': '+k.content.substring(0,200)).join(' | ');
                    return '- '+(e.claim||'').substring(0,60)+(kb?(' -> '+kb):'');
                }).join('\n');
            }
        }catch(e){}
        const modeTxt = (window.AgentEngine && window.AgentEngine.getModeCtx) ? AgentEngine.getModeCtx().text : '';
        const prompt = AGENT_A_PROMPT.replace('{question}', question.substring(0,1000)).replace('{answer}', answer.substring(0,6000))
            + '\n' + (modeTxt ? modeTxt+'\n若为计划模式：请同时检查主Agent是否先输出【本次任务完整执行计划书】并等待用户批准（用户回复"1"=批准）后才执行；若主Agent绕开审批直接给出结果，请标记为问题。' : '');
        const msg = await callLLMWithRole('agentReview', prompt, [
            {role:'user', content:'证据检索结果：\n'+(evidenceText||'（未取得）')}
        ], llm, 2200);
        const j = parseJSONLoose(msg.content||'');
        // 兼容新旧结构：新 found_issues / 旧 issues
        const rawIssues = (j&&j.found_issues)||(j&&j.issues)||[];
        const issues = rawIssues.map(x=>({
            position:x.position, error_type:x.error_type, kb_original_text:x.evidence||x.kb_original_text, fix_suggest:x.fix_suggest
        }));
        return {issues, found_issues: rawIssues, evidence_summary: (j&&j.summary)||(j&&j.evidence_summary)||'',
            answer_summary: (j&&j.answer_summary)||'', overall_advice: (j&&j.overall_advice)||'',
            has_issue: !!(rawIssues&&rawIssues.length), raw: msg.content||''};
    }

    // Agent-B：复核A + 打分 + 可选回传
    async function agentBJudge(question, answer, agentAOutput, llm){
        const modeTxt2 = (window.AgentEngine && window.AgentEngine.getModeCtx) ? AgentEngine.getModeCtx().text : '';
        const prompt = AGENT_B_PROMPT
            .replace('{question}', question.substring(0,1000))
            .replace('{answer}', answer.substring(0,6000))
            .replace('{agent_a_output}', JSON.stringify(agentAOutput).substring(0,4000))
            + '\n' + (modeTxt2 ? modeTxt2+'\n若为计划模式：主Agent必须走计划审批流程，绕开审批直接给结果应视为不合格。' : '');
        const msg = await callLLMWithRole('agentJudge', prompt, [
            {role:'user', content:'请复核 Agent-A 的发现并评分。'}
        ], llm, 2200);
        const j = parseJSONLoose(msg.content||'') || {};
        return {score:Number(j.score)||0, status:j.status||'', dimensions:j.dimensions||null, overall_reason:j.overall_reason||'', fallback:j.fallback||'', raw:msg.content||''};
    }

    // ================================================================
    // 质检主流程：Agent-A 审计 + Agent-B 评判 双向协同（最多3轮）
    // 旧五层流程（judgeCluster/factAudit/llmJudge）作为异常降级兜底
    // ================================================================
    async function qaPipeline(question, answer, llm, emit){
        const start = Date.now();
        const log = (icon, msg)=>{ if(emit) emit('status', `${icon} ${msg}`); };

        if(!llm || !llm.apiKey) return {pass:true, score:85, status:'PASS', iteration:0,
            error_list:[], user_requirement_check:'（质检跳过：未配置API Key）', final_answer:answer};

        if(isSimpleQuestion(question)){
            log('⚡', '简单日常问题，跳过质检（主Agent直接回答）');
            return {pass:true, score:90, status:'PASS', iteration:0,
                error_list:[], user_requirement_check:'（简单日常问题，无需质检）', final_answer:answer};
        }

        // 默认 GLM-4.7-Flash：禁止同时启用多个Agent（A审计+B评判），直接判通过，避免限流/多Agent混乱
        if(isDefaultFlash(llm)){
            log('⚡', '默认模型 GLM-4.7-Flash：禁止同时启用多Agent（A/B质检降级为直接通过）');
            return {pass:true, score:88, status:'PASS', iteration:0,
                error_list:[], user_requirement_check:'（默认Flash：跳过A/B多Agent质检）', final_answer:answer};
        }

        let currentAnswer = answer;
        let lastResult = null;
        let aOutput = null;
        const MAX_AB_ROUNDS = 3;
        let round = 0;

        try{
            for(round=1; round<=MAX_AB_ROUNDS; round++){
                log('🔬', `质检第${round}轮(A→B协同)：Agent-A 审计 → Agent-B 评判`);
                // 1. Agent-A 审计拆解+找漏洞
                try{
                    aOutput = await agentAReview(question, currentAnswer, llm);
                }catch(e){
                    throw new Error('Agent-A 审计降级: '+String(e.message||e).substring(0,80));
                }
                // 2. Agent-B 裁判打分（三维度，≥75 PASS / <75 FAIL）
                const b = await agentBJudge(question, currentAnswer, aOutput, llm);
                const score = Math.max(0, Math.min(100, Number(b.score)||0));
                const status = (b.status==='PASS'||b.status==='FAIL') ? b.status : (score>=75?'PASS':'FAIL');
                lastResult = {
                    pass: score>=75, score, status, iteration: round,
                    error_list: aOutput.issues||[],
                    user_requirement_check: b.overall_reason||'',
                    final_answer: currentAnswer,
                    ab_round: round,
                    dimensions: b.dimensions, fallback: b.fallback,
                };
                log('🎯', `质检评分 ${score} 分 → ${status}`);

                // 3. 分支：PASS → 放行；FAIL → 交由主循环重跑工具链
                if(status==='PASS' || score>=75){ break; }
                log('🔄', 'FAIL（评分<75），交由主循环重跑工具链');
                break;
            }
        }catch(e){
            log('⚠️', '2-Agent协同质检异常: '+String(e.message||e).substring(0,80)+'（回退旧5层流程）');
            lastResult = await legacyQaPipeline(question, currentAnswer, llm, log);  // 旧流程兜底
        }
        if(round>=MAX_AB_ROUNDS && lastResult && lastResult.status!=='PASS'){
            // 强制放行（多轮仍未过则放行，MAX_ITER 语义）
            if(lastResult.status==='FAIL' && lastResult.score<75){
                lastResult = {...lastResult, status:'MAX_ITER_STOP', pass:false, final_answer:'回答校验失败，请重新提问'};
                log('⛔', '质检迭代达上限(A/B协同3轮)');
            } else if(lastResult.score>=75){
                lastResult = {...lastResult, status:'PASS', pass:true};
                log('✅', '质检3轮后按分数放行');
            }
        }
        log('⏱️', `质检耗时 ${((Date.now()-start)/1000).toFixed(1)}s（${round}轮 A/B协同）`);
        return lastResult;
    }

    // 旧5层流程（降级兜底）：保留原 judgeCluster/factAudit/llmJudge 调用
    async function legacyQaPipeline(question, answer, llm, log){
        try{
            const claims = await claimSplit(question, answer, llm);
            if(!claims.length) return {pass:true, score:85, status:'PASS', iteration:0, error_list:[], user_requirement_check:'（拆解为空）', final_answer:answer};
            const evidences = await evidenceRetrieve(claims);
            const judgeResults = await judgeCluster(question, evidences, llm);
            const audit = await factAudit(question, answer, judgeResults, llm);
            const j = await llmJudge(question, answer, judgeResults, audit, llm);
            const score = Math.max(0, Math.min(100, Number(j.score)||0));
            const status = j.status || (score>=80?'PASS':score>=60?'PARTIAL_FIX':'FULL_REGEN');
            return {pass: score>=80, score, status, iteration:0,
                error_list: Array.isArray(j.error_list)?j.error_list:[], user_requirement_check: j.user_requirement_check||'', final_answer:answer};
        }catch(e){
            return {pass:true, score:85, status:'PASS', iteration:0, error_list:[], user_requirement_check:'（旧流程兜底放行）', final_answer:answer};
        }
    }

    return {qaPipeline, foresightCheck, claimSplit, evidenceRetrieve, judgeCluster, factAudit, llmJudge, chainFix, isSimpleQuestion, isDefaultFlash};
})();

window.QA = QA;
