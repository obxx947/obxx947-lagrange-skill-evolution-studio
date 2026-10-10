// 对话直接创建 skill（create_skill 工具）真实对话验证
// 前置：localhost:3002 已启动；使用 ../拉格朗日智能体/local_config.json 真实 key
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
const sleep = ms => new Promise(r=>setTimeout(r,ms));

(async () => {
    const browser = await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:'new', args:['--no-sandbox']});
    const page = await browser.newPage();
    const jsErrors = [];
    page.on('pageerror', err=>jsErrors.push('[JS] '+err.message));
    page.on('console', m=>{ if(m.type()==='error' && !m.text().includes('404')) jsErrors.push('[CONSOLE] '+m.text().substring(0,150)); });

    await page.goto('http://localhost:3002/chat.html', {waitUntil:'networkidle2', timeout:30000});
    await page.evaluate((c)=>{
        localStorage.setItem('lagrange_static_config', JSON.stringify(c));
        localStorage.setItem('lagrange_conversations','{}');
        localStorage.removeItem('lagrange_skills');
        localStorage.removeItem('lagrange_auto_reflect');
    }, testCfg);
    await page.reload({waitUntil:'networkidle2'});
    await sleep(2000);

    async function askAndWait(question, maxMs){
        console.log('\n▶ ' + question);
        await page.type('#chatInput', question);
        await page.click('#sendBtn');
        const t0 = Date.now();
        while(Date.now()-t0 < maxMs){
            await sleep(4000);
            if(await page.evaluate(()=>!!document.querySelector('.plan-card .plan-approve'))){
                console.log('  [自动] 批准计划');
                await page.evaluate(()=>document.querySelector('.plan-card .plan-approve').click());
                await sleep(1500); continue;
            }
            if(await page.evaluate(()=>!!document.getElementById('askCard'))){
                console.log('  [自动] 提交提问卡片');
                await page.evaluate(()=>{
                    const first=document.querySelector('#askCard .ask-opt'); if(first) first.click();
                    const free=document.getElementById('askFreeText'); if(free) free.value='全部加入，直接执行';
                    const btn=document.querySelector('#askCard .ask-submit'); if(btn) btn.click();
                });
                await sleep(1500); continue;
            }
            const st=await page.evaluate(()=>{
                const sb=document.getElementById('sendBtn');
                const ans=document.querySelectorAll('#chatMsgs .msg.assistant');
                const last=ans.length?ans[ans.length-1]:null;
                return {done:sb&&!sb.disabled, count:ans.length, text:last?last.innerText.substring(0,250):''};
            });
            if(st.done && st.count>0) return st.text;
            if(st.done) return '';
        }
        return '';
    }

    // 1. 先有一段配队对话（提供可提取的思路）
    const a1 = await askAndWait('推荐一个简单的400人口输出队配置', 12*60*1000);
    console.log('对话1回答(' + a1.length + '字符): ' + a1.replace(/\n/g,' ').substring(0,120));

    // 2. 对话中直接要求保存为 skill（关键验证点）
    const a2 = await askAndWait('把刚才这个输出队的配队思路保存成一个skill', 10*60*1000);
    console.log('对话2回答(' + a2.length + '字符): ' + a2.replace(/\n/g,' ').substring(0,150));

    // 3. 检查 skillStore
    await sleep(3000);
    const skills = await page.evaluate(()=>JSON.parse(localStorage.getItem('lagrange_skills')||'[]'));
    console.log('\nskillStore 内容: ' + (skills.length ? skills.map(s=>'【'+s.name+'】'+s.summary).join(' / ') : '（空）'));
    const created = skills.find(s=>/输出队|配队|输出/.test(s.name));
    console.log('对话创建 skill 成功: ' + !!created);

    console.log('\nJS错误数: ' + jsErrors.length);
    if(jsErrors.length) jsErrors.slice(0,5).forEach(e=>console.log('  -', e.substring(0,150)));
    await browser.close();
    process.exit(0);
})().catch(e=>{ console.error('测试异常:', e.message); process.exit(1); });
