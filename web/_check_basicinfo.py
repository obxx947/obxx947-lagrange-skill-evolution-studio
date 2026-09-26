# -*- coding: utf-8 -*-
"""逐艘核对 知识库2/数据/舰船基础信息.md 的人口 / 服役上限 / 母舰载机搭载容量  vs  ship_database.json"""
import re, json, os

DOC = r'C:\Users\Administrator\Desktop\知识库2\数据\舰船基础信息.md'
db = json.load(open('data/ship_database.json', encoding='utf-8'))
dbships = list(db) if isinstance(db, list) else list(db.values())

t = open(DOC, encoding='utf-8').read()

# ---- 1) 人口 / 服役上限 ----
# 两种写法： 「- 全部型号：人口 3，服役上限 15」 / 「- 侦察型 A：人口 4，服役上限 10」
rows = []          # (家族名, 型号后缀, 人口, 服役上限)
fam = None
for L in t.split('\n'):
    if L.startswith('### '):
        fam = L[4:].strip()
        continue
    m = re.match(r'^-\s*(.+?)：人口\s*(\d+)(?:/\d+)?，服役上限\s*(\d+)', L)
    if m and fam:
        rows.append((fam, m.group(1).strip(), int(m.group(2)), int(m.group(3))))

def norm(s):
    x = str(s or '')
    x = re.sub(r'[（(][^）)]*[）)]', '', x)
    x = re.sub(r'[\s\u3000·]', '', x)
    return x.lower()

out = []
for fam, var, pop, svc in rows:
    f = norm(fam).replace('型', '').replace('级', '')
    cands = [s for s in dbships if f and (f in norm(s.get('name')).replace('型', '').replace('级', ''))]
    if var.startswith('全部'):
        pass                                  # 家族全部型号
    else:
        v = norm(re.split(r'[\s　]', var)[-1]) if var else ''
        v = norm(var)
        hit = [s for s in cands if v and v in norm(s.get('name'))]
        if hit:
            cands = hit
    if not cands:
        out.append(('NO-MATCH', fam, var, pop, svc, '', '', ''))
        continue
    for s in cands:
        out.append(('OK', fam, var, pop, svc, s.get('id'), s.get('commandValue'), s.get('serviceLimit')))

bad = [r for r in out if r[0] == 'OK' and (r[3] != r[6] or r[4] != r[7])]
nomatch = [r for r in out if r[0] == 'NO-MATCH']

print('=' * 90)
print('舰船基础信息.md：解析出 %d 条；比对上 %d 条；其中【人口/服役对不上】%d 条；库内找不到 %d 条'
      % (len(rows), len([r for r in out if r[0] == 'OK']), len(bad), len(nomatch)))
print('=' * 90)
if bad:
    print('\n### 人口 / 服役上限 不一致（文档 vs 库）###')
    seen = set()
    for _, fam, var, pop, svc, sid, dpop, dsvc in bad:
        k = (sid, pop, svc)
        if k in seen:
            continue
        seen.add(k)
        print('  %-14s %-12s [%s]  文档 人口%-3s 服役%-3s  →  库 人口%-3s 服役%-3s'
              % (fam, var, sid, pop, svc, dpop, dsvc))
if nomatch:
    print('\n### 文档里有、但按家族名在库里找不到 ###')
    for _, fam, var, pop, svc, _, _, _ in nomatch[:30]:
        print('  %-16s %s（人口%s 服役%s）' % (fam, var, pop, svc))

# ---- 2) 母舰载机搭载容量 ----
cap = []
fam = None
for L in t.split('\n'):
    if L.startswith('### '):
        fam = L[4:].strip()
        continue
    L = L.strip()
    if not L.startswith('- ') or '：' not in L:
        continue
    if '个' not in L or '战机' not in L and '护航艇' not in L:
        continue
    body = L[2:]
    head, _, rest = body.partition('：')
    if not re.search(r'(M\d|A\d|B\d|C\d|D\d|E\d)', head):
        continue
    parts = re.split(r'[；;]', rest)
    for p in parts:
        m = re.search(r'(大/中/小型|中型/小型)?\s*(战机|护航艇)\s*(\d+)\s*个', p)
        if m:
            cap.append((fam, head.strip(), m.group(1) or '', m.group(2), int(m.group(3))))

print('\n### 母舰载机搭载容量（文档）###')
for fam, head, size, kind, n in cap:
    print('  %-12s %-8s %s%s ×%d' % (fam, head, size, kind, n))
json.dump({'pop': out, 'cap': cap}, open('_basicinfo.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
