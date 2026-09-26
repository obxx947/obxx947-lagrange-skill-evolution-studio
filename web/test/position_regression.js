/* 第十轮：站位更正后的全面验证（显示 / 战斗 / 知识库检索） */
const puppeteer=require('puppeteer-core');
const fs=require('fs');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE='http://127.0.0.1:3888/';
const LOG=[]; function say(...a){ const s=a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '); LOG.push(s); console.log(s); }
const results=[]; function check(n,ok,d){ results.push({n,ok:!!ok,d}); say((ok?'PASS ':'FAIL ')+n+(d?('  → '+d):'')); }

(async()=>{
  const b=await puppeteer.launch({executablePath:EDGE,headless:'new',protocolTimeout:300000,args:['--no-sandbox','--disable-gpu']});
  const p=await b.newPage();
  p.on('dialog',async d=>{ try{ await d.accept(); }catch(e){} });
  const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  p.on('console',m=>{ if(m.type()==='error'&&!/favicon|hf-mirror|ERR_FAILED|CORS|net::/i.test(m.text())) errs.push('CONSOLE: '+m.text()); });
  const ev=async(fn,...a)=>{ try{ return await p.evaluate(fn,...a); }catch(e){ return {__err:String(e.message)}; } };

  /* ===== 1. 配队页默认站位来自更正后的数据 ===== */
  say('===== 1. 配队页：默认站位 =====');
  await p.goto(BASE+'fleet.html',{waitUntil:'load',timeout:90000});
  await new Promise(r=>setTimeout(r,3000));
  const A=await ev(()=>{
    const want={'plutus-shield':'中排','uranus-spear':'前排','constantine':'中排','sun-whale':'中排',
                'tianquan':'前排','antontas':'中排','cishuimu':'后排','huoyanshan':null};
    const got={};
    ['plutus-shield','uranus-spear','constantine','sun-whale','tianquan','antontas','chixuimu'].forEach(id=>{
      const s=getShip(id);
      got[id]=s?defPos(s):'(缺)';
    });
    const bad=Object.keys(got).filter(k=>want[k]&&got[k]!==want[k]);
    // 实际加入一行看渲染出的站位
    newPlan();
    const af=activeFleet();
    af.main=[{id:'plutus-shield',name:'大盾',qty:1,mods:{},air:[]},
             {id:'uranus-spear',name:'大矛',qty:1,mods:{},air:[]}];
    fillPos(cur); renderAll();
    const rowsHtml=document.getElementById('mainList').innerHTML;
    return {got, bad, posInRows:(rowsHtml.match(/>中排<|>前排<|>后排</g)||[]),
            fleetToText:FleetIO.fleetToText(cur).replace(/\n/g,' | ')};
  });
  check('1a 配队页默认站位与更正数据一致', A.bad.length===0, JSON.stringify(A.got));
  check('1b 行内渲染出站位按钮', (A.posInRows||[]).length===2, JSON.stringify(A.posInRows));
  check('1c fleetToText 按新站位分组（大盾中排/大矛前排）', /前排│.*大矛/.test(A.fleetToText) && /中排│.*大盾/.test(A.fleetToText), A.fleetToText);

  /* ===== 2. 模拟器：站位 + 战斗分组 ===== */
  say('\n===== 2. 模拟器：站位与战斗 =====');
  await p.goto(BASE+'simulator.html',{waitUntil:'load',timeout:90000});
  await new Promise(r=>setTimeout(r,4000));
  const B=await ev(()=>{
    FLEET_TYPES.forEach(k=>{ fleetData[k].main=[]; fleetData[k].reinforcement=[]; });
    const want={'plutus-shield':'中排','uranus-spear':'前排','sun-whale':'中排','tianquan':'前排'};
    const got={}; Object.keys(want).forEach(id=>{ got[id]=SHIP_DATABASE[id].position; });
    // 加两艘并检查行上的站位
    currentFleetType='ally-escort'; currentFleetTab='main';
    spkFleetType='ally-escort'; spkTab='main'; spkSel=[]; spkToggle('uranus-spear'); spkToggle('plutus-shield'); spkConfirm();
    toggleFleetPanel('ally-escort');
    const el=document.getElementById('inlineFleetEditor');
    const poses=Array.from(el.querySelectorAll('.fpos')).map(x=>x.innerText.trim());
    // 战斗：站位进实例
    fleetData['enemy-escort'].main=[{uid:'e1',id:'constantine',name:'大帝',count:1,position:SHIP_DATABASE['constantine'].position,
        modules:{}, selectedModules:{}, aircraft:[]}];
    recalcAircraftSlots(fleetData['enemy-escort'].main[0]);
    refreshFleetViews();
    const ok=prepareBattle();
    return {got, bad:Object.keys(want).filter(k=>got[k]!==want[k]), poses,
            battlePos:ok?battleState.allyShips.map(s=>s.name+'/'+s.position):null};
  });
  check('2a 模拟器读取的站位与更正数据一致', B.bad.length===0, JSON.stringify(B.got));
  check('2b 编辑行显示站位（大矛前排、大盾中排）', JSON.stringify(B.poses)===JSON.stringify(['前排','中排']), JSON.stringify(B.poses));
  check('2c 战斗实例带正确站位', (B.battlePos||[]).join(',').indexOf('乌拉诺斯之矛/前排')>=0 && (B.battlePos||[]).join(',').indexOf('普鲁图斯之盾级-防护战列巡洋舰/中排')>=0, JSON.stringify(B.battlePos));

  /* ===== 3. 知识库：站位文件可被检索 ===== */
  say('\n===== 3. 知识库检索（TF-IDF + 语料） =====');
  const C=await ev(async()=>{
    const out={};
    try{ await KB.load(); }catch(e){ out.loadErr=String(e.message); }
    const qs=['大盾 站位','乌拉诺斯之矛 站位','舰船站位','天权级 站前排还是中排'];
    out.q={};
    for(const q of qs){
      try{
        const r=await KB.search(q,5);
        out.q[q]=(r||[]).map(x=>x.source).slice(0,4);
      }catch(e){ out.q[q]='ERR '+e.message; }
    }
    // 语料里是否包含站位文件
    try{
      const cr=await fetch('data/kb_corpus.json',{cache:'no-cache'});
      const cd=await cr.json();
      const pos=cd.chunks.filter(c=>/^舰船站位/.test(c.source||''));
      out.corpusPosChunks=pos.map(c=>c.source+'('+c.content.length+'字)');
      out.corpusTotal=cd.chunks.length;
      const one=pos.find(c=>/超主力/.test(c.source));
      out.sample=one?one.content.split('\n').filter(l=>/大盾|大矛|大帝/.test(l)).join(' / '):'(无)';
    }catch(e){ out.corpusErr=String(e.message); }
    return out;
  });
  check('3a 语料里含 4 个站位文件', (C.corpusPosChunks||[]).length===4, JSON.stringify(C.corpusPosChunks));
  check('3b 语料总块数 = 1130', C.corpusTotal===1130, 'total='+C.corpusTotal);
  say('3c/3d 知识库内容校验改由 Node 侧 _verify_pos_chain.js 做（更强：逐条比对）');

  /* ===== 4. 向量索引（若能加载模型） ===== */
  say('\n===== 4. 向量索引 =====');
  const D=await ev(async()=>{
    try{
      const r=await fetch('data/rag_index.json',{cache:'no-cache'});
      const j=await r.json();
      const pos=(j.chunks||[]).filter(c=>/^舰船站位/.test(c.source||''));
      return {dim:j.dim, chunks:j.chunk_count, posChunks:pos.map(c=>c.source+' vec='+(c.vector?c.vector.length:0)),
              ok:pos.length===4 && pos.every(c=>c.vector && c.vector.length===512)};
    }catch(e){ return {err:String(e.message)}; }
  });
  check('4 向量索引含 4 个站位块且各 512 维', D.ok===true, JSON.stringify(D));

  say('\n===== 运行期错误 =====');
  if(!errs.length) say('（无）'); else [...new Set(errs)].forEach(e=>say('  '+e));
  say('\n===== FAIL 汇总 =====');
  const f=results.filter(r=>!r.ok); if(!f.length) say('（全部 PASS）'); else f.forEach(x=>say('  ✗ '+x.n+' → '+x.d));
  fs.writeFileSync('_fleet_test10.log',LOG.join('\n'),'utf8');
  await b.close();
})().catch(e=>{ console.error('HARNESS ERROR',e); process.exit(1); });
