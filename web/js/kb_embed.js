/* ========================================
   Embedding 语义检索模块（网页版前端）
   ----------------------------------------
   - 调智谱 embedding-3 API（带 429 限流重试退避，复用已有 key/代理配置）
   - IndexedDB 缓存文档向量（渐进/懒计算，避免 1127 份全预哈希）
   - 余弦相似度计算
   ======================================== */
const KbEmbed = (function(){
    const DB_NAME = 'lagrange_rag_vectors';
    const STORE = 'vectors';
    const KEY_STORE = 'cached_texts';   // 缓存哪些 chunk 已算过向量

    // ======== 配置（复用 agent.js 的智谱 key / glm_proxy） ========
    function getEmbedCfg(){
        try{
            const cfg = JSON.parse(localStorage.getItem('lagrange_static_config')||'{}');
            const proxy = cfg.glm_proxy_url || '';
            // 向量通道：优先代理(隐藏key)；否则直连智谱(用内置/用户key)
            if(proxy){
                return {apiKey:'proxy', apiUrl:proxy, model:'embedding-3'};
            }
            const key = cfg.glm_api_key || (window.AgentEngine && AgentEngine.getActiveLLM ? AgentEngine.getActiveLLM().apiKey : '');
            return {apiKey:key, apiUrl:'https://open.bigmodel.cn/api/paas/v4', model:'embedding-3'};
        }catch(e){ return {apiKey:'', apiUrl:'https://open.bigmodel.cn/api/paas/v4', model:'embedding-3'}; }
    }

    // ======== 限流重试（429 → 指数退避，与 agent.js 一致） ========
    function is429(e){ return /429|Too Many|访问量过大|rate.?limit/i.test(String((e&&e.message)||e)); }
    async function embedText(text){
        const {apiKey, apiUrl, model} = getEmbedCfg();
        if(!apiKey) throw new Error('未配置 API Key 用于 embedding');
        let base = apiUrl.replace(/\/+$/,'');
        if(!/\/v\d+$/.test(base)) base += '/v1';
        let lastErr;
        for(let i=0;i<=3;i++){
            try{
                const r = await fetch(base+'/embeddings', {
                    method:'POST',
                    headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},
                    body:JSON.stringify({model, input:[text]})
                });
                if(!r.ok){
                    const j = await r.json().catch(()=>({}));
                    throw new Error('HTTP '+r.status+': '+((j&&j.error&&j.error.message)||r.statusText));
                }
                const d = await r.json();
                const emb = d && d.data && d.data[0] && d.data[0].embedding;
                if(!emb) throw new Error('返回无向量');
                return emb;
            }catch(e){
                lastErr = e;
                if(is429(e) && i<3){
                    await new Promise(res=>setTimeout(res, 3000*Math.pow(2,i+1)));
                    continue;
                }
                if(i<3){ await new Promise(res=>setTimeout(res, 1500*(i+1))); continue; }
            }
        }
        throw lastErr;
    }

    // ======== IndexedDB 缓存 ========
    function openDB(){
        return new Promise((res,rej)=>{
            try{
                const rq = indexedDB.open(DB_NAME, 1);
                rq.onupgradeneeded = ()=>{
                    if(!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE);
                    if(!rq.result.objectStoreNames.contains(KEY_STORE)) rq.result.createObjectStore(KEY_STORE);
                };
                rq.onsuccess = ()=>res(rq.result);
                rq.onerror = ()=>rej(new Error('IndexedDB打开失败'));
            }catch(e){ rej(e); }
        });
    }
    async function dbPut(store, k, v){
        try{ const db=await openDB(); await new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite'); tx.objectStore(store).put(v,k); tx.oncomplete=res; tx.onerror=rej;}); }catch(e){}
    }
    async function dbGet(store, k){
        try{ const db=await openDB(); return await new Promise((res,rej)=>{const tx=db.transaction(store,'readonly'); const rq=tx.objectStore(store).get(k); rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error);}); }catch(e){ return undefined; }
    }
    async function dbKeyExists(store, k){
        try{ const db=await openDB(); return await new Promise((res,rej)=>{const tx=db.transaction(store,'readonly'); const rq=tx.objectStore(store).getKey(k); rq.onsuccess=()=>res(!!rq.result); rq.onerror=()=>rej(rq.error);}); }catch(e){ return false; }
    }

    // ======== 余弦相似度 ========
    function cosine(a,b){
        if(!a||!b||a.length!==b.length) return 0;
        let dot=0, na=0, nb=0;
        for(let i=0;i<a.length;i++){ dot+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i]; }
        if(!na||!nb) return 0;
        return dot/Math.sqrt(na*nb);
    }

    // ======== 语义检索（懒计算：仅对候选 chunk 调 embedding，缓存复用） ========
    // chunks: [{content, source, chunkIndex}]（候选，来自TF-IDF top-k）
    // 返回: Promise<[{content,source,score(余弦)}]>
    async function semanticRetrieve(query, candChunks){
        const qvec = await embedText(query);
        const results = [];
        for(const c of candChunks){
            let cvec;
            const cacheKey = c.source + '#' + c.chunkIndex;
            const hit = await dbGet(STORE, cacheKey);
            if(hit){ cvec = hit; }
            else{
                try{
                    cvec = await embedText(c.content.substring(0,600));
                    await dbPut(STORE, cacheKey, cvec);
                    await dbPut(KEY_STORE, cacheKey, 1);
                }catch(e){ cvec = null; }
            }
            if(cvec) results.push({content:c.content, source:c.source, chunkIndex:c.chunkIndex, score:cosine(qvec,cvec)});
        }
        results.sort((a,b)=>b.score-a.score);
        return results;
    }

    return {embedText, cosine, semanticRetrieve, getEmbedCfg};
})();

// 暴露到 window
window.KbEmbed = KbEmbed;
