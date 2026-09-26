/* sysmap 兜底：把"带着武器类统计量、却没对上模块"的系统（scope=null）配到本舰有武器的模块上。
   背景（用户 2026-09-25）：没配上的系统会被引擎当【舰船级】→ 它的武器加成会加到全舰所有武器上
   （就是"本系统加点串到其它系统"）。全库原来剩 64 个系统 / 300 个可加点。
   规则：
     1) 只处理【含武器类统计量节点】的未匹配系统（纯电子/装甲/动力类不动，它们本来就该是舰船级）
     2) 配给本舰【有武器的模块】里名字最像的那个；名字都不像就用唯一那个
     3) 允许"多个系统共用一个模块"—— 库里常常只有 1 个武器模块，而蓝图有 2 个武器系统
        （如 卡利莱恩-重炮护卫舰：蓝图有「重炮系统」+「近防火炮系统」，库里只有 M1 舰首重炮系统）
   跑法：node _fix_sysmap_weapons.js
*/
const fs = require('fs');
const sm = JSON.parse(fs.readFileSync('./data/blueprint_sysmap.json', 'utf8'));
const st = JSON.parse(fs.readFileSync('./data/blueprint_stats.json', 'utf8'));
const bp = JSON.parse(fs.readFileSync('./data/blueprint_all.json', 'utf8'));
const map = JSON.parse(fs.readFileSync('./data/blueprint_map.json', 'utf8'));
const dbRaw = JSON.parse(fs.readFileSync('./data/ship_database.json', 'utf8'));
const ships = Array.isArray(dbRaw) ? dbRaw : dbRaw.ships;

const WSTAT = new Set(['singleDmg', 'cooldownReduction', 'crit', 'critDmg', 'lockReduction', 'atkReduction',
  'hitBonus', 'lockEfficiency', 'antiIntercept', 'multiTarget', 'denseFire', 'focusTargets', 'sysIntercept', 'weaponDuration']);
const norm = s => String(s || '').replace(/[“”"'「」『』\s\-—_·（）()【】\[\]，,。.、]/g, '').replace(/[系统平台搭载装置模块设备型级舰只的]/g, '').toLowerCase();
function dice(a, b) { const A = new Set(), B = new Set(); for (let i = 0; i < a.length - 1; i++) A.add(a.substr(i, 2)); for (let i = 0; i < b.length - 1; i++) B.add(b.substr(i, 2)); if (!A.size || !B.size) return 0; let h = 0; A.forEach(x => { if (B.has(x)) h++; }); return 2 * h / (A.size + B.size); }

let fixed = 0; const rep = [];
Object.keys(sm).forEach(cdn => {
  const slug = Object.keys(map).find(k => String(map[k].cdnId) === String(cdn));
  const sh = ships.find(x => x.id === slug); if (!sh) return;
  const b = bp.find(x => String(x.id) === String(cdn)); if (!b) return;
  // 本舰"有武器的模块"（含 moduleGroup 变体）
  const wmods = [];
  Object.entries(sh.modules || {}).forEach(([k, m]) => {
    if (k[0] === '_' || !m) return;
    if (m.type === 'moduleGroup' && m.variants) {
      Object.entries(m.variants).forEach(([vk, g]) => { if ((g.weapons || []).length) wmods.push({ key: k, variant: vk, name: g.name || m.name || '', ws: g.weapons }); });
    } else if ((m.weapons || []).length) wmods.push({ key: k, variant: '', name: m.name || '', ws: m.weapons });
  });
  if (!wmods.length) return;
  Object.entries(sm[cdn].systems || {}).forEach(([sid, rec]) => {
    const sc = rec.scope; if (!(sc === null || sc === undefined || sc === 'none')) return;
    const sys = b.systems.find(y => String(y.sysId) === String(sid)); if (!sys) return;
    const nW = (sys.nodes || []).filter(x => { const c = st.nodes[x.id]; return c && c.addable && WSTAT.has(c.stat); }).length;
    if (!nW) return;                                     // 纯电子/装甲/动力 → 本来就该舰船级
    // 选最像的模块
    let best = null, bs = -1;
    wmods.forEach(m => { const s2 = dice(norm(sys.sysName), norm(m.name)); if (s2 > bs) { bs = s2; best = m; } });
    if (!best) return;
    /* 闸门：相似度低时，只有【系统名本身像武器系统】才硬配。
       否则宁可让它留在舰船级，也不要把「装甲/预警/防空/干扰」这类配到武器模块上
       （配错比外溢更难查）。 */
    const WEAPONISH = /火炮|炮|导弹|鱼雷|轨道|脉冲|离子|投射|武器|无人机|激光|机炮|发射|能源|弹/;
    if (bs < 0.2 && !WEAPONISH.test(sys.sysName || '')) return;   // 名字不是武器系统 → 保持舰船级
    rec.scope = 'module'; rec.key = best.key;
    if (best.variant) rec.variant = best.variant;
    rec.matchedLabel = best.name; rec.sysName = sys.sysName;
    rec.score = Math.round(bs * 100) / 100;
    rec._fallback = '按"含武器统计量+本舰武器模块"兜底配（_fix_sysmap_weapons.js）';
    fixed++;
    rep.push(sh.name + '【' + sys.sysName + '】→ ' + best.key + (best.variant || '') + '（' + nW + ' 节点, 相似 ' + rec.score + '）');
  });
});
fs.writeFileSync('./data/blueprint_sysmap.json', JSON.stringify(sm));
console.log('兜底配上 ' + fixed + ' 个系统：');
rep.forEach(x => console.log('  ' + x));
