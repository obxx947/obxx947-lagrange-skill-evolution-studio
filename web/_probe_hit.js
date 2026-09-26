const puppeteer=require('puppeteer-core'); const fs=require('fs');
const EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const AP=JSON.parse(fs.readFileSync('C:/Users/Administrator/Desktop/资料3/拉格朗日_整套加点_总体加点方案4.json','utf8'));
const PA=JSON.parse(fs.readFileSync('C:/Users/Administrator/Desktop/资料3/舰队A.json','utf8'));
const PB=JSON.parse(fs.readFileSync('C:/Users/Administrator/Desktop/资料3/舰队B.json','utf8'));
(async()=>{
 const b=await puppeteer.launch({executablePath:EDGE,headless:'new',timeout:900000,args:['--no-sandbox','--disable-gpu']});
 const p=await b.newPage(); p.on('pageerror',e=>console.log('ERR',e.message));
 await p.goto('http://127.0.0.1:3888/simulator.html',{waitUntil:'load',timeout:90000}); await sleep(4500);
 await p.evaluate(x=>localStorage.setItem('lagrange_addpoint',JSON.stringify(x)),AP.addpoints);
 await p.evaluate(async ids=>{for(const c of ids)await loadBpTree(c);},Object.keys(AP.addpoints));
 const out=await p.evaluate(async(pa,pb)=>{
  function BUILD(pl,sec){return (pl[sec]||[]).map(s=>{const t=SHIP_DATABASE[s.id];if(!t)return null;
   const e=JSON.parse(JSON.stringify(t)); e.count=s.qty||1; e.selectedModules=Object.assign({},s.mods||{});
   if(s.pos)e.position=s.pos; recalcAircraftSlots(e); e.aircraft=[];
   (s.air||[]).forEach(a=>{const at=SHIP_DATABASE[a.id];if(!at)return;const slots=e.simSlots||[];
    const sl=slots.find(x=>x.key===a.slot)||slots.find(x=>x.allow==='ALL'||x.kind===a.kind); if(!sl)return;
    const i=JSON.parse(JSON.stringify(at)); i.count=a.qty||1; i.slot=sl.key; e.aircraft.push(i);});
   return e;}).filter(Boolean);}
  const pf=pl=>pl.plans[0].fleets[0];
  FLEET_TYPES.forEach(k=>{fleetData[k].main=[];fleetData[k].reinforcement=[];fleetData[k].apSet=null;});
  fleetData['ally-escort'].main=BUILD(pf(pa),'main').concat(BUILD(pf(pa),'reinforce'));
  fleetData['enemy-escort'].main=BUILD(pf(pb),'main').concat(BUILD(pf(pb),'reinforce'));
  refreshFleetViews(); if(!prepareBattle())return{err:'fail'};
  const bs=battleState;
  /* 统计：实际命中率 + 护甲折损 */
  let shots=0, hits=0, nominal=0, dealt=0;
  const W={};
  const real=window.executeShot;
  window.executeShot=function(atk,tgt,w,ws,b2,cr){
    const k=String(w.name).slice(0,22);
    const o=W[k]||(W[k]={shots:0,hits:0,nom:0,dealt:0});
    o.shots++; shots++;
    const sd=w.singleDmg||0; const st=(ws&&ws.strengthen)||{};
    const nb=1+(((st.dmgBonus||0)+(atk.dmgBonus||0))/100);
    o.nom+=sd*nb; nominal+=sd*nb;
    const hp0=tgt.hp; const r=real.apply(null,arguments);
    const d=Math.max(0,hp0-Math.max(0,tgt.hp));
    if(d>0&&hp0>0){o.hits++;hits++;}
    o.dealt+=d; dealt+=d;
    return r;
  };
  let t=0; while(!bs.ended&&t<30000){processBattleTick(0.1);t+=0.1;}
  window.executeShot=real;
  const bad=Object.keys(W).filter(k=>W[k].shots>200).map(k=>({n:k,...W[k],
     hit:+(W[k].hits/W[k].shots*100).toFixed(1), loss:+(W[k].dealt/W[k].nom*100).toFixed(1)}));
  bad.sort((a,c)=>c.nom-a.nom);
  return {dur:+bs.time.toFixed(0), total:{shots,hits,hitRate:+(hits/shots*100).toFixed(1),
    nominal:Math.round(nominal),dealt:Math.round(dealt),ratio:+(dealt/nominal*100).toFixed(1)}, top:bad.slice(0,12)};
 },PA,PB);
 console.log(JSON.stringify(out,null,1));
 await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
