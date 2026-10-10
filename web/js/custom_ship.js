/* ============================================================
   CustomShip —— 「战舰配队」页里的【自定义舰船】弹窗（2026-10-07）
   ------------------------------------------------------------
   功能：①新建/编辑/删除自定义舰船（写入 localStorage 'lagrange_custom_ships'，配队页即时可用）
        ②页内与 AI 对话设计"当X之后X"机制（AI 输出 ```json 代码块 → MechSpec 校验 → 写入并展示）
        ③机制清单展示 + 单条删除 + 清空
   依赖：js/mech_spec.js（白名单）；页面里的 ALL/ALLMAP/renderPickGrid（fleet.html 顶层 let/function，
        同页脚本可直接访问；不存在时全部走 try 兜底）
   暴露：window.CustomShip.open(id?) / .close()
   ============================================================ */
window.CustomShip = (function () {
    const LS = 'lagrange_custom_ships';
    const CHAT = id => 'lglr_cs_chat_' + id;
    let built = false, editingId = null, chatMsgs = [], imgWeapons = [];

    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const readAll = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } };
    const saveAll = o => localStorage.setItem(LS, JSON.stringify(o));

    function inject() {
        if (built) return; built = true;
        const css = document.createElement('style');
        /* ★ 自带样式（不依赖具体页面的 .overlay/.modal）——配队页与模拟器页都能用 */
        css.textContent = '.cs-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:3000;display:none;align-items:flex-start;justify-content:center;overflow:auto;padding:18px 10px 70px}'
            + '.cs-overlay.show{display:flex}'
            + '.cs-modal{background:#0f1626;border:1px solid #2d4a6f;border-radius:14px;max-width:1080px;width:100%;padding:14px;color:#dbe6f5;font-size:0.75rem}'
            + '.cs-input{width:100%;background:#0b1220;border:1px solid #2d4a6f;border-radius:6px;color:#dbe6f5;padding:4px 6px;font-size:0.7rem;font-family:inherit}'
            + '.cs-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;font-size:0.68rem}'
            + '.cs-grid label{display:block;color:#8899aa;margin-bottom:1px}'
            + '.cs-cols{display:flex;gap:12px;align-items:flex-start}'
            + '.cs-col{flex:1;min-width:0}.cs-col.left{flex:1.15}'
            + '@media(max-width:900px){.cs-cols{flex-direction:column}.cs-grid{grid-template-columns:repeat(2,1fr)}}'
            + '.cs-wcard{background:#0b1220;border:1px solid #2d4a6f;border-radius:6px;padding:6px;margin-bottom:6px}'
            + '.cs-wrow{display:grid;grid-template-columns:1.4fr .7fr .7fr .7fr .7fr .7fr .5fr .5fr .6fr .6fr .8fr 22px;gap:3px;margin-bottom:3px;align-items:center}'
            + '.cs-wrow input,.cs-wrow select{background:#0b1220;border:1px solid #2d4a6f;border-radius:4px;color:#dbe6f5;font-size:0.62rem;padding:2px 3px;width:100%}'
            + '.cs-chat{height:240px;overflow-y:auto;background:#0b1220;border:1px solid #2d4a6f;border-radius:8px;padding:8px;font-size:0.7rem;line-height:1.6}'
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
            + '.cs-btn.gold{color:#ffd700;border-color:#ffd700}';
        document.head.appendChild(css);

        const el = document.createElement('div');
        el.className = 'cs-overlay'; el.id = 'customShipOverlay';
        el.innerHTML =
            '<div class="cs-modal">'
            + '<h3 style="font-size:0.92rem;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">'
            + '<span>⚙️ 自定义舰船管理 <span id="csSubTitle" style="font-size:0.68rem;color:#8899aa"></span></span>'
            + '<span style="cursor:pointer;padding:0 6px" onclick="CustomShip.close()">✕</span></h3>'
            /* ★ 管理条：已有自定义舰船列表（点=编辑）+ 新建 */
            + '<div style="margin-bottom:10px;padding:6px 8px;background:#0b1220;border:1px solid #2d4a6f;border-radius:8px;">'
            + '<span style="color:#8899aa;font-size:0.66rem;margin-right:6px;">已有自定义舰船（点击编辑）：</span><span id="csList"></span>'
            + '<button class="cs-btn pri" style="margin-left:6px" onclick="CustomShip.newShip()">➕ 新建</button>'
            + '</div>'
            + '<div class="cs-cols">'
            /* 左：数据表单 */
            + '<div class="cs-col left">'
            + '<div class="cs-grid">'
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
            + '<div><label><input type="checkbox" id="csCarrier"> 可搭载舰载机</label></div>'
            + '<div><label>战机槽</label><input class="cs-input" id="csSlotsF" type="number" value="2"></div>'
            + '<div><label>护航艇槽</label><input class="cs-input" id="csSlotsC" type="number" value="2"></div>'
            + '</div>'
            + '<div style="margin-top:8px;font-size:0.7rem;"><b>⚔️ 武器</b> <button class="cs-btn" style="margin-left:6px" onclick="CustomShip.addWeapon()">+ 添加武器</button> <span style="color:#8899aa;font-size:0.62rem">（单发/冷却/锁定/持续 单位秒；命中填 min~max）</span></div>'
            + '<div id="csWeapons" style="margin-top:4px"></div>'
            + '<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">'
            + '<button class="cs-btn pri" onclick="CustomShip.save()">💾 保存舰船</button>'
            + '<button class="cs-btn red" id="csDelBtn" style="display:none" onclick="CustomShip.del()">🗑 删除这艘</button>'
            + '</div>'
            + '</div>'
            /* 右：AI 对话 + 机制 */
            + '<div class="cs-col">'
            + '<div style="font-size:0.75rem;font-weight:600;margin-bottom:4px">🤖 机制设计 AI <span style="color:#8899aa;font-size:0.62rem">（先「保存舰船」，再和它聊；它会按《战斗机制.md》白名单设计"当X之后X"并直接写入）</span></div>'
            + '<div class="cs-chat" id="csChat"></div>'
            + '<div style="display:flex;gap:6px;margin-top:6px">'
            + '<textarea id="csChatInput" rows="2" class="cs-input" placeholder="例：给这艘船设计一条"半血狂暴"机制；或：把第2条改成冷却30秒" style="resize:vertical"></textarea>'
            + '<button class="cs-btn cyan" style="flex:0 0 auto" onclick="CustomShip.send()">发送</button>'
            + '</div>'
            + '<div style="margin-top:8px;font-size:0.72rem;font-weight:600">📋 当前机制 <span style="color:#8899aa;font-size:0.62rem" id="csMechCnt"></span> <button class="cs-btn red" style="font-size:0.6rem;padding:2px 6px" onclick="CustomShip.clearMechs()">清空全部</button></div>'
            + '<div id="csMechList" style="max-height:180px;overflow-y:auto"></div>'
            + '</div>'
            + '</div></div>';
        document.body.appendChild(el);
    }
    /* 管理条：列出全部自定义舰船（当前编辑中的高亮） */
    function renderList() {
        const box = $('csList'); if (!box) return;
        const all = readAll(); const ids = Object.keys(all);
        box.innerHTML = ids.length
            ? ids.map(id => '<span class="cs-chip' + (id === editingId ? ' on' : '') + '" onclick="CustomShip.open(\'' + id + '\')">' + esc((all[id] && all[id].name) || id) + '</span>').join('')
            : '<span style="color:#5a7a9a;font-size:0.66rem">（还没有，点右边「➕ 新建」造一艘）</span>';
    }

    /* ---------- 表单 ↔ 数据 ---------- */
    /* ★ 2026-10-07（用户反馈）：武器字段"填写不明确"→ 改成带标签的网格 + 字段含义提示；
       并按引擎口径补齐【武器类型：直射/投射】、【优先目标：三选一】、【暴击】、【防空类型】。 */
    const PTYPES = [['小型舰船', '小型舰船'], ['大型舰船', '大型舰船'], ['舰载机', '舰载机']];
    function weaponRow(w) {
        w = w || {};
        const t0 = (w.targets && w.targets[0]) || {};
        const prio = (t0.types && t0.types[0]) || '小型舰船';
        const d = document.createElement('div');
        d.className = 'cs-wcard';
        const opt = (v, t, cur) => '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + t + '</option>';
        d.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">'
            + '<b style="font-size:0.68rem;">武器</b>'
            + '<span class="x" title="删除这条武器" style="cursor:pointer;color:#ff6b6b" onclick="this.closest(\'.cs-wcard\').remove()">✕</span></div>'
            + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;font-size:0.64rem;">'
            + '<div>名称<input class="cs-input" data-f="name" value="' + esc(w.name || '主武器') + '"></div>'
            + '<div>伤害类型<select class="cs-input" data-f="dmgType">' + opt('physical', '实弹', w.dmgType) + opt('energy', '能量', w.dmgType) + '</select></div>'
            + '<div>武器类型<select class="cs-input" data-f="weaponType" title="直射：不会被拦截，但受阵型阻挡（离子炮/轨道炮/脉冲多为直射）；投射：可被敌方拦截（导弹/鱼雷/无人机）">' + opt('direct', '直射', w.weaponType) + opt('projectile', '投射', w.weaponType) + '</select></div>'
            + '<div>优先目标<select class="cs-input" data-f="priority">' + PTYPES.map(p => opt(p[0], p[1], prio)).join('') + '</select></div>'
            + '<div>单发伤害<input class="cs-input" data-f="singleDmg" type="number" value="' + (w.singleDmg || 1000) + '" title="一次开火、每一发的伤害"></div>'
            + '<div>弹药数<input class="cs-input" data-f="ammo" type="number" value="' + (w.ammo || 1) + '" title="一轮攻击打几发"></div>'
            + '<div>攻击轮次<input class="cs-input" data-f="attacks" type="number" value="' + (w.attacks || 1) + '" title="一轮攻击里攻击几次"></div>'
            + '<div>攻击持续(s)<input class="cs-input" data-f="atkDuration" type="number" value="' + (w.atkDuration || 0) + '" title="一轮开火持续几秒"></div>'
            + '<div>锁定时间(s)<input class="cs-input" data-f="lockTime" type="number" value="' + (w.lockTime || 4) + '"></div>'
            + '<div>冷却时间(s)<input class="cs-input" data-f="cooldown" type="number" value="' + (w.cooldown || 6) + '" title="一轮打完到下一轮开始之间的冷却"></div>'
            + '<div>锁定效率%<input class="cs-input" data-f="lockEfficiency" type="number" value="' + (w.lockEfficiency || 10) + '" title="影响换目标后的锁定速度（1~200）"></div>'
            + '<div>防空类型<select class="cs-input" data-f="antiAirType">' + opt('', '无', w.antiAirType || '') + opt('counter', '反击防空', w.antiAirType) + opt('area', '区域防空', w.antiAirType) + '</select></div>'
            + '<div>命中min%<input class="cs-input" data-f="hitMin" type="number" value="' + (t0.hitMin || 60) + '" title="对该类目标的命中率下限"></div>'
            + '<div>命中max%<input class="cs-input" data-f="hitMax" type="number" value="' + (t0.hitMax || 80) + '" title="命中率上限（引擎把命中钳在 10~95%）"></div>'
            + '<div style="display:flex;align-items:end;"><label style="display:flex;gap:4px;align-items:center;"><input type="checkbox" data-f="crit"' + (w.crit ? ' checked' : '') + '> 暴击</label></div>'
            + '</div>';
        return d;
    }
    function collectWeapons() {
        const host = $('csWeapons'); if (!host) return [];
        const out = [];
        [...host.querySelectorAll('.cs-wcard')].forEach(row => {
            const g = f => { const el = row.querySelector('[data-f="' + f + '"]'); return el ? el.value : ''; };
            const name = String(g('name')).trim(); if (!name) return;
            out.push({
                name: name, dmgType: g('dmgType') || 'physical', weaponType: g('weaponType') || 'direct',
                singleDmg: +g('singleDmg') || 1, ammo: +g('ammo') || 1, attacks: +g('attacks') || 1,
                atkDuration: +g('atkDuration') || 0, lockTime: +g('lockTime') || 4, cooldown: +g('cooldown') || 6,
                lockEfficiency: +g('lockEfficiency') || 10, priority: 'small',
                crit: !!row.querySelector('[data-f="crit"]:checked'),
                antiAirType: g('antiAirType') || undefined,
                targets: [{ types: [g('priority') || '小型舰船'], hitMin: +g('hitMin') || 60, hitMax: +g('hitMax') || 80 }]
            });
        });
        return out;
    }
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
        $('csCarrier').checked = !!s.isCarrier;
        $('csSlotsF').value = (s.aircraftSlots && s.aircraftSlots.fighter) || 2;
        $('csSlotsC').value = (s.aircraftSlots && s.aircraftSlots.corvette) || 2;
        const host = $('csWeapons'); host.innerHTML = '';
        const ws = [];
        Object.values(s.modules || {}).forEach(m => (m && m.weapons || []).forEach(w => ws.push(w)));
        (ws.length ? ws : [{}]).forEach(w => host.appendChild(weaponRow(w)));
    }
    function toShip(existing) {
        const type = $('csType').value;
        const weapons = collectWeapons();
        const isCarrier = $('csCarrier').checked;
        const id = (existing && existing.id) || ('custom_' + Date.now());
        return Object.assign({}, existing || {}, {
            id: id, name: $('csName').value.trim() || '自定义舰船', variant: '自定义', type: type,
            size: (type === 'fighter' || type === 'corvette') ? 'aircraft' : ((type === 'battleship' || type === 'aircraftcarrier' || type === 'battlecruiser' || type === 'support') ? 'large' : 'small'),
            position: $('csPos').value, hp: +$('csHp').value || 50000,
            physicalArmor: +$('csPhy').value || 5, energyArmor: +$('csEng').value || 5,
            commandValue: +$('csCmd').value || 10, serviceLimit: +$('csLimit').value || 10,
            speed: { cruise: $('csSpeed').value, warp: +$('csWarp').value || 2500 },
            ratings: (existing && existing.ratings) || { antiShip: 'B', antiAir: 'C', siege: 'C', survival: 'C', strategy: 'C' },
            superCapital: (type === 'battleship' || type === 'aircraftcarrier' || type === 'battlecruiser' || type === 'support'),
            isCarrier: isCarrier,
            aircraftSlots: isCarrier ? { fighter: +$('csSlotsF').value || 2, corvette: +$('csSlotsC').value || 2 } : undefined,
            modules: weapons.length ? { M1: { name: '主武器系统', type: 'weapon', weapons: weapons } } : {},
            _systems: (existing && existing._systems) || ['能源系统', '装甲系统', '动力系统'],
            condEffects: (existing && existing.condEffects) || []
        });
    }
    function syncToPage(ship) {
        /* 配队页：ALL/ALLMAP（选船弹窗立即可选） */
        try {
            if (typeof ALLMAP !== 'undefined' && typeof ALL !== 'undefined') {
                ALLMAP[ship.id] = ship;
                const i = ALL.findIndex(x => x.id === ship.id);
                if (i >= 0) ALL[i] = ship; else ALL.push(ship);
                if (typeof renderPickGrid === 'function' && document.getElementById('pickModal') && document.getElementById('pickModal').classList.contains('show')) renderPickGrid();
            }
        } catch (e) { }
        /* 模拟器页：SHIP_DATABASE + 视图刷新（不必刷新页面就能选到新船/新机制） */
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
        const all = readAll(), s = editingId ? all[editingId] : null;
        const list = (s && s.condEffects) || [];
        const onCnt = list.filter(c => c && c.on !== false).length;
        cnt.textContent = list.length ? '（共 ' + list.length + ' 条，启用 ' + onCnt + ' 条）' : '（还没有，和 AI 聊一句让它设计）';
        box.innerHTML = list.map((c, i) => {
            const off = c && c.on === false;
            return '<div class="cs-mech" style="' + (off ? 'opacity:.5;' : '') + '">'
                + '<label title="' + (off ? '已关闭：不进战斗。点它启用' : '已启用：点它关闭（不进战斗）') + '" style="display:flex;align-items:center;gap:4px;cursor:pointer;">'
                + '<input type="checkbox" ' + (off ? '' : 'checked') + ' onchange="CustomShip.toggleMech(' + i + ',this.checked)" style="accent-color:#2ed573;">'
                + '</label>'
                + '<b>' + esc(c.note || ('机制' + (i + 1))) + '</b><span>' + esc(window.MechSpec ? MechSpec.line(c) : '') + '</span>'
                + '<span class="x" title="删除" onclick="CustomShip.delMech(' + i + ')">✕</span></div>';
        }).join('');
    }
    /* ★ 2026-10-07：单条机制的开/关（关掉的不进战斗） */
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
        const kinds = MS ? MS.KINDS.join(' / ') : 'hpBelow / enemyHpBelow / battleStart / battleStartSec / firstRounds / everySec / everyRounds / onAttacked / onEnemyLoss / onKill / onTargetType';
        const sf = MS ? MS.SHIP_F.join(' / ') : ''; const wf = MS ? MS.WEAPON_F.join(' / ') : '';
        return '你是《无尽的拉格朗日》的【舰船机制设计师】，现在正在「战舰配队 → 自定义舰船」页面里和用户对话，给下面这艘自定义舰船设计"当X之后X"的战斗机制（会被写进战斗引擎的条件触发系统，开战生效）。\n'
            + '【当前舰船数据】' + JSON.stringify(ship) + '\n'
            + '【条件白名单 when.kind】' + kinds + '\n（可带参数：threshold/threshold%/sec秒/rounds轮/dur持续秒/cd冷却秒/once仅一次/targetKind舰种）\n'
            + '【效果白名单 then】（舰船级）' + sf + '；（武器级）' + wf + '\n（数值=百分比或点数；未知字段/未知条件会被拒绝，绝不要用白名单外的键）\n'
            + '【规则】①一条机制只做一件事，复杂技能拆成多条（when 可相同）；②数值要按舰船本体的量级给（先算这笔加成值多少，再定值），常驻型给半档、触发型可给整档；③克制，不要"开场无敌"；④先给设计思路（1~3 句），再给机制。\n'
            + '【什么时候才输出 json】★只有当用户【明确要求设计/修改机制】、或【明确同意你的提议】时才输出 json；用户只是打招呼、闲聊、问问题 → 正常文字回复（可用一句话介绍你能做什么）。**用户没有明确说明机制时，你连设计都不做：不输出 json、不提议、不写任何机制**（页面也会把这种 json 直接忽略）。\n'
            + '【启用开关】机制条目可带 \"on\": true/false（默认启用；false = 先写好但不生效，用户可在清单里随时开关）。用户让你改清单时，请输出整份最新清单，并【沿用】没改到的条目的 on 状态。\n'
            + '【写入方式】确定方案后，在回复末尾输出 json 代码块；页面**不会直接写入**，而是先展示提议，等用户点「✅ 写入」才生效（被拒的会回显，你再修正）：\n'
            + '```json\n{"mechanics":[{"when":{"kind":"hpBelow","threshold":50,"dur":10,"cd":25},"then":{"dmgBonus":30},"note":"半血狂暴"}]}\n```\n'
            + '用户说"改第N条/删掉/再加一条"时，用 replace 语义输出【整份最新机制清单】（把你想要的最终状态全部列出），页面会整体替换。';
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
    /* ★ 2026-10-07：AI 提议 → 用户点「写入」才落库（不再自动写） */
    let pending = null;
    function _sig(c) { try { return JSON.stringify({ c: c.cond || {}, s: c.stat, v: c.val }); } catch (e) { return ''; } }
    function _carryOn(built, id) {
        const all = readAll(); const s = all[id || editingId] || {};
        const old = s.condEffects || [];
        const offSet = {};
        old.forEach(c => { if (c && c.on === false) offSet[_sig(c)] = 1; });
        return built.map(c => { const o = Object.assign({}, c); if (offSet[_sig(o)]) o.on = false; else delete o.on; return o; });
    }
    function applyPending() {
        if (!pending) return;
        const all = readAll(); const s = all[pending.id];
        if (!s) { chatMsgs = chatMsgs.filter(m => m.role !== 'pending'); chatMsgs.push({ role: 'sys', content: '⚠️ 目标舰船不存在了，未写入' }); renderChat(); pending = null; return; }
        s.condEffects = _carryOn(pending.built, pending.id);
        all[pending.id] = s; saveAll(all); syncToPage(s); renderMechs();
        chatMsgs = chatMsgs.filter(m => m.role !== 'pending');
        chatMsgs.push({ role: 'sys', content: '✅ 已写入 ' + s.condEffects.length + ' 条机制（整份清单替换；可用每条的开关单独启停）' + (pending.rejected && pending.rejected.length ? '；被拒 ' + pending.rejected.length + ' 条：' + pending.rejected.join('；') : '') });
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
        if (!editingId) { chatMsgs.push({ role: 'sys', content: '⚠️ 请先点左边「💾 保存舰船」（新船先保存），再让 AI 设计机制。' }); renderChat(); return; }
        const llm = resolveLLM();
        if (!llm) { chatMsgs.push({ role: 'sys', content: '⚠️ 没有可用的模型 Key——先去「⚙️ 设置」配一个（自定义模型或智谱 GLM）。' }); renderChat(); return; }
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
            /* ★ 2026-10-07：推理模型「思考吃光 token → 正文为空」是这里最常见的失败。
               预算阶梯重试：4000 → 12000 → 12000 + 强制关思考（DeepSeek 传 thinking:disabled，其它厂商不受影响）。 */
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
                    if (r.status === 429) break;                     // 限流：不再空转，交给用户重试
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
            /* 提取 json 代码块 → 校验 → 写入（整体替换语义） */
            const blocks = [...out.matchAll(/```json\s*([\s\S]*?)```/g)];
            /* ★ 2026-10-07（用户要求）：用户"没有明确说明机制"时，不让他做——
               最近一条用户消息里没有机制相关词 → 丢弃 json（不显示提议卡），并说明原因。 */
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
                        /* ★ 2026-10-07：改成【提议】——点「✅ 写入」才落库（避免"只说你好也被写机制"） */
                        pending = { id: editingId, built: res.built, rejected: res.rejected };
                        chatMsgs = chatMsgs.filter(m => m.role !== 'pending');
                        chatMsgs.push({ role: 'pending', content: 'AI 提议写入 ' + res.built.length + ' 条机制：\n' + res.built.map(c => '· ' + (c.note || '') + (MechSpec ? MechSpec.line(c) : '')).join('\n') + (res.rejected.length ? '\n⚠️ 被拒 ' + res.rejected.length + ' 条：' + res.rejected.join('；') : '') });
                        wrote = true;
                    } else if (res.rejected.length) {
                        chatMsgs.push({ role: 'sys', content: '⚠️ 这份机制全部被拒（未写入）：' + res.rejected.join('；') });
                    }
                }
                if (!wrote) { /* 解析失败/全被拒：上面已提示 */ }
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
            if (dup) { editingId = dup; }
        }
        const existing = editingId ? all[editingId] : null;
        const ship = toShip(existing);
        if (!editingId) editingId = ship.id;
        all[editingId] = ship; saveAll(all); syncToPage(ship);
        $('csSubTitle').textContent = '编辑中：' + ship.name;
        $('csDelBtn').style.display = '';
        renderMechs(); renderList();
        chatMsgs.push({ role: 'sys', content: '✅ 已保存「' + ship.name + '」（' + (ship.condEffects || []).length + ' 条机制）。配队页/模拟器里现在就能用。' });
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
    function addWeapon() { $('csWeapons').appendChild(weaponRow({})); }

    return { open: open, close: close, newShip: newShip, save: save, del: del, delMech: delMech, toggleMech: toggleMech, applyPending: applyPending, discardPending: discardPending, clearMechs: clearMechs, addWeapon: addWeapon, send: send };
})();
