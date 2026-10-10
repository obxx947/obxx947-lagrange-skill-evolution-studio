// 浏览器内"默认 GLM-4.7-Flash → 禁止同时启用多Agent"测试
// 验证：默认Flash模型下
//   1) 质检不调用 A/B 两个Agent（审计/评判 LLM 调用均为 0）
//   2) 意图门不调用 LLM Agent（改用规则判定，[需求理解智能体] 调用为 0）
const puppeteer = require('puppeteer-core');

(async () => {
    const browser = await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:'new', args:['--no-sandbox']});
    const page = await browser.newPage();
    const jsErrors = [];
    page.on('pageerror', err=>jsErrors.push('[JS] '+err.message));
    page.on('console', m=>{ if(m.type()==='error' && !m.text().includes('404')) jsErrors.push('[CONSOLE] '+m.text().substring(0,120)); });

    await page.goto('http://localhost:3002/chat.html', {waitUntil:'networkidle2', timeout:60000});

    const result = await page.evaluate(async ()=>{
        // 让 getActiveLLM 返回默认 flash 模型
        localStorage.setItem('lagrange_static_config', JSON.stringify({llm_api_key:'test', llm_api_url:'https://api.deepseek.com', llm_model:'glm-4.7-flash'}));

        const log=[]; const emit=(e,d,m)=>log.push({e,d:typeof d==='string'?d:(d&&String(d).substring?String(d).substring(0,200):d), m});
        // 统计各类Agent调用
        const counts={audit:0, judge:0, intent:0, main:0};
        window.fetch = async (url, opts)=>{
            const u=String(url); const body=opts&&opts.body?JSON.parse(opts.body):null;
            const okResp=(content)=>({ok:true,json:async()=>({choices:[{message:{content},finish_reason:'stop'}]})});
            if(u.includes('/chat/completions')){
                const sys=String(body.messages[0].content||'');
                if(sys.includes('· 审计智能体')){ counts.audit++; return okResp('{"issues":[],"evidence_summary":"s","has_issue":false}'); }
                if(sys.includes('· 评判智能体')){ counts.judge++; return okResp('{"score":82,"status":"PASS","error_list":[],"user_requirement_check":"ok","review_needs":false,"retour_instruction":""}'); }
                if(sys.includes('需求理解')){ counts.intent++; return okResp('{"is_daily_chat":false,"clarified_intent":"x","reason":"x"}'); }
                counts.main++; return okResp('这是最终的方案。');
            }
            return {ok:false};
        };
        // 桩掉检索，聚焦多Agent调用计数
        window.KB.load=async()=>true; window.KB.search=async()=>[]; window.KB.searchByCategory=async()=>[];
        window.KB.hybridSearch=async()=>({results:[],denseCount:0,gate:null}); window.KB.hitRate=()=>({rate:0,hits:0,total:0});
        window.SHIP_DB=window.SHIP_DB||{}; window.SHIP_DB.load=async()=>true;

        const P=window.SubAgentPool; const out={};
        // ---- 正常任务(非闲聊)：应走主流程，但审计/评判/意图门LLM 均 0 ----
        counts.audit=0;counts.judge=0;counts.intent=0;counts.main=0; log.length=0;
        await window.AgentEngine.chat('推荐一个护卫队', [], emit, false, null);
        out.task={done:log.some(x=>x.e==='done'), answers:log.filter(x=>x.e==='answer').map(x=>x.d),
            audit:counts.audit, judge:counts.judge, intent:counts.intent, main:counts.main, pool:P.getCount()};
        // ---- 闲聊：待chatDaily直接回答，同样不启用多Agent ----
        counts.audit=0;counts.judge=0;counts.intent=0;counts.main=0; log.length=0;
        await window.AgentEngine.chat('你好', [], emit, false, null);
        out.daily={done:log.some(x=>x.e==='done'), answers:log.filter(x=>x.e==='answer').map(x=>x.d),
            qcFee:(log.find(x=>x.e==='answer')||{}).m&&log.find(x=>x.e==='answer').m.qc_feedback,
            audit:counts.audit, judge:counts.judge, intent:counts.intent, main:counts.main, pool:P.getCount()};
        return out;
    });

    console.log('=== 默认 GLM-4.7-Flash：禁止同时启用多Agent ===');
    console.log('【任务】', JSON.stringify(result.task, null, 2));
    console.log('【闲聊】', JSON.stringify(result.daily, null, 2));
    console.log('JS 错误数: ' + jsErrors.length);
    jsErrors.forEach(e=>console.log('  '+e));

    const T=result.task, D=result.daily;
    const pass =
        T.done && T.audit===0 && T.judge===0 && T.intent===0 && T.main>=1 && T.pool===0 &&
        D.done && D.qcFee==='DAILY_CHAT' && D.audit===0 && D.judge===0 && D.intent===0 && D.pool===0 &&
        jsErrors.length===0;
    console.log('结果: ' + (pass?'PASS':'FAIL'));
    await browser.close();
    process.exit(pass?0:1);
})().catch(e=>{console.error('异常:',e.message);process.exit(1);});
