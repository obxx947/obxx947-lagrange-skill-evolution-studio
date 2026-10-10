// 发送键智能切换(暂停/发送) + 消息排队(完成后自动发送 + 立即发送/修改/删除) 测试
const puppeteer = require('puppeteer-core');

(async () => {
    const browser = await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:'new', args:['--no-sandbox']});
    const page = await browser.newPage();
    const jsErrors = [];
    page.on('pageerror', e=>jsErrors.push('[JS] '+e.message));
    page.on('console', m=>{ if(m.type()==='error' && !m.text().includes('404') && !m.text().includes('401') && !m.text().includes('429') && !m.text().includes('ERR_FAILED') && !m.text().includes('bge embed') && !m.text().includes('Access to fetch')) jsErrors.push('[CONSOLE] '+m.text().substring(0,120)); });
    await page.goto('http://localhost:3002/chat.html', {waitUntil:'networkidle2', timeout:60000});

    const r = await page.evaluate(async ()=>{
        localStorage.setItem('lagrange_static_config', JSON.stringify({llm_api_key:'test', llm_api_url:'https://api.deepseek.com', llm_model:'glm-4.7-2507'}));
        // 测试环境 hf-mirror 无 CORS 放行 → 注入 mock 本地 embedding（512 维），避免掉进 KbEmbed 兜底真调智谱(慢/429)
        window.__embedPipeline = async ()=>({data:new Array(512).fill(0.02)});
        const out={}; const answers=[];
        let mainCalls=0, delayMain=false;
        const orig=window.fetch.bind(window);
        window.fetch = async (url,opts)=>{
            const u=String(url);
            if(u.includes('/chat/completions')){
                const sys=String(opts.body && (JSON.parse(opts.body).messages[0].content||''));
                const content=(c)=>({ok:true,json:async()=>({choices:[{message:{content:c},finish_reason:'stop'}]})});
                if(sys.includes('检索子Agent')) return content('素材');
                if(sys.includes('检索总Agent')) return content('素材包');
                if(sys.includes('· 审计智能体')) return content('{"issues":[]}');
                if(sys.includes('· 评判智能体')) return content('{"score":85,"status":"PASS"}');
                if(sys.includes('需求理解')) return content('{"is_daily_chat":false,"clarified_intent":"x","reason":"x"}');
                // 主模型：第一次延迟，模拟"思考中"
                mainCalls++;
                if(delayMain && mainCalls===1) await new Promise(r=>setTimeout(r,600));
                const a='答案'+mainCalls;
                answers.push(a);
                return content(a);
            }
            return orig(url,opts);
        };
        // 预热：先加载知识库与向量库，避免首轮 KB.load(2s+)+RAG(14MB) 拖慢
        await window.KB.load();
        await window.RAG.load();
        const $=s=>document.querySelector(s);
        const input=()=>$('#chatInput');
        const setVal=(v)=>{ const t=input(); t.value=v; t.dispatchEvent(new Event('input',{bubbles:true})); };

        // 1) 发起第一次对话（思考中）
        delayMain=true;
        setVal('问题1');
        $('#sendBtn').click();
        await new Promise(r=>setTimeout(r,200));
        out.pauseBtnWhileEmpty = $('#sendBtn').textContent;   // 思考中+输入空 → 应为 ⏸

        // 2) 思考中且有内容 → 发送键(排队)
        setVal('问题2');
        await new Promise(r=>setTimeout(r,50));
        out.sendBtnWithText = $('#sendBtn').textContent;      // 应为 ➤
        $('#sendBtn').click();                                // 排队
        await new Promise(r=>setTimeout(r,50));
        const bar=$('#pendingBar');
        out.pendingBarVisible = bar && bar.style.display!=='none';
        out.pendingBarText = bar?bar.textContent.substring(0,40):'';
        out.pendingButtons = bar?bar.querySelectorAll('button').length:0;

        // 3) 等待第一次完成 → 自动发送"问题2"
        await new Promise(r=>setTimeout(r,1200));
        await new Promise(r=>setTimeout(r,1200));
        out.answers = answers.slice();
        out.pendingBarCleared = !bar || bar.style.display==='none';
        out.userMsgs = [...document.querySelectorAll('#chatMsgs .msg.user')].map(e=>e.innerText);
        out.pool = window.SubAgentPool.getCount();

        // 4) 修改/删除：在 streaming 中排队后操作
        delayMain=true; mainCalls=0; answers.length=0;
        setVal('问题3'); $('#sendBtn').click(); await new Promise(r=>setTimeout(r,150));   // 进入 streaming(主模型延迟600ms)
        setVal('问题4'); $('#sendBtn').click(); await new Promise(r=>setTimeout(r,60));    // 排队
        const items0=[...document.querySelectorAll('#pendingBar .pending-item')];
        out.twoPending = items0.length;                       // 应 1（问题4）
        const editBtn0=items0[0].querySelectorAll('button')[1]; editBtn0.click();
        out.editFilledInput = input().value;                  // 应 问题4
        out.pendingAfterEdit = document.querySelectorAll('#pendingBar .pending-item').length; // 应 0
        // 再排队一条并删除
        setVal('问题5'); $('#sendBtn').click(); await new Promise(r=>setTimeout(r,60));    // 排队(仍在streaming)
        out.pendingOne = document.querySelectorAll('#pendingBar .pending-item').length;     // 应 1
        const items1=[...document.querySelectorAll('#pendingBar .pending-item')];
        const delBtn=items1[0].querySelectorAll('button')[2]; delBtn.click();
        out.pendingAfterDel = document.querySelectorAll('#pendingBar .pending-item').length; // 应 0
        out.barHiddenAfterDel = !bar || bar.style.display==='none';
        return out;
    });

    console.log('=== 发送/暂停切换 + 排队等待 ===');
    console.log(JSON.stringify(r,null,2));
    console.log('JS 错误数(排除CORS类): '+jsErrors.length); jsErrors.forEach(e=>console.log('  '+e));
    const pass =
        r.pauseBtnWhileEmpty==='⏸' && r.sendBtnWithText==='➤' &&
        r.pendingBarVisible===true && r.pendingBarText.includes('待发送：问题2') && r.pendingButtons===3 &&
        r.answers.length>=2 && r.answers.includes('答案1') && r.answers.includes('答案2') &&
        r.pendingBarCleared===true && r.userMsgs.some(t=>t.includes('问题1')) && r.userMsgs.some(t=>t.includes('问题2')) &&
        r.twoPending===1 && r.editFilledInput==='问题4' && r.pendingAfterEdit===0 &&
        r.pendingOne===1 && r.pendingAfterDel===0 && r.barHiddenAfterDel===true &&
        r.pool===0 && jsErrors.length===0;
    console.log('结果: '+(pass?'PASS':'FAIL'));
    await browser.close();
    process.exit(pass?0:1);
})().catch(e=>{console.error('异常:',e.message);process.exit(1);});
