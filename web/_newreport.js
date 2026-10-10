    /* ============================================================
       战报：游戏「行动统计」格式 + 用户 2026-09-27 要求的 6 项
        ① 多目标时可切换「打某一个目标时的数据」（游戏右侧那个「目标」列表）
        ② 点舰船看详情
        ③ 详情里【结构值伤害】与【系统伤害】分开列
        ④ 破坏系统扣的那 5% 血【计入结构值伤害】（括号里显示殉爆部分）
        ⑤ 可切换我方/敌方视角
        ⑥ 战报可保存
       ============================================================ */
    let REPORT_STATE = { view: 'both', sel: null, mode: 'target' };

    function _w(v) { return v >= 10000 ? (v / 10000).toFixed(1) + '万' : (v > 0 ? Math.round(v).toLocaleString() : '0'); }

    function _rowsOf(side, bs, duration) {
        const bucket = (bs.stat && bs.stat[side]) || null;
        const per = (bucket && bucket.per) || {};
        const units = (side === 'ally' ? bs.allyShips : bs.enemyShips) || [];
        const rows = {};
        units.forEach(u => {
            const k = statRowOf(u);
            const r = rows[k] || (rows[k] = { name: k, n: 0, alive: 0 });
            r.n++; r.alive += (u._aliveSec || 0);
        });
        Object.keys(per).forEach(k => { if (!rows[k]) rows[k] = { name: k, n: 0, alive: 0 }; });
        return Object.values(rows).map(r => {
            const p2 = per[r.name] || {};
            return Object.assign(r, {
                antiShip: p2.antiShip || 0, antiAir: p2.antiAir || 0, repair: p2.repair || 0,
                sysDmg: p2.sysDmg || 0, sysKill: p2.sysKill || 0, blastHp: p2.blastHp || 0,
                byTarget: p2.byTarget || {}, byWeapon: p2.byWeapon || {},
                life: (r.n && duration > 0) ? (r.alive / (r.n * duration)) : 0
            });
        }).filter(r => r.antiShip || r.antiAir || r.repair || r.n)
          .sort((a, b) => (b.antiShip + b.antiAir) - (a.antiShip + a.antiAir));
    }

    function _statTable(side, bs, duration) {
        const list = _rowsOf(side, bs, duration);
        const tot = list.reduce((a, r) => ({ antiShip: a.antiShip + r.antiShip, antiAir: a.antiAir + r.antiAir, repair: a.repair + r.repair }), { antiShip: 0, antiAir: 0, repair: 0 });
        const units = (side === 'ally' ? bs.allyShips : bs.enemyShips) || [];
        const allAlive = units.reduce((a, u) => a + (u._aliveSec || 0), 0);
        const lifeAll = units.length && duration ? allAlive / (units.length * duration) : 0;
        const col = side === 'ally' ? 'var(--accent-blue)' : 'var(--accent-red)';
        const sel = REPORT_STATE.sel;
        let h = '<div style="flex:1;min-width:0;">'
            + '<div style="font-weight:700;color:' + col + ';padding:4px 0;border-bottom:2px solid ' + col + ';">'
            + (side === 'ally' ? '🔵 我方' : '🔴 敌方')
            + ' <span style="color:var(--text-secondary);font-weight:400;font-size:11px;">（' + units.length + ' 个单位）</span></div>'
            + '<table style="width:100%;border-collapse:collapse;font-size:11px;">'
            + '<tr style="color:var(--text-secondary);"><th style="text-align:left;padding:3px 4px;">舰种</th>'
            + '<th style="text-align:right;">对舰伤害</th><th style="text-align:right;">对空伤害</th>'
            + '<th style="text-align:right;">维修量</th><th style="text-align:right;">生存时间占比</th></tr>'
            + '<tr style="border-top:1px solid rgba(45,74,111,.6);font-weight:700;background:rgba(255,255,255,.03);">'
            + '<td style="text-align:left;padding:3px 4px;">总计</td>'
            + '<td style="text-align:right;">' + _w(tot.antiShip) + '</td>'
            + '<td style="text-align:right;">' + _w(tot.antiAir) + '</td>'
            + '<td style="text-align:right;">' + _w(tot.repair) + '</td>'
            + '<td style="text-align:right;">' + Math.round(lifeAll * 100) + '%</td></tr>';
        list.forEach(r => {
            const on = sel && sel.side === side && sel.key === r.name;
            h += '<tr style="border-top:1px solid rgba(45,74,111,.2);cursor:pointer;' + (on ? 'background:rgba(255,215,0,.12);' : '') + '"'
                + ' onclick="_reportSelect(\'' + side + '\',' + JSON.stringify(r.name).replace(/"/g, '&quot;') + ')" title="点击查看详情">'
                + '<td style="text-align:left;padding:3px 4px;">' + (on ? '▾ ' : '▸ ') + r.name
                + (r.n ? ' <span style="color:var(--text-muted)">×' + r.n + '</span>' : '') + '</td>'
                + '<td style="text-align:right;">' + (r.antiShip > 0 ? _w(r.antiShip) : '0') + '</td>'
                + '<td style="text-align:right;">' + (r.antiAir > 0 ? _w(r.antiAir) : '0') + '</td>'
                + '<td style="text-align:right;">' + (r.repair > 0 ? _w(r.repair) : '0') + '</td>'
                + '<td style="text-align:right;">' + Math.round(r.life * 100) + '%</td></tr>';
            if (on) h += _detailRow(side, r, 5);
        });
        return h + '</table></div>';
    }

    /* 详情块：结构值伤害 与 系统伤害 分开列；可在「按目标 / 按武器」之间切换 */
    function _detailRow(side, r, span) {
        const map = REPORT_STATE.mode === 'weapon' ? r.byWeapon : r.byTarget;
        const keys = Object.keys(map).filter(k => { const v = map[k]; return (v.s || v.a || v.sysDmg || v.sysKill); })
            .sort((a, b) => ((map[b].s + map[b].a) - (map[a].s + map[a].a)));
        let h = '<tr><td colspan="' + span + '" style="padding:6px 8px 10px 18px;background:rgba(0,0,0,.25);">'
            + '<div style="display:flex;gap:8px;align-items:center;margin-bottom:5px;flex-wrap:wrap;">'
            + '<b style="color:var(--gold);">📋 ' + r.name + ' 详情</b>'
            + '<button class="btn btn-sm" style="font-size:10px;" onclick="event.stopPropagation();_reportSetMode(\'target\')">按目标' + (REPORT_STATE.mode === 'target' ? ' ✅' : '') + '</button>'
            + '<button class="btn btn-sm" style="font-size:10px;" onclick="event.stopPropagation();_reportSetMode(\'weapon\')">按武器' + (REPORT_STATE.mode === 'weapon' ? ' ✅' : '') + '</button>'
            + '<span style="color:var(--text-secondary);font-size:10px;">生存时间占比 ' + Math.round(r.life * 100) + '% ｜ 殉爆 ' + _w(r.blastHp) + ' ｜ 击毁系统 ' + r.sysKill + ' 次</span>'
            + '</div>'
            + '<table style="width:100%;border-collapse:collapse;font-size:10.5px;background:rgba(0,0,0,.2);">'
            + '<tr style="color:var(--text-secondary);">'
            + '<th style="text-align:left;padding:2px 4px;">' + (REPORT_STATE.mode === 'weapon' ? '武器' : '目标') + '</th>'
            + '<th style="text-align:right;">结构值伤害(殉爆)</th><th style="text-align:right;">系统伤害(数量)</th>'
            + '<th style="text-align:right;">对空伤害</th></tr>';
        if (!keys.length) h += '<tr><td colspan="4" style="padding:4px;color:var(--text-muted);">（本行没有可拆分的记录）</td></tr>';
        keys.forEach(k => {
            const v = map[k];
            h += '<tr style="border-top:1px solid rgba(45,74,111,.15);">'
                + '<td style="text-align:left;padding:2px 4px;">' + k + '</td>'
                + '<td style="text-align:right;">' + _w(v.s) + (v.blast > 0 ? ' <span style="color:var(--text-muted)">(' + _w(v.blast) + ')</span>' : '') + '</td>'
                + '<td style="text-align:right;">' + _w(v.sysDmg) + (v.sysKill > 0 ? ' <span style="color:var(--text-muted)">(' + v.sysKill + ')</span>' : '') + '</td>'
                + '<td style="text-align:right;">' + (v.a > 0 ? _w(v.a) : '0') + '</td></tr>';
        });
        return h + '</table></td></tr>';
    }

    function _reportSelect(side, key) {
        const s = REPORT_STATE.sel;
        REPORT_STATE.sel = (s && s.side === side && s.key === key) ? null : { side: side, key: key };
        renderBattleReport();
    }
    function _reportSetMode(m) { REPORT_STATE.mode = m; renderBattleReport(); }
    function _reportSetView(v) { REPORT_STATE.view = v; REPORT_STATE.sel = null; renderBattleReport(); }

    function _reportSave() {
        const bs = battleState; if (!bs) return;
        const body = $('battleReportContent').innerHTML;
        const html = '<!doctype html><meta charset="utf-8"><title>战报</title>'
            + '<style>body{background:#0f1620;color:#dfe7f3;font-family:system-ui,"Microsoft YaHei";padding:16px;}'
            + 'table{border-collapse:collapse;}th,td{padding:2px 6px;}button{display:none}</style>'
            + '<h2>拉格朗日模拟器 · 战报</h2>'
            + '<div style="color:#9fb0c7;font-size:12px;">保存于 ' + new Date().toLocaleString() + ' ｜ 战斗时长 ' + (bs.time || 0).toFixed(1) + ' 秒</div>'
            + body;
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const a = document.createElement('a');
        const t = new Date(); const pad = n => String(n).padStart(2, '0');
        a.href = URL.createObjectURL(blob);
        a.download = '战报_' + t.getFullYear() + pad(t.getMonth() + 1) + pad(t.getDate()) + '_' + pad(t.getHours()) + pad(t.getMinutes()) + '.html';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    }

    function renderBattleReport() {
        const bs = battleState;
        if (!bs) { $('battleReportContent').innerHTML = '<div style="padding:12px;color:var(--text-muted);">还没有战斗数据 —— 先点「开始战斗」。</div>'; return; }
        const duration = bs.time || 1;
        const aliveA = bs.allyShips.filter(s => s.alive).length, aliveB = bs.enemyShips.filter(s => s.alive).length;
        const V = REPORT_STATE.view;
        const tab = (v, t) => '<button class="btn btn-sm" style="font-size:11px;' + (V === v ? 'outline:1px solid var(--gold);' : '') + '" onclick="_reportSetView(\'' + v + '\')">' + t + '</button>';
        let html = '<div style="font-weight:700;font-size:13px;margin-bottom:6px;">📊 行动统计'
            + '<span style="color:var(--text-secondary);font-weight:400;font-size:11px;">'
            + ' ｜ 战斗时长 ' + duration.toFixed(1) + ' 秒 ｜ 存活 我方 ' + aliveA + '/' + bs.allyShips.length + ' · 敌方 ' + aliveB + '/' + bs.enemyShips.length
            + ' ｜ ' + (!bs.ended ? '未结束' : (aliveB === 0 && aliveA > 0 ? '<b style="color:var(--accent-blue)">我方胜利</b>' : (aliveA === 0 && aliveB > 0 ? '<b style="color:var(--accent-red)">敌方胜利</b>' : '两败俱伤'))) + '</span></div>'
            + '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">'
            + '<span style="font-size:11px;color:var(--text-secondary);">视角：</span>'
            + tab('both', '双方') + tab('ally', '只看我方') + tab('enemy', '只看敌方')
            + '<span style="flex:1"></span>'
            + '<button class="btn btn-sm" style="font-size:11px;" onclick="_reportSave()">💾 保存战报</button></div>'
            + '<div style="color:var(--text-muted);font-size:10.5px;margin-bottom:6px;">点任意舰船行可展开详情；详情里「结构值伤害」与「系统伤害」分列，破坏系统扣的 5% 血量已计入结构值伤害（括号里是殉爆部分）。</div>'
            + '<div style="display:flex;gap:14px;">';
        if (V !== 'enemy') html += _statTable('ally', bs, duration);
        if (V !== 'ally') html += _statTable('enemy', bs, duration);
        html += '</div>';

        try {
            const _grp = [['我方护航', bs.allyEscort], ['我方被护航', bs.allyEscorted],
                          ['敌方护航', bs.enemyEscort], ['敌方被护航', bs.enemyEscorted]];
            const rows = _grp.map(([nm, arr]) => {
                const a = (arr || []).filter(s => s && s.position !== 'aircraft');
                if (!a.length) return '';
                const cnt = {};
                a.forEach(s => { const k = s._apSrc || '?'; cnt[k] = (cnt[k] || 0) + 1; });
                const keys = Object.keys(cnt);
                const txt = keys.map(k => (cnt[k] > 1 ? k + '×' + cnt[k] : k)).join(' + ');
                return '<div style="font-size:11px;padding:2px 0;">· ' + nm + '：<b>' + txt + '</b>'
                     + '<span style="color:var(--text-muted)"> （' + a.length + ' 艘）</span></div>';
            }).join('');
            if (rows) html += '<div style="margin-top:12px;padding:8px;border:1px solid rgba(45,74,111,.5);border-radius:6px;">'
                            + '<b style="color:var(--gold)">⚙ 本场实际采用的加点（引擎逐船查到的来源）</b>' + rows + '</div>';
        } catch (e) { }
        $('battleReportContent').innerHTML = html;
    }

    function generateBattleReport() {
        REPORT_STATE.sel = null;
        renderBattleReport();
        openModal('battleReportModal');
    }
