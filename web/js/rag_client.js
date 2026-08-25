/* ========================================
   RAG 静态向量库客户端（纯前端，纯静态）
   ----------------------------------------
   - 文档向量由离线预处理脚本 build_rag_index.py 生成到 data/rag_index.json
   - 用户前端只加载该向量库 + 生成 query 向量，不负责文档向量化/语义分析
   - query 向量来源按 query_source 自动适配：
       "api"  -> 调 embedding API（智谱/OpenAI 兼容，用 kb_embed_api/kb_embed_key）
       "local"-> 前端本地模型 transformers.js（需已通过 window.__embedPipeline 注入）
   - 未加载到向量库 / 不可用 -> RAG.ready()=false，调用方回退现有检索，不破坏主流程
   ======================================== */
const RAG = (function(){
    let index = null;   // {model, dim, query_source, chunks:[{content,source,chunkIndex,vector}]}
    let vecMap = null;  // key: source#chunkIndex -> vector
    let loaded = false;
    let loading = null;

    async function load(){
        if(loaded) return index;
        if(loading) return loading;
        loading = (async function(){
            try{
                // 用浏览器默认缓存（去掉 no-cache）：14MB 向量库不要每次重拉，避免检索卡死
                const ctl = (typeof AbortSignal!=='undefined' && AbortSignal.timeout) ? {signal:AbortSignal.timeout(15000)} : {};
                const r = await fetch((window.KB_BASE||'')+'data/rag_index.json', ctl);
                if(!r.ok) return null;
                index = await r.json();
                vecMap = new Map();
                (index.chunks||[]).forEach(c=>vecMap.set(c.source+'#'+c.chunkIndex, c.vector));
                loaded = true;
                return index;
            }catch(e){ return null; }
        })();
        const v = await loading; loading=null; return v;
    }
    function ready(){ return !!(index && vecMap); }
    // 生成 query 向量（按向量库 query_source 自动选路）
    async function queryEmbed(query){
        if(!index) return null;
        const qs = index.query_source || 'api';
        if(qs==='api') return await apiEmbed(query);
        if(qs==='local') return await localEmbed(query);
        return null;
    }

    // 调 embedding API（智谱 / OpenAI 兼容）
    async function apiEmbed(q){
        const cfg = JSON.parse(localStorage.getItem('lagrange_static_config')||'{}');
        const base = (cfg.kb_embed_api || cfg.glm_proxy_url || 'https://open.bigmodel.cn/api/paas/v4')
                        .replace(/\/+$/,'').replace(/\/embeddings$/,'');
        const key = cfg.kb_embed_key || cfg.glm_api_key
                    || (window.AgentEngine && AgentEngine.getActiveLLM ? AgentEngine.getActiveLLM().apiKey : '');
        const model = cfg.kb_embed_model || index.model || 'embedding-3';
        if(!key) throw new Error('未配置 embedding API Key');
        // 智谱 base 以 /api/paas/v4 结尾(含 /v4) -> 直接 +/embeddings；其它 OpenAI 兼容补 /v1
        const url = /\/v\d+$/.test(base) ? base+'/embeddings' : base+'/v1/embeddings';
        const r = await fetch(url, {method:'POST',
            headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
            body:JSON.stringify({model, input:q})});
        if(!r.ok) throw new Error('embedding HTTP '+r.status);
        const d = await r.json();
        const v = d.data && d.data[0] && d.data[0].embedding;
        if(!v) throw new Error('embedding 返回为空');
        return v;
    }

    // 本地模型（transformers.js）；当前未注入则抛错，让上层回退
    async function localEmbed(q){
        if(!window.__embedPipeline) throw new Error('本地embedding模型未加载(transformers.js)');
        const out = await window.__embedPipeline(q, {pooling:'mean', normalize:true});
        return Array.from(out.data);
    }

    // 语义检索：query 向量 × 静态 doc 向量 -> top-k（签名兼容 KbEmbed.semanticRetrieve）
    async function semanticRetrieve(query, candChunks){
        if(!ready()) throw new Error('RAG 向量库未加载');
        const qvec = await queryEmbed(query);
        if(!qvec) throw new Error('RAG query 向量为空');
        const results=[];
        for(const c of (candChunks||[])){
            const cv = vecMap.get(c.source+'#'+c.chunkIndex);
            if(cv) results.push({content:c.content, source:c.source, chunkIndex:c.chunkIndex, score:cosine(qvec,cv)});
        }
        results.sort((a,b)=>b.score-a.score);
        return results;
    }

    function cosine(a,b){
        let dot=0, na=0, nb=0;
        const n=Math.min(a.length,b.length);
        for(let i=0;i<n;i++){ dot+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i]; }
        if(!na||!nb) return 0;
        return dot/Math.sqrt(na*nb);
    }

    return {load, ready, queryEmbed, semanticRetrieve, get index(){return index;}};
})();
window.RAG = RAG;