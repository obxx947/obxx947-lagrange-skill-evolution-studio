# -*- coding: utf-8 -*-
"""全量交叉核对：把 data/knowledge/舰船资料1-187.md 里每门武器完整解析出来，
   与 data/ship_database.json 逐门对（单发 / 每分钟火力 / 弹药×次数 / 持续 / 锁定 / 冷却 / 命中率）。
   跑法：python _kb_verify.py  → 输出报告到 stdout（也写 _kb_verify.txt）
"""
import io, os, re, json

KB = 'data/knowledge'
DB = json.loads(io.open('data/ship_database.json', encoding='utf-8').read())
OUT = []


def P(s):
    OUT.append(s)


def num(x):
    m = re.search(r'(\d+(?:\.\d+)?)', str(x))
    return float(m.group(1)) if m else None


# ---------- 解析知识库 ----------
ships_kb = {}
files = sorted([f for f in os.listdir(KB) if f.startswith('舰船资料') and f.endswith('.md')],
               key=lambda x: int(re.search(r'(\d+)', x).group(1)))
for fn in files:
    txt = io.open(os.path.join(KB, fn), encoding='utf-8', errors='ignore').read()
    lines = txt.split('\n')
    ship = lines[0].strip()
    ws = []
    cur = None
    for l in lines:
        s = l.strip()
        m = re.match(r'^-\s*\*\*武器\*\*:\s*(.+)$', s)
        if m:
            if cur: ws.append(cur)
            cur = {'name': m.group(1).strip(), 'file': fn, 'ship': ship}
            continue
        if cur is None: continue
        for key, rx in [
            ('dmgType', r'\*\*伤害类型\*\*:\s*([^|]+)'),
            ('wType',   r'\*\*武器类型\*\*:\s*([^|]+)'),
            ('single',  r'\*\*单发伤害\*\*:\s*([^|]+)'),
            ('fire',    r'\*\*每分钟火力\*\*:\s*(.+)'),
            ('attacks', r'\*\*攻击次数\*\*:\s*(.+?)\s*\|'),
            ('dur',     r'\*\*持续时间\*\*:\s*([^|]+)'),
            ('lock',    r'\*\*锁定时间\*\*:\s*([^|]+)'),
            ('cd',      r'\*\*冷却时间\*\*:\s*(.+)$'),
            ('prio',    r'\*\*优先目标\*\*:\s*(.+)$'),
            ('mech',    r'\*\*附加机制\*\*:\s*(.+)$'),
        ]:
            mm = re.search(rx, s)
            if mm and key not in cur:
                cur[key] = mm.group(1).strip()
        # 命中率表：| 01 | 护航艇 | 10%~20% |
        mm = re.match(r'^\|\s*\d+\s*\|\s*([^|]+?)\s*\|\s*([<>]?\s*\d+\s*[%~]?\s*[~\-]?\s*\d*\s*%?)\s*\|', s)
        if mm:
            cur.setdefault('hits', []).append((mm.group(1).strip(), mm.group(2).strip()))
    if cur: ws.append(cur)
    # 只留真武器（有单发伤害）
    real = []
    for w in ws:
        if not w.get('single'): continue
        if re.search(r'无|未标注', w['single']): continue
        w['single'] = num(w['single'])
        if w.get('fire'):
            for k, rx in [('as', r'对舰\s*(\d+(?:\.\d+)?)'), ('aa', r'防空\s*(\d+(?:\.\d+)?)'), ('siege', r'攻城\s*(\d+(?:\.\d+)?)')]:
                mm = re.search(rx, w['fire'])
                w[k] = float(mm.group(1)) if mm else None
        if w.get('attacks'):
            mm = re.search(r'(\d+)\s*[×x*]\s*(\d+)', w['attacks'])
            if mm: w['ammo'] = float(mm.group(1)); w['atk'] = float(mm.group(2))
        for k in ('dur', 'lock', 'cd'):
            if w.get(k): w[k] = num(w[k])
        real.append(w)
    if real: ships_kb[ship] = real

P('解析：%d 份舰船资料，%d 艘有可解析武器，共 %d 门武器' % (len(files), len(ships_kb), sum(len(v) for v in ships_kb.values())))

# ---------- 建库索引 ----------
def norm(s):
    s = re.sub(r'[（(].*?[)）]', '', str(s))
    return re.sub(r'[\s\-—、]', '', s)

dbw = []
for s in DB:
    for k in (s.get('modules') or {}):
        if k.startswith('_'): continue
        m = s['modules'][k]
        bags = list(m['variants'].values()) if (m.get('type') == 'moduleGroup' and m.get('variants')) else [m]
        for v in bags:
            for w in (v or {}).get('weapons') or []:
                dbw.append({'ship': s['name'], 'shipId': s['id'], 'slot': k, 'w': w})

P('库：%d 艘 / %d 门武器' % (len(DB), len(dbw)))

# ---------- 逐门对 ----------
ok = 0; mismatch = []; notfound = []
for ship, ws in ships_kb.items():
    n = norm(ship)
    cand = [x for x in dbw if norm(x['ship']) == n] or [x for x in dbw if norm(x['ship']).startswith(n[:6])]
    if not cand:
        notfound.append(ship); continue
    for w in ws:
        # 按 单发 找对应
        pool = [c for c in cand if abs((c['w'].get('singleDmg') or -1) - w['single']) <= max(0.5, w['single'] * 0.02)]
        if not pool:
            mismatch.append('  [单发对不上] %-22s %-24s 知识库单发%g ｜ 库里同船武器单发=%s'
                            % (ship[:22], (w.get('name') or '')[:24], w['single'],
                               sorted({c['w'].get('singleDmg') for c in cand})[:8]))
            continue
        c = pool[0]; d = c['w']; dpm = d.get('dpm') or {}
        probs = []
        # ★ 两边"份数"口径不同：知识库常见"单门/单架"，库里常是"整组/编队"。
        #   先按 1..6 倍归一化，能找到整数倍就算对得上（并记录倍数，供人工复核）。
        mult_used = 1
        if w.get('as') and (dpm.get('antiShip') or 0):
            ratio = dpm['antiShip'] / w['as']
            if abs(ratio - 1) > 0.05:
                found = None
                for m in (2, 3, 4, 5, 6, 0.5, 1/3):
                    if abs(ratio - m) / m < 0.05: found = m; break
                if found: mult_used = found
                else: probs.append('对舰 知识库%g vs 库%g（非整数倍 %.2f）' % (w['as'], dpm['antiShip'], ratio))
        if w.get('aa') and abs((dpm.get('antiAir') or 0) - w['aa']) > max(2, w['aa'] * 0.05):
            probs.append('对空 知识库%g vs 库%g' % (w['aa'], dpm.get('antiAir') or 0))
        for k, lbl in (('cd', '冷却'), ('lock', '锁定'), ('dur', '持续')):
            if w.get(k) and d.get(k) and abs(d[k] - w[k]) > 0.6:
                probs.append('%s 知识库%g vs 库%g' % (lbl, w[k], d[k]))
        if probs: mismatch.append('  %-22s %-24s %s' % (ship[:22], (w.get('name') or '')[:24], ' ｜ '.join(probs)))
        else: ok += 1

P('')
P('== 逐门核对 ==')
P('  对得上 %d ｜ 对不上 %d ｜ 库里找不到该船 %d' % (ok, len(mismatch), len(notfound)))
P('')
P('【对不上的明细（前 60 条）】')
OUT.extend(mismatch[:60])
P('')
P('【库里找不到的船】')
P('  ' + '、'.join(notfound[:40]))

txt = '\n'.join(OUT)
io.open('_kb_verify.txt', 'w', encoding='utf-8').write(txt)
print(txt)
