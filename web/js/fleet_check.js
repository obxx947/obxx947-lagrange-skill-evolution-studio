/* ========================================
   FleetCheck —— 舰队校验器（唯一权威口径）
   「战舰配队」页 = 检查器：舰船数据一律以 data/ship_database.json 重算为准，
   任何来源（AI / 导入 / 手填）给的数字与它不一致时，以本模块算出的为准。

   提供：
     airSlots(ship,mods,qty)  载机位 = 【模块来源】×【机型】，各自独立容量/机型限制
     slotsOf(ship)            超主力可选模块槽位与变体
     assignSlots(entry,ship)  给没有 slot 的载机补载机位（能补则补，补不上留空）
     stats(fleet)             权威统计：人口/指挥值、增援数、载机数、载机位总量、模块数
     check(fleet,opts)        全面校验 → {ok, errors, warnings, fixed, stats}

   校验内容：
     1) 舰船是否存在于舰船库
     2) 载机是否合法：船/所选模块必须真的提供对应该机型的载机位（否则报错，不允许强塞）
     3) 服役上限：同一型舰「主舰队+增援」合计 ≤ 服役上限
     4) 增援 ≤ 9 艘
     5) 启用「允许AI检索舰船库」时：用到的舰船与模块必须是用户拥有的
   ======================================== */
(function(){

    function DB(){ return (window.SHIP_DB && typeof SHIP_DB.get==='function') ? SHIP_DB : null; }
    function getShip(id){ const db=DB(); return db ? db.get(id) : null; }
    function normSlots(mods){ return (mods&&typeof mods==='object') ? mods : {}; }

    /* ---------- 模块槽位（超主力）：{slot: {name, variants:[v,...]}} ---------- */
    function slotsOf(ship){
        const out=[];
        if(!ship||!ship.modules) return out;
        Object.keys(ship.modules).forEach(k=>{
            const g=ship.modules[k];
            if(g && g.type==='moduleGroup' && g.variants){
                out.push({slot:k, name:g.name||k,
                    variants:Object.keys(g.variants).map(v=>({v, name:(g.variants[v]&&g.variants[v].name)||''}))});
            }
        });
        return out;
    }
    // 所有槽位变体码集合（含非 moduleGroup 的固定槽，用于判断"是否存在这个模块码"）
    function allVariantCodes(ship){
        const set={};
        slotsOf(ship).forEach(g=>g.variants.forEach(v=>{ set[v.v]=true; }));
        return set;
    }

    /* ---------- 载机位：模块来源 × 机型，各自独立 ---------- */
    function airSlots(ship, mods, qty){
        const out=[];
        const push=(srcKey, rec)=>{
            if(!rec) return;
            const kind=rec.kind; if(kind!=='fighter'&&kind!=='corvette') return;
            const key=srcKey+'|'+kind;
            let s=out.find(x=>x.key===key);
            if(!s){ s={key, mod:srcKey, label:(srcKey==='base'?'基础':srcKey), kind, allow:'S', cap:0}; out.push(s); }
            s.cap += (rec.cap||0);
            if(rec.size==='ALL') s.allow='ALL';
        };
        const as=ship&&ship.airSlots;
        if(as){
            (as.base||[]).forEach(r=>push('base', r));
            const bm=as.byModule||{};
            Object.keys(bm).forEach(mod=>{
                const sl=mod[0];
                // 只算「已被选中的模块」带来的载机位
                if(((mods||{})[sl]||'')===mod) (bm[mod]||[]).forEach(r=>push(mod, r));
            });
        }
        // 兼容旧船级 aircraftSlots（仅当完全没有 airSlots 数据时）
        if(!as && ship&&ship.aircraftSlots){
            if(ship.aircraftSlots.fighter) push('base',{kind:'fighter',cap:ship.aircraftSlots.fighter,size:'S'});
            if(ship.aircraftSlots.corvette) push('base',{kind:'corvette',cap:ship.aircraftSlots.corvette});
        }
        const q=Math.max(1, qty||1);
        out.forEach(s=>{ s.cap = s.cap*q; });
        return out;
    }
    function slotOf(ship,mods,qty,key){ return airSlots(ship,mods,qty).find(s=>s.key===key)||null; }
    function usedIn(entry,key){ return (entry.air||[]).filter(a=>a.slot===key).reduce((n,a)=>n+(a.qty||0),0); }
    function hasAir(ship,mods,qty){ return airSlots(ship,mods,qty).length>0; }

    /* 给没有 slot（或 slot 已失效）的载机补位：能补则补，补不上留 '' */
    function assignSlots(entry, ship){
        if(!entry||!Array.isArray(entry.air)||!entry.air.length) return entry;
        const slots=airSlots(ship, normSlots(entry.mods), entry.qty);
        entry.air.forEach(a=>{
            if(a.slot && slots.some(x=>x.key===a.slot)) return;
            const s=slots.find(x=>x.kind===a.kind && usedIn(entry,x.key)<x.cap);
            a.slot = s ? s.key : '';
        });
        return entry;
    }

    /* 某模块变体带来的载机位文字（模块弹窗用） */
    function modAirInfo(ship, mod, qty){
        const bm=ship&&ship.airSlots&&ship.airSlots.byModule; if(!bm||!bm[mod]) return '';
        const q=Math.max(1,qty||1);
        return (bm[mod]||[]).map(r=>{
            const n=r.cap||0, tot=n*q;
            return '+'+n+(r.kind==='fighter'?(' 战机位'+(r.size==='ALL'?'(可大型)':'(仅中小型)')):' 护航艇位')
                + (q>1 ? ('，'+q+'艘共 '+tot) : '');
        }).join('；');
    }

    /* ---------- 权威统计 ---------- */
    function stats(fleet){
        const main=(fleet&&fleet.main)||[], rein=(fleet&&fleet.reinforcement)||[];
        let pop=0, reinShips=0, airCnt=0, airCap=0, mods=0;
        const byShip={};   // id → {qty, limit, name}
        const byAir={};    // airId → qty
        const scan=(arr, isRein)=>arr.forEach(s=>{
            const ship=getShip(s.id);
            const q=Math.max(0, parseInt(s.qty,10)||0);
            const cv=(ship&&ship.commandValue)||0;
            if(!isRein) pop += cv*q;            // 增援不计人口
            else reinShips += q;
            if(ship){
                byShip[s.id]=byShip[s.id]||{name:ship.name||s.name||s.id, qty:0, limit:ship.serviceLimit||99};
                byShip[s.id].qty += q;
                airSlots(ship, normSlots(s.mods), q).forEach(sl=>{ airCap += sl.cap; });
            }
            (s.air||[]).forEach(a=>{
                const n=(a.qty||0); airCnt+=n;
                if(a.id) byAir[a.id]=(byAir[a.id]||0)+n;
            });
            mods += Object.keys(normSlots(s.mods)).filter(k=>s.mods[k]).length;
        });
        scan(main,false); scan(rein,true);
        return {pop, reinShips, airCnt, airCap, mods, byShip, byAir,
                mainKinds:main.length, reinKinds:rein.length};
    }

    /* ---------- 校验 ---------- */
    /* opts: {stitch:false, checkUser:true} */
    function check(fleet, opts){
        opts=opts||{};
        const stitch=!!opts.stitch;
        const errors=[], warnings=[];
        const db=DB();
        if(!db) return {ok:false, errors:['舰船库尚未加载'], warnings, fixed:fleet, stats:null};
        if(!fleet) return {ok:false, errors:['空配队'], warnings, fixed:fleet, stats:null};

        const FS=window.FleetIO;
        const fixed=JSON.parse(JSON.stringify({
            name:fleet.name||'', desc:fleet.desc||'', reason:fleet.reason||'',
            main:(fleet.main||[]).map(x=>Object.assign({},x)),
            reinforcement:(fleet.reinforcement||[]).map(x=>Object.assign({},x)),
            flagship:fleet.flagship||''
        }));

        // 0) 规整：补 id / 补 pos / 规整 mods 与 air
        ['main','reinforcement'].forEach(sec=>fixed[sec].forEach((s,idx)=>{
            s.qty=Math.max(1, parseInt(s.qty,10)||1);
            s.mods=normSlots(s.mods);
            s.air=Array.isArray(s.air)?s.air:[];
            s.pos=s.pos||(sec==='reinforcement'?'增援':((getShip(s.id)||{}).position||'中排'));
            if(!s.id && FS && FS.matchShip && s.name){
                const m=FS.matchShip(s.name); if(m) s.id=m.id;
            }
            if(!s.id){ errors.push(`第${idx+1}艘（${s.name||'未命名'}）不是舰船库里的舰船，无法配入舰队`); }
            else if(!getShip(s.id)){ errors.push(`未知舰船「${s.name||s.id}」：舰船库中没有这条数据`); }
        }));

        // 1) 服役上限（整队口径）+ 舰船库校验（舰船）
        const shipQty={};
        ['main','reinforcement'].forEach(sec=>fixed[sec].forEach(s=>{
            if(!s.id) return;
            shipQty[s.id]=(shipQty[s.id]||0)+s.qty;
        }));
        const userOn = !!(window.UserShipDB && UserShipDB.aiEnabled && UserShipDB.aiEnabled());
        const wantUser = opts.checkUser!==false && userOn;

        fixed.main.forEach(s=>{
            const ship=getShip(s.id); if(!ship) return;
            const lim=ship.serviceLimit||99;
            const used=shipQty[s.id]||0;
            if(!stitch && used>lim)
                errors.push(`「${ship.name}」服役超上限：主舰队+增援合计 ${used} 艘 > 上限 ${lim} 艘`);
            if(wantUser && !UserShipDB.isOwned(s.id))
                errors.push(`用户没有「${ship.name}」这艘船（舰船库未记录）`);
            // 模块必须是该船真实存在 + 用户拥有
            const codes=allVariantCodes(ship);
            Object.keys(s.mods).forEach(slot=>{
                const v=s.mods[slot]; if(!v) return;
                if(!codes[v]){ errors.push(`「${ship.name}」没有模块 ${v}（该模块不属于这艘船）`); return; }
                if(wantUser){
                    const owned=(UserShipDB.getShipMods(s.id)||{})[slot]||[];
                    if(owned.indexOf(v)<0) errors.push(`用户没有「${ship.name}」的模块 ${v}（拥有：${owned.length?owned.join('/'):'无'}）`);
                }
            });
        });
        fixed.reinforcement.forEach(s=>{
            const ship=getShip(s.id); if(!ship) return;
            if(wantUser && !UserShipDB.isOwned(s.id))
                errors.push(`用户没有「${ship.name}」这艘船（增援，舰船库未记录）`);
            const codes=allVariantCodes(ship);
            Object.keys(s.mods).forEach(slot=>{
                const v=s.mods[slot]; if(!v) return;
                if(!codes[v]){ errors.push(`「${ship.name}」没有模块 ${v}`); return; }
                if(wantUser){
                    const owned=(UserShipDB.getShipMods(s.id)||{})[slot]||[];
                    if(owned.indexOf(v)<0) errors.push(`用户没有「${ship.name}」的模块 ${v}（增援）`);
                }
            });
        });

        // 2) 增援 ≤ 9 艘
        const reinShips=fixed.reinforcement.reduce((n,s)=>n+s.qty,0);
        if(!stitch && reinShips>9) errors.push(`增援编队 ${reinShips} 艘 > 上限 9 艘`);

        // 3) 载机合法性（核心：不允许把载机强塞进没有载机位的船/模块）
        const airQty={};
        ['main','reinforcement'].forEach(sec=>fixed[sec].forEach(s=>{
            const ship=getShip(s.id); if(!ship) return;
            const slots=airSlots(ship, s.mods, s.qty);
            const tag=sec==='reinforcement'?'（增援）':'';
            // 先把能补的位补上
            s.air.forEach(a=>{
                if(a.slot && slots.some(x=>x.key===a.slot)) return;
                if(a.slot){   // slot 指向的载机位已不存在（模块被改）
                    const s2=slots.find(x=>x.kind===a.kind && usedIn(s,a.kind===x.kind?x.key:'')<x.cap);
                    a.slot = s2 ? s2.key : '';
                }
                if(!a.slot){
                    const s2=slots.find(x=>x.kind===a.kind && usedIn(s,x.key)<x.cap);
                    a.slot = s2 ? s2.key : '';
                }
            });
            s.air = s.air.filter(a=>{
                const n=Math.max(1, parseInt(a.qty,10)||1);
                a.qty=n;
                if(!slots.length){
                    errors.push(`「${ship.name}」不能携带载机${tag}：该舰没有载机位（也没有可提供载机位的模块）→ 移除 ${a.name||a.id}×${n}`);
                    return false;
                }
                const sameKind=slots.filter(x=>x.kind===a.kind);
                if(!sameKind.length){
                    errors.push(`「${ship.name}」没有可用的${a.kind==='fighter'?'战机':'护航艇'}载机位${tag}（所选模块不提供该机型载机位）→ 移除 ${a.name||a.id}×${n}`);
                    return false;
                }
                if(!a.slot){
                    const cap=sameKind.reduce((t,x)=>t+x.cap,0);
                    errors.push(`「${ship.name}」的${a.kind==='fighter'?'战机':'护航艇'}载机位已满（容量 ${cap}）${tag} → 移除 ${a.name||a.id}×${n}`);
                    return false;
                }
                // 大型机限制：该载机位允许的机型
                const sl=slots.find(x=>x.key===a.slot);
                const ac=getShip(a.id);
                if(sl && sl.kind==='fighter' && sl.allow!=='ALL' && ac && ac.airSize==='large'){
                    errors.push(`「${ship.name}」的 ${sl.mod} 载机位只能带中小型战机${tag} → 移除大型机 ${a.name||a.id}×${n}`);
                    return false;
                }
                // 单一位容量
                if(usedIn(s,a.slot)>sl.cap){
                    errors.push(`「${ship.name}」的 ${sl.mod} 载机位超容量（${usedIn(s,a.slot)}/${sl.cap}）${tag} → 移除 ${a.name||a.id}×${n}`);
                    return false;
                }
                if(a.id) airQty[a.id]=(airQty[a.id]||0)+n;
                return true;
            });
        }));

        // 4) 载机服役上限（整队口径）
        if(!stitch) Object.keys(airQty).forEach(id=>{
            const ac=getShip(id); if(!ac) return;
            const lim=ac.serviceLimit||99;
            if(airQty[id]>lim) errors.push(`载机「${ac.name}」服役超上限：整队 ${airQty[id]} 架 > 上限 ${lim} 架`);
        });

        // 5) 旗舰必须在该舰队内
        if(fixed.flagship){
            const fk=String(fixed.flagship);
            const id=fk.indexOf('|')>=0?fk.split('|')[1]:fk;
            const inMain=fixed.main.some(s=>s.id===id);
            const inRein=fixed.reinforcement.some(s=>s.id===id);
            if(!inMain && !inRein){ warnings.push('设定的旗舰不在本舰队内，已清除'); fixed.flagship=''; }
        }

        const st=stats(fixed);
        return {ok:errors.length===0, errors, warnings, fixed, stats:st, userChecked:wantUser};
    }

    window.FleetCheck={ airSlots, slotOf, usedIn, hasAir, assignSlots, slotsOf, allVariantCodes,
                        modAirInfo, stats, check, getShip };
})();
