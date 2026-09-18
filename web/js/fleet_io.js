/* ========================================
   FleetIO —— 配队 ↔ AI ↔ 模拟器 三向联动
   - 解析 AI 回答里的舰队配置文本
   - 舰船名 → id 匹配（含黑话别名）
   - 通过 localStorage 传递配队
   ======================================== */
(function(){
    const K_IMPORT='lagrange_fleet_import';     // AI → 配队页
    const K_SIM='lagrange_sim_import';          // 配队页 → 模拟器
    const K_PREFILL='lagrange_chat_prefill';    // 配队页 → AI 对话

    // 黑话/简称 → 正规舰名（用于模糊匹配失败时兜底；值为 id 或名字片段）
    const ALIAS={
        '大帝':'constantine','大盾':'plutus-shield','大矛':'uranus-spear','艇矛':'uranus-spear',
        '大剑':'antontas','安东塔斯':'antontas','五九':'ST59','59':'ST59','天枢':'tianshu',
        '太阳鲸':'sun-whale','风暴':'eternal-storm','雷火':'thunder-star','雷火之星':'thunder-star',
        '雷火之辉':'leihuo-hui','卡利斯托':'callisto','艾奥':'aio','奇美拉':'chimera','光锥':'lightcone',
        '玉衡':'yuheng','水母':'cishuimu','刺水母':'cishuimu','谷神星':'gushenxing','开阳':'kaiyang',
        '苔原':'taixian','亚达伯拉':'yadabola','枪骑兵':'qiangqibing','斗牛':'douniu','卫士':'weishi',
        '卡利莱恩':'kalilaien','雷里亚特':'leiliyate','锆石':'zircon','雨海':'yuhai','澄海':'chenghai',
        '红宝石':'ruby','狼蜥':'langxi','静海':'jinghai','云海':'yunhai','瑶光':'yaoguang',
        '猎兵':'liebing','狩猎':'hunter','棕熊':'brownbear','白垩':'chalk','玉衡级':'yuheng',
        '海尔A':'hayabusa','海尔波普':'hayabusa','天玑':'tianji','野火':'wildfire','鳐级':'yao',
        '蜂巢守卫者':'hive-guardian','列维':'s-levi9','索姆河':'somme-shadow','虚灵':'void-corvette',
        '星云追逐者':'nebula','坦普尔':'temple1','米斯特拉':'mistral','海氏':'haishi','理智':'lizhi',
        '维塔斯':'vitas','刺鳐':'stingray','佩刀':'peidao','牛蛙':'niuwa','林鸮':'linxiao',
        '砂龙':'shalong','安德森':'andersen','SC002':'sc002','BR050':'br050','天璇':'tianxuan',
        '雷火V022':'leihuoV022','新大地':'B192-newland','孢孑':'spore','孢子':'spore',
        '永恒苍穹':'eternal-vault','南十字':'south-cross','南十字星':'south-cross','止战':'zhizhan',
        '天权':'tianquan','不屈':'buqu','乌拉诺斯':'uranus-spear','普鲁图斯':'plutus-shield',
        '新君士坦丁':'constantine','FT300':'FG300','锈蚀':'rust'
    };

    function norm(s){ return String(s==null?'':s).replace(/[\s\u3000]/g,'').replace(/[（(].*?[)）]/g,'').trim(); }

    /* 竖线分隔符：三种写法都要认，否则【同站位的多艘舰会被整段吞掉】
       U+2502 │（Box Drawings，我方输出用）  U+FF5C ｜（全角竖线，用于分隔同站位多舰 / AI 常用）  U+007C |（半角） */
    const VERT = /[\u2502\uFF5C|]/;

    // 在 SHIP_DB 里匹配舰船；返回 {id,name,type,...} 或 null
    function matchShip(raw){
        if(!window.SHIP_DB||!SHIP_DB.all) return null;
        const q=norm(raw); if(!q) return null;
        const all=SHIP_DB.all();
        // 0) 直接是 id / 全名
        let hit=all.find(s=>s.id===raw||norm(s.name)===q);
        if(hit) return hit;
        // 1) 别名表
        const ak=Object.keys(ALIAS).filter(k=>q.indexOf(k)>=0).sort((a,b)=>b.length-a.length);
        for(const k of ak){
            const v=ALIAS[k];
            const cand=all.filter(s=>s.id===v||s.id.toLowerCase().indexOf(String(v).toLowerCase())===0||norm(s.name).indexOf(k)>=0);
            if(cand.length){
                // 同族多型号时优先取第一个（A型/原装）
                hit=cand.find(s=>/A型|-A\b|-A$/.test(s.name))||cand[0];
                if(hit) return hit;
            }
        }
        // 2) 名称包含（取匹配最长的）
        let best=null,bl=0;
        all.forEach(s=>{ const n=norm(s.name); if(n.indexOf(q)>=0 && q.length>bl){ best=s; bl=q.length; } });
        if(best) return best;
        // 3) 反向：query 包含舰名核心段
        all.forEach(s=>{ const core=norm(s.name).split('-')[0]; if(core && q.indexOf(core)>=0 && core.length>bl){ best=s; bl=core.length; } });
        return best||null;
    }

    // 解析 AI 回答（或任意含 │ × 的文本）为舰队结构
    function parseFleetText(text){
        const lines=String(text||'').split(/\r?\n/);
        const out={ name:'', desc:'', main:[], reinforce:[], air:[] };
        let section='main';
        // 解析单个配置段： pos 为站位（增援时为空）
        function parseSeg(seg, pos){
            if(!seg) return;
            seg=String(seg).replace(/^[\u2502\uFF5C|\s]+/,'').trim();
            if(!seg) return;
            const qm=seg.match(/[×xX*]\s*(\d+)/);
            const qty=qm?parseInt(qm[1],10):1;
            let core=seg.split(/[×xX*]/)[0].replace(/带.*$/,'').trim();
            const mods=(core.match(/\b([MABCDEFGH]\d)\b/gi)||[]).map(m=>m.toUpperCase());
            core=core.replace(/\b[MABCDEFGH]\d\b/gi,'').replace(/[（(].*?[)）]/g,'').replace(/^[\u2502\uFF5C|\s]+/,'').trim();
            if(!core) return;
            const ship=matchShip(core);
            const entry={ raw:core, id:ship?ship.id:'', name:ship?ship.name:core, qty:isNaN(qty)?1:qty, pos:pos||'', mods:{} };
            mods.forEach(m=>{ entry.mods[m[0]]=m; });
            // 载机： 带 XX×N
            const airPart=seg.match(/带\s*(.+)$/);
            if(airPart){
                (airPart[1].match(/[\u4e00-\u9fa5A-Za-z0-9\-]+\s*[×xX*]\s*\d+/g)||[]).forEach(t=>{
                    const mm=t.match(/^([\u4e00-\u9fa5A-Za-z0-9\-]+)\s*[×xX*]\s*(\d+)$/);
                    if(!mm) return;
                    const a=matchShip(mm[1]);
                    out.air.push({ forId:entry.id, id:a?a.id:'', name:a?a.name:mm[1],
                        kind:(a&&a.type==='corvette')?'corvette':'fighter', qty:parseInt(mm[2],10) });
                });
            }
            if(section==='reinforce') out.reinforce.push(entry); else out.main.push(entry);
        }
        lines.forEach(ln=>{
            let l=ln.trim(); if(!l) return;
            const hasSep=VERT.test(l);
            // 段标题
            if(!hasSep && /增援|reinforcement/i.test(l)){ section='reinforce'; return; }
            if(!hasSep && /(主舰队|主力舰队|主队|main fleet)/i.test(l)){ section='main'; return; }
            if(hasSep){
                const parts=l.split(VERT).map(x=>x.trim());
                const pos=parts[0];
                if(pos && !/[×xX*]/.test(pos)) parts.slice(1).forEach(seg=>parseSeg(seg,pos));
                else parts.forEach(seg=>parseSeg(seg,''));      // 整行本身就是配置
                return;
            }
            // 无分隔符的配置行（我方 fleetToText 的通用格式 / AI 自由排版）
            if(/[×xX*]\s*\d/.test(l)){
                const pm=l.match(/^(前[排列]|中[排列]|后[排列])\s*/);   // 行首站位前缀
                let pos='';
                if(pm){ pos=pm[1]; l=l.slice(pm[0].length).trim(); }
                if(!pos && section==='reinforce') pos='增援';
                if(l) parseSeg(l,pos);
            }
        });
        return out;
    }
    // 去掉行首站位前缀后是否像一份配置（宽松：不强制要求 │）
    function looksLikeFleet(text){
        const t=String(text||'');
        if(!/×\s*\d/.test(t)) return false;
        if(/(前[排列]|中[排列]|后[排列])/.test(t)) return true;
        if(VERT.test(t) && /(增援|主舰队|主队)/.test(t)) return true;
        // 「舰名 ×N」密集出现（≥3 个 ×N）也认为是配队
        return (t.match(/×\s*\d+/g)||[]).length>=3;
    }

    // 舰队 → 给 AI 的文本（按站位分组，带带载机；保证可被 parseFleetText 读回）
    function fleetToText(plan){
        const f=(plan.fleets&&plan.fleets[plan.active||0])||{main:[],reinforce:[]};
        const L=[];
        L.push('方案名称：'+(plan.name||'未命名'));
        if(plan.desc) L.push('方案介绍：'+plan.desc);
        const one=s=>{
            const mods=Object.keys(s.mods||{}).filter(k=>s.mods[k]).map(k=>s.mods[k]).join('+');
            const air=(s.air||[]).map(a=>'带 '+a.name+'×'+a.qty).join(' ');
            return (s.name||s.id)+(mods?' '+mods:'')+' ×'+(s.qty||1)+(air?' '+air:'');
        };
        if(f.reinforce.length) L.push('【增援 — '+f.reinforce.reduce((a,s)=>a+s.qty,0)+'位】\n'+f.reinforce.map(one).join('\n'));
        if(f.main.length){
            const order=['前排','中排','后排'];
            const g={};
            f.main.forEach(s=>{ const p=s.pos||''; (g[p]=g[p]||[]).push(one(s)); });
            const keys=Object.keys(g).sort((a,b)=>{
                const ia=order.indexOf(a), ib=order.indexOf(b);
                return (ia<0?9:ia)-(ib<0?9:ib);
            });
            L.push('【主舰队】\n'+keys.map(p=>p ? (p+'│'+g[p].join(' ｜ ')) : g[p].join(' ｜ ')).join('\n'));
        }
        return L.join('\n');
    }

    // 传递
    function put(key,val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} }
    function take(key){ try{ const v=localStorage.getItem(key); localStorage.removeItem(key); return v?JSON.parse(v):null; }catch(e){ return null; } }

    window.FleetIO={ norm, matchShip, parseFleetText, looksLikeFleet, fleetToText,
        toFleet:(fleet)=>put(K_IMPORT, fleet), fromAI:()=>take(K_IMPORT),
        toSim:(fleet)=>put(K_SIM, fleet), fromFleetPage:()=>take(K_SIM),
        toChat:(text)=>put(K_PREFILL, text), fromFleet:( )=>take(K_PREFILL) };
})();
