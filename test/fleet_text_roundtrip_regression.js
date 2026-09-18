/* 验证：同站位多艘舰的往返（这是站位改完后暴露的浮动 bug） */
const puppeteer=require('puppeteer-core');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const LOG=[]; function say(...a){ const s=a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '); LOG.push(s); console.log(s); }
let pass=0, fail=0;
function check(n,ok,d){ if(ok){pass++;say('PASS '+n+(d?('  → '+d):''));} else {fail++;say('FAIL '+n+(d?('  → '+d):''));} }
(async()=>{
  const b=await puppeteer.launch({executablePath:EDGE,headless:'new',protocolTimeout:300000,args:['--no-sandbox','--disable-gpu']});
  const p=await b.newPage();
  p.on('dialog',async d=>{ try{ await d.accept(); }catch(e){} });
  p.on('pageerror',e=>say('PAGEERROR: '+e.message));
  await p.goto('http://127.0.0.1:3888/fleet.html',{waitUntil:'load',timeout:90000});
  await sleep(3000);
  const R=await p.evaluate(()=>{
    const out={};
    // ① 同站位两艘（大盾=中排、太阳鲸=中排，按新站位都在中排）
    const af=activeFleet();
    af.main=[{id:'plutus-shield',name:'普鲁图斯之盾级-防护战列巡洋舰',pos:'中排',qty:5,mods:{B:'B1'},air:[]},
             {id:'sun-whale',name:'太阳鲸-武装战略航空母舰',pos:'中排',qty:1,mods:{M:'M2'},
              air:[{id:'tianxuan',name:'天璇A-轻型攻击机',kind:'fighter',slot:'M2|fighter',qty:8}]},
             {id:'uranus-spear',name:'乌拉诺斯之矛',pos:'前排',qty:4,mods:{B:'B2'},
              air:[{id:'tianji',name:'天玑-重型护航艇',kind:'corvette',slot:'B2|corvette',qty:12}]}];
    af.reinforce=[{id:'tianshu',name:'天枢级-支援航空母舰',pos:'增援',qty:2,mods:{M:'M1'},air:[]}];
    fillPos(cur); renderAll();
    out.txt=FleetIO.fleetToText(cur);
    const parsed=FleetIO.parseFleetText(out.txt);
    out.parsedMain=parsed.main.map(x=>x.name+'/'+x.pos+'×'+x.qty);
    out.parsedRein=parsed.reinforce.map(x=>x.name+'×'+x.qty);
    out.parsedAir=parsed.air.map(a=>a.name+'×'+a.qty);
    // ② 三种竖线都要认
    const t1='中排│大盾 B1×5 ｜ 太阳鲸 M2×1 带 天璇×8';
    const t2='中排｜大盾 B1×5 ｜ 太阳鲸 M2×1';
    const t3='中排|大盾 B1×5|太阳鲸 M2×1';
    out.variants=[t1,t2,t3].map(t=>FleetIO.parseFleetText(t).main.length);
    out.looks1=FleetIO.looksLikeFleet(out.txt);
    return out;
  });
  say(out_head(R));
  function out_head(r){ return 'fleetToText:\n'+r.txt; }
  check('同站位 2 艘都解析出来（中排→2 条）', (R.parsedMain||[]).filter(x=>/中排/.test(x)).length===2, JSON.stringify(R.parsedMain));
  check('前排 1 条也没丢', (R.parsedMain||[]).filter(x=>/前排/.test(x)).length===1, JSON.stringify(R.parsedMain));
  check('三艘全在（共 3 条）', (R.parsedMain||[]).length===3, JSON.stringify(R.parsedMain));
  check('增援 1 条', (R.parsedRein||[]).length===1, JSON.stringify(R.parsedRein));
  check('载机 2 条且没挂错', (R.parsedAir||[]).length===2, JSON.stringify(R.parsedAir));
  check('│ ｜ | 三种竖线都能切分', JSON.stringify(R.variants)==='[2,2,2]', JSON.stringify(R.variants));
  check('looksLikeFleet 认得', R.looks1===true, String(R.looks1));
  console.log('\n通过 '+pass+' / 失败 '+fail);
  await b.close();
  process.exit(fail?1:0);
})().catch(e=>{ console.error('HARNESS ERROR',e); process.exit(1); });
