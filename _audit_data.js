/* 全库数据质量审计：找出明显异常/可疑的数据
   产出：桌面/全库数据质量审计-2026-10-02.md */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/ship_database.json'), 'utf8'));
const SHIPS = Array.isArray(raw) ? raw : Object.values(raw);
const L = []; const P = (...a) => L.push(a.join(''));
P('# 全库数据质量审计（2026-10-02）');
P('');
P('对象：`data/ship_database.json`（' + SHIPS.length + ' 条）');
P('');

const ISSUES = {};
const add = (k, msg) => (ISSUES[k] = ISSUES[k] || []).push(msg);

/* 遍历所有武器（基础 + 模块 + 变体） */
function eachWeapon(s, cb) {
    (s.weapons || []).forEach(w => cb(w, 'base'));
    Object.entries(s.modules || {}).forEach(([k, m]) => {
        if (k.startsWith('_') || !m) return;
        (m.weapons || []).forEach(w => cb(w, k));
        Object.entries(m.variants || {}).forEach(([vk, v]) => {
            if (!v) return;
            (v.weapons || []).forEach(w => cb(w, k + '=' + vk));
        });
    });
}

SHIPS.forEach(s => {
    const nm = s.name || s.id;
    /* ① 结构值缺失/为 0 */
    if (!(s.hp > 0)) add('① 结构值缺失', nm + '（hp=' + s.hp + '）');
    /* ② 护甲异常：<=2 且 hp>5万（参考战报2 那 6 艘大型舰的教训） */
    if (s.hp > 50000 && (s.physicalArmor || 0) <= 2) add('② 护甲可疑（大船却≤2）', nm + ' hp=' + s.hp + ' 护甲=' + s.physicalArmor);
    /* ③ 人口缺失 */
    if (!(s.commandValue > 0)) add('③ 人口缺失', nm);
    /* ④ 站位缺失 */
    if (!s.position) add('④ 站位缺失', nm);
    /* ⑤ 载机没有 flightMode */
    if (s.position === 'aircraft' && !s.flightMode) add('⑤ 载机缺 flightMode', nm);
    /* ⑥ 往复载机缺去/回程 */
    if (s.flightMode === 'reciprocating' && (!(s.departSec > 0) || !(s.returnSec > 0)))
        add('⑥ 往复载机缺去/回程', nm + ' 去=' + s.departSec + ' 返=' + s.returnSec);
    /* ⑦ 武器面板为 0 但有单发（疑似面板没提取） */
    let weaponN = 0, panelN = 0;
    eachWeapon(s, (w, tag) => {
        weaponN++;
        const d = w.dpm || {};
        const panel = (d.antiShip || 0) + (d.antiAir || 0) + (d.siege || 0) + (d.repair || 0);
        if (panel > 0) panelN++;
        /* 武器名疑似段落标题 */
        if (/^(一|二|三|四|五|六|七|八|九|十)、|^[0-9]\.|补充说明|系统机制|效率(低|中|高)|仅标注/.test(String(w.name || '')))
            add('⑦ 武器名疑似段落标题', nm + ' / ' + w.name);
        /* 单发>0 但面板全 0 */
        if ((w.singleDmg || 0) > 0 && panel === 0 && (w.weaponType || '') !== 'support')
            add('⑧ 单发>0 但面板全0', nm + ' / ' + String(w.name).slice(0, 26) + ' 单发=' + w.singleDmg);
        /* 面板/分 与 单发×发数×60/周期 差 >3 倍 */
        const shots = (w.shotsPerCycle > 0) ? w.shotsPerCycle : ((w.ammo || 1) * (w.attacks || 1) * (w.mounts || 1));
        const cyc = (w.atkDuration || 0) + (w.cooldown || 1);
        const nat = (w.singleDmg || 0) * shots * 60 / Math.max(0.01, cyc);
        if (panel > 0 && nat > 0) {
            const r = nat / panel;
            if (r > 20 || r < 0.05) add('⑨ 面板与单发推算差>20倍', nm + ' / ' + String(w.name).slice(0, 24) +
                ' 面板=' + panel + ' 推算=' + Math.round(nat) + ' 倍=' + r.toFixed(1));
        }
        /* 攻击序列缺失 */
        if (!(w.targets || []).length && (w.weaponType || '') !== 'support')
            add('⑩ 武器缺攻击序列', nm + ' / ' + String(w.name).slice(0, 26));
    });
    /* ⑪ 零武器船（非 support/工程） */
    if (weaponN === 0 && !/工程|支援舰/.test(nm)) add('⑪ 零武器船', nm);
    /* ⑫ 模块变体存在但全无武器（对战斗船可疑） */
    Object.entries(s.modules || {}).forEach(([k, m]) => {
        if (k.startsWith('_') || !m || !m.variants) return;
        const vk = Object.keys(m.variants);
        if (!vk.length) return;
        const anyW = vk.some(x => ((m.variants[x] || {}).weapons || []).length);
        if (!anyW && !/装甲|维修|护卫|拦截|火控|投射|系统/.test(String(m.name || '')))
            add('⑫ 模块全变体无武器', nm + ' / ' + k + '（' + (m.name || '') + '）');
    });
});

/* 输出 */
Object.keys(ISSUES).sort().forEach(k => {
    P('## ' + k + '（' + ISSUES[k].length + ' 条）');
    P('');
    ISSUES[k].slice(0, 25).forEach(x => P('- ' + x));
    if (ISSUES[k].length > 25) P('- …（共 ' + ISSUES[k].length + ' 条）');
    P('');
});
const tot = Object.values(ISSUES).reduce((a, b) => a + b.length, 0);
fs.writeFileSync('C:/Users/Administrator/Desktop/全库数据质量审计-2026-10-02.md', L.join('\r\n'), 'utf8');
fs.writeFileSync(path.join(ROOT, 'docs_全库数据质量审计-2026-10-02.md'), L.join('\r\n'), 'utf8');
console.log('共发现 ' + tot + ' 条可疑：');
Object.entries(ISSUES).sort().forEach(([k, v]) => console.log('  ' + k + ' : ' + v.length));
