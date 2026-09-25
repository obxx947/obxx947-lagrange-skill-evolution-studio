/* 建立「加点系统 ↔ 我们的模块」映射表 → data/blueprint_sysmap.json

   为什么需要它：加点的说明几乎都是「系统内武器…」「本系统机库内载机…」，
   只该作用于【那个系统的武器/载机】。而引擎是舰船级的。
   有了这张表，就能把每个系统的加成正确地投到对应模块的武器上。

   匹配策略（2026-09-19 重写，v2）：
     游戏里的「系统名」和资料里的「模块名」经常同一件东西两种叫法：
       护航艇坞舱 / 护航艇坞仓       （舱/仓）
       大型载机系统 / 大型舰载机系统   （载机/舰载机）
       舰船维护系统 / 舰载机维护系统   （舰船/舰载机）
       舰载机平台 / 舰载机搭载平台     （中间插了"搭载"）
     原来只认「模块名以系统名开头」，这些全都匹配不上 → 落到 scope:null → 加点被引擎丢弃。
     v2 改成三级打分 + 全船最优分配：
       ① 归一化后完全相同          → 2.0
       ② 一方以另一方开头且后缀短   → 1.5
       ③ 去掉「系统/平台/搭载/舰/型…」等停用词后做【字符二元组 Dice 相似度】
     然后在一艘船内做全局贪心分配（分数高的先配，一个模块只配一次），
     这样「舰载机平台」不会被「舰载机维护系统」抢走。
*/
const fs = require('fs');
const ROOT = 'C:/Users/Administrator/Desktop/拉格朗日智能体3';
const bp = JSON.parse(fs.readFileSync(ROOT + '/data/blueprint_all.json', 'utf8'));
const db = JSON.parse(fs.readFileSync(ROOT + '/data/ship_database.json', 'utf8'));
const bmap = JSON.parse(fs.readFileSync(ROOT + '/data/blueprint_map.json', 'utf8'));
const dbById = {}; db.forEach(s => dbById[s.id] = s);

/* 已知的舰船级系统名（作用整艘船，不该配到模块） */
const SHIP_LEVEL = [/^装甲系统$/, /^动力系统$/, /^指挥系统$/, /^中排指挥系统$/, /^后排指挥系统$/, /^前排指挥系统$/,
                    /^往复式指挥系统$/, /^附加能源/, /^能源$/, /^附加装甲系统$/, /^系统$/];

/* 归一化：去引号/英文型号/数字/空白，再干掉一批「同义不同字」的停用词 */
function norm(s) {
  return String(s || '')
    .replace(/[\u201c\u201d\u2018\u2019「」『』"'《》]/g, '')
    .replace(/[A-Za-z]+/g, '')
    .replace(/\d+/g, '')
    .replace(/[系统平台搭载装置模块设备型级舰只的]/g, '')   // 停用词
    .replace(/[舱]/g, '仓')                                  // 坞舱 = 坞仓
    .replace(/[\s\-—_·（）()【】\[\]，,。.、]/g, '')
    /* ★ 引号必须一起去掉：蓝图用全角「“…”」，库里用半角「"…"」，
       不去掉就永远匹配不上（静海区/卡利莱恩/澄海 这类带引号的系统名全中招） */
    .replace(/[“”‘’「」『』"'`]/g, '')
    .toLowerCase();
}
function bigrams(s) { const o = new Set(); if (s.length === 1) o.add(s); for (let i = 0; i < s.length - 1; i++) o.add(s.substr(i, 2)); return o; }
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0; A.forEach(x => { if (B.has(x)) hit++; });
  return 2 * hit / (A.size + B.size);
}
const MAX_SUFFIX = 12;

function score(sysName, modName) {
  const n = norm(sysName), m = norm(modName);
  if (!n || !m) return 0;
  if (n === m) return 2.0;
  if (m.indexOf(n) === 0 && (m.length - n.length) <= MAX_SUFFIX) return 1.5;
  if (n.indexOf(m) === 0 && (n.length - m.length) <= MAX_SUFFIX) return 1.5;
  return dice(n, m);
}

function moduleList(slug) {
  const s = dbById[slug]; if (!s) return [];
  const out = [];
  Object.keys(s.modules || {}).forEach(k => {
    if (k[0] === '_') return;
    const m = s.modules[k];
    if (m.type === 'moduleGroup' && m.variants) {
      Object.keys(m.variants).forEach(v => {
        const nm = m.variants[v].name || '';
        const hasAir = !!(m.variants[v].aircraft && Object.keys(m.variants[v].aircraft).length);
        out.push({ key: k, variant: v, label: nm, weapons: (m.variants[v].weapons || []).length, hasAir: hasAir });
      });
    } else {
      const nm = m.name || '';
      out.push({ key: k, variant: '', label: nm, weapons: (m.weapons || []).length, hasAir: false });
    }
  });
  return out.filter(x => x.label && !/空白/.test(x.label));   // 空白配置不参与匹配
}

const OUT = {};
const rep = { total: 0, byModule: 0, byShip: 0, unknown: 0, fuzzy: 0, nullList: [], renamed: 0 };

bp.forEach(b => {
  const slug = Object.keys(bmap).find(id => bmap[id] && String(bmap[id].cdnId) === String(b.id));
  const mods = slug ? moduleList(slug) : [];
  const sysMap = {};

  // 1) 舰船级先钉死
  const pending = [];
  b.systems.forEach(y => {
    rep.total++;
    if (SHIP_LEVEL.some(re => re.test(y.sysName))) {
      sysMap[y.sysId] = { scope: 'ship', sysName: y.sysName };
      rep.byShip++; return;
    }
    pending.push(y);
  });

  // 2) 其余系统 × 模块 全打分，全局贪心分配（高分先配，模块只能用一次）
  const cands = [];
  pending.forEach(y => mods.forEach(m => {
    const s = score(y.sysName, m.label);
    if (s > 0) cands.push({ y, m, s });
  }));
  cands.sort((a, b) => b.s - a.s);
  const usedSys = new Set(), usedMod = new Set();
  const assigned = {};
  cands.forEach(c => {
    if (usedSys.has(c.y.sysId) || usedMod.has(c.m.key + '_' + c.m.variant)) return;
    if (c.s < 0.3) return;                       // 太不像就不硬配
    usedSys.add(c.y.sysId); usedMod.add(c.m.key + '_' + c.m.variant);
    assigned[c.y.sysId] = c;
  });

  pending.forEach(y => {
    const c = assigned[y.sysId];
    if (c) {
      sysMap[y.sysId] = { scope: 'module', key: c.m.key, variant: c.m.variant, matchedLabel: c.m.label, sysName: y.sysName, score: Math.round(c.s * 100) / 100 };
      rep.byModule++;
      if (c.s < 1.5) rep.fuzzy++;
      return;
    }
    sysMap[y.sysId] = { scope: null, sysName: y.sysName };
    rep.unknown++;
    rep.nullList.push(b.shipName + ' / ' + y.sysName);
  });

  OUT[b.id] = { shipName: b.shipName, slug: slug || null, systems: sysMap };
});

// 与旧表对比
let old = {}; try { old = JSON.parse(fs.readFileSync(ROOT + '/data/blueprint_sysmap.json', 'utf8')); } catch (e) { }
let changed = 0, gained = 0;
for (const id of Object.keys(OUT)) {
  if (!old[id]) continue;
  for (const sid of Object.keys(OUT[id].systems)) {
    const a = old[id].systems[sid], c = OUT[id].systems[sid];
    if (!a) continue;
    const same = a.scope === c.scope && a.key === c.key && a.variant === c.variant;
    if (!same) changed++;
    if (a.scope === null && c.scope === 'module') gained++;
  }
}

fs.writeFileSync(ROOT + '/data/blueprint_sysmap.json', JSON.stringify(OUT), 'utf8');
console.log('系统总数 ' + rep.total);
console.log('  → 对到模块  : ' + rep.byModule + '   其中模糊匹配 ' + rep.fuzzy);
console.log('  → 舰船级    : ' + rep.byShip);
console.log('  → 仍未匹配  : ' + rep.unknown);
console.log('\n与旧表对比：改变的条目 ' + changed + '，其中「原来 null → 现在匹配到模块」' + gained + ' 个');
const uniq = [...new Set(rep.nullList)];
console.log('\n仍未匹配的系统名（去重 ' + uniq.length + ' 种）：');
uniq.slice(0, 40).forEach(x => console.log('   ' + x));
console.log('\n文件大小: ' + (fs.statSync(ROOT + '/data/blueprint_sysmap.json').size / 1024).toFixed(0) + ' KB');
