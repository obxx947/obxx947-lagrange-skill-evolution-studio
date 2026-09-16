/* ========================================
   用户舰船信息库（内置舰船库 · 纯前端 localStorage）v2
   - 全量 196 艘：每艘只存"是否拥有"（在库=拥有）+ 超主力模块多选
   - 「允许AI检索舰船库」开关（默认关）：关=AI 完全看不到；开=AI 用快照+get_user_ships 工具
   - 模块：超主力(战巡/战列/航母/支援) 每槽可勾选多个拥有的变体 → mods:{槽位:[变体,...]}
   ======================================== */

const UserShipDB = (function(){
    const KEY = 'lagrange_user_ships';
    const SUPER_TYPES = ['battlecruiser','battleship','aircraftcarrier','support'];   // 支援舰也算超主力

    function isSuper(type){ return SUPER_TYPES.indexOf(type)!==-1; }
    function isSuperType(t){ return isSuper(t); }

    // 规整数据：{aiAccess:false, ships:[]}  (ships 数组的元素即"已拥有"的舰船)
    function normalize(d){
        d = d || {};
        const ships = Array.isArray(d.ships) ? d.ships : [];
        return { aiAccess: d.aiAccess===true, ships };
    }
    function load(){ try{ return normalize(JSON.parse(localStorage.getItem(KEY)||'null')); } catch(e){ return {aiAccess:false, ships:[]}; } }
    function save(data){ try{ localStorage.setItem(KEY, JSON.stringify(normalize(data))); return true; } catch(e){ return false; } }
    function getData(){ return load(); }

    // ---- AI 开关 ----
    function aiEnabled(){ return load().aiAccess; }
    function setAiAccess(v){ const d=load(); d.aiAccess=!!v; save(d); return d.aiAccess; }

    // 蓝点(技术点)分级：普通舰 40勉强/75差不多/100刚好；超主力 60勉强/120差不多/200刚好
    const TP = { n:{barely:40, ok:75, good:100}, s:{barely:60, ok:120, good:200} };
    function techTier(isSuper, tp){
        const r = isSuper ? TP.s : TP.n;
        tp = parseInt(tp,10)||0;
        if(tp<=0) return '未填';
        if(tp < r.barely) return '不足';
        if(tp < r.ok) return '勉强';
        if(tp < r.good) return '差不多';
        return '刚好';
    }
    function setTechPoints(shipKey, v){
        const d=load(); const s=d.ships.find(x=>x.shipKey===shipKey);
        if(s){ s.techPoints = parseInt(v,10)||0; save(d); }
        return d;
    }
    function getTechPoints(shipKey){ const s=getByKey(shipKey); return (s&&s.techPoints)||0; }

    // ---- 拥有/删除 ----
    function isOwned(shipKey){ return !!getByKey(shipKey); }   // v2: 在数组中即"拥有"
    // ship: {shipKey,name,type,isSuper}；已在库→仅确保名/类型
    function setOwned(ship){
        const d=load();
        const i=d.ships.findIndex(s=>s.shipKey===(ship&&ship.shipKey));
        if(i>=0){ d.ships[i]=Object.assign({}, d.ships[i], {name:ship.name, type:ship.type, isSuper:ship.isSuper}); }
        else d.ships.unshift({ shipKey:ship.shipKey, name:ship.name, type:ship.type, isSuper:ship.isSuper, mods:{}, techPoints:0 });
        save(d); return d;
    }
    function unsetOwned(shipKey){
        const d=load(); d.ships=d.ships.filter(s=>s.shipKey!==shipKey); save(d); return d;
    }
    function toggleOwned(ship){
        return isOwned(ship.shipKey) ? unsetOwned(ship.shipKey) : setOwned(ship);
    }

    // ---- 模块 ----
    function getShipMods(shipKey){ const s=getByKey(shipKey); return (s&&s.mods)||{}; }
    function setShipMods(shipKey, mods){
        const d=load(); const s=d.ships.find(x=>x.shipKey===shipKey);
        if(s){ s.mods=mods||{}; save(d); } return d;
    }
    function toggleMod(shipKey, slot, variant){
        const d=load(); const s=d.ships.find(x=>x.shipKey===shipKey);
        if(!s) return;
        const arr=(s.mods&&s.mods[slot])||[];
        s.mods = s.mods||{};
        if(arr.includes(variant)) s.mods[slot]=arr.filter(v=>v!==variant);
        else s.mods[slot]=[...arr, variant];
        save(d);
    }

    // ---- 查询 ----
    function getByKey(shipKey){
        const k=String(shipKey||'').toLowerCase();
        return load().ships.find(s=>(s.shipKey||'').toLowerCase()===k || (s.name||'').toLowerCase()===k)||null;
    }
    function has(shipKey){ return isOwned(shipKey); }
    function status(shipKey){ const s=getByKey(shipKey); return s ? {owned:true, name:s.name, type:s.type, isSuper:s.isSuper, mods:s.mods||{}} : {owned:false}; }
    function getOwnedShips(){ return load().ships; }
    function allShips(){ return load().ships; }

    // ---- 快照（每轮注入 system 消息；只列已拥有；超主力带模块）----
    function snapshot(){
        const d=load();
        if(!d.aiAccess) return '';
        const owned=d.ships.filter(s=>s.owned!==false);
        if(!owned.length) return '';
        const SORT={'battlecruiser':0,'battleship':1,'aircraftcarrier':2,'support':3};
        owned.sort((a,b)=>(SORT[a.type]!==undefined?SORT[a.type]:9)-(SORT[b.type]!==undefined?SORT[b.type]:9));
        let lines=[];
        for(const s of owned){
            const typeName=typeLabel(s.type);
            let line=`- ${s.name||s.shipKey}${typeName?`（${typeName}${isSuper(s.type)?' · 超主力':''}）`:''}`;
            const mods=modsText(s.mods);
            if(mods) line+=` 模块: ${mods}`;
            const tp=(s.techPoints||0);
            if(tp>0) line+=` 蓝点${tp}(${techTier(isSuper(s.type),tp)})`;
            lines.push(line);
        }
        let out=`【玩家舰船库】（以下为玩家当前已拥有的舰船及其模块，配队/建议只能基于这些船与模块）\n${lines.join('\n')}\n共 ${owned.length} 艘已拥有。`;
        return out.substring(0, 2500);
    }

    // ---- AI 按需查询（get_user_ships 工具）----
    function searchTool(query){
        if(!aiEnabled()) return JSON.stringify({allowed:false, message:'用户未开放AI检索舰船库（默认不允许，需在「舰船信息库」页面开启）。'});
        const all=load().ships.filter(s=>s.owned!==false);
        if(!all.length) return JSON.stringify({count:0, ships:[], note:'玩家舰船库为空（尚未添加舰船）。'});
        if(!query){
            const list=all.map(s=>({name:s.name, shipKey:s.shipKey, type:s.type, 超主力:isSuper(s.type), mods:s.mods||{}, 蓝点:s.techPoints||0, 蓝点分级:techTier(isSuper(s.type), s.techPoints)}));
            return JSON.stringify({count:list.length, ships:list, note:'玩家已拥有的舰船如上（超主力已带其拥有的模块；蓝点用于评估舰船强度。蓝点分级：普通舰40勉强/75差不多/100刚好，超主力60勉强/120差不多/200刚好）。配队/建议只能用这些船与模块。'});
        }
        const q=String(query).toLowerCase();
        const m=all.find(s=>(s.name||'').toLowerCase().includes(q))||all.find(s=>(s.shipKey||'').toLowerCase().includes(q));
        if(!m) return JSON.stringify({found:false, query, message:'玩家舰船库中没有该舰船的记录（未拥有）。'});
        return JSON.stringify({found:true, name:m.name, shipKey:m.shipKey, type:m.type, 超主力:isSuper(m.type), owned:true, mods:m.mods||{}, 蓝点:m.techPoints||0, 蓝点分级:techTier(isSuper(m.type), m.techPoints)});
    }

    // ---- 工具函数 ----
    const TYPE_LABEL={frigate:'护卫舰',destroyer:'驱逐舰',cruiser:'巡洋舰',corvette:'护航艇',fighter:'战机',battlecruiser:'战列巡洋舰',battleship:'战列舰',aircraftcarrier:'航空母舰',support:'支援舰'};
    function typeLabel(t){ return TYPE_LABEL[t]||t||''; }
    // mods:{M:['M1','M2'],A:['A1']} → 'M1、M2 / A1'
    function modsText(mods){
        if(!mods||typeof mods!=='object') return '';
        const ORDER=['M','A','B','C','D','E','F','G','H'];
        const keys=Object.keys(mods).filter(k=>mods[k]&&mods[k].length).sort((a,b)=>(ORDER.indexOf(a)>=0?ORDER.indexOf(a):99)-(ORDER.indexOf(b)>=0?ORDER.indexOf(b):99));
        return keys.map(k=>k+':'+mods[k].join('、')).join(' / ');
    }
    // 给定 SHIP_DB 原始船对象，返回超主力模块槽位变体 {M:['M1','M2'],...}（跳过 _systems）
    function slotOptions(shipObj){
        if(!shipObj||!isSuper(shipObj.type)||!shipObj.modules) return {};
        const out={};
        for(const k of Object.keys(shipObj.modules)){
            const v=shipObj.modules[k];
            if(v && v.type==='moduleGroup' && v.variants) out[k]=Object.keys(v.variants);
        }
        return out;
    }

    return { load, save, getData, aiEnabled, setAiAccess, isOwned, setOwned, unsetOwned, toggleOwned,
             getShipMods, setShipMods, toggleMod, getByKey, has, status, getOwnedShips, allShips,
             snapshot, searchTool, isSuper, isSuperType, typeLabel, slotOptions, modsText, SUPER_TYPES,
             techTier, setTechPoints, getTechPoints, TP };
})();

window.UserShipDB = UserShipDB;
