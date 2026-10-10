// 智谱 GLM-4.7-Flash 真实对话验证（工具链/质检/流式兼容性）
// 前置：localhost:3002 已启动；GLM Key 从环境变量 GLM_API_KEY 读取（不硬编码进代码）
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const GLM_KEY = process.env.GLM_API_KEY || '';
if(!GLM_KEY){ console.error('缺少 GLM_API_KEY 环境变量'); process.exit(1); }
const testCfg = {
    glm_api_key: GLM_KEY,
    glm_model: process.env.GLM_MODEL || 'glm-4.7-flash',
    max_tokens: 100000
};
const sleep = ms => new Promise(r=>setTimeout(r,ms));

(async () => {
    const browser = await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:'new', args:['--no-sandbox']});
    const page = await browser.newPage();
    const jsErrors = [];
    page.on('pageerror', err=>jsErrors.push('[JS] '+err.message));
    page.on('console', m=>{ if(m.type()==='error' && !m.text().includes('404')) jsErrors.push('[CONSOLE] '+m.text().substring(0,150)); });
    // 拦截 API 响应错误（智谱 401/限流等）
    page.on('response', async r=>{
        const u=r.url();
        if(u.includes('chat/completions') && r.status()>=400){
            const t=await r.text().catch(()=>''); jsErrors.push('[API '+r.status()+'] '+t.substring(0,150));
        }
    });

    await page.goto('http://localhost:3002/chat.html', {waitUntil:'networkidle2', timeout:30000});
    await page.evaluate((c)=>{
        localStorage.setItem('lagrange_static_config', JSON.stringify(c));
        localStorage.setItem('lagrange_conversations','{}');
        localStorage.removeItem('lagrange_skills');
    }, testCfg);
    await page.reload({waitUntil:'networkidle2'});
    await sleep(2000);

    const t0=Date.now();
    console.log('▶ 提问: 推荐一个简单的400人口输出队配置');
    await page.type('#chatInput', '推荐一个简单的400人口输出队配置');
    await page.click('#sendBtn');
    let answer='', toolCount=0, done=false;
    while(Date.now()-t0 < 12*60*1000){
        await sleep(5000);
        if(await page.evaluate(()=>!!document.querySelector('.plan-card .plan-approve'))){
            console.log('  [自动] 批准计划');
            await page.evaluate(()=>document.querySelector('.plan-card .plan-approve').click());
            await sleep(2000); continue;
        }
        if(await page.evaluate(()=>!!document.getElementById('askCard'))){
            console.log('  [自动] 提交提问卡片');
            await page.evaluate(()=>{
                const first=document.querySelector('#askCard .ask-opt'); if(first) first.click();
                const free=document.getElementById('askFreeText'); if(free) free.value='全部加入，直接执行';
                const btn=document.querySelector('#askCard .ask-submit'); if(btn) btn.click();
            });
            await sleep(2000); continue;
        }
        const st=await page.evaluate(()=>{
            const sb=document.getElementById('sendBtn');
            const ans=document.querySelectorAll('#chatMsgs .msg.assistant');
            const last=ans.length?ans[ans.length-1]:null;
            const lines=[...(document.querySelectorAll('#statusPanelBody .sp-line')||[])].map(l=>l.textContent||'');
            const tc=lines.filter(t=>t.includes('调用工具')).length;
            return {done:sb&&!sb.disabled, text:last?last.innerText.substring(0,200):'', count:ans.length, tc};
        });
        toolCount=st.tc;
        if(st.done && st.count>0){ answer=st.text; done=true; break; }
    }
    const sec=((Date.now()-t0)/1000).toFixed(0);
    console.log('\n========== 结果 ==========');
    console.log('耗时: '+sec+'s | 工具调用: '+toolCount+' 次 | 完成: '+done);
    console.log('回答('+answer.length+'字符): '+answer.replace(/\n/g,' ').substring(0,150));
    console.log('JS/API错误数: '+jsErrors.length);
    if(jsErrors.length) jsErrors.slice(0,8).forEach(e=>console.log('  -', e.substring(0,160)));
    console.log('工具链可用: '+(toolCount>0)+' | 收到回答: '+(answer.length>0));
    await browser.close();
    process.exit(0);
})().catch(e=>{ console.error('测试异常:', e.message); process.exit(1); });
