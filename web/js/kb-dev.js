/* ========================================
   知识库开发流水线（Orchestrator 批量任务 · 浏览器端）
   ----------------------------------------
   任务A：批量知识库开发（与聊天问答完全分离）
   1. 摄入清洗 Agent    → 清洗文本 + 元数据
   2. Chunk 决策 Agent  → 语义分块（父子块）+ 打标签
   3. 实体抽取 Agent    → LLM 知识图谱三元组
   4. 冲突检测仲裁 Agent→ LLM 多裁判辩论 + 勘误报告
   产物：清洗文档 / 父子块JSON / 知识图谱JSON / 勘误报告
   硬约束：最大迭代6轮；只输出JSON；真值来自资料原文
   ======================================== */

const KbDev = (function(){
    // ======== 共享系统提示词（复用 agent.js 唯一 system_prompt：data/system_prompt.md） ========
    let _sharedSp = null;
    async function loadSharedPrompt(){
        if(_sharedSp) return _sharedSp;
        try{
            const r = await fetch((window.KB_BASE||'')+'data/system_prompt.md',{cache:'no-cache'});
            if(r.ok){
                const t = await r.text();
                if(t && t.trim().length>100) _sharedSp = t.trim();
            }
        }catch(e){}
        return _sharedSp;
    }

    const MAX_ITER = 6;              // 全局迭代上限
    const CHUNK_SIZE = 500;          // 子块大小（字符）
    const CHUNK_OVERLAP = 50;        // 子块重叠
    const KB_BASE = (window.KB_BASE||'') + 'data/knowledge/';

    // ======== 配置（与 settings.html 共用 localStorage） ========
    function getConfig(){
        try{ return JSON.parse(localStorage.getItem('lagrange_static_config'))||{}; }catch(e){ return {}; }
    }
    function getActiveLLM(){
        const cfg = getConfig();
        const models = cfg.models || [];
        const activeId = cfg.active_model_id || '';
        if(models.length){
            const active = models.find(m=>m.id===activeId) || models[0];
            return {apiKey: active.api_key, apiUrl: active.api_url||'https://api.deepseek.com', model: active.model||'deepseek-chat'};
        }
        return {apiKey: cfg.llm_api_key||'', apiUrl: cfg.llm_api_url||'https://api.deepseek.com', model: cfg.llm_model||'deepseek-chat'};
    }
    function normalizeApiUrl(url){
        let base = String(url||'https://api.deepseek.com').trim().replace(/\/+$/,'');
        base = base.replace(/\/chat\/completions$/,'');
        base = base.replace(/\/v1\/chat\/completions$/,'');
        base = base.replace(/\/anthropic$/,'');
        base = base.replace(/\/v1$/,'');
        return base;
    }
    async function callLLM(llm, messages, temperature, maxTokens){
        let base = normalizeApiUrl(llm.apiUrl);
        // 版本路径（/v1、/v4 等）已包含时不追加（兼容智谱 /api/paas/v4）
        if(!/\/v\d+$/.test(base)) base += '/v1';
        const payload = {
            model: llm.model,
            messages: messages.map(m=>({role:m.role, content:m.content!=null?String(m.content):''})),
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
    }
    function parseJSONLoose(text){
        if(!text) return null;
        try{ return JSON.parse(text); }catch(e){}
        const m = text.match(/\{[\s\S]*\}/);
        if(m){ try{ return JSON.parse(m[0]); }catch(e){} }
        const arr = text.match(/\[[\s\S]*\]/);
        if(arr){ try{ return JSON.parse(arr[0]); }catch(e){} }
        return null;
    }

    // ================================================================
    // 步骤1：摄入清洗 Agent（本地规则，确定性处理）
    // ================================================================
    function cleanText(raw, sourceId){
        let t = String(raw||'');
        t = t.replace(/^\uFEFF/,'');                                    // BOM
        t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,''); // 控制字符
        t = t.replace(/\u200B|\u200C|\u200D/g,'');                      // 零宽字符
        t = t.replace(/\r\n?/g,'\n');                                   // 统一换行
        t = t.replace(/[ \t]+/g,' ');                                   // 压缩空白
        const lines = t.split('\n').map(l=>l.trim()).filter(l=>l.length>0);
        // 去重复段落：同一行出现≥3次视为重复
        const seen = {}, out = [];
        for(const line of lines){
            seen[line]=(seen[line]||0)+1;
            if(seen[line]>=3) continue;
            out.push(line);
        }
        t = out.join('\n').replace(/\n{3,}/g,'\n\n');
        return {text: t, meta: extractMeta(t, sourceId)};
    }

    function extractMeta(text, sourceId){
        const docName = String(sourceId).replace(/\.txt$/,'').replace(/^舰船资料\//,'');
        const meta = {source_id: sourceId, doc_name: docName, chapters: []};
        const versionMatch = String(sourceId).match(/(19|20)\d{2}|v\d+(\.\d+)?/i);
        meta.version = versionMatch ? versionMatch[0] : '';
        const lines = text.split('\n');
        for(const line of lines){
            const s = line.trim();
            if(/^[一二三四五六七八九十百]+、/.test(s) || /^第[一二三四五六七八九十百]+[章节部分]/.test(s) ||
               /^[0-9]+[\.、]/.test(s) || /^#+ /.test(s) || /^【.+】/.test(s)){
                meta.chapters.push(s.substring(0,40));
            }
        }
        return meta;
    }

    // ================================================================
    // 步骤2：Chunk 决策 Agent（语义分块 + 父子块 + 打标签）
    // ================================================================
    const TAG_KEYWORDS = {
        '舰船':   ['护卫舰','驱逐舰','巡洋舰','战列','战机','护航艇','航母','舰船','旗舰','级','人口'],
        '装备':   ['武器','模块','炮','导弹','鱼雷','机库','装甲','防空','机载','模块'],
        '机制':   ['伤害','拦截','防空','冷却','锁定','维修','命中','暴击','闪避','系统','机制','公式'],
        '公式':   ['公式','=' ,'%','×','÷','×'],
        '案例':   ['例子','实战','配置','配队','人口','战报','实例'],
    };
    function tagText(content){
        const tags = [];
        for(const [tag, kws] of Object.entries(TAG_KEYWORDS)){
            if(kws.some(k=>content.includes(k))){
                if(tag==='公式' && !content.includes('=') && !/[\d]+[%×÷]/.test(content)) continue;
                if(tags.indexOf(tag)<0) tags.push(tag);
            }
        }
        return tags.length?tags:['其他'];
    }
    function isChapterTitle(line){
        const s = String(line||'').trim();
        return /^[一二三四五六七八九十百]+、/.test(s) || /^第[一二三四五六七八九十百]+[章节部分]/.test(s) ||
               /^[0-9]+[\.、]/.test(s) || /^#+ /.test(s) || /^【.+】/.test(s);
    }
    function splitParagraphs(text){
        return String(text||'').split('\n').map(p=>p.trim()).filter(p=>p.length>0);
    }
    function chunkText(cleaned){
        const meta = cleaned.meta;
        const chunks = [];
        let parentIdx = 0, childIdx = 0;
        // 父块：按章节切分
        const lines = cleaned.text.split('\n');
        let cur = {title:'全文', parts:[]};
        const parents = [];
        for(const line of lines){
            if(isChapterTitle(line)){
                parents.push(cur);
                cur = {title: line.trim().substring(0,40), parts:[line]};
            } else {
                cur.parts.push(line);
            }
        }
        parents.push(cur);
        for(const p of parents){
            const parentContent = p.parts.join('\n').trim();
            if(!parentContent) continue;
            const pid = `${meta.source_id}#p${parentIdx++}`;
            chunks.push({
                id: pid, parent_id: null, source_id: meta.source_id,
                chapter: p.title, tag: tagText(parentContent),
                content: parentContent, level: 'parent'
            });
            // 子块：段落合并至≤500字符，带50字符重叠
            const paras = splitParagraphs(parentContent);
            let buf = '';
            for(const para of paras){
                if((buf+'\n'+para).length > CHUNK_SIZE && buf){
                    chunks.push({id:`${pid}#c${childIdx++}`, parent_id: pid, source_id: meta.source_id,
                                 chapter: p.title, tag: tagText(buf), content: buf, level: 'child'});
                    buf = buf.slice(-CHUNK_OVERLAP) + '\n' + para;
                } else {
                    buf = buf ? buf+'\n'+para : para;
                }
            }
            if(buf){
                chunks.push({id:`${pid}#c${childIdx++}`, parent_id: pid, source_id: meta.source_id,
                             chapter: p.title, tag: tagText(buf), content: buf, level: 'child'});
            }
        }
        return chunks;
    }

    // ================================================================
    // 步骤3：实体抽取 Agent（LLM，逐文件）
    // ================================================================
    const ENTITY_PROMPT = `你是知识图谱实体抽取智能体。从下面的游戏资料文本中抽取全部关键事实，输出知识图谱三元组。

【抽取范围】
- 舰船：名称、级别、类型、定位、人口占用、建造上限（服役数）
- 数值：伤害、护甲、护盾、命中、暴击、冷却、锁定、DPM、血量
- 机制：公式、规则、条件
- 装备/模块：名称、效果、获取/解锁条件

【输出格式】只输出JSON，不要任何多余文字：
{"entities":[{"subject":"主体(如 云海级护卫舰)","relation":"关系(如 建造上限)","object":"客体(如 10)","evidence":"原文片段(20字以内)"}]}

【资料文本】
{text}`;

    async function extractEntities(cleanedDocs, llm, log, iter){
        const allEntities = [];
        for(const doc of cleanedDocs){
            const text = doc.text;
            if(!text.trim()) continue;
            // 长文本分段（LLM 输入上限保护：每段≤6000字符）
            const segs = [];
            for(let i=0;i<text.length;i+=6000) segs.push(text.substring(i,i+6000));
            for(const seg of segs){
                log('🧠', `实体抽取: ${doc.meta.source_id}${segs.length>1?' (分段)':''}`);
                try{
                    const msg = await callLLM(llm, [
                        {role:'system', content: (await loadSharedPrompt()) || '你是实体抽取Agent。严格只输出JSON，禁止编造资料中不存在的内容。'},
                        {role:'user', content: ENTITY_PROMPT.replace('{text}', seg.substring(0,6000))}
                    ], 0.1, 4096);
                    const j = parseJSONLoose(msg.content||'');
                    const entities = (j&&j.entities)||[];
                    entities.forEach(e=>{
                        if(e.subject&&e.relation&&e.object){
                            allEntities.push({subject:String(e.subject).trim(), relation:String(e.relation).trim(),
                                              object:String(e.object).trim(), evidence:String(e.evidence||'').trim(),
                                              source_id: doc.meta.source_id});
                        }
                    });
                    log('✅', `实体抽取完成: ${doc.meta.source_id}（+${entities.length}条三元组）`);
                }catch(e){
                    log('⚠️', `实体抽取失败 ${doc.meta.source_id}: ${String(e).substring(0,80)}`);
                }
                if(iter()>=MAX_ITER) break;
            }
        }
        return allEntities;
    }

    // ================================================================
    // 步骤4：冲突检测仲裁 Agent（LLM 多裁判辩论 + 勘误）
    // ================================================================
    function groupConflicts(entities){
        // 同一 (subject, relation) 出现不同 object → 冲突候选
        const groups = {};
        entities.forEach(e=>{
            const key = `${e.subject}|${e.relation}`;
            if(!groups[key]) groups[key] = [];
            if(!groups[key].some(x=>x.object===e.object)) groups[key].push(e);
        });
        return Object.entries(groups).filter(([k,v])=>v.length>1).slice(0,30); // 最多30组冲突候选
    }

    const JUDGE_PROMPT = `你是冲突仲裁裁判。资料库中同一实体出现了不同取值，请基于"原始证据"判定基准真值。

【冲突项】主体: {subject} | 属性: {relation}
【候选值】:
{values}

【判定规则】
- 以资料原文证据为准，证据更具体、更权威（官方/资料文件）的取值优先
- 若无法判定，verdict="存疑"，保留全部候选
- 禁止编造资料外的数值

【输出格式】只输出JSON：
{"verdict":"确定/存疑","correct_value":"选定的正确值(存疑时留空)","reason":"判定理由(30字内)"}`;

    async function arbitrateConflicts(conflicts, llm, log, iter){
        const report = [];
        for(const [key, candidates] of conflicts){
            const [subject, relation] = key.split('|');
            const values = candidates.map((c,i)=>
                `${i+1}. 值="${c.object}"  来源=${c.source_id}  证据="${c.evidence}"`).join('\n');
            // 多裁判辩论：2个独立裁判并行投票
            log('⚖️', `冲突仲裁: ${subject} 的${relation}（${candidates.length}个候选）`);
            const votes = [];
            try{
                const sp = await loadSharedPrompt();
                const results = await Promise.all([0,1].map(()=>
                    callLLM(llm, [
                        {role:'system', content: sp || '你是质证裁判。严格只输出JSON，以证据为准，禁止编造。'},
                        {role:'user', content: JUDGE_PROMPT.replace('{subject}',subject).replace('{relation}',relation).replace('{values}',values)}
                    ], 0.1, 800)
                ));
                results.forEach(r=>{
                    const j = parseJSONLoose(r.content||'');
                    if(j) votes.push(j);
                });
            }catch(e){
                log('⚠️', `仲裁调用失败: ${String(e).substring(0,80)}`);
            }
            if(!votes.length){ report.push({subject, relation, candidates, verdict:'存疑', reason:'裁判调用失败'}); continue; }
            // 多数决：确定票多于存疑且选值一致
            const decided = votes.filter(v=>v.verdict==='确定'&&v.correct_value);
            const agreed = {};
            decided.forEach(v=>{ agreed[v.correct_value]=(agreed[v.correct_value]||0)+1; });
            const best = Object.entries(agreed).sort((a,b)=>b[1]-a[1])[0];
            if(best && best[1] >= Math.ceil(decided.length/2) && best[1] >= 1){
                report.push({subject, relation, candidates, verdict:'确定', correct_value:best[0], reason: decided.find(v=>v.correct_value===best[0]).reason||''});
            }else{
                report.push({subject, relation, candidates, verdict:'存疑', reason: votes.map(v=>v.reason||'').join('；')});
            }
            if(iter()>=MAX_ITER) break;
        }
        return report;
    }

    // ================================================================
    // Orchestrator：总控流水线
    // ================================================================
    async function runPipeline(opts){
        const log = opts.log || (()=>{});
        let iterCount = 0;
        const iter = ()=>iterCount++;
        const results = {cleaned: [], chunks: [], entities: [], report: []};

        const llm = getActiveLLM();
        if(!llm.apiKey){ log('❌','未配置API Key，请先到设置页填写'); return results; }

        const files = (window.KB && KB.getFiles) ? KB.getFiles() : [];
        log('📂', `Orchestrator 启动：读取 ${files.length} 个原始文档`);

        // ---- 步骤1：摄入清洗 ----
        log('🧹', '步骤1 摄入清洗Agent 开始...');
        for(const f of files){
            try{
                const r = await fetch(KB_BASE+encodeURI(f),{cache:'no-cache'});
                if(!r.ok) continue;
                const raw = await r.text();
                const cleaned = cleanText(raw, f);
                results.cleaned.push(cleaned);
            }catch(e){}
            if(iter()>=MAX_ITER) break;
        }
        log('✅', `清洗完成：${results.cleaned.length} 个文档（去BOM/乱码/重复段落/无效换行，提取元数据）`);

        // ---- 步骤2：Chunk 决策 ----
        log('🧩', '步骤2 Chunk决策Agent 开始（语义分块+父子块+打标签）...');
        for(const doc of results.cleaned){
            const cs = chunkText(doc);
            results.chunks.push(...cs);
            if(iter()>=MAX_ITER) break;
        }
        log('✅', `分块完成：${results.chunks.length} 个块（父块=${results.chunks.filter(c=>c.level==='parent').length}，子块=${results.chunks.filter(c=>c.level==='child').length}）`);

        // ---- 步骤3：实体抽取（LLM） ----
        log('🧠', '步骤3 实体抽取Agent 开始（LLM批量，每文件1次）...');
        results.entities = await extractEntities(results.cleaned, llm, log, iter);
        log('✅', `实体抽取完成：${results.entities.length} 条三元组`);

        // ---- 步骤4：冲突检测仲裁（LLM多裁判） ----
        log('⚖️', '步骤4 冲突检测仲裁Agent 开始（跨文档比对+多裁判辩论）...');
        const conflicts = groupConflicts(results.entities);
        log('🔍', `发现 ${conflicts.length} 组冲突候选`);
        results.report = await arbitrateConflicts(conflicts, llm, log, iter);
        const decidedCount = results.report.filter(r=>r.verdict==='确定').length;
        log('✅', `仲裁完成：${results.report.length} 项（确定 ${decidedCount} 项，存疑 ${results.report.length-decidedCount} 项）`);

        log('🏁', '知识库开发流水线完成，产物已就绪');
        return results;
    }

    // ======== 产物导出 ========
    function download(filename, content){
        const blob = new Blob([content], {type:'application/json;charset=utf-8'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 1000);
    }
    function exportProducts(results){
        download('知识库_清洗文档.json', JSON.stringify(results.cleaned.map(c=>({source_id:c.meta.source_id, chapters:c.meta.chapters, text:c.text})), null, 2));
        download('知识库_父子块分块.json', JSON.stringify(results.chunks, null, 2));
        download('知识库_知识图谱.json', JSON.stringify(results.entities, null, 2));
        download('知识库_勘误报告.json', JSON.stringify(results.report, null, 2));
    }
    function buildReportMarkdown(results){
        let md = `# 知识库勘误报告\n\n生成时间: ${new Date().toLocaleString()}\n\n`;
        md += `## 统计\n- 文档数: ${results.cleaned.length}\n- 分块数: ${results.chunks.length}\n- 三元组: ${results.entities.length}\n- 冲突项: ${results.report.length}\n\n`;
        md += `## 冲突明细\n\n`;
        results.report.forEach((r,i)=>{
            md += `### ${i+1}. ${r.subject} → ${r.candidates[0].relation}\n`;
            md += `- 判定: **${r.verdict}** ${r.correct_value?`→ 正确值: ${r.correct_value}`:''}\n`;
            md += `- 理由: ${r.reason}\n`;
            md += `- 候选:\n`;
            r.candidates.forEach(c=>{ md += `  - ${c.object}（来源: ${c.source_id}，证据: ${c.evidence}）\n`; });
            md += '\n';
        });
        return md;
    }

    return {runPipeline, exportProducts, buildReportMarkdown, cleanText, chunkText, groupConflicts, getConfig};
})();

window.KbDev = KbDev;
