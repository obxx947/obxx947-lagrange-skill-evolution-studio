// 浏览器内 RAG 静态向量库 框架测试（mock 向量库 + mock /embeddings，不依赖真实 embedding）
const puppeteer = require('puppeteer-core');

(async () => {
    const browser = await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:'new', args:['--no-sandbox']});
    const page = await browser.newPage();
    const jsErrors = [];
    page.on('pageerror', e=>jsErrors.push('[JS] '+e.message));
    page.on('console', m=>{ if(m.type()==='error' && !m.text().includes('404')) jsErrors.push('[CONSOLE] '+m.text().substring(0,120)); });
    await page.goto('http://localhost:3002/chat.html', {waitUntil:'networkidle2', timeout:60000});

    const r = await page.evaluate(async ()=>{
        localStorage.setItem('lagrange_static_config', JSON.stringify({glm_api_key:'testkey'}));
        const mini = {
            model:'embedding-3', dim:2, query_source:'api', chunk_count:3,
            chunks:[
                {content:'护卫舰服役上限10人口3', source:'backup/舰船资料/护卫舰资料.txt', chunkIndex:0, vector:[0.8,0.2]},
                {content:'战斗机制伤害计算', source:'backup/战斗机制.txt', chunkIndex:0, vector:[0.2,-0.8]},
                {content:'配队思路例子', source:'backup/例子.txt', chunkIndex:0, vector:[0.6,0.7]}
            ]
        };
        const qvec=[0.9,0.3];
        const out={};
        let noIndex=false, embedFail=false;
        const orig=window.fetch.bind(window);
        window.fetch = async (url, opts)=>{
            const u=String(url);
            if(u.includes('rag_index.json')){
                if(noIndex) return {ok:false, status:404};
                return {ok:true, json:async()=>mini};
            }
            if(u.includes('/embeddings') || u.endsWith('/embed')){
                if(embedFail) return {ok:false, status:500};
                return {ok:true, json:async()=>({data:[{embedding:qvec}]})};
            }
            return orig(url, opts);
        };

        // 1. 无向量库 -> ready=false（load 失败不缓存）
        noIndex=true;
        await window.RAG.load(); out.readyNoIndex=window.RAG.ready();
        noIndex=false;

        // 2. 成功加载静态向量库
        await window.RAG.load();
        out.ready=window.RAG.ready(); out.model=window.RAG.index&&window.RAG.index.model; out.qsrc=window.RAG.index&&window.RAG.index.query_source;

        // 3. query 向量走 /embeddings（api 模式）
        let qv=null; try{ qv=await window.RAG.queryEmbed('护卫舰'); }catch(e){ out.qerr=e.message; }
        out.qvecLen=qv?qv.length:0;

        // 4. 语义检索余弦排序
        const cand=[
            {content:'护卫舰服役上限10人口3', source:'backup/舰船资料/护卫舰资料.txt', chunkIndex:0},
            {content:'战斗机制伤害计算', source:'backup/战斗机制.txt', chunkIndex:0},
            {content:'配队思路例子', source:'backup/例子.txt', chunkIndex:0}
        ];
        let sem=null; try{ sem=await window.RAG.semanticRetrieve('护卫舰', cand); }catch(e){ out.semerr=e.message; }
        out.semTop=(sem||[]).map(s=>({source:s.source, score:Math.round(s.score*100)/100})); out.semLen=(sem||[]).length;

        // 5. API 失败 -> queryEmbed 抛错（兜底前提）
        embedFail=true; let qvFail=false;
        try{ await window.RAG.queryEmbed('护卫舰'); }catch(e){ qvFail=true; }
        out.queryFailWhenApiDown=qvFail; embedFail=false;

        // 6. hybridSearch 兜底（mini 库无匹配 + KbEmbed 无 key -> sparse-only，不崩）
        out.hybrid = await (async()=>{
            try{
                await window.KB.load();
                const res=await window.KB.hybridSearch('470抗伤配队',{topK:5});
                return {ok:true, denseCount:res.denseCount, n:res.results.length};
            }catch(e){ return {ok:false, err:e.message}; }
        })();
        return out;
    });

    console.log('=== RAG 静态向量库（框架）测试 ===');
    console.log(JSON.stringify(r,null,2));
    console.log('JS 错误数: '+jsErrors.length); jsErrors.forEach(e=>console.log('  '+e));
    const pass =
        r.readyNoIndex===false && r.ready===true && r.model==='embedding-3' && r.qsrc==='api' &&
        r.qvecLen===2 && r.semLen===3 && r.semTop && r.semTop[0].source.includes('护卫舰') && r.semTop[0].score>r.semTop[1].score &&
        r.queryFailWhenApiDown===true && r.hybrid && r.hybrid.ok===true && typeof r.hybrid.denseCount==='number' &&
        jsErrors.length===0;
    console.log('结果: '+(pass?'PASS':'FAIL'));
    await browser.close();
    process.exit(pass?0:1);
})().catch(e=>{console.error('异常:',e.message);process.exit(1);});
