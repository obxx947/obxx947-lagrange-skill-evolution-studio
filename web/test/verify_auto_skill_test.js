// 自动沉淀（无需点赞）真实对话验证 + 截图
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
const SHOTS = path.resolve(__dirname, 'shots');
fs.mkdirSync(SHOTS, {recursive:true});

(async () => {
    const browser = await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:'new', args:['--no-sandbox','--window-size=1280,860']});
    const page = await browser.newPage();
    await page.setViewport({width:1280, height:860});
    const jsErrors = [];
    page.on('pageerror', err=>jsErrors.push('[JS] '+err.message));
    page.on('console', m=>{ if(m.type()==='error' && !m.text().includes('404')) jsErrors.push('[CONSOLE] '+m.text().substring(0,150)); });

    await page.goto('http://localhost:3002/chat.html', {waitUntil:'networkidle2', timeout:30000});
    await page.evaluate((c)=>{
        localStorage.setItem('lagrange_static_config', JSON.stringify(c));
        localStorage.setItem('lagrange_conversations','{}');
        localStorage.removeItem('lagrange_skills');
        localStorage.removeItem('lagrange_tools');
        localStorage.removeItem('lagrange_user_profile');
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
            // 计划/提问自动处理
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
                return {done:sb&&!sb.disabled, count:ans.length};
            });
            if(st.done && st.count>0) return true;
        }
        return false;
    }

    // ========== 对话1：有沉淀价值的配队对话 ==========
    const ok1 = await askAndWait('帮我配一个简单的护航抗伤队，主队加增援，说明思路', 12*60*1000);
    console.log('对话1完成: ' + ok1);
    // 等待后台自动反思完成
    await sleep(15000);
    let skills1 = await page.evaluate(()=>JSON.parse(localStorage.getItem('lagrange_skills')||'[]'));
    console.log('对话1后自动沉淀skill: ' + (skills1.length?skills1.map(s=>s.name+'（'+s.summary+'）').join(', '):'（无）'));
    // 截图：对话页
    await page.screenshot({path: path.join(SHOTS,'auto_skill_chat.png')});

    // ========== 对话2：闲聊（应不沉淀或沉淀价值低） ==========
    const ok2 = await askAndWait('谢谢，再见', 8*60*1000);
    console.log('对话2完成: ' + ok2);
    await sleep(15000);
    const skills2 = await page.evaluate(()=>JSON.parse(localStorage.getItem('lagrange_skills')||'[]'));
    console.log('对话2后skill总数: ' + skills2.length + '（闲聊应不新增或新增低价值）');

    // ========== skills.html 截图 ==========
    await page.goto('http://localhost:3002/skills.html', {waitUntil:'networkidle2'});
    await sleep(1500);
    await page.screenshot({path: path.join(SHOTS,'auto_skill_skills.png')});
    const skillNames = await page.evaluate(()=>[...document.querySelectorAll('#skillList .name')].map(e=>e.textContent.trim()));
    console.log('skills.html 展示: ' + skillNames.join(' / '));

    console.log('\nJS错误数: ' + jsErrors.length);
    if(jsErrors.length) jsErrors.slice(0,5).forEach(e=>console.log('  -', e.substring(0,150)));
    console.log('截图已保存: ' + SHOTS);
    await browser.close();
    process.exit(0);
})().catch(e=>{ console.error('测试异常:', e.message); process.exit(1); });
