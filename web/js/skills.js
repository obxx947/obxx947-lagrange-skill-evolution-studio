/* ========================================
   经验反思与自我进化系统（SkillSystem）
   ----------------------------------------
   1. 👍/👎 双反馈 → 独立反思流水线 → 沉淀 skill + 更新用户画像
   2. Skill 按需注入：一期关键词匹配，只注入与当前提问相关的 skill
      （禁止无条件全量注入；仅 /skill <名> 强制时才完整注入指定 skill）
   3. 用户画像：每轮只注入精简常驻摘要（≤20字），完整画像只存不随轮携带
   4. 工具自主创建（create_tool）+ 自检门禁（语法编译 + LLM逻辑审查出依据）
      + 运行失败自修复；Agent 创建的工具必须带"作用"标注并进入工具管理页
   ======================================== */
const SkillSystem = (function(){
    const SKILLS_KEY = 'lagrange_skills';
    const TOOLS_KEY  = 'lagrange_tools';
    const PROFILE_KEY= 'lagrange_user_profile';

    // ======== 存储 ========
    function loadSkills(){ try{ return JSON.parse(localStorage.getItem(SKILLS_KEY))||[]; }catch(e){ return []; } }
    function saveSkills(s){ try{ localStorage.setItem(SKILLS_KEY, JSON.stringify(s)); }catch(e){} }
    function loadTools(){ try{ return JSON.parse(localStorage.getItem(TOOLS_KEY))||[]; }catch(e){ return []; } }
    function saveTools(t){ try{ localStorage.setItem(TOOLS_KEY, JSON.stringify(t)); }catch(e){} }
    function loadProfile(){ try{ return JSON.parse(localStorage.getItem(PROFILE_KEY))||{full:'',condensed:'',updatedAt:0}; }catch(e){ return {full:'',condensed:'',updatedAt:0}; } }
    function saveProfile(p){ try{ localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); }catch(e){} }

    // ======== LLM 调用（独立，与主对话解耦） ========
    function getLLM(){ return (window.AgentEngine && AgentEngine.getActiveLLM) ? AgentEngine.getActiveLLM() : null; }
    function normalizeApiUrl(url){
        let base=String(url||'https://api.deepseek.com').trim().replace(/\/+$/,'');
        base=base.replace(/\/chat\/completions$/,'');
        base=base.replace(/\/v1\/chat\/completions$/,'');
        base=base.replace(/\/anthropic$/,'');
        base=base.replace(/\/v1$/,'');
        return base;
    }
    async function callLLM(messages, temperature, maxTokens){
        // 全局并发锁（默认模型固定 1 并发）：反思/工具审查等也统一串行，杜绝 429
        return (window.LLMLock||{run:(fn)=>fn()}).run(async ()=>{
            const llm=getLLM();
            if(!llm || !llm.apiKey) throw new Error('未配置API Key');
            let base=normalizeApiUrl(llm.apiUrl);
            // 版本路径（/v1、/v4 等）已包含时不追加（兼容智谱 /api/paas/v4）
            if(!/\/v\d+$/.test(base)) base+='/v1';
            const payload={model:llm.model, messages, temperature:temperature??0.3, max_tokens:maxTokens||4096};
            let signal=null;
            if(typeof AbortSignal!=='undefined' && AbortSignal.timeout) signal=AbortSignal.timeout(120000);
            const r=await fetch(base+'/chat/completions',{
                method:'POST',
                headers:{'Content-Type':'application/json','Authorization':'Bearer '+llm.apiKey},
                body:JSON.stringify(payload),
                ...(signal?{signal}:{})
            });
            if(!r.ok){
                let m='';
                try{ m=(await r.json()).error?.message||r.statusText; }catch(e){ m=r.statusText; }
                throw new Error('HTTP '+r.status+': '+m);
            }
            return (await r.json()).choices[0].message;
        });
    }
    async function callLLMRetry(messages, temperature, maxTokens){
        let lastErr;
        const is429=e=>/429|访问量过大|rate.?limit|Too Many/i.test(String((e&&e.message)||e));
        for(let i=0;i<=3;i++){
            try{ return await callLLM(messages, temperature, maxTokens); }
            catch(e){
                lastErr=e;
                if(i<3){
                    const wait = is429(e) ? 5000*Math.pow(2,i) : 1200*(i+1);
                    await new Promise(r=>setTimeout(r, wait));
                }
            }
        }
        throw lastErr;
    }
    function parseJSONLoose(text){
        if(!text) return null;
        try{ return JSON.parse(text); }catch(e){}
        const m=String(text).match(/\{[\s\S]*\}/);
        if(m){ try{ return JSON.parse(m[0]); }catch(e){} }
        return null;
    }

    // ======== 反思流水线（👍/👎 → 沉淀） ========
    const REFLECT_PROMPT = `你是【经验反思智能体】。用户对AI回答给出评价后，你需分析整段对话，提炼可复用经验。

输入：
- 用户评价方向：{feedback_type}（"like" 或 "dislike"）
- 用户评价原因（选填）：{feedback_text}（可能为空）
- 用户指定的评价位置（选填）：{feedback_position}（可能为空，如"第三段配队方案""关于艾奥级的那段"）
- 用户问题：{question}
- AI最终回答：{answer}
- 对话过程摘要（含工具调用、质检记录等）：{process}
- 已有Skill库摘要（用于查重）：{existing_skills_summary}

## 执行流程（必须按顺序执行，不可跳过）

### 第一步：解析评价方向与定位（最高优先级）
1. 评价方向判断：
   - feedback_type = "like" → 本次反思聚焦"做对了什么、哪些做法值得沿用"
   - feedback_type = "dislike" → 本次反思聚焦"错在哪、为什么错、以后怎么避免"
2. 评价位置定位：
   - 如果 feedback_position 非空 → 精确定位到用户指定的片段（如"第三段配队方案"），只分析该片段，忽略其余部分
   - 如果 feedback_position 为空 → 分析整段对话
3. 评价原因可用性：
   - 如果 feedback_text 非空且包含有效信息（长度≥5字）→ 优先使用用户提供的原因作为分析依据
   - 如果 feedback_text 为空或无效（过短/无实质内容）→ 根据对话内容自行推断有效模式和问题教训

### 第二步：结构化分析执行轨迹
分析{process}字段，按以下维度提取信息：
- 成功模式：本次对话中哪些做法有效？
- 错误模式：本次对话中哪些做法失败？
- 改进点：如果重来一次，哪些环节可以优化？

### 第三步：提炼用户画像
从整段对话中推断用户特征（基于事实，不得凭空猜测）：
- 游戏经验层次（新手/中坚/老玩家）
- 核心偏好（生存优先/输出优先/平衡/特定舰船偏好）
- 明确禁忌

### 第四步：Skill查重与决策
1. 检索{existing_skills_summary}，判断本次拟生成的Skill是否与已有Skill重复
2. 如果相似度 > 80%：不新建，输出 {"skill": null, "merge_target": "已有Skill名称"}
3. 如果相似度 50%-80%：输出 {"skill": {...}, "suggest_merge": "建议与XXX合并"}
4. 如果相似度 < 50%：正常生成新Skill

### 第五步：生成Skill草稿并自我评估
1. 根据分析结果生成Skill草稿（含name/summary/content/keywords/anti_patterns）
2. 自我评估草稿质量：
   - content是否在300字以内？
   - anti_patterns是否覆盖了本次错误的核心教训？
   - keywords是否准确匹配触发场景？
3. 如有不足，修正后输出最终版

## 输出格式（严格JSON）
{
  "profile_full": "完整用户画像（100字以内）",
  "profile_condensed": "精简用户画像（20字以内）",
  "patterns": ["成功/失败模式1", "成功/失败模式2"],
  "skill": null 或 {
    "name": "技能名称（4-8字）",
    "summary": "技能摘要（20字以内）",
    "content": "技能全文指令（300字以内）",
    "keywords": ["触发关键词1", "关键词2", "关键词3", "关键词4", "关键词5"],
    "anti_patterns": ["反模式1：避免xxx", "反模式2：不要xxx"]
  },
  "merge_target": "若建议合并，填写目标Skill名称；否则null",
  "version": 1,
  "refined_from": null
}

## 质量自检
- 是否根据feedback_type正确判断了反思方向（like→提炼成功，dislike→提炼教训）？
- 如果feedback_position非空，是否只分析了指定片段？
- 如果feedback_text为空，是否自行推断而非盲猜？
- 是否执行了Skill查重？
- JSON格式是否有效？`;

    // 自动模式（每次对话结束后自动考虑，无需用户评价）—— 宁缺毋滥
    const AUTO_REFLECT_PROMPT = `你是【经验反思智能体】。系统自动检测到一段对话已结束，无需用户评价，由你分析这段对话中的用户意图和纠正行为。

输入：
- 用户问题：{question}
- AI最终回答：{answer}
- 对话过程摘要（含工具调用、质检记录等）：{process}
- 完整对话历史（用于识别用户反复追问的内容）：{conversation_history}
- 已有Skill库摘要（用于查重）：{existing_skills_summary}

## 执行流程（必须按顺序执行）

### 第一步：识别用户意图
从对话中识别以下用户意图信号：

**1. 纠正信号（用户认为AI错了）**
关键词：不对、错了、应该是、不是这个、你搞错了、你理解错了
行为：用户提供了正确的信息、修正了AI说的数值或结论
→ 记录为"用户纠正"：纠正了什么？正确的内容是什么？

**2. 不满/不满意信号（用户对AI回答不满意）**
关键词：不行、不够、不好、太差了、没用、浪费、能不能认真点
行为：用户没有接受建议、表示拒绝、表达失望
→ 记录为"用户不满"：不满的点是什么？

**3. 反复追问信号（用户对同一主题有深度需求）**
行为：同一艘舰船、同一个战术词在对话中被提到≥3次
→ 记录为"反复需求"：用户反复问的是什么？为何反复问？

**4. 认可/接受信号（用户认为AI做对了）**
关键词：好的、就这个、可以、不错、采纳、靠谱、谢谢
行为：用户明确表示接受AI的建议
→ 记录为"用户认可"：认可了什么？

**5. 普通/中性信号**
对话正常进行，没有明显的积极或消极意图
→ 不做特殊记录，仅更新基础画像

### 第二步：提炼可沉淀内容
根据第一步识别的意图，提炼以下内容：

**如果有纠正：**
- 沉淀为【纠正记录】Skill（带触发词：该舰船/该场景/该问题）
- content写："用户曾纠正过：{纠正内容}。遇到{场景}时，优先采用{正确内容}，如未命中正确内容则按资料库默认逻辑处理。"

**如果有不满：**
- 沉淀为【用户偏好-禁忌】Skill
- content写："用户曾对{不满内容}表示不满，避免{做法}。"

**如果有反复追问：**
- 沉淀为【用户偏好-兴趣】Skill
- content写："用户对{主题}有深度需求，遇到相关{关键词}时优先给出详细方案。"

**如果有认可：**
- 判断该认可的内容是否可作为通用经验（配队思路/回答技巧）
- 是则沉淀为【常规Skill】；否则只更新用户画像

### 第三步：Skill查重与决策
1. 检索{existing_skills_summary}，判断本次拟生成的Skill是否已存在
2. 如果已存在：合并内容（如为纠正类，补充证据）
3. 如果不存在：新建Skill

### 第四步：更新用户画像
基于本次识别的意图，更新或补充用户画像：
- 偏好：从认可、接受中提炼
- 禁忌：从不满意、纠正中提炼
- 反复需求：从反复追问中提炼

## 输出格式（严格JSON）
{
  "intent_analysis": {
    "has_correction": true/false,
    "has_dissatisfaction": true/false,
    "has_repeated_need": true/false,
    "has_acknowledgment": true/false,
    "details": "意图分析摘要（一句话）"
  },
  "profile_full": "完整用户画像（100字以内，包含偏好、禁忌、反复需求）",
  "profile_condensed": "精简用户画像（20字以内）",
  "skill": null 或 {
    "name": "技能名称（4-8字）",
    "summary": "技能摘要（20字以内）",
    "content": "技能全文指令（300字以内）",
    "keywords": ["触发关键词1", "关键词2", "关键词3", "关键词4", "关键词5"],
    "skill_type": "纠正记录 | 用户偏好-禁忌 | 用户偏好-兴趣 | 常规Skill"
  },
  "merge_suggestion": "若建议合并，写'建议与[已有Skill名称]合并'；否则null"
}

## 质量自检
- 是否识别了用户的纠正行为？（如有）
- 是否识别了用户的不满/不满意？（如有）
- 是否识别了用户的反复追问？（如有）
- 用户的消极信号（纠正/不满）是否都记录了？
- JSON格式是否有效？`;

    // convMsgs: 该会话全部消息 [{role,content,meta}]
    // feedback: 'like' | 'dislike' | 'auto'(自动模式，无用户评价) | 用户填写的理由文本
    async function reflectExperience(convMsgs, feedback){
        const list=Array.isArray(convMsgs)?convMsgs:[];
        const lastUser=[...list].reverse().find(m=>m.role==='user');
        const lastAssist=[...list].reverse().find(m=>m.role==='assistant' && String(m.content||'').length>50);
        const question=lastUser?String(lastUser.content||'').substring(0,1000):'';
        const answer=lastAssist?String(lastAssist.content||'').substring(0,6000):'';
        const process=list.slice(-10).map(m=>{
            const r=m.role==='user'?'用户':m.role==='assistant'?'AI':(m.role==='system'?'系统':'工具');
            return r+': '+String(m.content||'').substring(0,150);
        }).join('\n');
        const isAuto = feedback==='auto';
        const fbType = isAuto ? 'auto' : (feedback==='like' ? 'like' : feedback==='dislike' ? 'dislike' : 'like');
        const fbText = (isAuto||feedback==='like'||feedback==='dislike') ? '' : String(feedback||'');
        const existingSkills = loadSkills().map(s=>s.name+(s.summary?'：'+s.summary:'')).join('; ')||'（无）';
        const historyTxt = list.map(m=>{
            const r=m.role==='user'?'用户':m.role==='assistant'?'AI':(m.role==='system'?'系统':'工具');
            return r+': '+String(m.content||'').substring(0,120);
        }).join('\n');
        const prompt = isAuto ? AUTO_REFLECT_PROMPT : REFLECT_PROMPT;
        const msg=await callLLMRetry([
            {role:'system',content:'你是经验反思智能体。严格只输出JSON。'},
            {role:'user',content:prompt
                .replace('{feedback_type}',fbType)
                .replace('{feedback_text}',fbText||'')
                .replace('{feedback_position}','')
                .replace('{question}',question)
                .replace('{answer}',answer)
                .replace('{process}',process.substring(0,3000))
                .replace('{conversation_history}',historyTxt.substring(0,4000))
                .replace('{existing_skills_summary}',existingSkills)}
        ],0.3,2500);
        const j=parseJSONLoose(msg.content||'');
        if(!j) throw new Error('反思输出解析失败');
        // 更新用户画像（完整画像只存，每轮只注入精简摘要）
        if(j.profile_full){
            const prof=loadProfile();
            prof.full=j.profile_full;
            prof.condensed=(j.profile_condensed||(j.profile_full.length>20?j.profile_full.substring(0,20):j.profile_full)).substring(0,20);
            prof.updatedAt=Date.now();
            saveProfile(prof);
        }
        // 沉淀 skill（同名合并，点赞+1）
        let skill=null;
        if(j.skill && j.skill.name && j.skill.content){
            const skills=loadSkills();
            const existing=skills.find(s=>s.name===j.skill.name);
            const anti=Array.isArray(j.skill.anti_patterns)?j.skill.anti_patterns.slice(0,6):[];
            if(existing){
                existing.summary=String(j.skill.summary||existing.name).substring(0,20);
                existing.content=j.skill.content;
                existing.keywords=Array.isArray(j.skill.keywords)?j.skill.keywords.slice(0,5):(existing.keywords||[]);
                if(anti.length) existing.anti_patterns=anti;
                existing.praise=(existing.praise||0)+1;
                skill=existing;
            }else{
                skill={id:'skill_'+Date.now(), name:j.skill.name, summary:String(j.skill.summary||j.skill.name).substring(0,20), content:j.skill.content, keywords:Array.isArray(j.skill.keywords)?j.skill.keywords.slice(0,5):[], anti_patterns:anti, skill_type:j.skill.skill_type||'', enabled:true, praise:1, lastUsed:0, createdAt:Date.now()};
                skills.unshift(skill);
            }
            saveSkills(skills);
        }
        return {profile:loadProfile(), patterns:Array.isArray(j.patterns)?j.patterns:[], skill};
    }

    // ======== 自动沉淀（每次对话结束后自动考虑是否沉淀，无需用户点赞） ========
    const AUTO_STATE_KEY = 'lagrange_auto_reflect';
    let autoReflecting = false;  // in-flight 锁：同一时刻只允许一个反思任务，防并发覆盖 skillStore
    function loadAutoState(){
        try{ return JSON.parse(localStorage.getItem(AUTO_STATE_KEY))||{}; }catch(e){ return {}; }
    }
    function saveAutoState(s){ try{ localStorage.setItem(AUTO_STATE_KEY, JSON.stringify(s)); }catch(e){} }

    // convId: 会话id；convMsgs: 该会话消息；onResult: 沉淀成功回调(skill)
    async function autoReflectIfNeeded(convId, convMsgs, onResult){
        try{
            if(autoReflecting) return;   // 已有反思在进行 → 跳过
            const list=Array.isArray(convMsgs)?convMsgs:[];
            const userTurns=list.filter(m=>m.role==='user' && String(m.content||'').trim()).length;
            if(userTurns<1) return;      // 无有效提问，无上下文可判断
            const st=loadAutoState();
            // 防重：同一会话自上次检测以来没有新增用户轮次 → 不重复空转
            if(st.lastConvId===convId && (st.checkedTurns||0) >= userTurns) return;
            autoReflecting=true;
            const result=await reflectExperience(list, 'auto');
            saveAutoState({lastAt:Date.now(), lastConvId:convId, checkedTurns:userTurns});
            if(result.skill && typeof onResult==='function'){
                try{ onResult(result.skill); }catch(e){}
            }
        }catch(e){
            // 自动反思失败静默（不打扰对话；下次有新增轮次会再尝试）
        }finally{
            autoReflecting=false;
        }
    }

    // ======== 按需注入（一期：关键词匹配） ========
    function tokenize(q){
        const t=String(q||'').toLowerCase(); const toks={};
        for(let i=0;i<t.length-1;i++){
            const c1=t.charCodeAt(i), c2=t.charCodeAt(i+1);
            if(c1>0x2e80 && c2>0x2e80){ const bi=t.substring(i,i+2); toks[bi]=(toks[bi]||0)+1; }
        }
        (t.match(/[a-z0-9]+/g)||[]).forEach(w=>{ if(w.length>1) toks[w]=(toks[w]||0)+1; });
        return toks;
    }
    // 只注入与当前提问相关的 skill（关键词命中）；预算内全文，超预算摘要；同时更新 lastUsed
    function getSkillContext(userMessage, budgetChars){
        const skills=loadSkills().filter(s=>s.enabled);
        if(!skills.length) return '';
        const q=String(userMessage||'');
        const qToks=tokenize(q);
        const scored=skills.map(s=>{
            const words=[s.name, s.summary, ...(s.keywords||[])].filter(Boolean);
            let score=0;
            words.forEach(w=>{
                if(q.includes(w)) score+=2;
                else{
                    const wt=tokenize(w);
                    for(const k in wt){ if(qToks[k]){ score+=1; break; } }
                }
            });
            return {s, score};
        }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score || (b.s.praise||0)-(a.s.praise||0));
        if(!scored.length) return '';
        const budget=budgetChars||1500;
        let text='', used=0, touched=[];
        for(const {s} of scored){
            const full='【经验skill·'+s.name+'】'+s.content;
            if(used+full.length<=budget){ text+=full+'\n'; used+=full.length; s.lastUsed=Date.now(); touched.push(s.id); }
            else text+='【经验skill·'+s.name+'（摘要）】'+s.summary+'\n';
        }
        if(touched.length){
            const all=loadSkills();
            all.forEach(s=>{ if(touched.includes(s.id)) s.lastUsed=Date.now(); });
            saveSkills(all);
        }
        return text;
    }
    // /skill <名> 强制完整注入
    function getSkillByName(name){
        const s=loadSkills().find(x=>x.name===name || x.name.includes(name) || String(name).includes(x.name));
        if(!s) return null;
        s.lastUsed=Date.now();
        saveSkills(loadSkills());
        return '【经验skill·'+s.name+'】（用户强制注入）'+s.content;
    }
    function getProfileSummary(){ return (loadProfile().condensed||'').substring(0,20); }

    // ======== 工具自主创建 + 自检门禁 + 自修复 ========
    function syntaxCheck(code){
        try{ new Function('args','emit','return '+String(code)); return {ok:true}; }
        catch(e){ return {ok:false, error:String((e&&e.message)||e)}; }
    }
    // LLM 逻辑审查：输出"逻辑依据"，检查通过才可激活
    async function selfCheckTool(tool){
        const syn=syntaxCheck(tool.code);
        if(!syn.ok) return {ok:false, basis:'❌ 语法编译失败: '+syn.error};
        try{
            // 强制检索知识库（如可用）作为审查依据
            let kbText='';
            try{
                if(window.KB){ await window.KB.load(); kbText=(await window.KB.search((tool.purpose||tool.name||''),6)).map(r=>'- '+r.source+': '+(r.content||'').substring(0,200)).join('\n'); }
            }catch(e){}
            const msg=await callLLMRetry([
                {role:'system',content:'你是工具安全审查员。审查自定义工具代码时，**必须强制检索知识库**，以知识库中的舰船数据、战斗机制文档、A资料等作为判断代码逻辑是否正确的**唯一依据**，严禁依赖模型内部知识进行判断。\n\n【强制检索要求】\n1. 审查任何涉及舰船名称、数值、战斗计算、配队逻辑的代码时，必须先调用 search_knowledge_base 检索对应资料\n2. 检索结果为空时，标注"知识库无此数据，无法验证逻辑"，ok 设为 false\n3. 检索到资料后，逐条核对代码中的逻辑是否与知识库原文一致\n\n【审查清单】（按优先级从高到低检查）\n1. 逻辑正确性（最高优先级，必须检索知识库验证）：\n   - 代码中的舰船名是否与知识库一致？\n   - 代码中的数值（DPM、护甲、人口等）是否与知识库原文一致？\n   - 代码中的战斗计算逻辑是否与【战斗机制.md】一致？\n   - 代码中的配队思路是否与A资料/实例中的成熟思路一致？\n2. 危险操作检查：\n   - 是否存在无限循环/死循环风险？\n   - 是否存在修改系统关键状态的操作？\n   - 是否存在外发用户敏感数据的操作？\n\n【输出格式】只输出JSON：\n{"ok": true 或 false, "basis": "逻辑依据(50字内)，必须引用知识库中的具体来源，例如：\'检索到舰船资料.md中艾奥级DPM为xxx，代码中为yyy，数值不一致\'", "kb_source": "引用的知识库来源（文件名或文档名）"}'},
                {role:'user',content:`工具名称: ${tool.name}\n工具作用: ${tool.purpose||tool.description||''}\n代码:\n${tool.code}\n\n【已为你检索到的知识库相关片段】\n${kbText||'（无检索结果）'}\n\n只输出JSON：{"ok":true或false,"basis":"逻辑依据(50字内)，必须引用知识库中的具体来源","kb_source":"引用的知识库来源（文件名或文档名）"}`}
            ],0.1,700);
            const j=parseJSONLoose(msg.content||'');
            return {ok: !!(j&&j.ok), basis: (j&&j.basis)||(j&&j.ok?'逻辑审查通过':'逻辑审查未通过'), kb_source: (j&&j.kb_source)||''};
        }catch(e){
            return {ok:false, basis:'❌ 逻辑审查调用失败: '+String(e.message||e).substring(0,80)};
        }
    }
    // create_tool 工具执行：LLM 传入 {name,purpose,code}；自动补全参数描述→自检→激活/禁用
    async function createToolFromLLM(args){
        const code=String(args&&args.code||'').trim();
        if(!code) return JSON.stringify({error:'未提供工具代码（code 字段）'});
        const name=String(args&&args.name||('tool_'+Date.now())).trim().substring(0,30);
        const purpose=String(args&&args.purpose||'').trim().substring(0,100);
        // LLM 依据代码生成描述与参数 schema
        let description=args&&args.description||purpose||name;
        let parameters={type:'object',properties:{}};
        try{
            const meta=await callLLMRetry([
                {role:'system',content:'你是工具元数据生成器。根据工具代码生成 OpenAI function calling 的 description 和 parameters(JSON Schema)。严格只输出JSON。\n\n【生成规则】\n1. description（80字内）：必须同时包含"做什么"和"什么时候用"。\n   - 格式：用于[目标]的[操作]，当[触发条件]时调用。\n   - 示例：用于查询舰船基础数据的工具，当用户询问某艘舰船的属性、数值或配置时调用。\n   - 避免：仅描述功能，不说触发条件。\n2. parameters.properties：从代码中提取所有参数，逐个生成：\n   - type：根据代码中的参数类型推断（string / number / boolean / object / array）\n   - description：说明该参数的含义、格式要求、示例值（如适用）\n3. required：标记代码中无默认值且必传的参数。\n\n只输出JSON：\n{"description":"用于[目标]的[操作]，当[触发条件]时调用。","parameters":{"type":"object","properties":{"参数名":{"type":"string","description":"参数含义、格式要求、示例"}},"required":["必填参数名"]}}'},
                {role:'user',content:`工具名: ${name}\n作用: ${purpose}\n代码:\n${code}\n\n只输出JSON：{"description":"用于[目标]的[操作]，当[触发条件]时调用。","parameters":{"type":"object","properties":{"参数名":{"type":"string","description":"参数含义、格式要求、示例"}},"required":["必填参数名"]}}`}
            ],0.1,800);
            const j=parseJSONLoose(meta.content||'');
            if(j){ description=j.description||description; if(j.parameters) parameters=j.parameters; }
        }catch(e){}
        const tool={id:'tool_'+Date.now(), name, purpose, description, parameters, code, status:'pending', logic_basis:'', createdAt:Date.now(), errorLog:[]};
        // 自检门禁（全自动，用户不插手）
        const check=await selfCheckTool(tool);
        tool.status=check.ok?'active':'disabled';
        tool.logic_basis=check.basis||'';
        const tools=loadTools(); tools.unshift(tool); saveTools(tools);
        // 简单功能简介（对齐 create_skill 返回里的摘要风格）：把 purpose/description 带进 note
        const brief=(tool.purpose||tool.description||tool.name).substring(0,80);
        return JSON.stringify({id:tool.id, name:tool.name, status:tool.status, logic_basis:tool.logic_basis, purpose:tool.purpose,
            note: tool.status==='active'
                ? '✅ 工具「'+tool.name+'」已创建并通过自检，已注册可用。功能简介：'+brief+'（后续对话可直接调用，无需重创）'
                : '⚠️ 工具「'+tool.name+'」已创建但未通过自检，已禁用（见逻辑依据）。功能简介：'+brief}, null, 2);
    }
    // 运行失败自修复：分析错误→生成修复版→重新自检
    async function repairTool(toolId, errorMsg){
        const tools=loadTools();
        const tool=tools.find(t=>t.id===toolId);
        if(!tool) return null;
        const msg=await callLLMRetry([
            {role:'system',content:'你是工具修复专家。根据运行错误修复工具代码。\n\n【修复流程】（按顺序执行）\n1. 分析错误：从 errorMsg 中提取错误类型（TypeError / ReferenceError / SyntaxError / 运行时逻辑错误）和错误发生的具体位置（行号/函数名）\n2. 定位问题：在原代码中找到对应的代码段，判断错误原因（变量未定义/作用域问题、类型不匹配、异步调用未 await、参数未校验、函数签名不兼容）\n3. 生成修复方案：简单错误（类型/语法/空值）直接修改对应行；逻辑错误重构相关代码段并加校验；异步问题检查 async/await 链\n4. 验证修复（生成前自检）：是否保持 async (args, emit) => 返回值 签名？是否引入新问题？是否最小改动？\n\n【修复约束】\n- 保持函数签名严格兼容：async (args, emit) => { ... return result; }\n- 只修复导致错误的部分，不做无关重构\n- 如错误信息不充分，在代码中添加必要的参数校验和错误捕获（try-catch）\n- 最多尝试修复 3 轮（本次为第 1 轮），如 3 轮仍失败，在代码中加注释说明\n\n【输出要求】\n只输出修复后的完整 JS 代码，不要任何解释、不要 Markdown 代码块标记。'},
            {role:'user',content:`工具作用: ${tool.purpose}\n原代码:\n${tool.code}\n\n运行错误:\n${String(errorMsg).substring(0,500)}\n\n输出修复后的完整代码：`}
        ],0.2,4000);
        let code=(msg.content||'').trim().replace(/^```(?:js|javascript)?/i,'').replace(/```$/,'').trim();
        if(!code) return null;
        tool.code=code;
        tool.errorLog=tool.errorLog||[];
        tool.errorLog.push({time:Date.now(), error:String(errorMsg).substring(0,300), fixed:true});
        const check=await selfCheckTool(tool);
        tool.status=check.ok?'active':'disabled';
        tool.logic_basis=check.basis||tool.logic_basis;
        saveTools(tools);
        return tool;
    }
    // ======== 对话直接创建 skill（用户口头要求"保存为skill"，LLM 调用 create_skill 工具） ========
    function createSkillFromRequest(args){
        const name=String(args&&args.name||'').trim();
        const content=String(args&&args.content||'').trim();
        if(!name||!content) return JSON.stringify({error:'缺少必要字段：name 和 content 必填'});
        const summary=String(args&&args.summary||name).substring(0,20);
        const keywords=(Array.isArray(args&&args.keywords)?args.keywords:[]).map(String).filter(Boolean).slice(0,5);
        const skills=loadSkills();
        const existing=skills.find(s=>s.name===name);
        if(existing){
            existing.summary=summary;
            existing.content=content;
            if(keywords.length) existing.keywords=keywords;
            existing.enabled=true;
            existing.lastUsed=Date.now();
        }else{
            skills.unshift({id:'skill_'+Date.now(), name, summary, content, keywords, enabled:true, praise:0, lastUsed:Date.now(), createdAt:Date.now()});
        }
        saveSkills(skills);
        return JSON.stringify({ok:true, name, summary, note:'已创建skill「'+name+'」（'+summary+'），可在 技能/工具 页查看，后续相关对话会自动注入'}, null, 2);
    }

    // 获取已激活的自定义工具（注册进 TOOLS）
    function getActiveTools(){
        return loadTools().filter(t=>t.status==='active').map(t=>({
            type:'function', function:{name:t.name, description:t.description||t.purpose||'自定义工具', parameters:t.parameters||{type:'object',properties:{}}}
        }));
    }
    // 执行自定义工具
    async function executeCustomTool(name, args, emit){
        const tool=loadTools().find(t=>t.name===name && t.status==='active');
        if(!tool) return JSON.stringify({error:'工具不可用: '+name});
        try{
            // 工具代码为 async (args, emit) => {...}；包装后立即以 args/emit 调用
            const fn=new Function('args','emit','return ('+tool.code+')(args, emit);');
            const result=await fn(args, emit);
            return (typeof result==='string')?result:JSON.stringify(result);
        }catch(e){
            const err=String((e&&e.message)||e);
            // 自动触发修复（1次），修复后本次返回错误说明
            try{ await repairTool(tool.id, err); }catch(_){}
            return JSON.stringify({error:'工具执行异常: '+err.substring(0,200), note:'已自动尝试修复，可在技能/工具管理页查看状态'});
        }
    }

    return {reflectExperience, autoReflectIfNeeded, createSkillFromRequest, getSkillContext, getSkillByName, getProfileSummary,
            createToolFromLLM, selfCheckTool, repairTool, getActiveTools, executeCustomTool,
            loadSkills, saveSkills, loadTools, saveTools, loadProfile, saveProfile};
})();

// 显式暴露到window（跨script标签访问）
window.SkillSystem = SkillSystem;
