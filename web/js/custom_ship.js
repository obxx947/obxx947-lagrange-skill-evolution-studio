/* ============================================================
   CustomShip —— 「自定义舰船」弹窗（2026-10-10 第二版：系统化）
   ------------------------------------------------------------
   本版按用户要求补齐：
   ① 武器：可勾【暴击】后填 额外暴击率 / 暴击伤害；可勾【可攻击系统】并选 目标系统 + 效率(低/中/高)；
      【目标优先级】支持多行（第1优先、第2优先…），每行可多选舰种（含小型舰船/大型舰船/超主力舰/舰载机）并各自填命中区间
   ② 机库：不再直接填舰载机 → 「＋ 添加机库」；每行 = 战机槽/护航艇槽 + 载机伤害强化 / 载机暴击率 / 载机暴击伤害 / 载机闪避 + 系统血量；可设【主机库系统】
   ③ 系统：每个武器 = 一个武器系统（可设【主武器系统】）；机库 = 机库系统；【动力系统】【指挥系统】必填；所有系统都要填系统血量
   引擎口径：modules={W1:{name,type,hp,weapons},H1:{name,type:'hangar',hp},E1:{type:'engine'},C1:{type:'command'}}；
   船级 hangarDmg/hangarCritRate/hangarCritDmg/hangarEvasion（主机库的加成，作用于本舰全部载机）
   依赖：js/mech_spec.js；暴露 window.CustomShip
   ============================================================ */
window.CustomShip = (function () {
    const LS = 'lagrange_custom_ships';
    const CHAT = id => 'lglr_cs_chat_' + id;
    let built = false, editingId = null, chatMsgs = [], pending = null;
    let mainWeaponIdx = 0, mainHangarIdx = 0;

    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const readAll = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } };
    const saveAll = o => localStorage.setItem(LS, JSON.stringify(o));

    /* 目标可选舰种（引擎 matchesType 认：中文舰种名 + 小型/大型舰船/超主力舰/舰载机 尺寸类） */
    const TTYPES = ['护卫舰', '驱逐舰', '巡洋舰', '战列巡洋舰', '战列舰', '航空母舰', '支援舰', '战机', '护航艇', '小型舰船', '大型舰船', '超主力舰'];
    const EFFS = [['low', '低'], ['medium', '中'], ['high', '高']];

    function inject() {
        if (built) return; built = true;
        const css = document.createElement('style');
        css.textContent = '.cs-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:3000;display:none;align-items:flex-start;justify-content:center;overflow:auto;padding:18px 10px 70px}'
            + '.cs-overlay.show{display:flex}'
            + '.cs-modal{background:#0f1626;border:1px solid #2d4a6f;border-radius:14px;max-width:1100px;width:100%;padding:14px;color:#dbe6f5;font-size:0.75rem}'
            + '.cs-input{width:100%;background:#0b1220;border:1px solid #2d4a6f;border-radius:6px;color:#dbe6f5;padding:4px 6px;font-size:0.7rem;font-family:inherit}'
            + '.cs-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;font-size:0.68rem}'
            + '.cs-grid label{display:block;color:#8899aa;margin-bottom:1px}'
            + '.cs-cols{display:flex;gap:12px;align-items:flex-start}'
            + '.cs-col{flex:1;min-width:0}.cs-col.left{flex:1.2}'
            + '@media(max-width:960px){.cs-cols{flex-direction:column}.cs-grid{grid-template-columns:repeat(2,1fr)}}'
            + '.cs-card{background:#0b1220;border:1px solid #2d4a6f;border-radius:8px;padding:8px;margin-bottom:8px}'
            + '.cs-card .hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-weight:700;font-size:0.72rem}'
            + '.cs-fgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;font-size:0.66rem}'
            + '.cs-fgrid>div{display:flex;flex-direction:column;gap:2px}'
            + '.cs-fgrid span.lb{color:#8899aa;font-size:0.62rem}'
            + '.cs-tt{display:flex;flex-wrap:wrap;gap:3px;align-items:center;font-size:0.64rem;border:1px dashed #2d4a6f;border-radius:6px;padding:4px;margin-top:3px}'
            + '.cs-tt label{display:inline-flex;gap:3px;align-items:center;cursor:pointer}'
            + '.cs-th{font-size:0.6rem;color:#5a7a9a;margin:4px 0 2px}'
            + '.cs-chat{height:250px;overflow-y:auto;background:#0b1220;border:1px solid #2d4a6f;border-radius:8px;padding:8px;font-size:0.7rem;line-height:1.6}'
            + '.cs-m-u{color:#4a9eff;margin:6px 0 2px;font-weight:600}'
            + '.cs-m-a{color:#dbe6f5;white-space:pre-wrap;margin:2px 0 6px}'
            + '.cs-m-s{color:#ffd700;margin:2px 0 6px;font-size:0.66rem;white-space:pre-wrap}'
            + '.cs-mech{border:1px solid #2d4a6f;border-radius:6px;padding:4px 6px;margin:3px 0;font-size:0.68rem;display:flex;gap:6px;align-items:center}'
            + '.cs-mech b{color:#ffd700;font-weight:600}.cs-mech .x{margin-left:auto;cursor:pointer;color:#ff6b6b}'
            + '.cs-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid #2d4a6f;border-radius:999px;padding:3px 10px;margin:2px 4px 2px 0;cursor:pointer;font-size:0.68rem}'
            + '.cs-chip:hover{border-color:#00d4ff;color:#00d4ff}.cs-chip.on{border-color:#ffd700;color:#ffd700}'
            + '.cs-btn{background:rgba(255,255,255,.05);border:1px solid #2d4a6f;color:#cfe0f5;border-radius:8px;padding:5px 12px;font-size:0.7rem;cursor:pointer;font-family:inherit}'
            + '.cs-btn:hover{border-color:#00d4ff;color:#00d4ff}.cs-btn.pri{background:rgba(0,212,255,.16);border-color:#00d4ff;color:#fff}'
            + '.cs-btn.red{color:#ff6b6b;border-color:#ff6b6b}.cs-btn.cyan{background:rgba(74,158,255,.14);border-color:#4a9eff;color:#cfe6ff}'
            + '.cs-btn.gold{color:#ffd700;border-color:#ffd700}.cs-btn.sm{padding:2px 7px;font-size:0.62rem}';
        document.head.appendChild(css);

        const el = document.createElement('div');
        el.className = 'cs-overlay'; el.id = 'customShipOverlay';
        el.innerHTML =
            '<div class="cs-modal">'
            + '<h3 style="font-size:0.92rem;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">'
            + '<span>⚙️ 自定义舰船管理 <span id="csSubTitle" style="font-size:0.68rem;color:#8899aa"></span></span>'
            + '<span style="cursor:pointer;padding:0 6px" onclick="CustomShip.close()">✕</span></h3>'
            + '<div style="margin-bottom:10px;padding:6px 8px;background:#0b1220;border:1px solid #2d4a6f;border-radius:8px;">'
            + '<span style="color:#8899aa;font-size:0.66rem;margin-right:6px;">已有自定义舰船（点击编辑）：</span><span id="csList"></span>'
            + '<button class="cs-btn pri" style="margin-left:6px" onclick="CustomShip.newShip()">➕ 新建</button>'
            + '</div>'
            + '<div class="cs-cols">'
            + '<div class="cs-col left">'
            /* 基本数据 */
            + '<div class="cs-card"><div class="hd">📋 基本数据</div><div class="cs-grid">'
            + '<div><label>舰船名称</label><input class="cs-input" id="csName" value="自定义舰船"></div>'
            + '<div><label>类型</label><select class="cs-input" id="csType"><option value="frigate">护卫舰</option><option value="destroyer">驱逐舰</option><option value="cruiser" selected>巡洋舰</option><option value="battlecruiser">战列巡洋舰</option><option value="battleship">战列舰</option><option value="aircraftcarrier">航空母舰</option><option value="support">支援舰</option><option value="fighter">战机</option><option value="corvette">护航艇</option></select></div>'
            + '<div><label>站位</label><select class="cs-input" id="csPos"><option>前排</option><option selected>中排</option><option>后排</option></select></div>'
            + '<div><label>指挥值</label><input class="cs-input" id="csCmd" type="number" value="10"></div>'
            + '<div><label>服役上限</label><input class="cs-input" id="csLimit" type="number" value="10"></div>'
            + '<div><label>结构值(HP)</label><input class="cs-input" id="csHp" type="number" value="50000"></div>'
            + '<div><label>物理护甲</label><input class="cs-input" id="csPhy" type="number" value="5"></div>'
            + '<div><label>能量护甲%</label><input class="cs-input" id="csEng" type="number" value="5"></div>'
            + '<div><label>巡航速度</label><input class="cs-input" id="csSpeed" value="500-1200"></div>'
            + '<div><label>曲率速度</label><input class="cs-input" id="csWarp" type="number" value="2500"></div>'
            + '</div></div>'
            /* 武器系统 */
            + '<div class="cs-card"><div class="hd"><span>⚔️ 武器系统（每门武器 = 一个系统，系统血量必填）</span><button class="cs-btn sm" onclick="CustomShip.addWeapon()">＋ 添加武器</button></div>'
            + '<div id="csWeapons"></div></div>'
            /* 机库 */
            + '<div class="cs-card"><div class="hd"><span>🛫 机库系统（舰载机在配队时挂到机库；这里填机库加成）</span><button class="cs-btn sm" onclick="CustomShip.addHangar()">＋ 添加机库</button></div>'
            + '<div id="csHangars"></div></div>'
            /* 动力/指挥 */
            + '<div class="cs-card"><div class="hd">🧰 动力 / 指挥系统（必填）</div><div class="cs-fgrid">'
            + '<div><span class="lb">动力系统 血量</span><input class="cs-input" id="csEngineHp" type="number" value="2400" title="动力系统结构值（战斗内不维修）"></div>'
            + '<div><span class="lb">指挥系统 血量</span><input class="cs-input" id="csCmdHp" type="number" value="2400" title="指挥系统结构值（可维修 3 次）"></div>'
            + '</div><div class="cs-th">提示：系统被打光=该系统损毁（武器系统毁了该武器停火、指挥系统毁了旗舰机制失效）。默认 2400 与全库口径一致。</div></div>'
            + '<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">'
            + '<button class="cs-btn pri" onclick="CustomShip.save()">💾 保存舰船</button>'
            + '<button class="cs-btn red" id="csDelBtn" style="display:none" onclick="CustomShip.del()">🗑 删除这艘</button>'
            + '</div>'
            + '</div>'
            /* 右列：AI */
            + '<div class="cs-col">'
            + '<div style="font-size:0.75rem;font-weight:600;margin-bottom:4px">🤖 机制设计 AI <span style="color:#8899aa;font-size:0.62rem">（先「保存舰船」，再和它聊；它会按《战斗机制.md》白名单设计"当X之后X"，先给你看提议）</span></div>'
            + '<div class="cs-chat" id="csChat"></div>'
            + '<div style="display:flex;gap:6px;margin-top:6px">'
            + '<textarea id="csChatInput" rows="2" class="cs-input" placeholder="例：给这艘船设计一条"半血狂暴"机制；或：把第2条改成冷却30秒" style="resize:vertical"></textarea>'
            + '<button class="cs-btn cyan" style="flex:0 0 auto" onclick="CustomShip.send()">发送</button>'
            + '</div>'
            + '<div style="margin-top:8px;font-size:0.72rem;font-weight:600">📋 当前机制 <span style="color:#8899aa;font-size:0.62rem" id="csMechCnt"></span> <button class="cs-btn red" style="font-size:0.6rem;padding:2px 6px" onclick="CustomShip.clearMechs()">清空全部</button></div>'
            + '<div id="csMechList" style="max-height:200px;overflow-y:auto"></div>'
            + '</div>'
            + '</div></div>';
        document.body.appendChild(el);
    }

    /* ---------- 管理条 ---------- */
    function renderList() {
        const box = $('csList'); if (!box) return;
        const all = readAll(); const ids = Object.keys(all);
        box.innerHTML = ids.length
            ? ids.map(id => '<span class="cs-chip' + (id === editingId ? ' on' : '') + '" onclick="CustomShip.open(\'' + id + '\')">' + esc((all[id] && all[id].name) || id) + '</span>').join('')
            : '<span style="color:#5a7a9a;font-size:0.66rem">（还没有，点右边「➕ 新建」造一艘）</span>';
    }

    /* ---------- 武器卡片 ---------- */
    function weaponSysName(i) { return i === mainWeaponIdx ? '主武器系统' : ('武器系统' + (i + 1)); }
    function hangarSysName(i) { return i === mainHangarIdx ? '主机库系统' : ('机库系统' + (i + 1)); }
    function allSysNames() {
        const n = [];
        const wc = ($('csWeapons') ? $('csWeapons').children.length : 0) || 1;
        const hc = ($('csHangars') ? $('csHangars').children.length : 0);
        for (let i = 0; i < wc; i++) n.push(i === mainWeaponIdx ? '主武器系统' : ('武器系统' + (i + 1)));
        for (let i = 0; i < hc; i++) n.push(i === mainHangarIdx ? '主机库系统' : ('机库系统' + (i + 1)));
        n.push('动力系统', '指挥系统');
        return n;
    }
    function refreshSysSelects() {
        const names = allSysNames();
        document.querySelectorAll('#csWeapons [data-f="sysRows"] select[data-f="sysTarget"]').forEach(sel => {
            const cur = sel.value;
            /* ★ 当前值优先（用户选过的不能被刷新冲掉），pref 只做「新行/值不在列表里」的兜底 */
            const want = (cur && names.indexOf(cur) >= 0) ? cur : (sel.dataset.pref && names.indexOf(sel.dataset.pref) >= 0 ? sel.dataset.pref : names[0]);
            sel.innerHTML = names.map(n => '<option value="' + esc(n) + '"' + (n === want ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
            sel.value = want;
        });
    }
    /* 目标优先级行：[第n优先] 舰种多选 + 命中区间 */
    function targetRow(tg, idx) {
        tg = tg || { types: ['护卫舰', '驱逐舰'], hitMin: 60, hitMax: 80 };
        const d = document.createElement('div');
        d.className = 'cs-card'; d.style.margin = '4px 0'; d.style.background = '#0d1526';
        d.innerHTML = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
            + '<b style="color:#00d4ff;font-size:0.66rem;">第' + (idx + 1) + '优先</b>'
            + '<span class="lb" style="color:#8899aa;font-size:0.62rem;">命中</span>'
            + '<input class="cs-input" data-f="hitMin" type="number" value="' + (tg.hitMin || 60) + '" style="width:52px">'
            + '<span style="font-size:0.62rem">% ~</span>'
            + '<input class="cs-input" data-f="hitMax" type="number" value="' + (tg.hitMax || 80) + '" style="width:52px">'
            + '<span style="font-size:0.62rem">%</span>'
            + '<span style="margin-left:auto;cursor:pointer;color:#ff6b6b" title="删除这条优先目标" onclick="CustomShip.delTargetRow(this)">✕</span>'
            + '</div>'
            + '<div class="cs-th">舰种（可多选）：</div>'
            + '<div class="cs-tt" data-f="types">'
            + TTYPES.map(t => '<label><input type="checkbox" value="' + esc(t) + '"' + ((tg.types || []).indexOf(t) >= 0 ? ' checked' : '') + '>' + esc(t) + '</label>').join('')
            + '</div>';
        return d;
    }
    function weaponCard(w) {
        w = w || {}; const i = ($('csWeapons') ? $('csWeapons').children.length : 0);
        const d = document.createElement('div');
        d.className = 'cs-card';
        const sizeOpt = 'style="width:100%"';
        d.innerHTML = '<div class="hd"><span>武器' + (i + 1) + ' <span class="wSysName" style="color:#8899aa;font-weight:400"></span></span>'
            + '<span style="display:flex;gap:8px;align-items:center;font-size:0.64rem;font-weight:400;">'
            + '<label style="cursor:pointer"><input type="radio" name="csMainWeapon" data-f="main" onchange="CustomShip.refresh()"' + (w._main ? ' checked' : '') + '> 设为主武器系统</label>'
            + '<span style="cursor:pointer;color:#ff6b6b" onclick="CustomShip.removeCard(this)">✕</span></span></div>'
            + '<div class="cs-fgrid">'
            + '<div><span class="lb">名称</span><input class="cs-input" data-f="name" value="' + esc(w.name || '主武器') + '"></div>'
            + '<div><span class="lb">伤害类型</span><select class="cs-input" data-f="dmgType"><option value="physical"' + (w.dmgType !== 'energy' ? ' selected' : '') + '>实弹</option><option value="energy"' + (w.dmgType === 'energy' ? ' selected' : '') + '>能量</option></select></div>'
            + '<div><span class="lb">武器类型</span><select class="cs-input" data-f="weaponType" title="直射：不被拦截、受阵型阻挡（离子炮/轨道炮/脉冲多为直射）；投射：可被拦截（导弹/鱼雷/无人机）"><option value="direct"' + (w.weaponType !== 'projectile' ? ' selected' : '') + '>直射</option><option value="projectile"' + (w.weaponType === 'projectile' ? ' selected' : '') + '>投射</option></select></div>'
            + '<div><span class="lb">防空类型</span><select class="cs-input" data-f="antiAirType"><option value=""' + (!w.antiAirType ? ' selected' : '') + '>无</option><option value="counter"' + (w.antiAirType === 'counter' ? ' selected' : '') + '>反击防空</option><option value="area"' + (w.antiAirType === 'area' ? ' selected' : '') + '>区域防空</option></select></div>'
            + '<div><span class="lb">单发伤害</span><input class="cs-input" data-f="singleDmg" type="number" value="' + (w.singleDmg || 1000) + '"></div>'
            + '<div><span class="lb">弹药数</span><input class="cs-input" data-f="ammo" type="number" value="' + (w.ammo || 1) + '"></div>'
            + '<div><span class="lb">攻击轮次</span><input class="cs-input" data-f="attacks" type="number" value="' + (w.attacks || 1) + '"></div>'
            + '<div><span class="lb">攻击持续s</span><input class="cs-input" data-f="atkDuration" type="number" value="' + (w.atkDuration || 0) + '"></div>'
            + '<div><span class="lb">锁定时间s</span><input class="cs-input" data-f="lockTime" type="number" value="' + (w.lockTime || 4) + '"></div>'
            + '<div><span class="lb">冷却时间s</span><input class="cs-input" data-f="cooldown" type="number" value="' + (w.cooldown || 6) + '"></div>'
            + '<div><span class="lb">锁定效率%</span><input class="cs-input" data-f="lockEfficiency" type="number" value="' + (w.lockEfficiency || 10) + '"></div>'
            + '<div><span class="lb">系统血量</span><input class="cs-input" data-f="sysHp" type="number" value="' + (w._sysHp || 2400) + '" title="这个武器系统的结构值，被打光则该武器停火"></div>'
            + '</div>'
            /* 暴击组 */
            + '<div style="margin-top:6px;font-size:0.66rem;">'
            + '<label style="cursor:pointer"><input type="checkbox" data-f="critOn" onchange="CustomShip.refresh()"' + (w.crit ? ' checked' : '') + '> 💥 暴击（额外加成）</label>'
            + '<span style="color:#5a7a9a;font-size:0.6rem;margin-left:6px;">引擎基础暴击 15%×150% 全武器通用，这里填额外</span>'
            + '<div data-f="critBox" style="display:' + (w.crit ? 'flex' : 'none') + ';gap:8px;align-items:center;margin-top:3px;">'
            + '<span class="lb">额外暴击率%</span><input class="cs-input" data-f="critRate" type="number" value="' + (w.critRate || 0) + '" style="width:70px">'
            + '<span class="lb">暴击伤害%(=倍率-100)</span><input class="cs-input" data-f="critDmg" type="number" value="' + (w.critDmg || 0) + '" style="width:80px" title="150=1.5倍；填 100 = 2.5 倍">'
            + '</div></div>'
            /* 攻击系统组 */
            + '<div style="margin-top:6px;font-size:0.66rem;">'
            + '<label style="cursor:pointer"><input type="checkbox" data-f="sysOn" onchange="CustomShip.refresh()"' + (w.subSystemTargets ? ' checked' : '') + '> 🎯 可攻击系统</label>'
            + '<span style="color:#5a7a9a;font-size:0.6rem;margin-left:6px;">命中分流：高 60% / 中 40% / 低 20% 打在系统上（不吃护甲）</span>'
            + '<div data-f="sysBox" style="display:' + (w.subSystemTargets ? 'block' : 'none') + ';margin-top:3px;">'
            + '<div class="cs-th">按顺序找【第一个还没被打掉】的系统打（第1优先→第2优先…）；每个优先级只选一个系统</div>'
            + '<div data-f="sysRows"></div>'
            + '<button class="cs-btn sm" onclick="CustomShip.addSysRow(this)">＋ 加一条系统优先级</button>'
            + '</div></div>'
            /* 目标优先级 */
            + '<div class="cs-th" style="margin-top:8px;">🎯 目标优先级（从第 1 优先往下逐级匹配；每级可多选舰种、各自命中率）</div>'
            + '<div data-f="targets"></div>'
            + '<button class="cs-btn sm" style="margin-top:2px" onclick="CustomShip.addTargetRow(this)">＋ 加一条优先目标</button>';
        /* 默认一行目标 */
        const tbox = d.querySelector('[data-f="targets"]');
        const tgs = (w.targets && w.targets.length) ? w.targets : [{ types: ['护卫舰', '驱逐舰'], hitMin: 60, hitMax: 80 }];
        tgs.forEach((tg, k) => tbox.appendChild(targetRow(tg, k)));
        /* 攻击系统：已有配置按【键序=优先级】展开成行；没有则给一行默认（动力系统·中） */
        const sbox = d.querySelector('[data-f="sysRows"]');
        const entries = w.subSystemTargets ? Object.entries(w.subSystemTargets) : [['动力系统', 'medium']];
        entries.forEach((e, k) => sbox.appendChild(sysRow(e[0], e[1], k)));
        return d;
    }
    /* 攻击系统优先级行：[第n优先] 系统 select + 效率 select */
    function sysRow(sysName, eff, idx) {
        const d = document.createElement('div');
        d.className = 'cs-card'; d.style.margin = '4px 0'; d.style.background = '#0d1526';
        d.innerHTML = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
            + '<b style="color:#ffd700;font-size:0.66rem;">第' + ((idx || 0) + 1) + '优先</b>'
            + '<select class="cs-input" data-f="sysTarget" data-pref="' + esc(sysName || '动力系统') + '" style="width:140px"></select>'
            + '<span class="lb" style="color:#8899aa;font-size:0.62rem;">效率</span>'
            + '<select class="cs-input" data-f="sysEff" style="width:70px">' + EFFS.map(e => '<option value="' + e[0] + '"' + ((eff || 'medium') === e[0] ? ' selected' : '') + '>' + e[1] + '</option>').join('') + '</select>'
            + '<span style="margin-left:auto;cursor:pointer;color:#ff6b6b" title="删除这条" onclick="CustomShip.delSysRow(this)">✕</span>'
            + '</div>';
        return d;
    }
    function collectSysRows(row) {
        const box = row.querySelector('[data-f="sysRows"]'); if (!box) return null;
        const rows = [...box.children]; if (!rows.length) return null;
        const obj = {};
        rows.forEach(r => {
            const nm = (r.querySelector('[data-f="sysTarget"]') || {}).value || '';
            const ef = (r.querySelector('[data-f="sysEff"]') || {}).value || 'medium';
            if (!nm || obj[nm] !== undefined) return;      // 同一个系统只认第一次（引擎也是取第一个匹配）
            obj[nm] = ef;
        });
        return Object.keys(obj).length ? obj : null;
    }
    function collectWeapons() {
        const host = $('csWeapons'); if (!host) return [];
        const out = [];
        [...host.children].forEach((row, i) => {
            const g = f => { const el = row.querySelector('[data-f="' + f + '"]'); return el ? el.value : ''; };
            const chk = f => { const el = row.querySelector('[data-f="' + f + '"]'); return !!(el && el.checked); };
            const name = String(g('name')).trim(); if (!name) return;
            const w = {
                name: name, dmgType: g('dmgType') || 'physical', weaponType: g('weaponType') || 'direct',
                singleDmg: +g('singleDmg') || 1, ammo: +g('ammo') || 1, attacks: +g('attacks') || 1,
                atkDuration: +g('atkDuration') || 0, lockTime: +g('lockTime') || 4, cooldown: +g('cooldown') || 6,
                lockEfficiency: +g('lockEfficiency') || 10,
                antiAirType: g('antiAirType') || undefined,
                _sysHp: +g('sysHp') || 2400
            };
            if (chk('critOn')) { w.crit = true; w.critRate = +g('critRate') || 0; w.critDmg = +g('critDmg') || 0; }
            if (chk('sysOn')) { const rowsObj = collectSysRows(row); if (rowsObj) w.subSystemTargets = rowsObj; }
            /* 目标优先级 */
            const tgs = [];
            [...row.querySelectorAll('[data-f="targets"] > .cs-card')].forEach(tr => {
                const types = [...tr.querySelectorAll('[data-f="types"] input:checked')].map(x => x.value);
                if (!types.length) return;
                tgs.push({ types: types, hitMin: +(tr.querySelector('[data-f="hitMin"]').value) || 60, hitMax: +(tr.querySelector('[data-f="hitMax"]').value) || 80 });
            });
            w.targets = tgs.length ? tgs : [{ types: ['护卫舰', '驱逐舰'], hitMin: 60, hitMax: 80 }];
            out.push(w);
        });
        return out;
    }

    /* ---------- 机库行 ---------- */
    function hangarRow(h) {
        h = h || {}; const i = ($('csHangars') ? $('csHangars').children.length : 0);
        const d = document.createElement('div');
        d.className = 'cs-card';
        d.innerHTML = '<div class="hd"><span>机库' + (i + 1) + ' <span class="hSysName" style="color:#8899aa;font-weight:400"></span></span>'
            + '<span style="display:flex;gap:8px;align-items:center;font-size:0.64rem;font-weight:400;">'
            + '<label style="cursor:pointer"><input type="radio" name="csMainHangar" data-f="main" onchange="CustomShip.refresh()"' + (h._main ? ' checked' : '') + '> 设为主机库系统</label>'
            + '<span style="cursor:pointer;color:#ff6b6b" onclick="CustomShip.removeCard(this)">✕</span></span></div>'
            + '<div class="cs-fgrid">'
            + '<div><span class="lb">战机槽</span><input class="cs-input" data-f="fighter" type="number" value="' + (h.fighter || 0) + '"></div>'
            + '<div><span class="lb">护航艇槽</span><input class="cs-input" data-f="corvette" type="number" value="' + (h.corvette || 0) + '"></div>'
            + '<div><span class="lb">系统血量</span><input class="cs-input" data-f="sysHp" type="number" value="' + (h.sysHp || 2400) + '"></div>'
            + '</div>'
            + '<div class="cs-th">主机库的下面四项加成作用于本舰【全部载机】</div>'
            + '<div class="cs-fgrid">'
            + '<div><span class="lb">载机伤害强化%</span><input class="cs-input" data-f="dmg" type="number" value="' + (h.dmg || 0) + '"></div>'
            + '<div><span class="lb">载机暴击率%</span><input class="cs-input" data-f="critRate" type="number" value="' + (h.critRate || 0) + '"></div>'
            + '<div><span class="lb">载机暴击伤害%</span><input class="cs-input" data-f="critDmg" type="number" value="' + (h.critDmg || 0) + '"></div>'
            + '<div><span class="lb">载机闪避%</span><input class="cs-input" data-f="evasion" type="number" value="' + (h.evasion || 0) + '"></div>'
            + '</div>';
        return d;
    }
    function collectHangars() {
        const host = $('csHangars'); if (!host) return [];
        const out = [];
        [...host.children].forEach(row => {
            const g = f => { const el = row.querySelector('[data-f="' + f + '"]'); return el ? +el.value || 0 : 0; };
            out.push({ fighter: g('fighter'), corvette: g('corvette'), sysHp: g('sysHp') || 2400, dmg: g('dmg'), critRate: g('critRate'), critDmg: g('critDmg'), evasion: g('evasion') });
        });
        return out;
    }

    /* ---------- 表单 ↔ 数据 ---------- */
    function refill(s) {
        s = s || {};
        $('csName').value = s.name || '自定义舰船';
        $('csType').value = s.type || 'cruiser';
        $('csPos').value = s.position || '中排';
        $('csCmd').value = s.commandValue || 10;
        $('csLimit').value = s.serviceLimit || 10;
        $('csHp').value = s.hp || 50000;
        $('csPhy').value = s.physicalArmor || 5;
        $('csEng').value = s.energyArmor || 5;
        $('csSpeed').value = (s.speed && s.speed.cruise) || '500-1200';
        $('csWarp').value = (s.speed && s.speed.warp) || 2500;
        /* 解析 modules → 武器行 / 机库行 / 动力·指挥血量（兼容旧格式：单 M1 多武器、无 E/C、isCarrier 字段） */
        const W = [], H = [];
        let eHp = 2400, cHp = 2400, mainW = -1, mainH = -1;
        Object.keys(s.modules || {}).forEach(k => {
            const m = s.modules[k]; if (!m) return;
            const nm = String(m.name || '');
            if (m.type === 'engine' || /动力|引擎/.test(nm)) { eHp = m.hp || 2400; return; }
            if (m.type === 'command' || /指挥/.test(nm)) { cHp = m.hp || 2400; return; }
            if (m.type === 'hangar' || /机库|机坞/.test(nm)) {
                H.push({ fighter: 0, corvette: 0, sysHp: m.hp || 2400, dmg: 0, critRate: 0, critDmg: 0, evasion: 0, _name: nm });
                if (/主/.test(nm)) mainH = H.length - 1;
                return;
            }
            (m.weapons || []).forEach(w => {
                const _st = w.subSystemTargets ? Object.keys(w.subSystemTargets)[0] : '';
                W.push(Object.assign({}, w, { _sysHp: m.hp || s.sysHp || 2400, _main: /主武器/.test(nm),
                    _sysTarget: _st, _sysEff: (_st && w.subSystemTargets[_st]) || 'medium' }));
                if (/主武器/.test(nm) && mainW < 0) mainW = W.length - 1;
            });
            if ((m.weapons || []).length && /主武器/.test(nm) === false && mainW < 0) mainW = 0;
        });
        /* 旧格式：isCarrier + aircraftSlots → 造一条机库行 */
        if (!H.length && (s.isCarrier || (s.aircraftSlots && (s.aircraftSlots.fighter || s.aircraftSlots.corvette)))) {
            H.push({
                fighter: (s.aircraftSlots && s.aircraftSlots.fighter) || 0, corvette: (s.aircraftSlots && s.aircraftSlots.corvette) || 0,
                sysHp: 2400, dmg: s.hangarDmg || 0, critRate: s.hangarCritRate || 0, critDmg: s.hangarCritDmg || 0, evasion: s.hangarEvasion || 0
            });
            mainH = 0;
        }
        /* 主机库加成回填（新格式：主机库的名字再定位） */
        if (H.length && mainH < 0) mainH = 0;
        if (H.length && (s.hangarDmg || s.hangarCritRate || s.hangarCritDmg || s.hangarEvasion)) {
            H[mainH].dmg = s.hangarDmg || 0; H[mainH].critRate = s.hangarCritRate || 0;
            H[mainH].critDmg = s.hangarCritDmg || 0; H[mainH].evasion = s.hangarEvasion || 0;
        }
        $('csWeapons').innerHTML = '';
        (W.length ? W : [{}]).forEach((w, i) => { if (i === mainW) w._main = true; $('csWeapons').appendChild(weaponCard(w)); });
        $('csHangars').innerHTML = '';
        H.forEach((h, i) => { if (i === mainH) h._main = true; $('csHangars').appendChild(hangarRow(h)); });
        $('csEngineHp').value = eHp;
        $('csCmdHp').value = cHp;
        refresh();
    }
    /* 统一收尾：主武器/主机库的默认勾选、系统名回填、系统下拉、暴击/攻击系统的显隐 */
    function refresh() {
        const wCards = [...$('csWeapons').children];
        let mi = wCards.findIndex(c => { const r = c.querySelector('[data-f="main"]'); return r && r.checked; });
        if (mi < 0 && wCards.length) { mi = 0; const r = wCards[0].querySelector('[data-f="main"]'); if (r) r.checked = true; }
        mainWeaponIdx = mi < 0 ? 0 : mi;
        wCards.forEach((c, i) => { const n = c.querySelector('.wSysName'); if (n) n.textContent = '（' + weaponSysName(i) + '）'; });
        const hCards = [...$('csHangars').children];
        let hi = hCards.findIndex(c => { const r = c.querySelector('[data-f="main"]'); return r && r.checked; });
        if (hi < 0 && hCards.length) { hi = 0; const r = hCards[0].querySelector('[data-f="main"]'); if (r) r.checked = true; }
        mainHangarIdx = hi < 0 ? 0 : hi;
        hCards.forEach((c, i) => { const n = c.querySelector('.hSysName'); if (n) n.textContent = '（' + hangarSysName(i) + '）'; });
        /* 暴击 / 攻击系统 组的显隐 */
        wCards.forEach(c => {
            const co = c.querySelector('[data-f="critOn"]'), cb = c.querySelector('[data-f="critBox"]');
            if (co && cb) cb.style.display = co.checked ? 'flex' : 'none';
            const so = c.querySelector('[data-f="sysOn"]'), sb = c.querySelector('[data-f="sysBox"]');
            if (so && sb) sb.style.display = so.checked ? 'flex' : 'none';
        });
        refreshSysSelects();
        /* 目标行 / 系统行的序号刷新 */
        [...$('csWeapons').children].forEach(c => {
            [...c.querySelectorAll('[data-f="targets"] > .cs-card')].forEach((tr, k) => { const b = tr.querySelector('b'); if (b) b.textContent = '第' + (k + 1) + '优先'; });
            [...c.querySelectorAll('[data-f="sysRows"] > .cs-card')].forEach((sr, k) => { const b = sr.querySelector('b'); if (b) b.textContent = '第' + (k + 1) + '优先'; });
        });
    }
    function toShip(existing) {
        const type = $('csType').value;
        const weapons = collectWeapons();
        const hangars = collectHangars();
        const EFFW = { low: 'low', medium: 'medium', high: 'high' };
        const modules = {};
        weapons.forEach((w, i) => {
            const name = weaponSysName(i);
            const wep = {
                name: w.name, dmgType: w.dmgType, weaponType: w.weaponType, singleDmg: w.singleDmg,
                ammo: w.ammo, attacks: w.attacks, atkDuration: w.atkDuration, lockTime: w.lockTime,
                cooldown: w.cooldown, lockEfficiency: w.lockEfficiency,
                targets: w.targets
            };
            if (w.antiAirType) wep.antiAirType = w.antiAirType;
            if (w.crit) { wep.crit = true; wep.critRate = w.critRate || 0; wep.critDmg = w.critDmg || 0; }
            if (w.subSystemTargets) wep.subSystemTargets = w.subSystemTargets;
            modules['W' + (i + 1)] = { name: name, type: 'weapon', hp: w._sysHp || 2400, weapons: [wep] };
        });
        hangars.forEach((h, i) => {
            modules['H' + (i + 1)] = { name: hangarSysName(i), type: 'hangar', hp: h.sysHp || 2400 };
        });
        modules['E1'] = { name: '动力系统', type: 'engine', hp: +$('csEngineHp').value || 2400 };
        modules['C1'] = { name: '指挥系统', type: 'command', hp: +$('csCmdHp').value || 2400 };
        const sF = hangars.reduce((n, h) => n + (h.fighter || 0), 0);
        const sC = hangars.reduce((n, h) => n + (h.corvette || 0), 0);
        const mh = hangars[mainHangarIdx] || null;
        const isCarrier = !!(sF || sC);
        return Object.assign({}, existing || {}, {
            id: (existing && existing.id) || ('custom_' + Date.now()),
            name: $('csName').value.trim() || '自定义舰船', variant: '自定义', type: type,
            size: (type === 'fighter' || type === 'corvette') ? 'aircraft' : ((type === 'battleship' || type === 'aircraftcarrier' || type === 'battlecruiser' || type === 'support') ? 'large' : 'small'),
            position: $('csPos').value, hp: +$('csHp').value || 50000,
            physicalArmor: +$('csPhy').value || 5, energyArmor: +$('csEng').value || 5,
            commandValue: +$('csCmd').value || 10, serviceLimit: +$('csLimit').value || 10,
            speed: { cruise: $('csSpeed').value, warp: +$('csWarp').value || 2500 },
            ratings: (existing && existing.ratings) || { antiShip: 'B', antiAir: 'C', siege: 'C', survival: 'C', strategy: 'C' },
            superCapital: (type === 'battleship' || type === 'aircraftcarrier' || type === 'battlecruiser' || type === 'support'),
            isCarrier: isCarrier,
            aircraftSlots: isCarrier ? { fighter: sF, corvette: sC } : undefined,
            modules: modules,
            hangarDmg: mh ? (mh.dmg || 0) : 0,
            hangarCritRate: mh ? (mh.critRate || 0) : 0,
            hangarCritDmg: mh ? (mh.critDmg || 0) : 0,
            hangarEvasion: mh ? (mh.evasion || 0) : 0,
            _systems: (existing && existing._systems) || ['能源系统', '装甲系统', '动力系统'],
            condEffects: (existing && existing.condEffects) || []
        });
    }
    function syncToPage(ship) {
        try {
            if (typeof ALLMAP !== 'undefined' && typeof ALL !== 'undefined') {
                ALLMAP[ship.id] = ship;
                const i = ALL.findIndex(x => x.id === ship.id);
                if (i >= 0) ALL[i] = ship; else ALL.push(ship);
                if (typeof renderPickGrid === 'function' && document.getElementById('pickModal') && document.getElementById('pickModal').classList.contains('show')) renderPickGrid();
            }
        } catch (e) { }
        try {
            if (typeof SHIP_DATABASE !== 'undefined' && SHIP_DATABASE) {
                SHIP_DATABASE[ship.id] = ship;
                if (typeof refreshShipViews === 'function') refreshShipViews();
            }
        } catch (e) { }
    }

    /* ---------- 机制 ---------- */
    function renderMechs() {
        const box = $('csMechList'), cnt = $('csMechCnt');
        const s = editingId ? readAll()[editingId] : null;
        const list = (s && s.condEffects) || [];
        const onCnt = list.filter(c => c && c.on !== false).length;
        cnt.textContent = list.length ? '（共 ' + list.length + ' 条，启用 ' + onCnt + ' 条）' : '（还没有，和 AI 聊一句让它设计）';
        box.innerHTML = list.map((c, i) => {
            const off = c && c.on === false;
            return '<div class="cs-mech" style="' + (off ? 'opacity:.5;' : '') + '">'
                + '<label title="' + (off ? '已关闭：不进战斗。点它启用' : '已启用：点它关闭（不进战斗）') + '" style="display:flex;align-items:center;gap:4px;cursor:pointer;">'
                + '<input type="checkbox" ' + (off ? '' : 'checked') + ' onchange="CustomShip.toggleMech(' + i + ',this.checked)" style="accent-color:#2ed573;"></label>'
                + '<b>' + esc(c.note || ('机制' + (i + 1))) + '</b><span>' + esc(window.MechSpec ? MechSpec.line(c) : '') + '</span>'
                + '<span class="x" title="删除" onclick="CustomShip.delMech(' + i + ')">✕</span></div>';
        }).join('');
    }
    function toggleMech(i, on) {
        const all = readAll(); const s = all[editingId]; if (!s || !s.condEffects || !s.condEffects[i]) return;
        if (on) delete s.condEffects[i].on; else s.condEffects[i].on = false;
        all[editingId] = s; saveAll(all); syncToPage(s); renderMechs();
    }

    /* ---------- AI 对话 ---------- */
    function resolveLLM() {
        try {
            const cfg = JSON.parse(localStorage.getItem('lagrange_static_config') || '{}') || {};
            const models = cfg.models || [];
            if (models.length) {
                const a = models.find(m => m.id === cfg.active_model_id) || models[0];
                if (a && a.api_key) return { apiKey: a.api_key, apiUrl: (a.api_url || 'https://api.deepseek.com'), model: a.model || 'deepseek-chat' };
            }
            if (cfg.llm_api_key) return { apiKey: cfg.llm_api_key, apiUrl: cfg.llm_api_url || 'https://api.deepseek.com', model: cfg.llm_model || 'deepseek-chat' };
            if (cfg.glm_api_key) return { apiKey: cfg.glm_api_key, apiUrl: 'https://open.bigmodel.cn/api/paas/v4', model: cfg.glm_model || 'glm-4.7-flash' };
            if (cfg.glm_proxy_url) return { apiKey: 'proxy', apiUrl: cfg.glm_proxy_url, model: cfg.glm_model || 'glm-4.7-flash' };
        } catch (e) { }
        return null;
    }
    function sysPrompt(ship) {
        const MS = window.MechSpec;
        const kinds = MS ? MS.KINDS.join(' / ') : '';
        const sf = MS ? MS.SHIP_F.join(' / ') : ''; const wf = MS ? MS.WEAPON_F.join(' / ') : '';
        return '你是《无尽的拉格朗日》的【舰船机制设计师】，正在「自定义舰船」弹窗里和用户对话，给下面这艘自定义舰船设计"当X之后X"的战斗机制。\n'
            + '【当前舰船数据】' + JSON.stringify(ship) + '\n'
            + '【条件白名单 when.kind】' + kinds + '\n（可带参数：threshold/sec/rounds/dur持续秒/cd冷却秒/once仅一次/targetKind舰种）\n'
            + '【效果白名单 then】（舰船级）' + sf + '；（武器级）' + wf + '\n（数值=百分比或点数；未知字段/未知条件会被拒绝）\n'
            + '【规则】①一条机制只做一件事，复杂技能拆成多条；②数值按本舰量级给（先算这笔加成值多少）；③克制，不要"开场无敌"。\n'
            + '【什么时候才输出 json】★只有当用户【明确要求设计/修改机制】、或【明确同意你的提议】时才输出 json；用户只是打招呼、闲聊、问问题 → 正常文字回复。**用户没有明确说明机制时，你连设计都不做**（不输出 json、不提议、不写）。\n'
            + '【启用开关】机制条目可带 "on": true/false（默认启用；false = 先写好但不生效）。改清单时输出整份最新清单，并沿用没改到的条目的 on 状态。\n'
            + '【写入方式】确定方案后在回复末尾输出 json 代码块；页面**不会直接写入**，先展示提议，用户点「✅ 写入」才生效：\n'
            + '```json\n{"mechanics":[{"when":{"kind":"hpBelow","threshold":50,"dur":10,"cd":25},"then":{"dmgBonus":30},"note":"半血狂暴"}]}\n```';
    }
    function renderChat() {
        const box = $('csChat');
        box.innerHTML = chatMsgs.map(m =>
            m.role === 'user' ? '<div class="cs-m-u">你：' + esc(m.content) + '</div>'
                : m.role === 'sys' ? '<div class="cs-m-s">' + esc(m.content) + '</div>'
                    : m.role === 'pending' ? '<div class="cs-m-s">⏳ ' + esc(m.content)
                        + '<br><button class="cs-btn pri" style="margin-top:4px" onclick="CustomShip.applyPending()">✅ 写入</button> '
                        + '<button class="cs-btn" style="margin-left:4px" onclick="CustomShip.discardPending()">✕ 忽略</button></div>'
                        : '<div class="cs-m-a">🤖 ' + esc(m.content) + '</div>').join('');
        box.scrollTop = box.scrollHeight;
    }
    function _sig(c) { try { return JSON.stringify({ c: c.cond || {}, s: c.stat, v: c.val }); } catch (e) { return ''; } }
    function _carryOn(built, id) {
        const all = readAll(); const s = all[id || editingId] || {};
        const offSet = {};
        (s.condEffects || []).forEach(c => { if (c && c.on === false) offSet[_sig(c)] = 1; });
        return built.map(c => { const o = Object.assign({}, c); if (offSet[_sig(o)]) o.on = false; else delete o.on; return o; });
    }
    function applyPending() {
        if (!pending) return;
        const all = readAll(); const s = all[pending.id];
        if (!s) { chatMsgs = chatMsgs.filter(m => m.role !== 'pending'); chatMsgs.push({ role: 'sys', content: '⚠️ 目标舰船不存在了，未写入' }); renderChat(); pending = null; return; }
        s.condEffects = _carryOn(pending.built, pending.id);
        all[pending.id] = s; saveAll(all); syncToPage(s); renderMechs();
        chatMsgs = chatMsgs.filter(m => m.role !== 'pending');
        chatMsgs.push({ role: 'sys', content: '✅ 已写入 ' + s.condEffects.length + ' 条机制（整份清单替换；每条可单独开关）' + (pending.rejected && pending.rejected.length ? '；被拒 ' + pending.rejected.length + ' 条：' + pending.rejected.join('；') : '') });
        pending = null;
        try { localStorage.setItem(CHAT(editingId), JSON.stringify(chatMsgs.slice(-40))); } catch (e) { }
        renderChat();
    }
    function discardPending() {
        if (!pending) return;
        pending = null;
        chatMsgs = chatMsgs.filter(m => m.role !== 'pending');
        chatMsgs.push({ role: 'sys', content: '（已忽略这次机制提议，未写入）' });
        try { localStorage.setItem(CHAT(editingId), JSON.stringify(chatMsgs.slice(-40))); } catch (e) { }
        renderChat();
    }
    async function send() {
        const ta = $('csChatInput'); const text = (ta.value || '').trim(); if (!text) return;
        if (!editingId) { chatMsgs.push({ role: 'sys', content: '⚠️ 请先点「💾 保存舰船」，再让 AI 设计机制。' }); renderChat(); return; }
        const llm = resolveLLM();
        if (!llm) { chatMsgs.push({ role: 'sys', content: '⚠️ 没有可用的模型 Key——先去「⚙️ 设置」配一个。' }); renderChat(); return; }
        ta.value = ''; chatMsgs.push({ role: 'user', content: text }); renderChat();
        chatMsgs.push({ role: 'sys', content: '⏳ 思考中…' }); renderChat();
        const all = readAll(); const ship = all[editingId] || {};
        try {
            let base = String(llm.apiUrl || '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
            if (!/\/v\d+$/.test(base)) base += '/v1';
            const msgs = [{ role: 'system', content: sysPrompt(ship) }]
                .concat(chatMsgs.filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'model').map(m => ({ role: m.role === 'model' ? 'assistant' : m.role, content: m.content })));
            let thinkOn = true;
            try { const cfg = JSON.parse(localStorage.getItem('lagrange_static_config') || '{}'); thinkOn = (cfg.thinking_on !== false); } catch (e) { }
            const isDS = /deepseek/i.test(llm.apiUrl);
            const attempts = [[4000, thinkOn], [12000, thinkOn], [12000, false]];
            let out = '', lastErr = '';
            for (let ai = 0; ai < attempts.length; ai++) {
                const maxTok = attempts[ai][0], useThink = attempts[ai][1];
                const body = { model: llm.model, messages: msgs, temperature: 0.5, max_tokens: maxTok };
                if (isDS && !useThink) body.thinking = { type: 'disabled' };
                let r = null;
                try {
                    r = await fetch(base + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + llm.apiKey }, body: JSON.stringify(body) });
                } catch (e) { lastErr = '网络不通：' + String(e.message || e); break; }
                if (!r.ok) {
                    const t = String(await r.text()).slice(0, 140);
                    lastErr = 'HTTP ' + r.status + ' ' + t;
                    if (r.status === 429) break;
                    continue;
                }
                const j = await r.json();
                const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
                out = String(msg.content || '').trim();
                if (out) break;
                const fin = (j.choices && j.choices[0] && j.choices[0].finish_reason) || '';
                lastErr = '模型返回为空（finish=' + fin + '，思考 ' + String(msg.reasoning_content || '').length + ' 字）——已自动加大预算重试';
            }
            if (!out) throw new Error(lastErr || '模型返回为空');
            const blocks = [...out.matchAll(/```json\s*([\s\S]*?)```/g)];
            if (blocks.length) {
                const lastUser = String((chatMsgs.filter(m => m.role === 'user').pop() || {}).content || '');
                const MECH_WORDS = ['机制', '技能', '特效', '效果', '加成', '设计', '加一条', '加个', '改', '删', '去掉', '开关', '启用', '关闭', '暴力', '狂暴'];
                const asked = MECH_WORDS.some(w => lastUser.indexOf(w) >= 0);
                if (!asked) {
                    blocks.length = 0;
                    chatMsgs.push({ role: 'sys', content: '（你这次没有要求设计/修改机制，AI 给出的机制内容已自动忽略。要设计就说「给这艘船设计一条XX机制」。）' });
                }
            }
            let shown = out.replace(/```json[\s\S]*?```/g, '').trim();
            chatMsgs = chatMsgs.filter(m => m.content !== '⏳ 思考中…');
            if (blocks.length) {
                let wrote = false;
                for (const b of blocks) {
                    let spec = null; try { spec = JSON.parse(b[1]); } catch (e) { chatMsgs.push({ role: 'sys', content: '⚠️ AI 输出的 JSON 解析失败（已忽略）：' + String(e.message).slice(0, 80) }); continue; }
                    const arr = (spec && spec.mechanics) || (Array.isArray(spec) ? spec : null);
                    if (!arr) { chatMsgs.push({ role: 'sys', content: '⚠️ JSON 里没有 mechanics 数组（已忽略）' }); continue; }
                    const res = window.MechSpec ? MechSpec.build(arr) : { built: [], rejected: ['MechSpec 未加载'] };
                    if (res.built.length) {
                        pending = { id: editingId, built: res.built, rejected: res.rejected };
                        chatMsgs = chatMsgs.filter(m => m.role !== 'pending');
                        chatMsgs.push({ role: 'pending', content: 'AI 提议写入 ' + res.built.length + ' 条机制：\n' + res.built.map(c => '· ' + (c.note || '') + (MechSpec ? MechSpec.line(c) : '')).join('\n') + (res.rejected.length ? '\n⚠️ 被拒 ' + res.rejected.length + ' 条：' + res.rejected.join('；') : '') });
                        wrote = true;
                    } else if (res.rejected.length) {
                        chatMsgs.push({ role: 'sys', content: '⚠️ 这份机制全部被拒（未写入）：' + res.rejected.join('；') });
                    }
                }
                if (!wrote) { /* 上面已提示 */ }
            }
            if (shown) chatMsgs.push({ role: 'assistant', content: shown });
            try { localStorage.setItem(CHAT(editingId), JSON.stringify(chatMsgs.slice(-40))); } catch (e) { }
            renderChat();
        } catch (e) {
            chatMsgs = chatMsgs.filter(m => m.content !== '⏳ 思考中…');
            chatMsgs.push({ role: 'sys', content: '❌ 请求失败：' + String(e.message || e).slice(0, 150) });
            renderChat();
        }
    }

    /* ---------- 打开/关闭/保存/删除 ---------- */
    function open(id) {
        inject();
        editingId = id || null;
        const all = readAll(); const s = editingId ? all[editingId] : null;
        if (id && !s) { alert('这艘自定义舰船不存在（可能已被删除）'); editingId = null; }
        refill(s || {});
        $('csSubTitle').textContent = editingId ? ('编辑中：' + (s.name || editingId)) : '（新船：填好点「保存舰船」后，右边的 AI 才能给它写机制）';
        $('csDelBtn').style.display = editingId ? '' : 'none';
        try { chatMsgs = editingId ? (JSON.parse(localStorage.getItem(CHAT(editingId)) || '[]') || []) : []; } catch (e) { chatMsgs = []; }
        if (!chatMsgs.length) chatMsgs.push({ role: 'sys', content: '和我说「给这艘船设计一条XX机制」就行；想改就说「把第2条冷却改成30秒」。我按白名单设计、**先给你看提议，你点「✅ 写入」才生效**；每条机制都能单独开关。' });
        renderChat(); renderMechs(); renderList();
        $('customShipOverlay').classList.add('show');
    }
    function close() { $('customShipOverlay').classList.remove('show'); }
    function newShip() { open(); }

    function save() {
        const name = ($('csName').value || '').trim();
        if (!name) { alert('先填舰船名称'); return; }
        const all = readAll();
        if (!editingId) {
            const dup = Object.keys(all).find(k => all[k] && all[k].name === name);
            if (dup) editingId = dup;
        }
        const existing = editingId ? all[editingId] : null;
        const ship = toShip(existing);
        if (!editingId) editingId = ship.id;
        all[editingId] = ship; saveAll(all); syncToPage(ship);
        $('csSubTitle').textContent = '编辑中：' + ship.name;
        $('csDelBtn').style.display = '';
        renderMechs(); renderList();
        chatMsgs.push({ role: 'sys', content: '✅ 已保存「' + ship.name + '」（' + Object.keys(ship.modules).length + ' 个系统，' + (ship.condEffects || []).length + ' 条机制）。配队页/模拟器里现在就能用。' });
        renderChat();
        try { localStorage.setItem(CHAT(editingId), JSON.stringify(chatMsgs.slice(-40))); } catch (e) { }
    }
    function del() {
        if (!editingId) return;
        const s = readAll()[editingId] || {};
        if (!confirm('删除自定义舰船「' + (s.name || editingId) + '」？')) return;
        const all = readAll(); delete all[editingId]; saveAll(all);
        try { localStorage.removeItem(CHAT(editingId)); } catch (e) { }
        try { if (typeof ALL !== 'undefined') { const i = ALL.findIndex(x => x.id === editingId); if (i >= 0) ALL.splice(i, 1); } if (typeof ALLMAP !== 'undefined') delete ALLMAP[editingId]; if (typeof renderPickGrid === 'function') renderPickGrid(); } catch (e) { }
        editingId = null; open();
    }
    function delMech(i) {
        const all = readAll(); const s = all[editingId]; if (!s || !s.condEffects) return;
        s.condEffects.splice(i, 1); all[editingId] = s; saveAll(all); syncToPage(s); renderMechs();
    }
    function clearMechs() {
        const all = readAll(); const s = all[editingId]; if (!s || !(s.condEffects || []).length) return;
        if (!confirm('清空「' + (s.name || '') + '」的全部机制？')) return;
        s.condEffects = []; all[editingId] = s; saveAll(all); syncToPage(s); renderMechs();
    }
    function addWeapon() { $('csWeapons').appendChild(weaponCard({})); refresh(); }
    function addHangar() { $('csHangars').appendChild(hangarRow({})); refresh(); }
    /* 删除整张卡片（武器/机库/目标行）——用函数而不是内联 closest，避免引号转义问题 */
    function removeCard(el) { try { const c = el.closest('.cs-card'); if (c) c.remove(); refresh(); } catch (e) { } }
    function delTargetRow(el) {
        try {
            const c = el.closest('.cs-card'); if (!c) return;
            const tb = c.parentElement; c.remove();
            [...tb.children].forEach((tr, k) => { const b = tr.querySelector('b'); if (b) b.textContent = '第' + (k + 1) + '优先'; });
            if (tb && tb.dataset && tb.dataset.f === 'targets' && tb.children.length === 0) tb.appendChild(targetRow(null, 0));
            refresh();
        } catch (e) { }
    }
    function addSysRow(btn) {
        const card = btn.closest('.cs-card');
        const box = card.querySelector('[data-f="sysRows"]');
        box.appendChild(sysRow('动力系统', 'medium', box.children.length));
        refresh();
    }
    function delSysRow(el) {
        try {
            const c = el.closest('.cs-card'); const box = c.parentElement;
            c.remove();
            [...box.children].forEach((r, k) => { const b = r.querySelector('b'); if (b) b.textContent = '第' + (k + 1) + '优先'; });
            if (box && box.dataset && box.dataset.f === 'sysRows' && box.children.length === 0) box.appendChild(sysRow('动力系统', 'medium', 0));
            refresh();
        } catch (e) { }
    }
    function addTargetRow(btn) {
        const card = btn.closest('.cs-card');
        const box = card.querySelector('[data-f="targets"]');
        box.appendChild(targetRow(null, box.children.length));
        refresh();
    }

    return {
        open: open, close: close, newShip: newShip, save: save, del: del,
        delMech: delMech, toggleMech: toggleMech, clearMechs: clearMechs,
        addWeapon: addWeapon, addHangar: addHangar, addTargetRow: addTargetRow, delTargetRow: delTargetRow, addSysRow: addSysRow, delSysRow: delSysRow, removeCard: removeCard, refresh: refresh,
        applyPending: applyPending, discardPending: discardPending, send: send
    };
})();
