// ============ 全功能真实对话复测（修复操作条重建后） ============
// 前置：localhost:3002 静态服务已启动；使用 ../拉格朗日智能体/local_config.json 真实 key
// 覆盖：真实对话→👍反思沉淀(修复验证)→计划模式470+5审批→/压缩
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
let pass = 0, fail = 0;
function ok(cond, name, detail){ if(cond){pass++;console.log('  ✅ '+name);} else {fail++;console.log('  ❌ '+name+(detail?'  — '+detail:''));} }
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
        localStorage.removeItem('lagrange_tools');
        localStorage.removeItem('lagrange_user_profile');
    }, testCfg);
    await page.reload({waitUntil:'networkidle2'});
    await sleep(2000);

    // 等待本轮回答（自动处理计划批准/提问卡片）
    async function waitAnswer(question, maxMs, autoPlan=true){
        console.log('\n▶ 提问: ' + question);
        await page.type('#chatInput', question);
        await page.click('#sendBtn');
        const t0 = Date.now();
        let lastText = '';
        while(Date.now()-t0 < maxMs){
            await sleep(5000);
            if(autoPlan){
                const hasPlan = await page.evaluate(()=>!!document.querySelector('.plan-card .plan-approve'));
                if(hasPlan){
                    console.log('  [自动] 批准计划');
                    await page.evaluate(()=>document.querySelector('.plan-card .plan-approve').click());
                    await sleep(2000); continue;
                }
            }
            const hasAsk = await page.evaluate(()=>!!document.getElementById('askCard'));
            if(hasAsk){
                console.log('  [自动] 提交提问卡片');
                await page.evaluate(()=>{
                    const first=document.querySelector('#askCard .ask-opt'); if(first) first.click();
                    const free=document.getElementById('askFreeText'); if(free) free.value='全部加入，直接执行';
                    const btn=document.querySelector('#askCard .ask-submit'); if(btn) btn.click();
                });
                await sleep(2000); continue;
            }
            const st = await page.evaluate(()=>{
                const sb=document.getElementById('sendBtn');
                const done=sb && !sb.disabled;
                const ans=document.querySelectorAll('#chatMsgs .msg.assistant');
                const last=ans.length?ans[ans.length-1]:null;
                return {done, text:last?last.innerText.substring(0,150):'', count:ans.length};
            });
            if(st.done && st.count>0){ lastText=st.text; break; }
            lastText=st.text;
        }
        console.log('  [结果] 回答('+(lastText.length||0)+'字符): '+lastText.replace(/\n/g,' ').substring(0,80));
        return lastText;
    }

    // ========== 1. 真实对话 → answer 事件（验证操作条重建修复） ==========
    console.log('\n==================== 复测1：真实对话 + 👍反思（操作条重建） ====================');
    const a1 = await waitAnswer('你好，介绍一下你能做什么', 8*60*1000);
    ok(a1.length>0, '普通模式收到回答');
    const hasLike = await page.evaluate(()=>!!document.querySelector('#chatMsgs .msg.assistant:last-of-type .act-btn.like'));
    ok(hasLike, '【修复验证】answer 后操作条已重建（👍按钮存在）');
    await page.evaluate(()=>document.querySelector('#chatMsgs .msg.assistant:last-of-type .act-btn.like').click());
    await sleep(400);
    const modal = await page.evaluate(()=>document.getElementById('rateModal').classList.contains('show'));
    ok(modal, '👍 弹出理由对话框');
    await page.evaluate(()=>{
        document.getElementById('rateReason').value='回答清晰实用，帮我配队时优先考虑生存';
        document.querySelector('#rateModal .m-ok').click();
    });
    let reflectRes = '';
    const t2 = Date.now();
    while(Date.now()-t2 < 4*60*1000){
        await sleep(4000);
        const st = await page.evaluate(()=>{ const sys=[...document.querySelectorAll('#chatMsgs .msg.system')]; return sys.length?sys[sys.length-1].innerText:''; });
        if(st.includes('用户画像已更新') || st.includes('已沉淀skill') || st.includes('反思失败') || st.includes('反思完成')){ reflectRes=st; break; }
    }
    ok(!!reflectRes, '反思流水线完成: '+(reflectRes.replace(/\n/g,' ').substring(0,80)||'超时'));
    const profile = await page.evaluate(()=>JSON.parse(localStorage.getItem('lagrange_user_profile')||'{}'));
    ok(!!profile.condensed, '用户画像已更新: '+(profile.condensed||'空'));
    const skills = await page.evaluate(()=>JSON.parse(localStorage.getItem('lagrange_skills')||'[]'));
    console.log('  [沉淀skill数] ' + skills.length + (skills.length?('：'+skills.map(s=>s.name).join(',')):''));

    // ========== 2. 计划模式 470+5 完整审批流 ==========
    console.log('\n==================== 复测2：计划模式 470+5 完整审批流 ====================');
    await page.evaluate(()=>{
        const c=JSON.parse(localStorage.getItem('lagrange_static_config')||'{}');
        c.plan_mode=true;
        localStorage.setItem('lagrange_static_config', JSON.stringify(c));
        document.getElementById('modePlan') && document.getElementById('modePlan').click();
    });
    await sleep(400);
    ok(await page.evaluate(()=>document.getElementById('modePlan').classList.contains('on')), '计划模式开关已开启');
    const a2 = await waitAnswer('给我一个470+5的护航抗伤队，我没有CV3000', 16*60*1000);
    const planShown = await page.evaluate(()=>[...document.querySelectorAll('#chatMsgs .msg')].some(el=>el.innerText.includes('本次任务完整执行计划书')));
    ok(planShown, '计划模式下输出【执行计划书】');
    ok(a2.length>0, '批准后获得最终配置回答');
    const hasCfg = await page.evaluate(()=>{ const sys=[...document.querySelectorAll('#chatMsgs .msg.system')]; return sys.some(s=>s.innerText.includes('压缩')); });

    // ========== 3. /压缩 强制压缩 ==========
    console.log('\n==================== 复测3：/压缩 强制压缩 ====================');
    const streaming = await page.evaluate(()=>{ const sb=document.getElementById('sendBtn'); return sb && sb.disabled; });
    if(streaming){ console.log('  [跳过] 上一轮仍在流式输出'); }
    else{
        await page.type('#chatInput', '/压缩');
        await page.click('#sendBtn');
        let cRes='';
        const t3=Date.now();
        while(Date.now()-t3 < 4*60*1000){
            await sleep(4000);
            const st=await page.evaluate(()=>{ const sys=[...document.querySelectorAll('#chatMsgs .msg.system')]; return sys.length?sys[sys.length-1].innerText:''; });
            if(st.includes('压缩完成')||st.includes('压缩失败')||st.includes('对话内容太少')){ cRes=st; break; }
        }
        ok(!!cRes, '/压缩 已执行: '+(cRes.replace(/\n/g,' ').substring(0,80)||'超时'));
        const hasSummary = await page.evaluate(()=>{
            const conv=JSON.parse(localStorage.getItem('lagrange_conversations')||'{}');
            const cur=conv[Object.keys(conv).pop()]||{messages:[]};
            return cur.messages.some(m=>(m.content||'').includes('【对话摘要】'));
        });
        ok(hasSummary, '会话已写入【对话摘要】');
    }

    console.log('\n========================================');
    console.log('JS错误数: ' + jsErrors.length);
    if(jsErrors.length) jsErrors.slice(0,5).forEach(e=>console.log('  -', e.substring(0,150)));
    console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败');
    await browser.close();
    process.exit(fail?1:0);
})().catch(e=>{ console.error('测试异常:', e.message); process.exit(1); });
