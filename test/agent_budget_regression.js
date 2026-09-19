/* 额度机制实测：用假 LLM（拦截 fetch）疯狂刷工具调用，验证
   ① 80% 有收敛提醒 ② 常规额度用尽进入"关键工具"模式 ③ 彻底用尽后停用工具并强制出答案
   ④ 全程不硬截停、最终一定有 answer */
const puppeteer=require('puppeteer-core');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  const b=await puppeteer.launch({executablePath:EDGE,headless:'new',protocolTimeout:600000,args:['--no-sandbox','--disable-gpu']});
  const p=await b.newPage();
  p.on('dialog',async d=>{ try{ await d.accept(); }catch(e){} });
  p.on('pageerror',e=>console.log('PAGEERROR:',e.message));

  // 拦截所有 /chat/completions：根据请求内容返回"调工具"或"正文"
  await p.evaluateOnNewDocument(()=>{
    window.__stats={llmCalls:0, withTools:0, withoutTools:0, toolCallsReq:0};
    const orig=window.fetch;
    window.fetch=async function(url,opt){
      const u=String(url);
      if(u.indexOf('/chat/completions')<0) return orig.apply(this,arguments);
      let body={}; try{ body=JSON.parse((opt&&opt.body)||'{}'); }catch(e){}
      window.__stats.llmCalls++;
      const msgs=body.messages||[];
      const all=msgs.map(m=>String(m.content||'')).join('\n');
      const hasTools=!!(body.tools&&body.tools.length);
      let content='';
      if(hasTools){
        window.__stats.withTools++; window.__stats.toolCallsReq++;
        // 每轮返回 5 个工具调用（轮换 6 个名字，含 2 个填充名）→ 让总次数爬到 240
        const ROT=['get_ship_data','search_fleets','get_ship_builds','make_fleet','_pad1','_pad2'];
        const tcs=[];
        for(let k=0;k<5;k++){
          const nm=ROT[(window.__stats.toolCallsReq+k) % ROT.length];
          tcs.push({id:'c'+window.__stats.llmCalls+'_'+k,type:'function',function:{name:nm,arguments:'{}'}});
        }
        return new Response(JSON.stringify({choices:[{message:{content:null,tool_calls:tcs},
          finish_reason:'tool_calls'}]}),{status:200,headers:{'Content-Type':'application/json'}});
      }
      window.__stats.withoutTools++;
      // 质检类调用 → 返回可解析的 PASS JSON
      if(/你是主张拆解智能体|你是独立校验裁判|你是FACT-AUDIT审计智能体|你是LLM-as-Judge评分智能体|你是质检【Agent-[AB]/.test(all)){
        content=JSON.stringify({score:88,status:'PASS',final_answer:'（质检放行）',error_list:[],
          claims:[],verdicts:[],layers:{},passed:true});
      }else{
        content='【最终回答】基于已获得的资料给出结论：这是额度耗尽后被迫产出的正文。';
      }
      return new Response(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}),
        {status:200,headers:{'Content-Type':'application/json'}});
    };
  });

  await p.goto('http://127.0.0.1:3888/chat.html',{waitUntil:'load',timeout:90000});
  await sleep(3500);
  // 配一个假 key（fetch 被拦，不会真发请求）
  await p.evaluate(()=>{
    localStorage.setItem('lagrange_static_config', JSON.stringify({
      models:[{id:'t',name:'T',api_key:'fake',api_url:'https://fake.local/v1',model:'fake-model'}],
      active_model_id:'t', rag_enabled:false
    }));
  });
  await p.reload({waitUntil:'load'});
  await sleep(3500);

  console.log('开始跑（假模型会一直要求调工具，直到额度耗尽）…');
  const t0=Date.now();
  const R=await p.evaluate(async()=>{
    const evs=[];
    const emit=(e,d)=>{ evs.push({e, d:String(d==null?'':d).slice(0,110)}); };
    let text='';
    try{ text=await AgentEngine.chat('请给我一套420人口的配队','',emit,null,null); }
    catch(err){ text='THREW: '+String(err&&err.message||err); }
    // 关键事件抽样
    const find=k=>evs.filter(x=>x.e.indexOf(k)>=0 || x.d.indexOf(k)>=0);
    return {
      llmCalls:window.__stats.llmCalls, withTools:window.__stats.withTools, withoutTools:window.__stats.withoutTools,
      events:evs.length,
      收敛提醒:find('额度已用').length,
      关键工具模式:find('仅保留关键工具').length,
      收尾:find('整理最终回答').length,
      拒绝:find('改为基于已有资料作答').length,
      answers:find('answer').map(x=>x.d.slice(0,60)),
      done:find('done').length,
      textHead:String(text).slice(0,80)
    };
  });
  console.log('耗时 '+((Date.now()-t0)/1000).toFixed(1)+'s');
  console.log(JSON.stringify(R,null,1));

  const ok1=R.收敛提醒>0, ok2=R.关键工具模式>0, ok3=R.收尾>0, ok4=R.answers.length>0;
  console.log('\n'+(ok1?'✅':'❌')+' 80% 收敛提醒');
  console.log((ok2?'✅':'❌')+' 常规额度用尽 → 关键工具模式');
  console.log((ok3?'✅':'❌')+' 彻底用尽 → 停用工具收尾');
  console.log((ok4?'✅':'❌')+' ★ 最终仍然给出了 answer（未硬截停）');
  console.log(ok1&&ok2&&ok3&&ok4 ? '\n全部通过' : '\n有未通过项');
  await b.close();
})().catch(e=>{ console.error('HARNESS ERROR',e); process.exit(1); });
