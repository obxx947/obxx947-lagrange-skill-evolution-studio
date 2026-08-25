/* ========================================
   前端知识库检索引擎（纯JS）
   - 加载 data/knowledge/*.md
   - TF-IDF + 余弦相似度检索（中文bigram分词）
   - 简单LRU缓存 + 命中率统计
   ======================================== */

const KB = (function(){
    // 知识库文件清单（47个md，与「数据」文件夹同步）
    const FILE_LIST = [
        '战斗机制.md','舰船基础信息.md','黑话.md','实例.md',
        'md分页/数据01.md','md分页/数据02.md','md分页/数据03.md','md分页/数据04.md',
        'md分页/数据05.md','md分页/数据06.md','md分页/数据07.md',
        '舰船数据文件夹/md分页/舰船数据01.md','舰船数据文件夹/md分页/舰船数据02.md',
        '舰船数据文件夹/md分页/舰船数据03.md','舰船数据文件夹/md分页/舰船数据04.md',
        '舰船数据文件夹/md分页/舰船数据05.md','舰船数据文件夹/md分页/舰船数据06.md',
        '舰船数据文件夹/md分页/舰船数据07.md','舰船数据文件夹/md分页/舰船数据08.md',
        '舰船数据文件夹/md分页/舰船数据09.md','舰船数据文件夹/md分页/舰船数据10.md',
        '舰船数据文件夹/md分页/舰船数据11.md','舰船数据文件夹/md分页/舰船数据12.md',
        '舰船数据文件夹/md分页/舰船数据13.md','舰船数据文件夹/md分页/舰船数据14.md',
        '舰船数据文件夹/md分页/舰船数据15.md','舰船数据文件夹/md分页/舰船数据16.md',
        '舰船数据文件夹/md分页/舰船数据17.md','舰船数据文件夹/md分页/舰船数据18.md',
        '舰船数据文件夹/md分页/舰船数据19.md','舰船数据文件夹/md分页/舰船数据20.md',
        '舰船数据文件夹/md分页/舰船数据21.md','舰船数据文件夹/md分页/舰船数据22.md',
        '舰船数据文件夹/md分页/舰船数据23.md','舰船数据文件夹/md分页/舰船数据24.md',
        '舰船数据文件夹/md分页/舰船数据25.md','舰船数据文件夹/md分页/舰船数据26.md',
        '舰船数据文件夹/md分页/舰船数据27.md','舰船数据文件夹/md分页/舰船数据28.md',
        '舰船数据文件夹/md分页/舰船数据29.md','舰船数据文件夹/md分页/舰船数据30.md',
        '舰船数据文件夹/md分页/舰船数据31.md','舰船数据文件夹/md分页/舰船数据32.md',
        '舰船数据文件夹/md分页/舰船数据33.md','舰船数据文件夹/md分页/舰船数据34.md',
        '舰船数据文件夹/md分页/舰船数据35.md','舰船数据文件夹/md分页/舰船数据36.md'
    ];

    // 第二知识库文件清单（51个，来自知识库备份：旧舰船资料/讲解/精炼数据；第一知识库检索不清晰时来此找）
    const BACKUP_FILES = [
        '例子.txt','例子10.txt','例子11.txt','例子12.txt','例子13.txt',
        '例子17.txt','例子18.txt','例子2.txt','例子20.txt','例子22.txt',
        '例子23.txt','例子24.txt','例子25.txt','例子26.txt','例子27.txt',
        '例子3.txt','例子30.txt','例子4.txt','例子5.txt','例子6.txt',
        '例子7.txt','例子8.txt','例子9.txt',
        '实例.txt','战斗机制.txt','舰船人口.txt','舰船基础信息（精炼）.md','黑话.txt',
        '资料14.txt','资料15.txt','资料16.txt','资料21.txt','资料28.txt','资料29.txt',
        '舰船资料/巡洋舰资料2.txt','舰船资料/巡洋舰资料3.txt','舰船资料/巡洋舰资料4.txt',
        '舰船资料/巡洋舰资料5 补充 战报制作要求.txt','舰船资料/战列巡洋舰‘战列舰 舰船资料.txt',
        '舰船资料/战机资料.txt','舰船资料/战机资料2.txt','舰船资料/护卫舰资料.txt',
        '舰船资料/护卫舰资料2.txt','舰船资料/护卫舰资料3和巡洋舰资料1拦截概率资料.txt',
        '舰船资料/护航艇资料.txt','舰船资料/护航艇资料2.txt','舰船资料/航空母舰 支援舰 资料.txt',
        '舰船资料/驱逐舰资料.txt','舰船资料/驱逐舰资料2.txt','舰船资料/驱逐舰资料3.txt',
        '舰船资料/驱逐舰资料4和舰船旗舰资料.txt'
    ];

    let chunks = [];        // [{content, source}]
    let idf = null;         // {term: idf}
    let docVectors = null;  // [{term: tfidf}]
    let loaded = false;
    let loading = null;

    // 缓存
    const cache = new Map();
    let hits = 0, misses = 0;
    let redline = new Set();   // 数据文件夹红线白名单：仅允许知识库(data/knowledge + corpus)内 source 进入检索结果

    // ======== 分词：中文bigram + 英文单词 ========
    function tokenize(text){
        const tokens = {};
        const t = String(text||'').toLowerCase();
        // 中文bigram
        for(let i=0;i<t.length-1;i++){
            const c1=t.charCodeAt(i), c2=t.charCodeAt(i+1);
            if(c1>0x2e80 && c2>0x2e80){
                const bi=t.substring(i,i+2);
                tokens[bi]=(tokens[bi]||0)+1;
            }
        }
        // 英文/数字词
        const words=t.match(/[a-z0-9]+/g)||[];
        words.forEach(w=>{ if(w.length>1) tokens[w]=(tokens[w]||0)+1; });
        return tokens;
    }

    // ======== 加载知识库 ========
    async function load(){
        if(loaded) return true;
        if(loading) return loading;
        loading = (async()=>{
            try{
                // 优先加载新语料（已拆分的 1050+ 块，一次性取回），避免逐文件 fetch
                try{
                    const cr = await fetch((window.KB_BASE||'')+'data/kb_corpus.json',{cache:'no-cache'});
                    if(cr.ok){
                        const cd = await cr.json();
                        const cs = (cd.chunks||[]);
                        if(cs.length){
                            chunks = cs.map((c,i)=>({content:c.content, source:c.source, chunkIndex:(c.chunkIndex!=null?c.chunkIndex:i), idx:i}));
                            loaded = true; buildIndex(); return true;
                        }
                    }
                }catch(e){}
                const base = (window.KB_BASE||'')+'data/knowledge/';
                const all = await Promise.all(FILE_LIST.map(async f=>{
                    try{
                        const r = await fetch(base+encodeURI(f),{cache:'no-cache'});
                        if(!r.ok) return null;
                        const text = await r.text();
                        // 分块：500字符/块
                        const blocks=[];
                        for(let i=0;i<text.length;i+=500){
                            blocks.push(text.substring(i,i+500));
                        }
                        return blocks.map((b,bi)=>({content:b,source:f,chunkIndex:bi,idx:0}));
                    }catch(e){ return null; }
                }));
                // 第二知识库（备份资料）：第一知识库检索不清晰时使用，source 带 backup/ 前缀
                const base2 = (window.KB_BASE||'')+'data/knowledge_backup/';
                const all2 = await Promise.all(BACKUP_FILES.map(async f=>{
                    try{
                        const r = await fetch(base2+encodeURI(f),{cache:'no-cache'});
                        if(!r.ok) return null;
                        const text = await r.text();
                        const blocks=[];
                        for(let i=0;i<text.length;i+=500){
                            blocks.push(text.substring(i,i+500));
                        }
                        return blocks.map((b,bi)=>({content:b,source:'backup/'+f,chunkIndex:bi,idx:0}));
                    }catch(e){ return null; }
                }));
                chunks = [...all.filter(Boolean).flat(), ...all2.filter(Boolean).flat()].map((c,i)=>({...c, idx:i}));
                loaded = true;
                buildIndex();
                return true;
            }catch(e){
                console.error('KB load failed:', e);
                return false;
            }
        })();
        return loading;
    }

    // ======== 构建TF-IDF索引 ========
    function buildIndex(){
        const df = {};
        docVectors = chunks.map(c=>{
            const tf = tokenize(c.content);
            Object.keys(tf).forEach(term=>{ df[term]=(df[term]||0)+1; });
            return tf;
        });
        idf = {};
        const N = chunks.length;
        Object.keys(df).forEach(term=>{
            idf[term] = Math.log(N/(df[term]+1))+1;
        });
        // 数据文件夹红线白名单：以当前知识库 source 为准
        redline = new Set(chunks.map(c=>String(c.source||'')));
    }

    // ======== 查询向量 ========
    function queryVec(query){
        const tf = tokenize(query);
        const vec = {};
        Object.keys(tf).forEach(term=>{
            if(idf[term]) vec[term] = tf[term]*idf[term];
        });
        return vec;
    }

    function cosSim(v1,v2){
        let dot=0,n1=0,n2=0;
        for(const k in v1){ dot += v1[k]*(v2[k]||0); n1 += v1[k]*v1[k]; }
        for(const k in v2){ n2 += v2[k]*v2[k]; }
        if(!n1||!n2) return 0;
        return dot/Math.sqrt(n1*n2);
    }

    // ======== 检索（带缓存） ========
    function search(query, topK=5){
        const cacheKey = query;
        if(cache.has(cacheKey)){
            hits++;
            return cache.get(cacheKey);
        }
        misses++;
        const qv = queryVec(query);
        const scored = chunks.map((c,i)=>{
            return {content:c.content, source:c.source, chunkIndex:c.chunkIndex, idx:c.idx, score:cosSim(qv,docVectors[i]), _tfidf:cosSim(qv,docVectors[i])};
        }).sort((a,b)=>b.score-a.score).slice(0,topK);
        // 缓存结果
        cache.set(cacheKey, scored);
        if(cache.size>200) cache.delete(cache.keys().next().value);
        return scored;
    }

    // ======== 按分类检索（子代理） ========
    function searchByCategory(query, keywords, topK=3){
        const qv = queryVec(query);
        const scored = chunks.map((c,i)=>{
            let kwBonus=0;
            const src=c.source;
            if(keywords.some(k=>src.includes(k))) kwBonus+=0.3;
            return {content:c.content, source:c.source, chunkIndex:c.chunkIndex, idx:c.idx, score:cosSim(qv,docVectors[i])+kwBonus, _tfidf:cosSim(qv,docVectors[i])};
        }).sort((a,b)=>b.score-a.score).slice(0,topK);
        return scored;
    }

    function hitRate(){
        const total=hits+misses;
        return {hits, misses, total, rate: total?Math.round(hits/total*1000)/10:0};
    }

    // ======== 元数据分层加权（音频口语稿降权 / 结构化舰船·配队数据升权） ========
    // source 分类：音频稿(backup/例子*.txt/资料*.txt)、舰船资料、战斗机制、实例配队
    function metadataWeight(source, baseScore){
        let w = 1.0;
        // 结构化高价值资料 → 升权
        if(/舰船数据|舰船资料|舰船人口|舰船基础|黑话/.test(source)) w = 1.25;
        if(/实例|例子|数据\d/.test(source)) w = 1.15;
        if(/战斗机制/.test(source)) w = 1.1;
        // 音频口语转写稿 → 降权（噪声高）
        if(/backup\/例子|backup\/data|资料\d+\.txt/.test(source)) w = 0.85;
        return baseScore * w;
    }

    // ======== 片段语义过滤（口语稿降噪：短碎片/语气词过密） ========
    function isNoiseChunk(content){
        const s = String(content||'');
        if(s.length < 8) return true;  // 太短
        // 语气词/口头语占比过高（连续口语堆砌）
        const filler=(s.match(/嗯|啊|就是|然后|那个|这个|我们|你们|的话|呢|吧|哈/g)||[]).length;
        if(filler>0 && filler/s.length > 0.08) return true;
        return false;
    }

    // ======== RRF 倒数排名融合（双路结果 → 融合分数） ========
    // listA/listB: [{...result, idx}]，k=60 标准
    function rrfFuse(listA, listB, k=60){
        const scores = {};
        const add = (list, weight)=>{
            (list||[]).forEach((item, rank)=>{
                const key = item.idx!=null?item.idx:(item.source+'#'+item.chunkIndex);
                scores[key] = (scores[key]||0) + weight/(k+rank+1);
                if(!scores[key+'_item']) scores[key+'_item']=item;
            });
        };
        add(listA, 1.0);
        add(listB, 1.0);
        return Object.keys(scores).filter(kx=>!kx.endsWith('_item'))
            .map(kx=>({...scores[kx+'_item'], rrscore:scores[kx]}))
            .sort((a,b)=>b.rrscore-a.rrscore);
    }

    // ======== 相邻块上下文扩展（补同 source 前后 chunk） ========
    function contextExpand(topResults, extend=1){
        const out = [];
        const seen = new Set();
        for(const r of topResults){
            if(seen.has(r.source+'#'+r.chunkIndex)) continue;
            out.push(r); seen.add(r.source+'#'+r.chunkIndex);
            // 同 source 前/后块
            for(let d=1; d<=extend; d++){
                const prev = chunks.find(c=>c.source===r.source && c.chunkIndex===r.chunkIndex-d);
                if(prev){ out.push({content:prev.content, source:prev.source, chunkIndex:prev.chunkIndex, idx:prev.idx, score:r.score*0.7, _expand:true}); seen.add(prev.source+'#'+prev.chunkIndex); }
                const nxt = chunks.find(c=>c.source===r.source && c.chunkIndex===r.chunkIndex+d);
                if(nxt){ out.push({content:nxt.content, source:nxt.source, chunkIndex:nxt.chunkIndex, idx:nxt.idx, score:r.score*0.7, _expand:true}); seen.add(nxt.source+'#'+nxt.chunkIndex); }
            }
        }
        return out;
    }

    // ======== 数据文件夹 md 红线：检索结果仅允许来自知识库内的 source ========
    // 防止外部/注入的外部来源片段污染知识库；未加载知识库时放行(哨兵)
    function isRedlineSource(source){
        if(!redline.size) return true;
        return redline.has(String(source||''));
    }

    // ======== 质量门控（召回块整体低分 → 触发改写二次检索标记） ========
    function qualityGate(results, threshold=0.1){
        if(!results.length) return {pass:false, reason:'无召回'};
        const avg = results.reduce((s,r)=>s+(r.score||0),0)/results.length;
        return {pass: avg>=threshold, reason: avg>=threshold?'ok':'召回质量低(avg='+avg.toFixed(3)+')', avg};
    }

    // ======== 混合检索主入口（向量+语义，懒计算） ========
    // query: 用户问题; opts: {topK, category}
    async function hybridSearch(query, opts){
        const topK = (opts&&opts.topK)||5;
        const category = opts && opts.category;
        const kws = opts && opts.kws;
        // 1. 关键词召回候选（top-20 供语义再算）
        let sparse = category&&kws ? searchByCategory(query, kws, 20) : search(query, 20);
        // 移除噪声碎片
        sparse = sparse.filter(c=>!isNoiseChunk(c.content));
        // 元数据加权
        sparse = sparse.map(c=>({...c, _wscore: metadataWeight(c.source, c._tfidf!=null?c._tfidf:c.score)}));
        // 2. 语义召回：优先静态向量库(RAG，本地 bge，所有模型都启用——免费/离线)。
        //    仅当"降级到真调智谱 embedding 的 KbEmbed"时受 skipApiEmbed(默认Flash)限制，避免默认模型卡在限流。
        let dense = [];
        const cand = sparse.map(c=>({content:c.content, source:c.source, chunkIndex:c.chunkIndex, idx:c.idx}));
        if(window.RAG){
            try{
                if(!RAG.ready()) await RAG.load();
                if(RAG.ready()){
                    const sem = await RAG.semanticRetrieve(query, cand);
                    dense = sem.map(s=>({...s, _sem:s.score}));
                }
            }catch(e){ dense = []; }
        }
        if(!dense.length && window.KbEmbed && !(opts&&opts.skipApiEmbed)){
            try{
                const sem = await window.KbEmbed.semanticRetrieve(query, cand);
                dense = sem.map(s=>({...s, _sem:s.score}));
            }catch(e){ dense = []; }
        }
        // 3. 混合：若语义成功 → 两路融合；失败(无key/网络) → 只用稀疏
        let fused;
        if(dense.length){
            // 语义分转 [0,1]待用, 与稀疏融合
            const sparseTop = sparse.filter(c=>c._wscore!=null).map(c=>({...c, score:c._wscore}));
            const denseTop = dense.map(c=>({...c, score:c._sem}));
            fused = rrfFuse(sparseTop, denseTop);
        }else{
            fused = sparse.map(c=>({...c, score:c._wscore||c.score}));
        }
        // 4. 相邻块扩展
        const expanded = contextExpand(fused.slice(0, topK));
        // 5. 质量门控：低分 → 触发一次改写二次检索(CRAG)，提升召回
        let gate = qualityGate(expanded);
        if(!gate.pass && (opts&&opts.recheck)!==false){
            const q2 = String(query||'').trim() + ' 舰船数据 配队 实例 战斗机制';
            try{
                const retry = await hybridSearch(q2, {...opts, topK, recheck:false});
                if(retry && retry.results && retry.results.length){
                    const map = new Map();
                    [...expanded, ...retry.results].forEach(r=>{
                        const k = r.source+'#'+r.chunkIndex;
                        if(!map.has(k) || (map.get(k).score||0) < (r.score||0)) map.set(k, r);
                    });
                    const merged = [...map.values()];
                    gate = qualityGate(merged);
                    gate.rechecked = true;
                    return {results: merged.filter(r=>isRedlineSource(r.source)).slice(0, topK+extendGuard()),
                            gate, sparseCount:sparse.length, denseCount:dense.length, rechecked:true};
                }
            }catch(e){}
        }
        return {results: expanded.filter(r=>isRedlineSource(r.source)).slice(0, topK+extendGuard()), gate, sparseCount:sparse.length, denseCount:dense.length};
    }
    function extendGuard(){ return 2; }

    return {load, search, searchByCategory, hitRate, tokenize,
            metadataWeight, rrfFuse, contextExpand, qualityGate, isNoiseChunk, hybridSearch,
            isRedlineSource, getFiles: () => FILE_LIST.slice(), get chunks(){return chunks;}};
})();

// ======== 舰船数据库 ========
const SHIP_DB = (function(){
    let ships = [];
    let loaded = false;
    let loading = null;
    async function load(){
        if(loaded) return true;
        if(loading) return loading;
        loading = (async()=>{
            try{
                const r = await fetch((window.KB_BASE||'')+'data/ship_database.json',{cache:'no-cache'});
                if(!r.ok) return false;
                const data = await r.json();
                ships = Array.isArray(data)?data:(Object.values(data)||[]);
                loaded = true;
                return true;
            }catch(e){ return false; }
        })();
        return loading;
    }
    function search(name){
        if(!name) return [];
        const n = String(name).toLowerCase();
        return ships.filter(s=>{
            return String(s.name||'').toLowerCase().includes(n) || String(s.id||'').toLowerCase().includes(n);
        }).map(s=>({
            id:s.id, name:s.name, type:s.type, hp:s.hp,
            physicalArmor:s.physicalArmor, energyArmor:s.energyArmor,
            position:s.position, commandValue:s.commandValue,
            ratings:s.ratings, speed:s.speed, modules:s.modules
        }));
    }
    return {load, search};
})();

// 显式暴露到window（跨script标签访问）
window.KB = KB;
window.SHIP_DB = SHIP_DB;
