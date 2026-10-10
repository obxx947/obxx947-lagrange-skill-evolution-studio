/* 按《舰船资料》火力总览（单架权威值）校正载机 dpm —— 保持武器结构与相对比例，只缩放 */
const fs = require('fs');
const db = JSON.parse(fs.readFileSync('data/ship_database.json', 'utf8'));
const arr = Object.values(db);
/* id -> {as,aa,sg} KB 权威（单架） */
const T = {
  'tianxuan':      { as: 3360, aa: 0,    sg: 306 },
  'lizhi':         { as: 2169, aa: 690,  sg: 180 },
  'leihuoV022':    { as: 640,  aa: 920,  sg: 104 },
  'leihuoV022-C':  { as: 1270, aa: 676,  sg: 42  },
  'br050':         { as: 2642, aa: 0,    sg: 944 },
  'br050-C':       { as: 642,  aa: 0,    sg: 254 },
  'at021':         { as: 1482, aa: 888,  sg: 42  },
  'at021-B':       { as: 843,  aa: 675,  sg: 96  },
  'B192-newland':  { as: 1374, aa: 1134, sg: 282 },
  'vitas-B010':    { as: 7276, aa: 0,    sg: 2692 },
  'vitas-A021':    { as: 2766, aa: 567,  sg: 570 },
  'tianji':        { as: 2240, aa: 460,  sg: 560 },
  'nebula-corvette': { as: 2556, aa: 573, sg: 616 },
  'hive-guardian': { as: 4989, aa: 1216, sg: 1739 },
  'ship-ato21c':   { as: 3366, aa: 0,    sg: 387 }
};
let n = 0;
Object.keys(T).forEach(id => {
  const s = arr.find(x => x.id === id);
  if (!s) { console.log('缺 ' + id); return; }
  const ws = [];
  Object.keys(s.modules || {}).filter(k => !k.startsWith('_')).forEach(k => {
    const m = s.modules[k];
    const bags = (m.type === 'moduleGroup' && m.variants) ? Object.values(m.variants) : [m];
    bags.forEach(v => (v && v.weapons || []).forEach(w => ws.push(w)));
  });
  const cur = { as: 0, aa: 0, sg: 0 };
  ws.forEach(w => { const d = w.dpm || (w.dpm = {}); cur.as += d.antiShip || 0; cur.aa += d.antiAir || 0; cur.sg += d.siege || 0; });
  const t = T[id];
  const k = { as: t.as > 0 && cur.as > 0 ? t.as / cur.as : 0, aa: t.aa > 0 && cur.aa > 0 ? t.aa / cur.aa : 0, sg: t.sg > 0 && cur.sg > 0 ? t.sg / cur.sg : 0 };
  if (!ws.length) { console.log('⚠ ' + id + ' 没有武器，跳过'); return; }
  /* 主武器（对舰占比最大的那门）承接全部对舰，防空同理 */
  let mainS = -1, mv = -1, mainA = -1, av = -1;
  ws.forEach((w, i) => { const d = w.dpm; if ((d.antiShip || 0) > mv) { mv = d.antiShip || 0; mainS = i; } if ((d.antiAir || 0) > av) { av = d.antiAir || 0; mainA = i; } });
  ws.forEach((w, i) => {
    const d = w.dpm;
    if (i === mainS) d.antiShip = t.as - (i === mainA ? 0 : 0); else if (k.as) d.antiShip = Math.round((d.antiShip || 0) * k.as);
    if (i === mainA) d.antiAir = t.aa; else if (k.aa) d.antiAir = Math.round((d.antiAir || 0) * k.aa);
    if (k.sg) d.siege = Math.round((d.siege || 0) * k.sg);
  });
  /* 主武器承接差额，使合计精确等于 KB */
  if (mainS >= 0) {
    let sum = 0, sumA = 0, sumS = 0;
    ws.forEach(w => { sum += w.dpm.antiShip || 0; sumA += w.dpm.antiAir || 0; sumS += w.dpm.siege || 0; });
    ws[mainS].dpm.antiShip += (t.as - sum);
    if (mainA >= 0) ws[mainA].dpm.antiAir += (t.aa - sumA);
    else ws[mainS].dpm.antiAir += (t.aa - sumA);
    if (t.sg > 0) ws[mainS].dpm.siege += (t.sg - sumS);
  }
  let fin = { as: 0, aa: 0, sg: 0 };
  ws.forEach(w => { fin.as += w.dpm.antiShip || 0; fin.aa += w.dpm.antiAir || 0; fin.sg += w.dpm.siege || 0; });
  console.log(id.padEnd(18) + (cur.as + '/' + cur.aa + '  →  ' + fin.as + '/' + fin.aa).padEnd(30) + (fin.as === t.as && fin.aa === t.aa && fin.sg === t.sg ? '✓' : '⚠ 不等'));
  n++;
});
fs.writeFileSync('data/ship_database.json', JSON.stringify(db), 'utf8');
console.log('\n已写库，修正 ' + n + ' 型载机');
