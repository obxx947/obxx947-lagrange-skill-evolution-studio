// 真实对话验证：1 轮真实 LLM 对话，验证 计划审批→工具→质检→最终回答 全链路
// 前置：localhost:3002 静态服务已启动；使用 ../拉格朗日智能体/local_config.json 真实 key
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../拉格朗日智能体/local_config.json'), 'utf-8'));
const models = cfg.models || [];
const testCfg = {
    llm_api_key: cfg.llm_api_key, llm_api_url: cfg.llm_api_url, llm_model: cfg.llm_model,
    models: models.map(m=>({id:m.id, name:m.name, api_key:m.api_key, api_url:m.api_url, model:m.model})),
    active_model_id: cfg.active_model_id,
    max_tokens: 100000
};
const QUESTION = '给我一个470+5的护航抗伤队，我没有CV3000';

(async () => {
    const browser = await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:'new', args:['--no-sandbox']});
    const page = await browser.newPage();
    const jsErrors = [];
    page.on('pageerror', err=>jsErrors.push('[JS] '+err.message));
    page.on('console', m=>{ if(m.type()==='error' && !m.text().includes('404')) jsErrors.push('[CONSOLE] '+m.text().substring(0,150)); });

    await page.goto('http://localhost:3002/chat.html', {waitUntil:'networkidle2', timeout:30000});
    await page.evaluate((c)=>{ localStorage.setItem('lagrange_static_config', JSON.stringify(c)); }, testCfg);
    // 清空旧会话，确保从零开始
    await page.evaluate(()=>{ localStorage.setItem('lagrange_conversations','{}'); });
    await page.reload({waitUntil:'networkidle2'});

    console.log('问题: ' + QUESTION);
    const t0 = Date.now();
    await page.type('#chatInput', QUESTION);
    await page.click('#sendBtn');

    let finalAnswer = '';
    let statusLines = [];
    let toolCount = 0;
    let lastLen = -1;
    const DEADLINE = 1000*60*10; // 10 分钟上限
    while(Date.now()-t0 < DEADLINE){
        await new Promise(r=>setTimeout(r,5000));
        const st = await page.evaluate(()=>{
            const ans = document.querySelector('#chatMsgs .msg.assistant:last-of-type .md-p, #chatMsgs .msg.assistant:last-of-type');
            const a = ans ? ans.innerText : '';
            const lines = [...(document.querySelectorAll('#statusPanelBody .sp-line')||[])].map(l=>l.textContent||'');
            const toolN = lines.filter(t=>t.includes('调用工具')).length;
            const done = !!document.getElementById('sendBtn') && !document.getElementById('sendBtn').disabled;
            return {a, lines, toolN, done};
        });
        statusLines = st.lines;
        toolCount = st.toolN;
        if(st.a && st.a.length>0 && st.a !== lastLen){
            finalAnswer = st.a;
            lastLen = st.a.length;
        }
        if(st.done && st.a.length>0){
            break;
        }
        // 计划批准：出现"批准"按钮时点击（模拟用户批准）
        const hasPlan = await page.evaluate(()=>!!document.querySelector('.plan-card .plan-approve'));
        if(hasPlan){
            console.log('[批准] 点击批准计划');
            await page.evaluate(()=>{ document.querySelector('.plan-card .plan-approve').click(); });
            await new Promise(r=>setTimeout(r,2000));
        }
        // ask_user 提问卡片：自动提交第一个选项
        const hasAsk = await page.evaluate(()=>!!document.getElementById('askCard'));
        if(hasAsk){
            console.log('[ask_user] 自动选择第一个选项并提交');
            await page.evaluate(()=>{
                const first=document.querySelector('#askCard .ask-opt'); if(first) first.click();
                document.getElementById('askFreeText') && (document.getElementById('askFreeText').value='');
                const btn=document.querySelector('#askCard .ask-submit'); if(btn) btn.click();
            });
            await new Promise(r=>setTimeout(r,2000));
        }
    }
    const sec = ((Date.now()-t0)/1000).toFixed(0);
    console.log('\n========== 结果 ==========');
    console.log('耗时: ' + sec + 's | 工具调用: ' + toolCount + ' 次');
    console.log('状态行(末8条):');
    statusLines.slice(-8).forEach(l=>console.log('  · '+l.substring(0,90)));
    console.log('\n最终回答(' + finalAnswer.length + '字符):');
    console.log(finalAnswer.substring(0,800));
    console.log('\nJS错误数: ' + jsErrors.length);
    if(jsErrors.length) jsErrors.forEach(e=>console.log('  -', e.substring(0,150)));
    console.log('回答是否包含配置方案: ' + /[×x]?\d+/.test(finalAnswer));
    await browser.close();
    process.exit(0);
})().catch(e=>{ console.error('测试异常:', e.message); process.exit(1); });
