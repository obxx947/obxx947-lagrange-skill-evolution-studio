// 轻量监督Agent测试：非默认模型触发并输出comply/violations；默认Flash跳过；子Agent池清空
const puppeteer = require('puppeteer-core');
(async () => {
  const b=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:'new',args:['--no-sandbox']});
  const p=await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(/429|LLM#/.test(m.text()))console.log('LOG',m.text().substring(0,80));});
  await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  await p.goto('http://localhost:3002/',{waitUntil:'networkidle2',timeout:60000});
  await p.evaluate(()=>{localStorage.setItem('lglr_intro_done','1');localStorage.setItem('lagrange_static_config',JSON.stringify({llm_api_key:'t',llm_api_url:'https://api.deepseek.com',llm_model:'glm-4.7-2507'}));window.__embedPipeline=async()=>({data:new Array(512).fill(0.02)});});
  await new Promise(r=>setTimeout(r,400));
  const r=await p.evaluate(async()=>{
    const out={};
    const mk=(content)=>({ok:true,json:async()=>({choices:[{message:{content},finish_reason:'stop'}]})});
    let supCalls=0;
    const orig=window.fetch.bind(window);
    window.fetch=async(url,opts)=>{
      const u=String(url);
      if(u.includes('/chat/completions')){
        const sys=String(opts.body&&JSON.parse(opts.body).messages[0].content||'');
        if(sys.includes('你是【监督Agent】')){ supCalls++; return mk('{"comply":false,"violations":[{"rule":"4 输出配队必须附打分","hit":"方案缺少打分结果"}],"note":"输出配队未附打分"}'); }
        if(sys.includes('· 审计智能体')) return mk('{"found_issues":[]}');
        if(sys.includes('· 裁判智能体')) return mk('{"score":82,"status":"PASS"}');
        if(sys.includes('检索总Agent')) return mk('素材包');
        if(sys.includes('你是【检索舰队·检索子Agent】')) return mk('素材');
        if(sys.includes('需求理解')) return mk('{"is_daily_chat":false,"clarified_intent":"x","reason":"x"}');
        return mk('这是某配置方案');   // 主模型
      }
      return orig(url,opts);
    };
    // 非默认模型 → 监督应触发
    const sup = await window.AgentEngine.supervisoryCheck('推荐一个470抗伤队','好的，主队6大矛，前排抗伤。', {apiKey:'t',apiUrl:'https://api.deepseek.com',model:'glm-4.7-2507'});
    out.nonFlash={sup, supCalls, pool:window.SubAgentPool.getCount()};
    // 默认Flash → 监督应跳过
    supCalls=0;
    const sup2 = await window.AgentEngine.supervisoryCheck('推荐一个470抗伤队','好的', {apiKey:'t',apiUrl:'https://api.deepseek.com',model:'glm-4.7-flash'});
    out.flash={sup2, supCalls, pool:window.SubAgentPool.getCount()};
    return out;
  });
  console.log(JSON.stringify(r,null,2));
  console.log('错误:',errs.length);
  const pass = r.nonFlash && r.nonFlash.sup && r.nonFlash.sup.comply===false && r.nonFlash.sup.violations.length>0 && r.nonFlash.supCalls===1 && r.nonFlash.pool===0
            && r.flash && r.flash.sup2===null && r.flash.supCalls===0 && r.flash.pool===0
            && errs.length===0;
  console.log('结果:', pass?'PASS':'FAIL');
  await b.close();
  process.exit(pass?0:1);
})().catch(e=>{console.error('异常:',e.message);process.exit(1);});
