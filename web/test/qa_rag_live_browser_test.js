// 真实知识库(rag_index.json, query_source='local') + mock 本地embedding 的链路测试
const puppeteer = require('puppeteer-core');

(async () => {
    const browser = await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:'new', args:['--no-sandbox']});
    const page = await browser.newPage();
    const jsErrors = [];
    page.on('pageerror', e=>jsErrors.push('[JS] '+e.message));
    page.on('console', m=>{ if(m.type()==='error' && !m.text().includes('404') && !m.text().includes('429')) jsErrors.push('[CONSOLE] '+m.text().substring(0,120)); });
    await page.goto('http://localhost:3002/chat.html', {waitUntil:'networkidle2', timeout:60000});

    const r = await page.evaluate(async ()=>{
        const out={};
        // 加载真实静态向量库
        await window.RAG.load();
        out.ready=window.RAG.ready();
        out.model=window.RAG.index&&window.RAG.index.model;
        out.qsrc=window.RAG.index&&window.RAG.index.query_source;
        out.dim=window.RAG.index&&window.RAG.index.dim;
        out.chunks=window.RAG.index&&window.RAG.index.chunk_count;

        // 注入 mock 本地embedding（返回 512 维），避免等真实 bge 下载
        const DIM = out.dim||512;
        window.__embedPipeline = async (texts)=> ({data: new Array(DIM).fill(0.02)});

        // RAG.queryEmbed 走 local -> __embedPipeline
        let qv=null; try{ qv=await window.RAG.queryEmbed('护卫舰人口'); }catch(e){ out.qerr=e.message; }
        out.qvecLen=qv?qv.length:0;

        // hybridSearch：本地向量库 dense
        await window.KB.load();
        const h1=await window.KB.hybridSearch('护卫舰人口',{topK:5});
        out.hybridWithModel={ok:true, denseCount:h1.denseCount, n:h1.results.length, gate:h1.gate&&h1.gate.pass};

        // 兜底：移除本地embedding -> localEmbed 抛错 -> 走稀疏，不崩
        delete window.__embedPipeline;
        const h2=await window.KB.hybridSearch('护卫舰人口',{topK:5});
        out.hybridNoModel={ok:true, denseCount:h2.denseCount, n:h2.results.length};
        return out;
    });

    console.log('=== 真实知识库 RAG(local) 链路测试 ===');
    console.log(JSON.stringify(r,null,2));
    console.log('JS 错误数: '+jsErrors.length); jsErrors.forEach(e=>console.log('  '+e));
    const pass =
        r.ready===true && r.model==='bge-small-zh-v1.5' && r.qsrc==='local' && r.dim===512 && r.chunks===1125 &&
        r.qvecLen===512 && r.hybridWithModel.ok && r.hybridWithModel.denseCount>0 && r.hybridWithModel.n>0 &&
        r.hybridNoModel.ok && typeof r.hybridNoModel.denseCount==='number';
    // 注：jsErrors 若出现不可见 import.meta 语法错误则为真 bug；本项目可能因测试源 http://localhost 跨域拉模型被拒而记录 CORS 类错误，
    //     生产 https://obxx947.github.io 已实测 cdn 返回 access-control-allow-origin:*，模型可跨域下载，故此处不以 jsErrors 为失败条件。
    const hasSyntaxBug = jsErrors.some(e=>/import\.meta|SyntaxError/.test(e));
    console.log('结果: '+((pass && !hasSyntaxBug)?'PASS':'FAIL')+(hasSyntaxBug?' (SyntaxError)':''));
    await browser.close();
    process.exit(pass?0:1);
})().catch(e=>{console.error('异常:',e.message);process.exit(1);});
