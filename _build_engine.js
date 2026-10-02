/* 从 simulator.html 抽取战斗引擎，生成可在 Node 里跑的独立引擎（engine/lagrange_engine.js）
   为什么要这样：让"进化 / 自对弈 / 批量化跑战斗"不需要浏览器（Edge + puppeteer），
   单场可控、可复现（battleSeed）、能在一台普通机器上连续跑上千场。

   做法：
     1. 取 simulator.html 里的内联 <script>（921~5836 行区间）
     2. 取 js/fleet_check.js（舰船校验/载机位，引擎依赖它）
     3. 在最前面插入【浏览器 API 垫片】（localStorage / document / fetch→本地文件 / alert…）
     4. 在最后面追加【导出块】（init / runBattle / 数据访问）
   产出：engine/lagrange_engine.js（纯 Node 模块，无第三方依赖） */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SIM = path.join(ROOT, 'simulator.html');
const OUT_DIR = path.join(ROOT, 'engine');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

/* ---------- 1. 抽取内联脚本 ---------- */
const html = fs.readFileSync(SIM, 'utf8').split('\n');
let start = -1, end = -1;
html.forEach((l, i) => {
    if (start < 0 && l.trim() === '<script>' && i > 800) start = i + 1;      // 主脚本开始
    else if (start >= 0 && end < 0 && l.trim() === '</script>' && i > start) end = i;   // 主脚本结束
});
if (start < 0 || end < 0) throw new Error('没找到内联 <script> 边界');
const engineSrc = html.slice(start, end).join('\n');
console.log('内联脚本行数 = ' + (end - start) + '（' + (start + 1) + '~' + end + '）');

/* ---------- 2. fleet_check.js ---------- */
const checkSrc = fs.readFileSync(path.join(ROOT, 'js', 'fleet_check.js'), 'utf8');

/* ---------- 3. 垫片 ---------- */
const SHIM = `/* ============================================================
   Node 垫片：把浏览器 API 换成最小可用实现
   ============================================================ */
const __fs = require('fs');
const __path = require('path');
const __ROOT = __path.join(__dirname, '..');       // 项目根（data/ 在这里）

/* localStorage：内存版 */
const __LS = new Map();
global.localStorage = {
    getItem: k => (__LS.has(String(k)) ? __LS.get(String(k)) : null),
    setItem: (k, v) => { __LS.set(String(k), String(v)); },
    removeItem: k => { __LS.delete(String(k)); },
    clear: () => __LS.clear(),
    get length() { return __LS.size; },
    key: i => Array.from(__LS.keys())[i] || null
};

/* 万能"空元素"：UI 代码对它的任何读写都安静地成功 */
function __mkEl(tag) {
    const el = {
        tagName: (tag || 'div').toUpperCase(), style: {}, dataset: {}, classList: {
            add() { }, remove() { }, toggle() { }, contains() { return false; }
        },
        children: [], childNodes: [], value: '', innerHTML: '', innerText: '', textContent: '',
        checked: false, disabled: false, selectedIndex: 0, options: [],
        appendChild(c) { return c; }, removeChild() { }, insertBefore(c) { return c; },
        insertAdjacentHTML() { }, setAttribute() { }, getAttribute() { return null; },
        removeAttribute() { }, addEventListener() { }, removeEventListener() { },
        dispatchEvent() { return true; }, focus() { }, blur() { }, click() { }, remove() { },
        querySelector() { return null; }, querySelectorAll() { return []; },
        getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; },
        closest() { return null; }, contains() { return false; }, scrollIntoView() { },
        getContext() { return null; }, toDataURL() { return ''; }, play() { }, pause() { }
    };
    el.parentNode = null; el.firstChild = null; el.lastChild = null; el.nextSibling = null;
    return el;
}
const __elCache = new Map();
const __el = id => { if (!__elCache.has(id)) __elCache.set(id, __mkEl('div')); return __elCache.get(id); };

global.document = {
    getElementById: id => (id ? __el(id) : null),
    querySelector: sel => (sel ? __el('sel:' + sel) : null),
    querySelectorAll: () => [],
    createElement: t => __mkEl(t),
    createTextNode: t => ({ nodeValue: t }),
    createDocumentFragment: () => __mkEl('frag'),
    addEventListener() { }, removeEventListener() { },
    get body() { return __el('body'); },
    get documentElement() { return __el('html'); },
    get head() { return __el('head'); },
    get readyState() { return 'complete'; },
    get title() { return ''; }, set title(v) { }
};
global.window = global;
global.navigator = { userAgent: 'node', language: 'zh-CN', platform: 'node', clipboard: { writeText: async () => { } } };
global.screen = { width: 1920, height: 1080 };
global.location = { href: 'file:///', protocol: 'file:', host: 'localhost', hash: '', search: '' };
global.alert = () => { };
global.confirm = () => true;
global.prompt = () => null;
global.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 16);
global.cancelAnimationFrame = id => clearTimeout(id);
global.addEventListener = () => { };
global.removeEventListener = () => { };
global.scrollTo = () => { };
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
global.Image = function () { return __mkEl('img'); };
global.Audio = function () { return { play() { }, pause() { }, addEventListener() { } }; };
global.Worker = function () { throw new Error('Worker 在 Node 垫片里不可用'); };
global.XMLHttpRequest = function () { };
global.Blob = function () { };
global.FileReader = function () { };
global.speechSynthesis = { speak() { }, cancel() { }, getVoices: () => [] };
global.SpeechSynthesisUtterance = function () { };
global.Notification = function () { };
global.ResizeObserver = function () { return { observe() { }, disconnect() { } }; };
global.IntersectionObserver = function () { return { observe() { }, disconnect() { } }; };

/* fetch → 读本地文件（引擎只用它读 data/ 下的 JSON） */
global.fetch = async function (url) {
    const rel = String(url).replace(/^\\.\\//, '').split('?')[0];
    const p = __path.join(__ROOT, rel);
    try {
        const txt = __fs.readFileSync(p, 'utf8');
        return {
            ok: true, status: 200,
            json: async () => JSON.parse(txt),
            text: async () => txt
        };
    } catch (e) {
        return { ok: false, status: 404, json: async () => { throw e; }, text: async () => { throw e; } };
    }
};
/* 把"当前项目根"暴露给导出块 */
global.__ENGINE_ROOT = __ROOT;
/* ============================================================ */
`;

/* ---------- 4. 导出块 ---------- */
const EXPORT = `
/* ============================================================
   导出块：给"进化 / 批量跑战斗"用的干净 API
   ============================================================ */
async function __engineInit() {
    await loadShipDatabase();
    const ok = await loadBlueprintData();
    /* 预载所有船的加点树（可选：跑加点方案时需要） */
    return { shipReady: SHIP_DB_READY, bpReady: !!ok, ships: Object.keys(SHIP_DATABASE).length };
}
/* 预载某几艘船的加点树 */
async function __engineLoadBpTrees(ids) {
    for (const id of (ids || [])) { try { await loadBpTree(id); } catch (e) { } }
}
/* 组装一边的舰队（spec: [{id,count,position,mods,apSet,air:[{id,qty,slot,kind}]}]） */
function __engineBuildSide(spec) {
    return (spec || []).map(s => {
        const t = SHIP_DATABASE[s.id];
        if (!t) return null;
        const e = JSON.parse(JSON.stringify(t));
        e.count = s.count || 1;
        e.selectedModules = Object.assign({}, s.mods || {});
        if (s.position) e.position = s.position;
        if (s.apSet) e.apSet = s.apSet;
        recalcAircraftSlots(e);
        e.aircraft = [];
        (s.air || []).forEach(a => {
            const at = SHIP_DATABASE[a.id];
            if (!at) return;
            const slots = e.simSlots || e.airSlots || [];
            const sl = slots.find(x => x.key === a.slot) || slots.find(x => x.allow === 'ALL' || x.kind === a.kind);
            if (!sl) return;
            const inst = JSON.parse(JSON.stringify(at));
            inst.count = a.qty || 1;
            inst.slot = sl.key;
            e.aircraft.push(inst);
        });
        return e;
    }).filter(Boolean);
}
/* 跑一场（返回战果；seed 相同则结果完全相同） */
function __engineRunBattle(opt) {
    const o = opt || {};
    FLEET_TYPES.forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; fleetData[k].apSet = null; });
    fleetData['ally-escort'].main = __engineBuildSide(o.A);
    fleetData['enemy-escort'].main = __engineBuildSide(o.B);
    if (typeof o.Aescort !== 'undefined') fleetData['ally-escorted'].main = __engineBuildSide(o.Aescort);
    if (typeof o.Bescort !== 'undefined') fleetData['enemy-escorted'].main = __engineBuildSide(o.Bescort);
    try { refreshFleetViews(); } catch (e) { }
    if (typeof o.seed === 'number') battleSeed = o.seed; else battleSeed = null;
    if (!prepareBattle()) return null;
    const bs = battleState;
    const cap = o.maxSec || 30000;
    let t = 0;
    while (!bs.ended && t < cap) { processBattleTick(o.dt || 0.2); t += (o.dt || 0.2); }
    const agg = arr => {
        const ships = arr.filter(x => x.position !== 'aircraft');
        const ac = arr.filter(x => x.position === 'aircraft');
        const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
        return {
            舰船数: ships.length, 载机数: ac.length,
            存活舰船: ships.filter(x => x.alive).length, 存活载机: ac.filter(x => x.alive).length,
            总输出对舰: sum(arr, x => x._dealtShip || 0), 总输出对空: sum(arr, x => x._dealtAir || 0),
            总承伤: sum(arr, x => x._taken || 0), 总维修: sum(arr, x => x._healOut || 0),
            总结构值: sum(ships, x => x.maxHp || 0),
            剩余结构值: sum(ships, x => Math.max(0, x.hp || 0)),
            平均生存时间占比: arr.length ? sum(arr, x => x._aliveSec || 0) / (arr.length * t) : 0
        };
    };
    return { 时长: t, 结束: !!bs.ended, 我方: agg(bs.allyShips), 敌方: agg(bs.enemyShips), _bs: bs };
}
/* 全灭/胜利判定 */
function __engineOutcome(r) {
    if (!r) return 'error';
    const a = r.我方.存活舰船 + r.我方.存活载机, b = r.敌方.存活舰船 + r.敌方.存活载机;
    if (a === 0 && b === 0) return 'draw';
    if (a === 0) return 'loss';
    if (b === 0) return 'win';
    return 'timeout';
}

module.exports = {
    init: __engineInit,
    loadBpTrees: __engineLoadBpTrees,
    runBattle: __engineRunBattle,
    outcome: __engineOutcome,
    buildSide: __engineBuildSide,
    /* 直接暴露内部数据与状态（进化实验里取用） */
    get ships() { return SHIP_DATABASE; },
    get stats() { return BP_STATS; },
    get battleState() { return (typeof battleState !== 'undefined') ? battleState : null; },
    setSeed: s => { battleSeed = s; },
    RNG: () => RNG(),
    version: 'engine-1 (extracted from simulator.html)'
};
`;

/* ---------- 5. 写出 ---------- */
const out = SHIM + '\n' + checkSrc + '\n' + engineSrc + '\n' + EXPORT;
fs.writeFileSync(path.join(OUT_DIR, 'lagrange_engine.js'), out, 'utf8');
console.log('已生成 engine/lagrange_engine.js（' + out.split('\n').length + ' 行，' + (Buffer.byteLength(out) / 1024).toFixed(0) + ' KB）');
