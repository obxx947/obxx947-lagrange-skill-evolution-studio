// 浏览器内 需求理解 Agent（意图门）测试：
//  1) 日常闲聊("你好") → 短路，禁止后续检索/工具/质检，主Agent直接回答
//  2) 正常任务("推荐一个护卫队") → 放行，并把明确后的需求注入主Agent
const puppeteer = require('puppeteer-core');

(async () => {
    const browser = await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:'new', args:['--no-sandbox']});
    const page = await browser.newPage();
    const jsErrors = [];
    page.on('pageerror', err=>jsErrors.push('[JS] '+err.message));
    page.on('console', m=>{ if(m.type()==='error' && !m.text().includes('404')) jsErrors.push('[CONSOLE] '+m.text().substring(0,120)); });

    await page.goto('http://localhost:3002/chat.html', {waitUntil:'networkidle2', timeout:60000});

    const result = await page.evaluate(async ()=>{
        // 收集事件
        const log = [];
        const emit = (e,d,m)=>log.push({e,d:typeof d==='string'?d:(d&&String(d).substring?String(d).substring(0,200):d), m}); 
        // 可控意图开关
        window.__intentDaily = true;
        // mock fetch：URL 区分 /chat/completions 与其它
        window.fetch = async (url, opts)=>{
            const u=String(url);
            const body = opts && opts.body ? JSON.parse(opts.body) : null;
            const okResp = (content)=>({ok:true, json:async()=>({choices:[{message:{content},finish_reason:'stop'}]})});
            if(u.includes('/chat/completions')){
                const sys=(body.messages[0].content||'');
                if(sys.includes('需求理解智能体') || sys.includes('需求理解Agent')){
                    return okResp(window.__intentDaily
                        ? '{"is_daily_chat":true,"clarified_intent":"你好","reason":"打招呼"}'
                        : '{"is_daily_chat":false,"clarified_intent":"推荐一个护卫抗伤队","reason":"包含任务"}');
                }
                // 主流程：闲聊走 chatDaily；任务走 agentLoop 主模型（一次出最终答案，不调工具）
                return okResp(window.__intentDaily ? '你好呀！我是智能体～' : '这是最终的护卫队推荐方案。');
            }
            return { ok:false }; // data/system_prompt.md / webSearch 等 → 让系统回退内置或忽略
        };
        // 桩掉检索/质检，聚焦意图门
        let kbSearchCount=0, qaCalled=0;
        window.KB.load = async()=>true;
        window.KB.search = async()=>{ kbSearchCount++; return []; };
        window.KB.searchByCategory = async()=>[];
        window.KB.hybridSearch = async()=>({results:[],denseCount:0,gate:null});
        window.KB.hitRate = ()=>({rate:0,hits:0,total:0});
        window.SHIP_DB = window.SHIP_DB||{};
        window.SHIP_DB.load = async()=>true;
        if(window.QA) window.QA.qaPipeline = async (q,a,llm,em)=>{ qaCalled++; return {pass:true,score:90,status:'PASS',iteration:1,error_list:[],user_requirement_check:'',final_answer:a}; };

        const P = window.SubAgentPool;
        const out = { };

        // ---- 场景1 日常闲聊 ----
        window.__intentDaily = true;
        log.length=0; kbSearchCount=0; qaCalled=0;
        await window.AgentEngine.chat('你好', [], emit, false, null);
        out.daily = {
            answers: log.filter(x=>x.e==='answer').map(x=>x.d),
            done: log.some(x=>x.e==='done'),
            qcFee: (log.find(x=>x.e==='answer')||{}).m && log.find(x=>x.e==='answer').m.qc_feedback,
            kbSearchCount, qaCalled,
            statuses: log.filter(x=>x.e==='status').map(x=>x.d),
            pool: P.getCount(),
        };

        // ---- 场景2 正常任务（明确需求注入主Agent） ----
        window.__intentDaily = false;
        log.length=0; kbSearchCount=0; qaCalled=0;
        let mainMsgs=null;
        // 捕获任务模式下主模型（非意图）请求的 messages
        const origFetch = window.fetch;
        window.fetch = async (url, opts)=>{
            const u=String(url); const body=opts&&opts.body?JSON.parse(opts.body):null;
            if(u.includes('/chat/completions') && body && body.messages && !String(body.messages[0].content||'').includes('需求理解')){
                mainMsgs = body.messages.map(m=>({role:m.role, content:String(m.content||'').substring(0,160)}));
            }
            return origFetch(url, opts);
        };
        await window.AgentEngine.chat('推荐一个护卫队', [], emit, false, null);
        out.task = {
            answers: log.filter(x=>x.e==='answer').map(x=>x.d),
            done: log.some(x=>x.e==='done'),
            qaCalled,
            kbSearchCount,
            pool: P.getCount(),
            hasClarifiedNote: !!(mainMsgs && mainMsgs.some(m=>String(m.content||'').includes('需求理解Agent'))),
            clarifiedNote: mainMsgs ? (mainMsgs.find(m=>String(m.content||'').includes('需求理解Agent'))||{content:''}).content : '(未捕获)',
            userTurn: mainMsgs ? (mainMsgs.find(m=>m.role==='user')||{content:''}).content : '',
        };
        return out;
    });

    console.log('=== 需求理解 Agent（意图门）浏览器测试 ===');
    console.log('【场景1 日常闲聊】', JSON.stringify(result.daily, null, 2));
    console.log('【场景2 正常任务】', JSON.stringify(result.task, null, 2));
    console.log('JS 错误数: ' + jsErrors.length);
    jsErrors.forEach(e=>console.log('  '+e));

    const D=result.daily, T=result.task;
    const pass =
        D.answers.some(a=>String(a).includes('你好呀')) &&
        D.qcFee==='DAILY_CHAT' &&
        D.done &&
        D.kbSearchCount===0 &&          // 未检索
        D.qaCalled===0 &&               // 未质检（agentLoop未进入）
        D.pool===0 &&                   // 子Agent池用后清空
        T.done &&
        T.qaCalled>=1 &&                // 非闲聊 → 进入主流程并质检
        T.hasClarifiedNote === true &&  // 明确后的需求注入主Agent
        T.pool===0 &&
        jsErrors.length===0;
    console.log('结果: ' + (pass?'PASS':'FAIL'));
    await browser.close();
    process.exit(pass?0:1);
})().catch(e=>{console.error('异常:',e.message);process.exit(1);});
