/* ============================================================
   fleet.html 配队页 UI/逻辑 回归测试（puppeteer + Edge）
   ------------------------------------------------------------
   用途：改完 fleet.html / js/fleet_io.js / js/fleet_lib.js 后跑一遍，
        验证载机位模型、服役上限、站位、旗舰、配队库、导入导出等不被改坏。
   跑法：
     1) cd 到 拉格朗日智能体3 （有 node_modules/puppeteer-core 与 data/ship_database.json）
     2) python -m http.server 3888 --bind 127.0.0.1
     3) node <本文件>     （脚本会自己起 Edge headless 打开 http://127.0.0.1:3888/fleet.html）
   依赖：本机 Edge 路径、端口 3888。断言里出现的 FAIL 若为「card-not-found」之类，
        通常是测试定位器过时（页面结构变了），先怀疑测试再怀疑代码。
   ============================================================ */
/* 第六轮：载机位模型重做后的验证 + 全量回归 */
const puppeteer=require('puppeteer-core');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const LOG=[]; function say(...a){ const s=a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '); LOG.push(s); console.log(s); }
const results=[]; function check(n,ok,d){ results.push({n,ok:!!ok,d}); say((ok?'PASS ':'FAIL ')+n+(d?('  → '+d):'')); }

(async()=>{
  const b=await puppeteer.launch({executablePath:EDGE,headless:'new',args:['--no-sandbox','--disable-gpu']});
  const p=await b.newPage();
  p.on('dialog',async d=>{ try{ await d.accept(); }catch(e){} });
  const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  p.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
  await p.goto('http://127.0.0.1:3888/fleet.html',{waitUntil:'load',timeout:60000});
  await new Promise(r=>setTimeout(r,2500));
  const ev=async(fn,...a)=>{ try{ return await p.evaluate(fn,...a); }catch(e){ return {__err:String(e.message)}; } };

  say('===== 1. 每个模块的载机位分开 =====');
  const t1=await ev(()=>{ const af=activeFleet();
    af.main=[{id:'sun-whale',name:'太阳鲸',pos:'后排',qty:1,mods:{M:'M2',C:'C1'},air:[]}];
    af.reinforce=[]; renderAll();
    const box=document.getElementById('mainList').querySelector('.airbox');
    const rows=Array.from(box.querySelectorAll('.airline')).map(el=>el.innerText.replace(/\s+/g,' ').trim());
    const btns=Array.from(box.querySelectorAll('.airline button')).map(el=>el.innerText.trim());
    return {rows, btns, slotKeys:airSlots(getShip('sun-whale'),{M:'M2',C:'C1'},1).map(s=>s.key+'='+s.cap+'/'+s.allow)}; });
  check('1a 太阳鲸 M2+C1 → 两个独立战机位（各 8 / 各 5）', t1.rows.length===2 && t1.btns.length===2, JSON.stringify(t1));
  check('1b 载机位 key 按模块分开', JSON.stringify(t1.slotKeys)===JSON.stringify(['M2|fighter=8/ALL','C1|fighter=5/ALL']), JSON.stringify(t1.slotKeys));

  say('\n===== 2. 机型限制不串味（S 槽 不得因 ALL 槽而被放开） =====');
  const t2=await ev(()=>{ const af=activeFleet();
    af.main=[{id:'eternal-vault',name:'永恒苍穹',pos:'后排',qty:1,mods:{M:'M1',C:'C1'},air:[]}]; af.reinforce=[]; renderAll();
    pickMode='air'; pickSection='main'; pickIdx=0;
    openAirPicker('main',0,'M1|fighter');
    const g1=document.getElementById('pkGrid').innerHTML;
    const c1=document.getElementById('pkTitle').textContent;
    openAirPicker('main',0,'C1|fighter');
    const g2=document.getElementById('pkGrid').innerHTML;
    const c2=document.getElementById('pkTitle').textContent;
    return {m1HasLarge:(g1.indexOf('刺鳐')>=0||g1.indexOf('牛蛙')>=0||g1.indexOf('BR050')>=0), m1Title:c1,
            c1HasLarge:(g2.indexOf('刺鳐')>=0||g2.indexOf('牛蛙')>=0||g2.indexOf('BR050')>=0), c1Title:c2,
            slots:airSlots(getShip('eternal-vault'),{M:'M1',C:'C1'},1).map(s=>s.key+':'+s.cap+'/'+s.allow)}; });
  check('2a M1(仅S) 载机位不列大型机', t2.m1HasLarge===false, t2.m1Title);
  check('2b C1(可大型) 载机位列大型机', t2.c1HasLarge===true, t2.c1Title);
  check('2c slot allow 未被合并拉高', JSON.stringify(t2.slots)===JSON.stringify(['M1|fighter:3/S','C1|fighter:4/ALL']), JSON.stringify(t2.slots));

  say('\n===== 3. 载机服役上限 = 整队口径 =====');
  const t3=await ev(()=>{ const af=activeFleet(); activeFleet().stitch=false;
    af.main=[{id:'sun-whale',name:'太阳鲸',pos:'后排',qty:1,mods:{M:'M2'},air:[{id:'mistral',name:'米斯特拉',kind:'fighter',slot:'M2|fighter',qty:8}]}];
    af.reinforce=[{id:'eternal-vault',name:'永恒苍穹',pos:'增援',qty:1,mods:{C:'C1'},air:[]}];
    renderAll(); pickSection='reinforce'; pickIdx=0;
    openAirPicker('reinforce',0,'C1|fighter');
    const capHere=airSlotOf(getShip('eternal-vault'),{C:'C1'},1,'C1|fighter').cap;
    openAirQty('mistral'); const maxQty=qtyTarget&&qtyTarget.maxQty; closeQty();
    return {fleetUsed:airUsedFleet('mistral'), servLimit:getShip('mistral').serviceLimit, capHere, maxQty}; });
  check('3a 增援母舰的载机位与主舰队共享服役上限（10-8=2，位有4）', t3.fleetUsed===8 && t3.servLimit===10 && t3.capHere===4 && t3.maxQty===2, JSON.stringify(t3));

  const t4=await ev(()=>{ const af=activeFleet();
    // 换到另一艘船的另一个载机位，整队服役仍应受同一上限约束
    af.main=[{id:'sun-whale',name:'太阳鲸',pos:'后排',qty:1,mods:{M:'M2',C:'C1'},air:[{id:'tianxuan',name:'天璇',kind:'fighter',slot:'M2|fighter',qty:8}]},
             {id:'eternal-vault',name:'永恒苍穹',pos:'后排',qty:1,mods:{C:'C1'},air:[]}];
    renderAll(); pickSection='main'; pickIdx=1;
    openAirPicker('main',1,'C1|fighter'); openAirQty('tianxuan');
    const mx=qtyTarget&&qtyTarget.maxQty; closeQty();
    return {mx, slotCap:airSlotOf(getShip('eternal-vault'),{C:'C1'},1,'C1|fighter').cap, fleetUsed:airUsedFleet('tianxuan')}; });
  check('3b 另一艘母舰的载机位也共享同一服役上限（本次最多2）', t4.mx===2, JSON.stringify(t4));

  say('\n===== 4. 选机后卡片立即显示 已用/上限 并刷新 =====');
  const t5=await ev(async()=>{ const af=activeFleet();
    af.main=[{id:'sun-whale',name:'太阳鲸',pos:'后排',qty:1,mods:{M:'M2'},air:[]}]; af.reinforce=[]; renderAll();
    pickMode='air'; pickSection='main'; pickIdx=0; openAirPicker('main',0,'M2|fighter');
    const badgeOf=(h,id,name)=>{
        const cards=h.split('class="pcard"').slice(1);
        // 优先按 onclick 定位；载机位满后卡片被禁用（无 onclick），退化为按舰名定位
        const c=cards.find(x=>x.indexOf('openAirQty(&quot;'+id+'&quot;)')>=0)||cards.find(x=>x.indexOf('>'+name+'<')>=0);
        return c?((c.match(/class="pop">([^<]*)</)||[])[1]||'(no-badge)'):'(card-not-found)';
    };
    const badge0=badgeOf(document.getElementById('pkGrid').innerHTML,'mistral','米斯特拉-战斗攻击机');
    openAirQty('mistral'); qtyPick=8; airSubmit();
    await new Promise(r=>setTimeout(r,60));
    const html=document.getElementById('pkGrid').innerHTML;
    const badge1=badgeOf(html,'mistral','米斯特拉-战斗攻击机');
    return {badge0, badge1, hasShipBadge:html.indexOf('本舰 ×')>=0, title:document.getElementById('pkTitle').textContent}; });
  check('4a 卡片角标显示「整队已用/上限」且选完立即更新(0/10→8/10)', t5.badge0==='0/10' && t5.badge1==='8/10', JSON.stringify(t5));
  check('4b 卡片标注本舰已在位数量', t5.hasShipBadge, JSON.stringify(t5));
  check('4c 标题显示该载机位余量', t5.title.indexOf('本位居')>=0, t5.title);

  say('\n===== 5. 增援 与 主舰队 服役数信息同步 =====');
  const t6=await ev(()=>{ const af=activeFleet(); activeFleet().stitch=false;
    af.main=[{id:'sun-whale',name:'太阳鲸',pos:'后排',qty:4,mods:{},air:[]}];
    af.reinforce=[{id:'sun-whale',name:'太阳鲸',pos:'增援',qty:1,mods:{},air:[]}]; renderAll();
    const mt=document.getElementById('mainList').innerText.replace(/\s+/g,' ');
    const rt=document.getElementById('reinforceList').innerText.replace(/\s+/g,' ');
    return {mt, rt, mainHas:mt.indexOf('服役 5/5')>=0, reinHas:rt.indexOf('服役 5/5')>=0}; });
  check('5 两行都显示「服役 5/5」（合并口径）', t6.mainHas && t6.reinHas, JSON.stringify(t6));

  say('\n===== 6. 载机位满 / 减船 / 换模块 的约束 =====');
  const t7=await ev(()=>{ const af=activeFleet();
    af.main=[{id:'sun-whale',name:'太阳鲸',pos:'后排',qty:1,mods:{M:'M2'},air:[{id:'tianxuan',name:'天璇',kind:'fighter',slot:'M2|fighter',qty:8}]}];
    af.reinforce=[]; renderAll(); pickSection='main'; pickIdx=0;
    let msg=''; const ot=window.toast; window.toast=m=>{msg=m;};
    openAirQty('mistral'); const opened=document.getElementById('qtyModal').classList.contains('show');
    window.toast=ot;
    return {opened, msg, html:document.getElementById('mainList').innerHTML.indexOf('disabled')>=0}; });
  check('6a 该载机位已满 → 不给加并提示', t7.opened===false && t7.msg.length>0, JSON.stringify(t7));

  const t8=await ev(()=>{ const af=activeFleet();
    af.main=[{id:'sun-whale',name:'太阳鲸',pos:'后排',qty:2,mods:{M:'M2'},air:[{id:'tianxuan',name:'天璇',kind:'fighter',slot:'M2|fighter',qty:16}]}];
    renderAll(); const before=activeFleet().main[0].qty; chQty('main',0,-1);
    return {before, after:activeFleet().main[0].qty}; });
  check('6b 载机满载(16)时减船被拦', t8.after===t8.before, JSON.stringify(t8));

  const t9=await ev(()=>{ const af=activeFleet();
    af.main=[{id:'sun-whale',name:'太阳鲸',pos:'后排',qty:1,mods:{M:'M2',C:'C1'},
              air:[{id:'tianxuan',name:'天璇',kind:'fighter',slot:'C1|fighter',qty:5}]}]; renderAll();
    modSection='main'; modIdx=0; openMods('main',0);
    let asked=0, txt=''; const ol=window.confirm; window.confirm=m=>{asked++;txt=m;return false;};
    // 取消 C1 → 其 5 架天璇失去载机位
    pickMod('C','C1');     // 取消勾选
    saveMods();
    const modsAfter=JSON.stringify(activeFleet().main[0].mods);
    window.confirm=ol;
    return {asked, txtHead:txt.slice(0,60), modsAfter, airStill:activeFleet().main[0].air.length}; });
  check('6c 模块改动会让载机失去载机位 → 保存前警告且可取消', t9.asked===1 && t9.modsAfter.indexOf('C1')>=0 && t9.airStill===1, JSON.stringify(t9));

  say('\n===== 7. 缝合：忽略服役上限（舰船 + 载机） =====');
  const t10=await ev(()=>{ const af=activeFleet(); af.stitch=false;
    af.main=[{id:'sun-whale',name:'太阳鲸',pos:'后排',qty:5,mods:{},air:[]}]; af.reinforce=[]; renderAll();
    chQty('main',0,1); const blocked=activeFleet().main[0].qty;
    activeFleet().stitch=true; chQty('main',0,1); const ok=activeFleet().main[0].qty;
    activeFleet().stitch=false; return {blocked, ok}; });
  check('7a 服役上限拦 / 缝合放行', t10.blocked===5 && t10.ok===6, JSON.stringify(t10));

  const t11=await ev(()=>{ const af=activeFleet();
    af.main=[{id:'sun-whale',name:'太阳鲸',pos:'后排',qty:1,mods:{M:'M2'},air:[{id:'tianxuan',name:'天璇',kind:'fighter',slot:'M2|fighter',qty:8}]},
             {id:'eternal-vault',name:'永恒苍穹',pos:'后排',qty:1,mods:{C:'C1'},air:[]}];
    af.reinforce=[]; af.stitch=false; renderAll(); pickSection='main'; pickIdx=1;
    openAirPicker('main',1,'C1|fighter'); openAirQty('tianxuan');
    const m0=qtyTarget&&qtyTarget.maxQty; closeQty();
    activeFleet().stitch=true;
    openAirPicker('main',1,'C1|fighter'); openAirQty('tianxuan');
    const m1=qtyTarget&&qtyTarget.maxQty; closeQty();
    activeFleet().stitch=false;
    return {m0, m1}; });
  check('7b 载机服役上限受整队约束(2)；缝合后放开到该位容量(4)', t11.m0===2 && t11.m1===4, JSON.stringify(t11));

  say('\n===== 8. 大矛 B2 护航艇位 / 多艘母舰容量 =====');
  const t12=await ev(()=>{ const af=activeFleet();
    af.main=[{id:'uranus-spear',name:'大矛',pos:'中排',qty:4,mods:{B:'B2'},air:[]},
             {id:'sun-whale',name:'太阳鲸',pos:'后排',qty:2,mods:{M:'M2',C:'C1'},air:[]}];
    af.reinforce=[]; renderAll();
    return airSlots(getShip('uranus-spear'),{B:'B2'},4).concat(
           airSlots(getShip('sun-whale'),{M:'M2',C:'C1'},2)).map(s=>s.key+'×(cap'+s.cap+'/'+s.allow+')'); });
  check('8 容量随舰船数量放大（大矛B2×4=12护航艇位；太阳鲸M2×2=16、C1×2=10）',
        JSON.stringify(t12)===JSON.stringify(['B2|corvette×(cap12/S)','M2|fighter×(cap16/ALL)','C1|fighter×(cap10/ALL)']), JSON.stringify(t12));

  say('\n===== 9. 站位 / 旗舰 / 配队库 / AI 导入 回归 =====');
  const t13=await ev(()=>{ store.plans=[]; saveStore(); newPlan();
    const af=activeFleet();
    af.main=[{id:'plutus-shield',name:'大盾',qty:5,mods:{B:'B1'},air:[]},
             {id:'sun-whale',name:'太阳鲸',qty:1,mods:{M:'M2'},air:[{id:'tianxuan',name:'天璇',kind:'fighter',qty:8}]}];
    af.reinforce=[{id:'tianshu',name:'天枢',qty:2,mods:{M:'M1'},air:[]}];
    fillPos(cur);
    const txt=FleetIO.fleetToText(cur); const parsed=FleetIO.parseFleetText(txt);
    return {txt, hasSep:txt.indexOf('│')>=0, looks:FleetIO.looksLikeFleet(txt),
            main:parsed.main.map(x=>x.name+'/'+x.pos), air:parsed.air.map(a=>a.name+'×'+a.qty),
            slots:activeFleet().main[1].air.map(a=>a.slot)}; });
  say(t13.txt);
  check('9a 站位分组输出 + 可被读回', t13.hasSep && t13.looks && t13.main.length===2, JSON.stringify(t13.main));
  check('9b 自动补 slot（老数据/无 slot 载机）', JSON.stringify(t13.slots)===JSON.stringify(['M2|fighter']), JSON.stringify(t13.slots));

  const t14=await ev(()=>{ const e=FleetLib.entryFromPlan(cur,{scenario:'回归'});
    FleetLib.upsert(e); return {pop:e.pop, air:e.main[1]&&e.main[1].air.length?e.main[1].air[0].slot:'(none)'}; });
  check('9c 配队库条目保留载机位', t14.air==='M2|fighter', JSON.stringify(t14));

  const t15=await ev(()=>{ const f={name:'导入回归',desc:'',reason:'',
      main:[{id:'sun-whale',name:'太阳鲸',pos:'后排',qty:1,mods:{M:'M2',C:'C1'},
             air:[{id:'tianxuan',name:'天璇A-轻型攻击机',kind:'fighter',qty:6}]}],
      reinforcement:[],air:[]};
    FleetIO.toFleet(f); return true; });
  await p.goto('http://127.0.0.1:3888/fleet.html?import=1',{waitUntil:'load'});
  await new Promise(r=>setTimeout(r,2500));
  const t16=await ev(()=>({main:activeFleet().main.map(s=>s.pos+'/'+s.qty+'/'+Object.values(s.mods).join('+')),
      air:activeFleet().main[0].air.map(a=>a.name+'×'+a.qty+'@'+a.slot),
      rows:document.getElementById('mainList').innerHTML.split('class="airline"').length-1,
      pop:document.getElementById('stPop').textContent, airCnt:document.getElementById('stAir').textContent}));
  check('9d AI导入：站位/模块/载机保留，载机自动落到 M2 位', t16.main[0].indexOf('后排')===0 && t16.air[0].indexOf('M2|fighter')>=0, JSON.stringify(t16));
  check('9e 导入后渲染出 2 个载机位行', t16.rows===2, JSON.stringify({rows:t16.rows}));

  say('\n===== 10. 前期修复项回归 =====');
  const r1=await ev(()=>{ const af=activeFleet();
    af.main=[{id:'sun-whale',name:'太阳鲸',pos:'后排',qty:1,mods:{M:'M2'},air:[{id:'mistral',name:'米斯特拉',kind:'fighter',slot:'M2|fighter',qty:8}]}];
    af.reinforce=[]; af.stitch=false; renderAll();
    pickSection='main'; pickIdx=0; airKind='fighter'; pickSlot='M2|fighter';
    let msg=''; const ot=window.toast; window.toast=m=>{msg=m;};
    qtyTarget={id:'tianxuan',name:'天璇',kind:'fighter',slot:'M2|fighter',cur:0,maxQty:1}; qtyPick=1;
    airSubmit(); window.toast=ot;
    const s=activeFleet().main[0];
    return {msg, used:airUsedIn(s,'M2|fighter'), cap:airSlotOf(getShip('sun-whale'),{M:'M2'},1,'M2|fighter').cap}; });
  check('10a airSubmit 二次校验：满载时即使强行提交也不超位', r1.used<=r1.cap, JSON.stringify(r1));

  const r2=await ev(()=>{ const af=activeFleet();
    af.main=[{id:'constantine',name:'大帝',pos:'中排',qty:1,mods:{},air:[]}];
    af.reinforce=[{id:'tianquan',name:'天权',pos:'增援',qty:1,mods:{},air:[]}]; renderAll();
    setFlagship('main|constantine'); renderAll();
    const a=document.getElementById('mainList').innerHTML.indexOf('⭐')>=0;
    const b=document.getElementById('reinforceList').innerHTML.indexOf('⭐')>=0;
    setFlagship('reinforce|tianquan'); renderAll();
    const c=document.getElementById('mainList').innerHTML.indexOf('⭐')>=0;
    const d=document.getElementById('reinforceList').innerHTML.indexOf('⭐')>=0;
    return {mainStar:a, reinNoStar:!b, mainNoStar:!c, reinStar:d}; });
  check('10b 旗舰⭐ 只出现在所选段落', r2.mainStar && r2.reinNoStar && r2.mainNoStar && r2.reinStar, JSON.stringify(r2));

  const r3=await ev(()=>{ const af=activeFleet();
    af.main=[{id:'buqu',name:'不屈级',pos:'中排',qty:1,mods:{},air:[]},
             {id:'constantine',name:'大帝',pos:'中排',qty:1,mods:{},air:[]}];
    af.reinforce=[]; renderAll();
    const rows=document.getElementById('mainList').innerHTML.split('class="shiprow"').slice(1);
    return {buqu:rows[0].indexOf('openMods')>=0, dadi:rows[1].indexOf('openMods')>=0,
            buquSlots:slotsOf(getShip('buqu')).length}; });
  check('10c 不屈级(无可选模块)→无模块按钮；大帝→有', r3.buqu===false && r3.dadi===true, JSON.stringify(r3));

  const r4=await ev(()=>{ store.plans=[]; saveStore(); newPlan(); const af=activeFleet();
    af.main=[{id:'sun-whale',name:'太阳鲸',pos:'后排',qty:1,mods:{M:'M2'},air:[]}];
    af.reinforce=[{id:'tianquan',name:'天权',pos:'增援',qty:1,mods:{},air:[{id:'tianji',name:'天玑',kind:'corvette',qty:3}]}];
    document.getElementById('planName').value='口径'; cur.name='口径'; savePlan(); switchTab('mine');
    const m=document.getElementById('mineList').innerHTML.match(/舰载机<b>(\d+)<\/b>/);
    return {shown:m&&m[1]}; });
  check('10d 「我的配队」舰载机=真实载机数3（含增援，不含机库）', r4.shown==='3', JSON.stringify(r4));

  const r5=await ev(()=>{ store.plans.unshift({id:'plan_legacy',name:'老方案',active:0,createdAt:1,updatedAt:1,
      fleets:[{name:'舰队1',flagship:'main|constantine',addPoint:false,stitch:false,reinforce:[],
               main:[{id:'constantine',name:'大帝',qty:1},{id:'sun-whale',name:'太阳鲸',qty:1,mods:{M:'M2'},
                      air:[{id:'tianxuan',name:'天璇',kind:'fighter',qty:6}]}]}]});
    saveStore(); loadPlan('plan_legacy'); switchTab('editor');
    const f=activeFleet();
    return {pos:f.main.map(s=>s.pos), slots:(f.main[1].air||[]).map(a=>a.slot),
            star:document.getElementById('mainList').innerHTML.indexOf('⭐')>=0}; });
  check('10e 老方案：站位回填 + 载机补 slot + 旗舰星识别',
        r5.pos.every(Boolean) && r5.slots[0]==='M2|fighter' && r5.star, JSON.stringify(r5));

  const r6=await ev(async()=>{ switchTab('mine'); await new Promise(x=>setTimeout(x,500));
    const box=document.getElementById('libList').innerHTML;
    const before=box.indexOf('copyLibToLocal')>=0||box.indexOf('delLib')>=0;
    return {rendered:box.length>0, hasButtons:before, cnt:document.getElementById('libCnt').textContent}; });
  say('10f 配队库区块: '+JSON.stringify(r6));

  const r7=await ev(()=>{ store.plans=[]; saveStore();
    const mk=(id,name,up)=>JSON.stringify({id,name,active:0,createdAt:1,updatedAt:up,
      fleets:[{name:'舰队1',flagship:'',addPoint:false,stitch:false,reinforce:[],main:[{id:'constantine',name:'大帝',pos:'中排',qty:1,mods:{},air:[]}]}]});
    const ol=readFile; let out=[];
    const feed=(j)=>{ readFile=(inp,cb)=>cb(j); const fake={files:[{}],value:''};
      try{ doImport(fake); }catch(e){ out.push('ERR '+e.message); } };
    feed(JSON.stringify({type:'plans',plans:[JSON.parse(mk('p1','旧版',100))]}));
    out.push('after1='+store.plans.map(x=>x.name+'@'+x.updatedAt).join(','));
    feed(JSON.stringify({type:'plans',plans:[JSON.parse(mk('p1','新版',200)),JSON.parse(mk('p2','新增',150))]}));
    out.push('after2='+store.plans.map(x=>x.name+'@'+x.updatedAt).sort().join(','));
    readFile=ol; return out; });
  check('10g 导入：同 id 按 updatedAt 覆盖，新 id 追加',
        r7.indexOf('after1=旧版@100')>=0 && r7.indexOf('after2=新增@150,新版@200')>=0, JSON.stringify(r7));

  const r8=await ev(()=>{ newPlan(); addFleet(); addFleet(); delFleet(1); addFleet();
    return cur.fleets.map(f=>f.name); });
  check('10h 舰队名不重复', new Set(r8).size===r8.length, JSON.stringify(r8));

  const r9=await ev(()=>{ newPlan(); const af=activeFleet();
    af.main=[{id:'sun-whale',name:'太阳鲸',pos:'后排',qty:1,mods:{M:'M2'},air:[{id:'mistral',name:'米斯特拉',kind:'fighter',slot:'M2|fighter',qty:8}]}];
    renderAll(); let asked=0; const ol=window.confirm; window.confirm=()=>{asked++;return false;};
    chQty('main',0,-1); const kept=activeFleet().main.length;
    activeFleet().main[0].air=[]; renderAll(); asked=0; window.confirm=()=>{asked++;return true;};
    chQty('main',0,-1); const removed=activeFleet().main.length; const askedNoAir=asked;
    window.confirm=ol; return {kept, removed, askedNoAir}; });
  check('10i 有载机条目删船要确认；无载机直接删', r9.kept===1 && r9.removed===0 && r9.askedNoAir===0, JSON.stringify(r9));

  const r10=await ev(()=>{ store.plans=[]; saveStore(); newPlan(); switchTab('mine');
    store.plans.push({id:'px',name:'别人的方案',active:0,createdAt:1,updatedAt:1,
      fleets:[{name:'舰队1',flagship:'',addPoint:false,stitch:false,reinforce:[],main:[{id:'constantine',name:'大帝',pos:'中排',qty:1,mods:{},air:[]}]}]});
    saveStore(); renderMine();
    let sent=null; const ol=FleetIO.toChat; FleetIO.toChat=t=>{sent=t;};
    try{ sendPlanToAI('px'); }catch(e){}
    FleetIO.toChat=ol; switchTab('editor');
    return {plans:store.plans.map(x=>x.name), hasPos:(sent||'').indexOf('中排')>=0, hasText:(sent||'').length>0}; });
  check('10j 发给AI 不新增空方案，且文本含站位', r10.plans.length===1 && r10.hasPos, JSON.stringify(r10));

  const r11=await ev(()=>{ const af=activeFleet();
    af.main=[{id:'sun-whale',name:'太阳鲸',pos:'后排',qty:1,mods:{M:'M2',C:'C1'},air:[{id:'mistral',name:'米斯特拉',kind:'fighter',slot:'M2|fighter',qty:8}]}];
    af.reinforce=[]; renderAll();
    return {air:document.getElementById('stAir').textContent, rein:document.getElementById('stRein').textContent}; });
  check('10k 统计栏「舰载机」显示 已用/可载（8/13）', r11.air==='8/13', JSON.stringify(r11));

  say('\n===== 运行期错误 =====');
  if(!errs.length) say('（无）'); else [...new Set(errs)].forEach(e=>say('  '+e));
  say('\n===== FAIL 汇总 =====');
  const f=results.filter(r=>!r.ok); if(!f.length) say('（全部 PASS）'); else f.forEach(x=>say('  ✗ '+x.n+' → '+x.d));
  require('fs').writeFileSync('_fleet_test6.log',LOG.join('\n'),'utf8');
  await b.close();
})().catch(e=>{ console.error('HARNESS ERROR',e); process.exit(1); });
