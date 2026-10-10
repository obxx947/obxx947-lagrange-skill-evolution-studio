# -*- coding: utf-8 -*-
"""扫全部《舰船资料》，抽出「N×武器名 + 每分钟伤害：X」→ 和 ship_database 里同名武器的 dpm 对比"""
import glob, re, json, os
KBW = {}
for f in sorted(glob.glob('data/knowledge/舰船资料*.md'), key=lambda x: int(re.search(r'(\d+)', x).group(1))):
    t = open(f, encoding='utf-8', errors='replace').read()
    ship = t.split('\n')[0].strip()
    lines = t.split('\n')
    cur = None
    for i, L in enumerate(lines):
        m = re.match(r'^\s*[-*]?\s*(\d+)\s*[×xX]\s*(.+?)\s*$', L)
        if m and len(m.group(2)) < 60:
            cur = m.group(2).strip()
            continue
        m2 = re.search(r'每分钟伤害[：:]\s*([0-9.]+)', L)
        if m2 and cur:
            # 可能同一行还写了伤害类型/优先目标
            dmg = float(m2.group(1))
            seg = L
            air = bool(re.search(r'优先目标[：:]\s*(舰载机|战机|护航艇)', seg)) or '防空' in cur
            rec = KBW.setdefault(cur, {'names': set(), 'dmg': [], 'air': air})
            rec['names'].add(ship)
            rec['dmg'].append(dmg)
            cur = None
json.dump({k: {'ship': sorted(v['names']), 'dmg': v['dmg'], 'air': v['air']} for k, v in KBW.items()},
          open('_kb_weapons.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('知识库抽出武器条目', len(KBW))
