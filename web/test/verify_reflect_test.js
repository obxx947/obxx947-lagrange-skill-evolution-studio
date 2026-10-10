// 👍/👎 反思复测（操作条重建修复后）：真实 LLM 反思一次，验证沉淀 skill + 画像
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
        localStorage.setItem('lagrange_conversations', JSON.stringify({
            conv_t: {title:'反思测试', messages:[
                {role:'user', content:'帮我配一个470+5护航抗伤队'},
                {role:'assistant', content:'按护航抗伤原则，主队重甲战巡扛线+维修奶船，增援5艘不占人口；已实测多环境存活时长，方案如下：前排大盾旗舰+天权×2，中排066×5+光锥×3，后排开阳×6+瑶光×8，增援天枢×5。', meta:{sources:[]}}
            ], createdAt:new Date().toISOString()}
        }));
        localStorage.removeItem('lagrange_skills');
        localStorage.removeItem('lagrange_user_profile');
    }, testCfg);
    await page.reload({waitUntil:'networkidle2'});
    await sleep(2000);

    // 确认操作条存在（修复验证）
    const hasLike = await page.evaluate(()=>!!document.querySelector('#chatMsgs .msg.assistant .act-btn.like'));
    console.log('修复验证 - 回答消息含 👍 按钮: ' + hasLike);

    // 点击 👍
    await page.evaluate(()=>document.querySelector('#chatMsgs .msg.assistant .act-btn.like').click());
    await sleep(500);
    const modal = await page.evaluate(()=>document.getElementById('rateModal').classList.contains('show'));
    console.log('👍 弹出理由对话框: ' + modal);
    await page.evaluate(()=>{
        document.getElementById('rateReason').value='这套抗伤配置思路很实用，帮我配队时先按这个思路来';
        document.querySelector('#rateModal .m-ok').click();
    });

    // 等待反思结果
    let result = '';
    const t0 = Date.now();
    while(Date.now()-t0 < 4*60*1000){
        await sleep(4000);
        const st = await page.evaluate(()=>{
            const sys = [...document.querySelectorAll('#chatMsgs .msg.system')];
            return sys.length ? sys[sys.length-1].innerText : '';
        });
        if(st.includes('用户画像已更新') || st.includes('已沉淀skill') || st.includes('反思失败') || st.includes('反思完成')){
            result = st; break;
        }
    }
    console.log('反思结果: ' + (result.replace(/\n/g,' ').substring(0,150) || '（超时无结果）'));
    const profile = await page.evaluate(()=>JSON.parse(localStorage.getItem('lagrange_user_profile')||'{}'));
    const skills = await page.evaluate(()=>JSON.parse(localStorage.getItem('lagrange_skills')||'[]'));
    console.log('用户画像(精简): ' + (profile.condensed||'（无）'));
    console.log('沉淀skill: ' + (skills.length ? skills.map(s=>s.name+'('+s.summary+')').join(', ') : '（无）'));
    console.log('JS错误数: ' + jsErrors.length);
    await browser.close();
    process.exit(0);
})().catch(e=>{ console.error('异常:', e.message); process.exit(1); });
