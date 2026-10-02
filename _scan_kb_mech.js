/* 扫知识库 A资料 + 舰船资料，找出【机制类】描述，并对库里的实现状态
   输出：桌面/A资料机制扫描-2026-10-02.md
   判据：句子含机制关键词（掩护/集火/融化/引爆/连锁/过载/反击/免疫/转移/分摊/叠加/层数…） */
const fs = require('fs');
const path = require('path');

const KB = 'C:/Users/Administrator/Desktop/知识库2/知识库';
const OUT = 'C:/Users/Administrator/Desktop/A资料机制扫描-2026-10-02.md';

/* 机制关键词 → 引擎里对应的字段/函数名（用于判断"库里实现了吗"） */
const KEYS = [
    ['掩护', ['cover', 'coverModule']],
    ['集火', ['strike', 'focusTargets', 'targetPriority']],
    ['融化', ['armorDebuff']],
    ['溶甲', ['armorDebuff']],
    ['引爆', []],
    ['连锁', []],
    ['过载', []],
    ['反击', ['counter', 'counterSub']],
    ['免疫', []],
    ['转移', ['protectFromSub']],
    ['分摊', ['split']],
    ['叠加', []],
    ['层数', []],
    ['无敌', []],
    ['秒杀', []],
    ['优先攻击', ['targetPriority', 'priority']],
    ['主动防空', ['active']],
    ['区域防空', ['area']],
    ['反击防空', ['counter']],
    ['拦截', ['interceptRate', 'antiIntercept']],
    ['闪避', ['evasion', 'dodgeVsAir']],
    ['护甲', ['armorBonus', 'physResist']],
    ['护盾', ['shieldBonusPct', 'energyArmor']],
    ['维修', ['repair', 'repairEff', 'repairArmor']],
    ['返航', ['flightMode', 'flightTimeReduction']],
    ['锁定', ['lockEfficiency', 'lockReduction']],
    ['暴击', ['crit', 'critDmgDown']],
    ['隐身', []],
    ['伪装', ['disguiseAs']],
    ['规避', ['dodgeVsAir']],
    ['协同', ['cmdAssist', 'company']],
    ['指挥', ['cmdAssist']],
    ['旗舰', ['fleetFlagship', 'isFlagship']],
    ['策略', ['mechanic', 'strike']],
    ['系统破坏', ['subSystemTargets']],
    ['殉爆', ['blastHp']],
    ['分伤', ['split']],
];

const files = [];
if (fs.existsSync(KB)) {
    fs.readdirSync(KB).forEach(f => { if (/\.(md|txt)$/.test(f)) files.push(path.join(KB, f)); });
}
console.log('知识库文件数 = ' + files.length);

/* 抽句子：按中文标点切 */
const rows = [];
files.forEach(fp => {
    let txt;
    try { txt = fs.readFileSync(fp, 'utf8'); } catch (e) { return; }
    if (txt.length > 400000) return;
    const name = path.basename(fp);
    const sents = txt.split(/[。；\n\r]/).map(x => x.trim()).filter(x => x.length > 8 && x.length < 200);
    sents.forEach(s => {
        for (const [kw, impls] of KEYS) {
            if (s.indexOf(kw) < 0) continue;
            /* 只保留"讲机制"的句子（含数值或动作词） */
            if (!/[0-9]|[%％]/.test(s) && !/提升|降低|增加|减少|触发|持续|叠加|生效/.test(s)) continue;
            rows.push({ kw, impl: impls, file: name, sent: s });
            break;
        }
    });
});
console.log('命中机制的句子 = ' + rows.length);

/* 按关键词分组，逐条标注引擎里有没有对应实现 */
const SIM = fs.readFileSync(path.join(__dirname, 'simulator.html'), 'utf8');
const byKw = {};
rows.forEach(r => (byKw[r.kw] = byKw[r.kw] || []).push(r));

const L = [];
P = (...a) => L.push(a.join(''));
P('# A资料 / 舰船资料 · 机制描述扫描（2026-10-02）');
P('');
P('来源：`知识库2/知识库/*.md`（' + files.length + ' 份）');
P('判据：句子含机制关键词 + 含数值或动作词；"引擎".列 = `simulator.html` 里是否有对应字段/函数');
P('');
P('| 机制 | 命中句数 | 引擎里有对应实现 |');
P('|---|---|---|');
Object.entries(byKw).sort((a, b) => b[1].length - a[1].length).forEach(([kw, arr]) => {
    const impls = arr[0].impl || [];
    const found = impls.filter(x => SIM.indexOf(x) >= 0);
    const miss = impls.filter(x => SIM.indexOf(x) < 0);
    P('| **' + kw + '** | ' + arr.length + ' | ' +
        (impls.length === 0 ? '（无字段映射，需人工判断）' :
            (found.length === impls.length ? '✅ ' + found.join('/') :
                (found.length ? '部分 ✅ ' + found.join('/') + ' ｜ ❌ ' + miss.join('/') : '❌ ' + miss.join('/')))) + ' |');
});
P('');
P('---');
P('');
P('## 逐条（按机制分组，最多每类 12 条）');
P('');
Object.entries(byKw).sort((a, b) => b[1].length - a[1].length).forEach(([kw, arr]) => {
    P('### ' + kw + '（' + arr.length + ' 条）');
    P('');
    arr.slice(0, 12).forEach(r => P('- `' + r.file + '` ' + r.sent.replace(/\|/g, '/').slice(0, 110)));
    if (arr.length > 12) P('- …（共 ' + arr.length + ' 条）');
    P('');
});
fs.writeFileSync(OUT, L.join('\r\n'), 'utf8');
console.log('已写：' + OUT);
