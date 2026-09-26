# -*- coding: utf-8 -*-
"""把「防空武器」攻击序列里【载机类目标】的命中区间，改成游戏真实的防空基础命中：
     舰载防空 15%（wiki：舰载防空武器基础命中率 15%，面板公式里就乘的 0.15）
     机载防空 60%（机载防空武器基础命中率 60%）
   为什么要改：_patch_shots 反推发数时用的 h 就是这两个值（0.15/0.6），
   但很多防空武器的 targets 写的是 70~100%，引擎按 85% 掷 → 实际输出被放大到面板的 5~6 倍。"""
import json, re

db = json.load(open('data/ship_database.json', encoding='utf-8'))
ships = list(db) if isinstance(db, list) else list(db.values())
AIR = re.compile(r'战机|护航艇|载机|无人机|登陆舰')

def is_air(t): return bool(AIR.search(str(t)))

n_ship = n_air = 0
for s in ships:
    isAC = (s.get('position') == 'aircraft')
    lo, hi = (50, 70) if isAC else (10, 20)
    for k, m in (s.get('modules') or {}).items():
        if k.startswith('_'):
            continue
        bags = list(m['variants'].values()) if (m.get('type') == 'moduleGroup' and m.get('variants')) else [m]
        for v in bags:
            for w in (v or {}).get('weapons') or []:
                tg = w.get('targets') or []
                if not tg:
                    continue
                t0 = (tg[0].get('types') or [])
                if not any(is_air(x) for x in t0):
                    continue                      # 不是对空武器，不动
                ch = 0
                for t in tg:
                    if any(is_air(x) for x in (t.get('types') or [])):
                        if t.get('hitMin') != lo or t.get('hitMax') != hi:
                            t['hitMin'], t['hitMax'] = lo, hi
                            ch += 1
                if ch:
                    w['_hitSrc'] = '游戏防空基础命中：舰载15%%/机载60%%（改成 %d~%d%%，原来写的偏高会让引擎多掷命中）' % (lo, hi)
                    if isAC: n_air += 1
                    else: n_ship += 1

json.dump(db, open('data/ship_database.json', 'w', encoding='utf-8'), ensure_ascii=False)
print('改动防空武器：舰载 %d 门 → 命中区间 10~20%% ｜ 机载 %d 门 → 50~70%%' % (n_ship, n_air))
