/* ============================================================
   MechSpec —— 自定义舰船机制（"当X之后X"）白名单与校验的【单一来源】
   ------------------------------------------------------------
   谁在用：js/custom_ship.js（配队页的自定义舰船弹窗）、simulator.html 的 __engineAddMechanic、
          js/agent.js 的 set_ship_mechanic 工具（有 window.MechSpec 就优先用它，否则退回各自的内置表——值同此）。
   规则（与引擎 processCondEffects 对齐）：
     · 未知 cond.kind 会被引擎当成"永远满足"=常驻 buff（历史坑）→ 这里【硬拒绝】
     · 效果字段只认下面两张表；数值=百分比或点数
   ============================================================ */
window.MechSpec = (function () {
    const KINDS = ['hpBelow', 'enemyHpBelow', 'battleStart', 'battleStartSec', 'firstRounds',
        'everySec', 'everyRounds', 'onAttacked', 'onEnemyLoss', 'onKill', 'onTargetType'];
    const SHIP_F = ['evasion', 'hitBonus', 'enemyHitDown', 'aaLockDown', 'sysDmgReduce', 'hp', 'physResist',
        'energyResist', 'repairEff', 'repairBonus', 'dmgBonus', 'interceptRate', 'siege', 'multiTarget', 'positionFix'];
    const WEAPON_F = ['singleDmg', 'cooldownReduction', 'crit', 'critDmg', 'lockReduction', 'atkReduction',
        'lockEfficiency', 'antiIntercept', 'weaponDuration', 'hangarCd', 'hangarFlight'];
    const KIND_CN = {
        hpBelow: w => '自身结构≤' + (w.threshold || 0) + '%',
        enemyHpBelow: w => '敌方有单位≤' + (w.threshold || 0) + '%',
        battleStart: () => '开场',
        battleStartSec: w => '开场' + (w.sec || 0) + '秒内',
        firstRounds: w => '前' + (w.rounds || 1) + '轮',
        everySec: w => '每' + (w.threshold || 10) + '秒',
        everyRounds: w => '每' + (w.rounds || 1) + '轮',
        onAttacked: () => '被打后',
        onEnemyLoss: () => '敌方有人被击毁后',
        onKill: () => '自己拿到击杀后',
        onTargetType: w => '锁定' + (w.targetKind || '目标') + '期间'
    };
    /* specs: [{when:{kind,...}, then:{k:v}, note?}] → {built:[{cond,stat,val,note}], rejected:[中文]} */
    function build(specs) {
        const built = [], rejected = [];
        (Array.isArray(specs) ? specs : [specs]).forEach(function (sp, i) {
            if (!sp || !sp.when || !sp.then) { rejected.push('第' + (i + 1) + '条：缺 when/then'); return; }
            const kind = sp.when.kind;
            if (KINDS.indexOf(kind) < 0) { rejected.push('第' + (i + 1) + '条：when.kind「' + kind + '」不在白名单（' + KINDS.join('/') + '）'); return; }
            const cond = { kind: kind };
            ['threshold', 'sec', 'rounds', 'dur', 'cd'].forEach(function (k) { if (sp.when[k] != null && isFinite(+sp.when[k])) cond[k] = +sp.when[k]; });
            if (sp.when.once != null) cond.once = !!sp.when.once;
            if (sp.when.targetKind != null) cond.targetKind = String(sp.when.targetKind);
            const keys = Object.keys(sp.then || {});
            if (!keys.length) { rejected.push('第' + (i + 1) + '条：then 为空'); return; }
            keys.forEach(function (k) {
                const v = +sp.then[k];
                if (!isFinite(v) || v === 0) { rejected.push('第' + (i + 1) + '条：then.' + k + ' 数值非法'); return; }
                if (SHIP_F.indexOf(k) < 0 && WEAPON_F.indexOf(k) < 0) { rejected.push('第' + (i + 1) + '条：效果字段「' + k + '」不在白名单'); return; }
                built.push({ cond: cond, stat: k, val: v, note: sp.note ? String(sp.note).substring(0, 60) : undefined, on: (sp.on === false ? false : undefined) });
            });
        });
        return { built: built, rejected: rejected };
    }
    /* 一条 condEffect → 一行中文 */
    function line(c) {
        const w = c.cond || {};
        const when = (KIND_CN[w.kind] || function () { return w.kind; })(w);
        const extras = [w.dur ? '持续' + w.dur + 's' : '', w.cd ? 'CD' + w.cd + 's' : '', w.once ? '仅一次' : ''].filter(Boolean).join(' ');
        return '当' + when + ' → ' + c.stat + ' +' + c.val + (extras ? '（' + extras + '）' : '') + (c.on === false ? '　[已关闭]' : '');
    }
    return { KINDS: KINDS, SHIP_F: SHIP_F, WEAPON_F: WEAPON_F, build: build, line: line, KIND_CN: KIND_CN };
})();
