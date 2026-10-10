// 模式传播测试（修正）：计划→主Agent注入完整审批规则且所有Agent被告知计划；普通→所有Agent被告知普通
const puppeteer = require('puppeteer-core');

(async () => {
    const browser = await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:'new', args:['--no-sandbox']});
    const page = await browser.newPage();
    const jsErrors = [];
    page.on('pageerror', e=>jsErrors.push('[JS] '+e.message));
    page.on('console', m=>{ if(m.type()==='error' && !m.text().includes('404') && !m.text().includes('401') && !m.text().includes('429') && !m.text().includes('ERR_FAILED') && !m.text().includes('bge embed') && !m.text().includes('Access to fetch')) jsErrors.push('[CONSOLE] '+m.text().substring(0,120)); });
    await page.goto('http://localhost:3002/chat.html', {waitUntil:'networkidle2', timeout:60000});

    const r = await page.evaluate(async ()=>{
        const out={};
        const orig=window.fetch.bind(window);
        const make = async (planMode)=>{
            localStorage.setItem('lagrange_static_config', JSON.stringify({llm_api_key:'test', llm_api_url:'https://api.deepseek.com', llm_model:'glm-4.7-2507', plan_mode:planMode}));
            const cap={allSys:[], intent:'', fleetSub:'', fleetLead:'', qaA:''};
            window.fetch = async (url,opts)=>{
                const u=String(url);
                if(u.includes('/chat/completions')){
                    const msgs=JSON.parse(opts.body).messages;
                    const sys=String(msgs[0].content||'');
                    msgs.forEach(m=>{ if(m.role==='system') cap.allSys.push(String(m.content||'')); });
                    if(sys.includes('检索总Agent')){ cap.fleetLead=sys; return {ok:true,json:async()=>({choices:[{message:{content:'素材包'},finish_reason:'stop'}]})}; }
                    if(sys.includes('你是【检索舰队·检索子Agent】')){ cap.fleetSub=sys; return {ok:true,json:async()=>({choices:[{message:{content:'素材'},finish_reason:'stop'}]})}; }
                    if(sys.includes('· 审计智能体')){ cap.qaA=sys; return {ok:true,json:async()=>({choices:[{message:{content:'{"issues":[]}'},finish_reason:'stop'}]})}; }
                    if(sys.includes('· 评判智能体')){ return {ok:true,json:async()=>({choices:[{message:{content:'{"score":85,"status":"PASS"}'},finish_reason:'stop'}]})}; }
                    if(sys.includes('需求理解')){ cap.intent=sys; return {ok:true,json:async()=>({choices:[{message:{content:'{"is_daily_chat":false,"clarified_intent":"x","reason":"x"}'},finish_reason:'stop'}]})}; }
                    return {ok:true,json:async()=>({choices:[{message:{content:'这是配队方案'},finish_reason:'stop'}]})};
                }
                return orig(url,opts);
            };
            await window.KB.load();
            await window.AgentEngine.chat('给我一个470抗伤配队', [], ()=>{}, false, null);
            return cap;
        };
        const plan = await make(true);
        out.plan={
            mainHasPlanRule: plan.allSys.some(s=>s.includes('核心强制总规则') && s.includes('本次任务完整执行计划书')),
            mainHasNormalRule: plan.allSys.some(s=>s.includes('普通模式·所有Agent')),
            intentTold: plan.intent.includes('当前对话模式·计划'),
            fleetSubTold: plan.fleetSub.includes('当前对话模式·计划'),
            fleetLeadTold: plan.fleetLead.includes('当前对话模式·计划'),
            qaATold: plan.qaA.includes('当前对话模式·计划'),
            pool: window.SubAgentPool.getCount()
        };
        const normal = await make(false);
        out.normal={
            mainHasNormalRule: normal.allSys.some(s=>s.includes('普通模式·所有Agent') && s.includes('无需输出计划书')),
            mainHasPlanRule: normal.allSys.some(s=>s.includes('核心强制总规则')),
            intentTold: normal.intent.includes('当前对话模式·普通'),
            fleetSubTold: normal.fleetSub.includes('当前对话模式·普通'),
            pool: window.SubAgentPool.getCount()
        };
        return out;
    });

    console.log('=== 模式传播（计划/普通）测试 ===');
    console.log('计划:', JSON.stringify(r.plan,null,2));
    console.log('普通:', JSON.stringify(r.normal,null,2));
    console.log('JS 错误数(排除CORS类): '+jsErrors.length); jsErrors.forEach(e=>console.log('  '+e));
    const pass =
        r.plan.mainHasPlanRule===true && r.plan.mainHasNormalRule===false &&
        r.plan.intentTold===true && r.plan.fleetSubTold===true && r.plan.fleetLeadTold===true && r.plan.qaATold===true && r.plan.pool===0 &&
        r.normal.mainHasNormalRule===true && r.normal.mainHasPlanRule===false &&
        r.normal.intentTold===true && r.normal.fleetSubTold===true && r.normal.pool===0 &&
        jsErrors.length===0;
    console.log('结果: '+(pass?'PASS':'FAIL'));
    await browser.close();
    process.exit(pass?0:1);
})().catch(e=>{console.error('异常:',e.message);process.exit(1);});
