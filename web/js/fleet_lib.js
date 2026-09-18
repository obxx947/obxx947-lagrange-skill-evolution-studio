/* ========================================
   FleetLib —— 结构化「配队库」（供 AI 检索，替代知识库文字配队）
   - 存 localStorage（可编辑）+ 只读合并 data/fleet_library.json
   - 纯代码检索：舰名(含黑话) / 场景 / 标签 / 人口
   - 导出/导入 JSON（把你浏览器里的配队交出来）
   ======================================== */
(function(){
    const LS='lagrange_fleet_library';
    const FILE='data/fleet_library.json';

    function blank(){ return {version:1, updatedAt:0, fleets:[]}; }
    function loadLocal(){ try{ const d=JSON.parse(localStorage.getItem(LS)||'null'); return (d&&Array.isArray(d.fleets))?d:blank(); }catch(e){ return blank(); } }
    function saveLocal(d){ try{ d.updatedAt=Date.now(); localStorage.setItem(LS, JSON.stringify(d)); }catch(e){} }
    async function loadFile(){
        try{ const r=await fetch((window.KB_BASE||'')+FILE,{cache:'no-cache'}); if(r.ok){ const j=await r.json(); return (j&&Array.isArray(j.fleets))?j:null; } }catch(e){}
        return null;
    }
    // 合并：文件条目(只读) + 本地条目（按 id 去重，本地优先）
    // 注意：_from 必须放在 Object.assign 的【最后】一个源里，否则会被条目自带的 _from 覆盖
    async function all(){
        const local=loadLocal();
        const file=await loadFile();
        const map={};
        ((file&&file.fleets)||[]).forEach(f=>{ if(!f||!f.id) return; map[f.id]=Object.assign({_from:'file'},f,{_from:'file'}); });
        (local.fleets||[]).forEach(f=>{ if(!f||!f.id) return; map[f.id]=Object.assign({}, map[f.id]||{}, f, {_from:'local'}); });
        return Object.values(map);
    }

    // 方案(plan) → 配队库条目
    function entryFromPlan(plan, extra){
        const f=(plan.fleets&&plan.fleets[plan.active||0])||{main:[],reinforce:[]};
        const main=(f.main||[]).map(s=>({id:s.id,name:s.name,pos:s.pos||'',qty:s.qty||1,mods:s.mods||{},air:s.air||[]}));
        const rein=(f.reinforce||[]).map(s=>({id:s.id,name:s.name,pos:'增援',qty:s.qty||1,mods:s.mods||{},air:s.air||[]}));
        const pop=main.reduce((a,s)=>{ const sh=shipOf(s.id); return a+(((sh&&sh.commandValue)||0)*s.qty); },0);
        const rq=rein.reduce((a,s)=>a+s.qty,0);
        return {
            id:(plan.id||('fl_'+Date.now())), name:plan.name||'未命名配队',
            scenario:(extra&&extra.scenario)||'', tags:(extra&&extra.tags)||[],
            pop, reinforce:rq, flagship:f.flagship||'',
            source:(extra&&extra.source)||plan.source||'',
            note:(extra&&extra.note)||plan.desc||'',
            score:(extra&&extra.score)||null,
            main, reinforceList:rein, createdAt:Date.now()
        };
    }
    function shipOf(id){ try{ return (window.SHIP_DB&&SHIP_DB.get)?SHIP_DB.get(id):null; }catch(e){ return null; } }

    // 纯代码检索
    function scoreEntry(e, q, opts){
        opts=opts||{};
        const FS=window.FleetIO;
        let sc=0;
        const kw=String(q||'').trim();
        // 1) 舰名命中（含黑话）
        if(kw){
            const toks=kw.split(/[\s,，、+]+/).filter(Boolean);
            const ships=(e.main||[]).concat(e.reinforceList||[]);
            toks.forEach(t=>{
                let id=null; if(FS&&FS.matchShip){ const m=FS.matchShip(t); id=m&&m.id; }
                const hit=ships.find(s=>s.id===id)||ships.find(s=>(s.name||'').indexOf(t)>=0);
                if(hit) sc+=10;
                if((e.name||'').indexOf(t)>=0) sc+=6;
                if((e.tags||[]).some(x=>String(x).indexOf(t)>=0)) sc+=5;
                if((e.note||'').indexOf(t)>=0) sc+=3;
                if((e.scenario||'').indexOf(t)>=0) sc+=5;
            });
        } else sc+=1;
        // 2) 场景/人口过滤
        if(opts.scenario){ if((e.scenario||'')===opts.scenario) sc+=8; else if((e.scenario||'').indexOf(opts.scenario)<0) return -1; }
        if(opts.pop){ const tol=opts.tol||60; if(Math.abs((e.pop||0)-opts.pop)>tol) return -1; else sc+=4; }
        return sc;
    }
    function search(q, opts){
        const local=loadLocal();
        const list=(local.fleets||[]);
        return list.map(e=>({e, s:scoreEntry(e,q,opts)})).filter(x=>x.s>0)
            .sort((a,b)=>b.s-a.s).slice(0,opts&&opts.topK?opts.topK:3).map(x=>Object.assign({},x.e,{_score:x.s}));
    }
    async function searchAsync(q, opts){
        const entries=await all();
        return entries.map(e=>({e,s:scoreEntry(e,q,opts)})).filter(x=>x.s>0)
            .sort((a,b)=>b.s-a.s).slice(0,opts&&opts.topK?opts.topK:3).map(x=>Object.assign({},x.e,{_score:x.s}));
    }

    // 工具/注入用的紧凑文本
    function entryToText(e){
        const line=a=>(a||[]).map(s=>{
            const mods=Object.keys(s.mods||{}).filter(k=>s.mods[k]).map(k=>s.mods[k]).join('+');
            const air=(s.air||[]).map(x=>(x.name||'')+'×'+x.qty).join(' ');
            return (s.pos?s.pos+' ':'')+(s.name||s.id)+(mods?' '+mods:'')+' ×'+(s.qty||1)+(air?' 带 '+air:'');
        }).join(' ｜ ');
        const L=['【'+(e.name||'配队')+'】'+(e.scenario?' 场景:'+e.scenario:'')+' 人口'+(e.pop||0)+'+'+(e.reinforce||0)+(e.tags&&e.tags.length?'  标签:'+e.tags.join('/'):'')];
        if((e.main||[]).length) L.push('主舰队: '+line(e.main));
        if((e.reinforceList||[]).length) L.push('增援: '+line(e.reinforceList));
        if(e.note) L.push('说明: '+String(e.note).substring(0,180));
        return L.join('\n');
    }
    // 索引（每轮注入）：只列概要
    function indexText(list, max){
        const ls=(list||[]).slice(0,max||30);
        if(!ls.length) return '';
        return ls.map(e=>{
            const core=(e.main||[]).slice(0,5).map(s=>(s.name||s.id)+'×'+(s.qty||1)).join('、');
            return '- '+(e.name||'配队')+(e.scenario?'｜'+e.scenario:'')+'｜人口'+(e.pop||0)+'+'+(e.reinforce||0)+(core?'｜'+core:'');
        }).join('\n');
    }

    function exportAll(){
        const d=loadLocal(); d.version=1; d.updatedAt=Date.now();
        return JSON.stringify(d,null,2);
    }
    function importJSON(str, mode){
        let j=null; try{ j=JSON.parse(str); }catch(e){ return {ok:false,error:'JSON 解析失败'}; }
        const inc=(j&&Array.isArray(j.fleets))?j.fleets:(Array.isArray(j)?j:null);
        if(!inc) return {ok:false,error:'格式不对（应为 {fleets:[...]} 或数组）'};
        const d=(mode==='replace')?blank():loadLocal();
        const map={}; (d.fleets||[]).forEach(f=>map[f.id]=f);
        let added=0;
        inc.forEach(f=>{ if(!f||!f.id) return; if(!map[f.id]) added++; map[f.id]=Object.assign(map[f.id]||{},f); });
        d.fleets=Object.values(map); saveLocal(d);
        return {ok:true, added, total:d.fleets.length};
    }
    function upsert(entry){
        const d=loadLocal(); const i=d.fleets.findIndex(x=>x.id===entry.id);
        if(i>=0) d.fleets[i]=Object.assign(d.fleets[i],entry); else d.fleets.unshift(entry);
        saveLocal(d); return d;
    }
    function remove(id){ const d=loadLocal(); d.fleets=d.fleets.filter(x=>x.id!==id); saveLocal(d); return d; }

    window.FleetLib={ loadLocal, saveLocal, all, entryFromPlan, search, searchAsync, entryToText, indexText, exportAll, importJSON, upsert, remove };
})();
