// in-browser 2-Agent QC smoke test: loads chat.html, mock fetch, calls QA.qaPipeline.
// 验证浏览器端 subagent_pool + llm_gate + qa.js A/B 协同 真正跑通（不依赖真实API/长耗时）。
const puppeteer = require('puppeteer-core');

(async () => {
    const browser = await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:'new', args:['--no-sandbox']});
    const page = await browser.newPage();
    const jsErrors = [];
    page.on('pageerror', err=>jsErrors.push('[JS] '+err.message));
    page.on('console', m=>{ if(m.type()==='error' && !m.text().includes('404')) jsErrors.push('[CONSOLE] '+m.text().substring(0,120)); });

    await page.goto('http://localhost:3002/chat.html', {waitUntil:'networkidle2', timeout:60000});

    const result = await page.evaluate(async ()=>{
        // 注入与 node 测试相同的状态化 mock fetch
        let aCallCount=0, bCallCount=0, bAcceptOnCall=2;
        window.__mock = {aCallCount:()=>aCallCount, bCallCount:()=>bCallCount};
        // 保存原始 fetch，仅覆盖后续
        const realFetch = window.fetch.bind(window);
        window.fetch = async (url, opts)=>{
            const body=JSON.parse(opts.body);
            const sys=(body.messages[0].content||'');
            const isA=sys.includes('· 审计智能体'), isB=sys.includes('· 评判智能体');
            let content;
            if(isA){ aCallCount++; content='{"issues":[{"position":"x","error_type":"数值冲突","kb_original_text":"正确","fix_suggest":"修"}],"evidence_summary":"已查","has_issue":true}'; }
            else if(isB){ bCallCount++; if(bCallCount>=bAcceptOnCall){ content='{"score":86,"status":"PASS","error_list":[],"user_requirement_check":"ok","review_needs":false,"retour_instruction":""}'; } else { content='{"score":54,"status":"FULL_REGEN","error_list":[{"position":"x","error_type":"需复查"}],"user_requirement_check":"","review_needs":true,"retour_instruction":"请重新核对服役上限"}'; } }
            else { content='{"claims":[{"fact":"舰船数据正确","position":"引用原文"}]}'; }
            return {ok:true, json:async()=>({choices:[{message:{content, reasoning_content:''},finish_reason:'stop'}]})};
        };

        // 确保全局存在
        const P = window.SubAgentPool;
        if(!P) return {err:'SubAgentPool 未加载'};
        if(!window.QA || !window.QA.qaPipeline) return {err:'QA.qaPipeline 未加载'};

        const res = await window.QA.qaPipeline('大矛护卫舰的服役上限是什么', '大矛B3配C2，服役上限6。', {apiKey:'test', apiUrl:'https://api.deepseek.com', model:'glm-4.7-flash'}, ()=>{});
        return {
            status: res.status, score: res.score, ab_round: res.ab_round,
            aCall: window.__mock.aCallCount(), bCall: window.__mock.bCallCount(),
            poolCount: P.getCount(),
        };
    });

    console.log('=== 浏览器内 2-Agent 协同质检 ===');
    console.log(JSON.stringify(result, null, 2));
    console.log('JS 错误数: ' + jsErrors.length);
    jsErrors.forEach(e=>console.log('  '+e));

    const pass = result && !result.err
        && result.status==='PASS'
        && result.score>=80
        && result.aCall>=2
        && result.bCall>=2
        && result.poolCount===0
        && jsErrors.length===0;
    console.log('结果: ' + (pass?'PASS':'FAIL'));
    await browser.close();
    process.exit(pass?0:1);
})().catch(e=>{console.error('异常:',e.message);process.exit(1);});
