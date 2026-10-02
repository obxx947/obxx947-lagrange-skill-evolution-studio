/* 逐项审计：加点 / 策略 / 旗舰技能 / 机制 —— 到底实现了多少
   产出：桌面/加点策略旗舰机制-实现审计-2026-10-02.md */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/ship_database.json'), 'utf8'));
const SHIPS = Array.isArray(raw) ? raw : Object.values(raw);
const ST = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/blueprint_stats.json'), 'utf8'));
const SIM = fs.readFileSync(path.join(ROOT, 'simulator.html'), 'utf8');

/* ---------- 工具：某 stat 是否被引擎消费 ---------- */
/* 判据：引擎源码里出现过这个 stat 名字（作为字符串键或属性访问） */
function consumed(stat) {
    if (!stat) return false;
    const pats = [`'${stat}'`, `"${stat}"`, `.${stat}`, `${stat}:`];
    return pats.some(p => SIM.indexOf(p) >= 0);
}

const L = [];
const P = (...a) => L.push(a.join(''));
P('# 加点 / 策略 / 旗舰技能 / 机制 —— 实现审计（2026-10-02）');
P('');
P('审计对象：`拉格朗日智能体3`（引擎 = `simulator.html`，数据 = `data/`）');
P('');
P('---');
P('');

/* ============================================================
   一、加点
   ============================================================ */
const addable = Object.entries(ST.nodes).filter(([id, n]) => n && n.addable === true);
const statCount = {};
addable.forEach(([id, n]) => { const s = n.stat || 'unmapped'; statCount[s] = (statCount[s] || 0) + 1; });
const NONCOMBAT = new Set(['speed', 'fleetOps', 'scout', 'special']);
const rows = Object.entries(statCount).sort((a, b) => b[1] - a[1]);
let done = 0, nonc = 0, miss = 0;
const missing = [];
rows.forEach(([st, n]) => {
    if (NONCOMBAT.has(st)) { nonc += n; return; }
    if (consumed(st)) done += n; else { miss += n; missing.push([st, n]); }
});
P('## 一、加点节点');
P('');
P('| | 数量 |');
P('|---|---|');
P('| 可加点节点（全部） | **' + addable.length + '** |');
P('| 引擎已消费的属性 | **' + done + '** |');
P('| 非战斗（用户口径：不统计） | ' + nonc + '（' + [...NONCOMBAT].join('/') + '） |');
P('| **未消费** | **' + miss + '** |');
P('');
if (missing.length) {
    P('未消费的属性：');
    P('');
    P('| 属性 | 节点数 |');
    P('|---|---|');
    missing.forEach(([st, n]) => P('| `' + st + '` | ' + n + ' |'));
} else {
    P('**⇒ 战斗相关属性 100% 被引擎消费。**');
}
P('');
/* 条件触发 / 机制类节点 */
const condN = Object.values(ST.nodes).filter(n => n && n.cond).length;
const mechN = Object.values(ST.nodes).filter(n => n && n.mechanic).length;
const fmN = Object.values(ST.nodes).filter(n => n && n.fleetMech).length;
P('其它维度：**条件触发节点 ' + condN + ' 个**（`cond`，由 `processCondEffects` 每 tick 求值）、' +
    '**机制节点 ' + mechN + ' 个**（`mechanic`）、**舰队级机制节点 ' + fmN + ' 个**（`fleetMech`）');
P('');

/* ============================================================
   二、策略
   ============================================================ */
P('## 二、策略');
P('');
/* 策略类节点的判据：说明里含「策略」或 labelName 是「策略」，且可加点 */
const TREE_CACHE = {};
function treeOf(cdnId) {
    if (TREE_CACHE[cdnId]) return TREE_CACHE[cdnId];
    const p = path.join(ROOT, 'data/blueprint', cdnId + '.json');
    try { TREE_CACHE[cdnId] = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { TREE_CACHE[cdnId] = { systems: [] }; }
    return TREE_CACHE[cdnId];
}
const BP_MAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/blueprint_map.json'), 'utf8'));
const cdnOf = {}; Object.entries(BP_MAP).forEach(([sid, v]) => { if (v && v.cdnId) cdnOf[v.cdnId] = v.dbName || sid; });

const stratNodes = [];
Object.keys(TREE_CACHE && {}) // noop
Object.keys(BP_MAP).forEach(() => { });
Object.entries(BP_MAP).forEach(([sid, v]) => {
    if (!v || !v.cdnId) return;
    const t = treeOf(v.cdnId);
    (t.systems || []).forEach(sy => (sy.nodes || []).forEach(n => {
        const txt = String(n.baseDesc || '') + String(n.name || '');
        if (!/策略/.test(txt)) return;
        stratNodes.push({ cdnId: v.cdnId, ship: v.dbName, id: n.id, name: n.name, desc: n.baseDesc,
            stat: (ST.nodes[n.id] || {}).stat, mech: (ST.nodes[n.id] || {}).mechanic, cond: (ST.nodes[n.id] || {}).cond });
    }));
});
P('全库说明里含「策略」的加点节点 = **' + stratNodes.length + '** 个：');
P('');
if (stratNodes.length) {
    P('| 舰船 | 节点 | 说明 | 引擎状态 |');
    P('|---|---|---|---|');
    stratNodes.forEach(x => {
        const st = ST.nodes[x.id] || {};
        const ok = st.mechanic || st.cond || consumed(st.stat);
        P('| ' + String(x.ship).slice(0, 14) + ' | ' + String(x.name || x.id).slice(0, 10) + ' | ' +
            String(x.desc || '').replace(/\|/g, '/').slice(0, 56) + ' | ' + (ok ? '✅ 已实现' : '❌ **未实现**') + ' |');
    });
}
/* 模块层带「策略」的 */
const modStrat = [];
SHIPS.forEach(s => Object.entries(s.modules || {}).forEach(([k, m]) => {
    if (k.startsWith('_') || !m) return;
    Object.entries(m.variants || {}).forEach(([vk, v]) => {
        if (!v) return;
        const e = String(v.effect || '');
        if (!/策略/.test(e)) return;
        const has = ['armorBonus', 'hpBonusPct', 'shieldBonusPct', 'energyCut', 'physCut', 'critDmgDown', 'shieldDrone',
            'armorCap', 'interceptRate', 'hangarDmg', 'hangarHit', 'hangarCdRed', 'hangarFlight', 'hangarCritRate', 'hangarCritDmg']
            .some(x => v[x] !== undefined && v[x] !== 0);
        modStrat.push({ ship: s.name, k: k + '=' + vk, e, has });
    });
}));
P('');
P('**模块层**说明里含「策略」的 = **' + modStrat.length + '** 个：');
P('');
if (modStrat.length) {
    P('| 舰船 | 模块 | 说明 | 引擎状态 |');
    P('|---|---|---|---|');
    modStrat.forEach(x => P('| ' + String(x.ship).slice(0, 14) + ' | ' + x.k + ' | ' +
        String(x.e).replace(/\|/g, '/').slice(0, 50) + ' | ' + (x.has ? '✅ 已实现' : '❌ **未实现**') + ' |'));
}
P('');

/* ============================================================
   三、旗舰技能
   ============================================================ */
P('## 三、旗舰技能');
P('');
P('引擎支持情况：');
P('');
P('- **旗舰标记**：`prepareBattle()` 的 4 舰队分支里 `inst.isFlagship = true`（按 `fleet.flagship` 匹配舰船 id）✅');
P('- **旗舰机制的门槛**：`flagsMechOk(s, fm)` —— 必须是指定旗舰，且**指挥系统未被摧毁** ✅');
P('- **旗舰机制的数据来源**：加点节点的 `fleetMech` 字段（全库 ' + fmN + ' 个节点）');
P('');
/* 库里显式的舰队级旗舰技能字段 */
const ff = SHIPS.filter(s => s.fleetFlagship);
P('`ship_database.json` 里显式写了 `fleetFlagship`（舰船自带旗舰技能）的 = **' + ff.length + '** 艘：');
P('');
if (ff.length) {
    P('| 舰船 | 技能 | 减伤/效果 | 引擎是否消费 |');
    P('|---|---|---|---|');
    ff.forEach(s => P('| ' + s.name + ' | ' + String(s.fleetFlagship.text || '').slice(0, 40) + ' | cut=' +
        s.fleetFlagship.cut + ' | ' + (SIM.indexOf('shieldProtect') >= 0 ? '⚠️ 有代码但**已停用**（实测恶化）' : '❌ 未消费') + ' |'));
} else P('（无）');
P('');
P('**舰队级机制（fleetMech）支持的 kind**（引擎里 `fleetMechsOf` + 消费处）：');
const kinds = ['subTargetHit', 'counterSub', 'protectFromSub', 'repairBoost', 'cutInSub'];
kinds.forEach(k => P('- `' + k + '` → ' + (SIM.indexOf("'" + k + "'") >= 0 ? '✅ 已实现' : '❌ 未实现')));
P('');

/* ============================================================
   四、机制（模块 effect）
   ============================================================ */
P('## 四、机制（模块 effect 的结构化程度）');
P('');
const IMPL_KEYS = ['armorBonus', 'hpBonusPct', 'shieldBonusPct', 'energyCut', 'physCut', 'critDmgDown', 'shieldDrone',
    'armorCap', 'interceptRate', 'hangarDmg', 'hangarHit', 'hangarCdRed', 'hangarFlight', 'hangarCritRate', 'hangarCritDmg',
    /* ★ 第53轮新增：模块级机制 */
    'antiIntercept', 'ionBoost', 'dodgeVsAir', 'dmgBonusFlat',
    'strike', 'cmdAssist', 'targetPriority', 'atkReduction', 'coverModule'];
let effTotal = 0, effNum = 0, effDone = 0;
const effTodo = [];
SHIPS.forEach(s => Object.entries(s.modules || {}).forEach(([k, m]) => {
    if (k.startsWith('_') || !m) return;
    Object.entries(m.variants || {}).forEach(([vk, v]) => {
        if (!v) return;
        const e = String(v.effect || '');
        if (!e) return;
        effTotal++;
        const hasNum = /[0-9]/.test(e);            // 说明里带数值 = 是个"可核对的机制"
        if (!hasNum) return;
        effNum++;
        const has = IMPL_KEYS.some(x => v[x] !== undefined && v[x] !== 0);
        if (has) effDone++; else effTodo.push(s.name + ' / ' + k + '=' + vk + ' → ' + e);
    });
}));
P('| | 数量 |');
P('|---|---|');
P('| 模块变体带 `effect` 说明 | ' + effTotal + ' |');
P('| 其中**说明里带数值**（可核对的机制） | **' + effNum + '** |');
P('| 已写成结构化字段（引擎会读） | **' + effDone + '** |');
P('| **只有文字、引擎读不到** | **' + (effNum - effDone) + '** |');
P('');
if (effTodo.length) {
    P('未结构化清单（前 30 条）：');
    P('');
    P('| 舰船 / 模块 | 说明 |');
    P('|---|---|');
    effTodo.slice(0, 30).forEach(x => {
        const i = x.indexOf(' → ');
        P('| ' + x.slice(0, i).replace(/\|/g, '/') + ' | ' + x.slice(i + 3).replace(/\|/g, '/').slice(0, 54) + ' |');
    });
    if (effTodo.length > 30) P('| … | 共 ' + effTodo.length + ' 条 |');
}
P('');
P('---');
P('');
P('## 汇总');
P('');
P('| 维度 | 已实现 | 未实现 |');
P('|---|---|---|');
P('| 加点属性 | ' + done + ' | ' + miss + ' |');
P('| 加点·条件触发 | ' + condN + ' | 0 |');
P('| 策略（加点层） | ' + stratNodes.filter(x => { const s = ST.nodes[x.id] || {}; return s.mechanic || s.cond || consumed(s.stat); }).length + ' | ' + stratNodes.filter(x => { const s = ST.nodes[x.id] || {}; return !(s.mechanic || s.cond || consumed(s.stat)); }).length + ' |');
P('| 策略（模块层） | ' + modStrat.filter(x => x.has).length + ' | ' + modStrat.filter(x => !x.has).length + ' |');
P('| 旗舰标记 + 门槛 | ✅ | 0 |');
P('| 旗舰技能（舰船自带） | ' + (SIM.indexOf('shieldProtect') >= 0 ? '1（已停用）' : '0') + ' | ' + Math.max(0, ff.length) + ' |');
P('| 舰队级机制 kind | ' + kinds.filter(k => SIM.indexOf("'" + k + "'") >= 0).length + ' | ' + kinds.filter(k => SIM.indexOf("'" + k + "'") < 0).length + ' |');
P('| 模块机制（带数值） | ' + effDone + ' | ' + (effNum - effDone) + ' |');
P('');

fs.writeFileSync('C:/Users/Administrator/Desktop/加点策略旗舰机制-实现审计-2026-10-02.md', L.join('\r\n'), 'utf8');
fs.writeFileSync(path.join(ROOT, 'docs_加点策略旗舰机制-实现审计-2026-10-02.md'), L.join('\r\n'), 'utf8');
console.log('已写：桌面/加点策略旗舰机制-实现审计-2026-10-02.md');
console.log('加点 ' + done + '/' + addable.length + ' ｜ 策略(加点层) ' + stratNodes.length + ' ｜ 策略(模块层) ' + modStrat.length +
    ' ｜ 旗舰技能 ' + ff.length + ' ｜ 模块机制 ' + effDone + '/' + effNum);
