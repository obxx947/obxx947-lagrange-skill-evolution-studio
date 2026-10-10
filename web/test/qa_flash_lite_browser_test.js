// 默认 GLM-4.7-Flash 精简架构测试：配队问题 注入精简模式 + 检索舰队/质检A-B 均不启用（防429/防超时）
const puppeteer = require('puppeteer-core');

(async () => {
    const browser = await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:'new', args:['--no-sandbox']});
    const page = await browser.newPage();
    const jsErrors = [];
    page.on('pageerror', e=>jsErrors.push('[JS] '+e.message));
    page.on('console', m=>{ if(m.type()==='error' && !m.text().includes('404') && !m.text().includes('429') && !m.text().includes('401') && !m.text().includes('ERR_FAILED') && !m.text().includes('bge embed') && !m.text().includes('Access to fetch')) jsErrors.push('[CONSOLE] '+m.text().substring(0,120)); });
    await page.goto('http://localhost:3002/chat.html', {waitUntil:'networkidle2', timeout:60000});

    const r = await page.evaluate(async ()=>{
        localStorage.setItem('lagrange_static_config', JSON.stringify({llm_api_key:'test', llm_api_url:'https://api.deepseek.com', llm_model:'glm-4.7-flash'}));
        let mainMsgs=null, subst=0, lead=0, audit=0, judge=0;
        const orig=window.fetch.bind(window);
        window.fetch = async (url,opts)=>{
            const u=String(url);
            if(u.includes('/chat/completions')){
                const sys=String(opts.body && (JSON.parse(opts.body).messages[0].content||''));
                if(sys.includes('检索子Agent')){ subst++; return {ok:true,json:async()=>({choices:[{message:{content:'素材'},finish_reason:'stop'}]})}; }
                if(sys.includes('检索总Agent')){ lead++; return {ok:true,json:async()=>({choices:[{message:{content:'素材包'},finish_reason:'stop'}]})}; }
                if(sys.includes('· 审计智能体')){ audit++; return {ok:true,json:async()=>({choices:[{message:{content:'{"issues":[]}'},finish_reason:'stop'}]})}; }
                if(sys.includes('· 评判智能体')){ judge++; return {ok:true,json:async()=>({choices:[{message:{content:'{"score":85,"status":"PASS"}'},finish_reason:'stop'}]})}; }
                // 主模型（首条也可能是意图/精简注入，取含完整messages的那次）
                if(sys.includes('专业AI战术顾问') && !sys.includes('需求理解')){
                    mainMsgs = JSON.parse(opts.body).messages.map(m=>({role:m.role, content:String(m.content||'').substring(0,80)}));
                }
                return {ok:true,json:async()=>({choices:[{message:{content:'这是配队方案'},finish_reason:'stop'}]})};
            }
            return orig(url,opts);
        };
        await window.KB.load();
        const events=[]; const emit=(e,d,m)=>events.push({e,d:typeof d==='string'?d:(d&&String(d).substring?String(d).substring(0,80):d)});
        await window.AgentEngine.chat('给我一个470+5的护航抗伤队', [], emit, false, null);
        const mainText=(mainMsgs||[]).map(m=>m.content).join(' ');
        return {
            hasLite: mainText.includes('默认免费模型·精简模式'),
            bodyHasUser: (mainMsgs||[]).some(m=>m.role==='user'),
            subst, lead, audit, judge,
            done: events.some(x=>x.e==='done'),
            answer: events.filter(x=>x.e==='answer').map(x=>x.d),
            pool: window.SubAgentPool.getCount()
        };
    });

    console.log('=== 默认 Flash 精简架构（配队问题） ===');
    console.log(JSON.stringify(r,null,2));
    console.log('JS 错误数(排除CORS类): '+jsErrors.length); jsErrors.forEach(e=>console.log('  '+e));
    const pass =
        r.hasLite===true && r.bodyHasUser===true &&
        r.subst===0 && r.lead===0 && r.audit===0 && r.judge===0 && r.done===true &&
        jsErrors.length===0;
    console.log('结果: '+(pass?'PASS':'FAIL'));
    await browser.close();
    process.exit(pass?0:1);
})().catch(e=>{console.error('异常:',e.message);process.exit(1);});
