# -*- coding: utf-8 -*-
"""对账 桌面/舰船基础信息.txt（用户手打） vs ship_database.json 的人口/服役上限"""
import re, json

DOC = r'C:\Users\Administrator\Desktop\舰船基础信息.txt'
db = json.load(open('data/ship_database.json', encoding='utf-8'))
ships = list(db) if isinstance(db, list) else list(db.values())

t = open(DOC, encoding='utf-8', errors='replace').read()
lines = [l.strip() for l in t.split('\n') if l.strip()]
# 第一行是 sk- 开头的 key，跳过
lines = [l for l in lines if not l.startswith('sk-')]

def norm(s):
    x = re.sub(r'[（(][^）)]*[）)]', '', str(s or ''))
    x = re.sub(r'[\s\u3000—\-–·、,，]', '', x)
    return x.lower().replace('型', '').replace('级', '')

rows = []
for L in lines:
    if '人口' not in L and '服役' not in L:
        continue
    pop = re.search(r'人口[为（(]?[^\d]*(\d+)', L)
    svc = re.search(r'服役[数上]*[线限]*\D{0,4}(\d+)', L)
    name = re.split(r'[—\-–]?\s*人口', L)[0].strip(' —-–（(')
    if re.search(r'人口（(全部都为)?(\d+)）', L):
        m = re.search(r'人口（(全部都为)?(\d+)）', L)
        pop_v = int(m.group(2)); allv = True; nm = name
    else:
        pop_v = int(pop.group(1)) if pop else None
        allv = False; nm = name
    rows.append((nm, pop_v, int(svc.group(1)) if svc else None, allv, L))

print('解析出 %d 条人口/服役' % len(rows))
bad, miss = [], []
for nm0, pop, svc, allv, raw in rows:
    # 从原始行里再抠一层"XX型—人口为 N"
    sub = re.findall(r'([\u4e00-\u9fa5]{2,6})[—\-–]\s*人口[为]?\s*(\d+)', raw)
    fam = norm(re.split(r'[—\-–(:：（]', nm0)[0] or nm0)
    if not fam:
        continue
    cands = [s for s in ships if fam and fam in norm(s.get('name'))]
    if not cands:
        miss.append((nm0, raw)); continue
    if sub:
        for kind, p in sub:
            kk = norm(kind)
            hit = [s for s in cands if kk and kk in norm(s.get('name'))]
            target = hit if hit else cands
            for s in target:
                if int(p) != s.get('commandValue'):
                    bad.append((s.get('name'), s.get('id'), '人口', int(p), s.get('commandValue')))
            if not hit:
                miss.append((nm0 + '/' + kind, raw))
    else:
        for s in cands:
            if pop is not None and pop != s.get('commandValue'):
                bad.append((s.get('name'), s.get('id'), '人口', pop, s.get('commandValue')))
            if svc is not None and svc != s.get('serviceLimit'):
                bad.append((s.get('name'), s.get('id'), '服役', svc, s.get('serviceLimit')))

seen = set(); out = []
for r in bad:
    if r[:3] in seen: continue
    seen.add(r[:3]); out.append(r)
print('\n### 不一致（文档 vs 库）共 %d 条（去重后）###' % len(out))
for n, i, k, d, c in out:
    print('  %-30s [%-14s] %s  文档 %-3s → 库 %-3s' % (n, i, k, d, c))
print('\n### 文档里有、库里按名字找不到 %d 条 ###' % len(miss))
for n, raw in miss[:20]:
    print('  ' + n + '   << ' + raw[:60])
