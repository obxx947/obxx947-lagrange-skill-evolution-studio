/* 加点实现率【逐 stat 审计】—— 回答「所有的加点都可以运行吗」
   做法：对每个可加点节点的 stat，在 simulator.html 里找【真正的读取点】
   （形如 s.xxx / ship.xxx / ws.strengthen.xxx / st.xxx / .xxx !== undefined 等），
   再看它是否落在某个"被引擎消费"的桶里。只认字符串里的出现不算。
   跑法：node _audit_stats.js
*/
const fs = require('fs');
const st = require('./data/blueprint_stats.json');
const src = fs.readFileSync('simulator.html', 'utf8');

/* 去注释（保留字符串，因为字段名常常写在字符串里，如映射表） */
const noComment = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
                     .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(Math.max(0, m.length - p.length)));

const stats = [...new Set(Object.entries(st.nodes || {}).filter(([, c]) => c.addable && c.stat).map(([, c]) => c.stat))].sort();

const out = [];
for (const k of stats) {
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* 四种"真读"形态 */
  const reads = [
    new RegExp('\\.' + esc + '\\b(?!\\s*:)'),        // s.xxx  /  st.xxx  /  strengthen.xxx（排除对象字面量的  key:）
    new RegExp('\\[\\s*[\'"]' + esc + '[\'"]\\s*\\]'), // obj['xxx']
    new RegExp('\\b' + esc + '\\s*[?:]\\s*'),          // xxx ? :   三元的读
    new RegExp('\\b' + esc + '\\s*\\|\\|'),            // xxx || 0
    new RegExp('\\(' + esc + '\\s*\\+'),               // (xxx +
  ];
  let hits = 0, samples = [];
  const lines = noComment.split('\n');
  lines.forEach((l, i) => {
    if (reads.some(r => r.test(l))) { hits++; if (samples.length < 2) samples.push((i + 1) + ':' + l.trim().slice(0, 92)); }
  });
  /* 也要看它有没有出现在分组表里（管线→桶的入口） */
  const inGroups = Object.entries(st.groups || {}).filter(([, arr]) => arr.includes(k)).map(([g]) => g);
  out.push({ k, hits, inGroups, samples, nodes: Object.values(st.nodes).filter(c => c.addable && c.stat === k).length });
}

console.log('===== 可加点 stat 逐个审计（共 ' + out.length + ' 种）=====\n');
let bad = [], weak = [];
out.sort((a, b) => a.hits - b.hits);
for (const r of out) {
  if (r.hits === 0) bad.push(r);
  else if (r.hits <= 2) weak.push(r);
}
console.log('【完全没有读取点】' + bad.length + ' 种：');
bad.forEach(r => console.log('  ❌ ' + r.k.padEnd(22) + ' 节点 ' + String(r.nodes).padStart(4) + '  分组：' + (r.inGroups.join(',') || '（无）')));
console.log();
console.log('【只有 1~2 处读取点（可疑）】' + weak.length + ' 种：');
weak.forEach(r => console.log('  ⚠️  ' + r.k.padEnd(22) + ' 节点 ' + String(r.nodes).padStart(4) + '  分组：' + (r.inGroups.join(',') || '（无）')));
console.log();
console.log('【读取点 ≥3，正常】' + (out.length - bad.length - weak.length) + ' 种：');
out.filter(r => r.hits > 2).forEach(r => console.log('  ✅ ' + r.k.padEnd(22) + ' 节点 ' + String(r.nodes).padStart(4) + '  读取点 ' + String(r.hits).padStart(3) + '  分组：' + (r.inGroups.join(',') || '（无）')));
