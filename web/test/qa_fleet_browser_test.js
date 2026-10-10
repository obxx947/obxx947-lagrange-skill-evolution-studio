// 检索舰队(retrieveFleet)测试：非默认Flash 派≤3检索子Agent+总Agent；默认Flash自动降级
const puppeteer = require('puppeteer-core');

(async () => {
    const browser = await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:'new', args:['--no-sandbox']});
    const page = await browser.newPage();
    const jsErrors = [];
    page.on('pageerror', e=>jsErrors.push('[JS] '+e.message));
    page.on('console', m=>{ if(m.type()==='error' && !m.text().includes('404') && !m.text().includes('429') && !m.text().includes('ERR_FAILED') && !m.text().includes('bge embed') && !m.text().includes('Access to fetch')) jsErrors.push('[CONSOLE] '+m.text().substring(0,120)); });
    await page.goto('http://localhost:3002/chat.html', {waitUntil:'networkidle2', timeout:60000});

    const r = await page.evaluate(async ()=>{
        const res={};
        let subCount=0, leadCount=0;
        const orig=window.fetch.bind(window);
        window.fetch = async (url,opts)=>{
            const u=String(url);
            if(u.includes('/chat/completions')){
                const sys=String(opts.body && (JSON.parse(opts.body).messages[0].content||''));
                let content;
                if(sys.includes('你是【检索舰队·检索总Agent】')){ leadCount++; content='【检索素材包】\n核心思路：470抗伤配队以护卫舰抗伤+巡洋输出。\n关键规则：前排需抗住对面前排。\n来源：知识库/例子1.md'; }
                else if(sys.includes('你是【检索舰队·检索子Agent】')){ subCount++; content='【子Agent素材】片段与问题相关：核心是470抗伤，示例：护卫舰+巡洋抗队。'; }
                else { content=''; }
                return {ok:true, json:async()=>({choices:[{message:{content},finish_reason:'stop'}]})};
            }
            return orig(url,opts);
        };

        const cands=[
            {content:'470抗伤配队思路：护卫舰做前排承伤，巡洋舰输出。', source:'例子1.md', chunkIndex:0},
            {content:'战斗机制：伤害计算分叉。', source:'战斗机制.md', chunkIndex:0},
            {content:'另一种配队案例。', source:'资料2.md', chunkIndex:0}
        ];

        // 1. 非默认 Flash：派 ≤3 子Agent + 总Agent
        const out = await window.AgentEngine.retrieveFleet('推荐470抗伤配队', cands, {apiKey:'t', apiUrl:'https://api.deepseek.com', model:'glm-4.7-2507'}, ()=>{});
        res.nonFlash = {out: String(out||'').substring(0,60), subCount, leadCount, pool: window.SubAgentPool.getCount()};

        // 2. 默认 Flash：自动降级为 ''（不派多Agent）
        subCount=0; leadCount=0;
        const out2 = await window.AgentEngine.retrieveFleet('推荐470抗伤配队', cands, {apiKey:'t', apiUrl:'https://api.deepseek.com', model:'glm-4.7-flash'}, ()=>{});
        res.flash = {len:(out2||'').length, subCount, leadCount, pool: window.SubAgentPool.getCount()};

        // 3. 池满：子Agent返回null时不派生超限
        return res;
    });

    console.log('=== 检索舰队(retrieveFleet)测试 ===');
    console.log(JSON.stringify(r,null,2));
    console.log('JS 错误数(排除CORS类): '+jsErrors.length); jsErrors.forEach(e=>console.log('  '+e));
    const pass =
        r.nonFlash && r.nonFlash.out.includes('检索素材包') && r.nonFlash.subCount>=3 && r.nonFlash.leadCount===1 && r.nonFlash.pool===0 &&
        r.flash && r.flash.len===0 && r.flash.subCount===0 && r.flash.leadCount===0 && r.flash.pool===0 &&
        jsErrors.length===0;
    console.log('结果: '+(pass?'PASS':'FAIL'));
    await browser.close();
    process.exit(pass?0:1);
})().catch(e=>{console.error('异常:',e.message);process.exit(1);});
