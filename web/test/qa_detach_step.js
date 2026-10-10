/* 逐步锁定：到底是 sleep(2500) 还是 addStyleTag 导致 detached */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:3888';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let round = 1; round <= 2; round++) {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox','--disable-gpu'] });
    const p = await b.newPage();
    await p.setViewport({width:1500,height:1000});
    const ev=[]; p.on('error',e=>ev.push('CRASH:'+String(e.message).slice(0,90)));
    p.on('framenavigated',fr=>{if(fr===p.mainFrame())ev.push('NAV:'+fr.url());});
    let crash='';
    const S=async(n,fn)=>{ if(crash) return; try{ const r=await fn(); console.log('   round'+round+' ✅ '+n+(r!==undefined?' → '+String(r).slice(0,60):'')); }catch(e){ crash=n+' :: '+String(e.message).slice(0,110); console.log('   round'+round+' ❌ '+n+' → '+crash); } };
    await S('goto', async()=>{ await p.goto(BASE+'/index.html',{waitUntil:'load',timeout:60000}); return 'ok'; });
    await S('sleep 2500', async()=>{ await sleep(2500); return 'ok'; });
    await S('evaluate#1 (无 addStyleTag)', async()=>await p.evaluate(()=>document.body.innerText.length));
    await S('addStyleTag', async()=>{ await p.addStyleTag({content:'*{scroll-behavior:auto !important}'}); return 'ok'; });
    await S('sleep 300', async()=>{ await sleep(300); return 'ok'; });
    await S('evaluate#2 (addStyleTag 之后)', async()=>await p.evaluate(()=>document.body.innerText.length));
    await S('sleep 1500', async()=>{ await sleep(1500); return 'ok'; });
    await S('evaluate#3', async()=>await p.evaluate(()=>document.body.innerText.length));
    console.log('   round'+round+' 事件: '+(ev.join(' | ')||'（无）')+' ｜ 崩溃步: '+(crash||'无'));
    await b.close();
  }
})();
