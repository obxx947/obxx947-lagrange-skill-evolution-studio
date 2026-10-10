# -*- coding: utf-8 -*-
"""载机面板：把「被编队架数除过」的改回单架口径；补矛/天枢/康纳马拉的防空
数据来源：知识库《A资料556》「林鸮对空 1800 左右」佐证；其余为 Wiki（知识库无逐舰面板）"""
import json, re

db = json.load(open('data/ship_database.json', encoding='utf-8'))
ships = list(db) if isinstance(db, list) else list(db.values())

def weapons(s):
    out = []
    for k, m in (s.get('modules') or {}).items():
        if k.startswith('_'):
            continue
        bags = list(m['variants'].values()) if (m.get('type') == 'moduleGroup' and m.get('variants')) else [m]
        for v in bags:
            if v:
                for w in (v.get('weapons') or []):
                    out.append(w)
    return out

def scale(sid, mult, note, aa_mult=None):
    s = next((x for x in ships if x.get('id') == sid), None)
    if not s:
        return '✗ 缺 ' + sid
    for w in weapons(s):
        d = w.get('dpm') or {}
        if d.get('antiShip'):
            d['antiShip'] = round(d['antiShip'] * mult)
        if d.get('antiAir'):
            d['antiAir'] = round(d['antiAir'] * (aa_mult if aa_mult is not None else mult))
        if d.get('siege'):
            d['siege'] = round(d['siege'] * mult)
        w['dpm'] = d
        w['_src'] = note
    return '✓ %s ×%.2f %s' % (sid, mult, note[:56])

log = []
# ① 林鸮A100 / 海氏追随者：面板是【单架】口径，先前被 ÷3
log.append(scale('linxiao', 3, '《A资料556》林鸮对空≈1800 + Wiki 实战加点 对舰1989/对空1377（单架）'))
log.append(scale('haishi', 3, 'Wiki 海氏追随者 实战加点 对舰4614/对空2214（单架）'))
# ② SC002
sc = next((x for x in ships if x.get('id') == 'sc002'), None)
if sc:
    for w in weapons(sc):
        if w.get('dpm', {}).get('antiShip'):
            w['dpm']['antiShip'] = 234; w['dpm']['antiAir'] = 234
    log.append('✓ sc002 → 对舰234/对空234（Wiki）')

# ③ 乌拉诺斯之矛 BG-340B 防空炮 216 → 1440
ur = next((x for x in ships if x.get('id') == 'uranus-spear'), None)
n = 0
if ur:
    for w in weapons(ur):
        if 'BG-340B' in str(w.get('name')):
            w['dpm']['antiAir'] = 1440
            w['_src'] = 'Wiki 乌拉诺斯之矛 BG-340B型防空火炮 防空火力 1440（《舰船资料131》的 216 偏低）'
            n += 1
log.append('✓ 矛 BG-340B 防空 → 1440（%d 门）' % n)

# ④ 天枢 M1 精密协同攻击无人艇（对舰6400/防空3840，Wiki 原文；先前试过又撤，这次按 Wiki 而不是我猜的 7680）
ts = next((x for x in ships if x.get('id') == 'tianshu'), None)
if ts:
    v = ts['modules']['M']['variants']['M1']
    if not any('无人艇' in str(w.get('name')) for w in (v.get('weapons') or [])):
        v['weapons'] = [{
            'name': '精密协同攻击无人艇(4架)', 'dmgType': 'energy', 'weaponType': 'direct',
            'singleDmg': 100, 'ammo': 1, 'attacks': 4, 'mounts': 1, 'atkDuration': 3, 'lockTime': 8, 'cooldown': 12,
            'priority': '护航艇', 'antiAirType': 'counter',
            'targets': [{'types': ['护航艇'], 'hitMin': 70, 'hitMax': 100},
                        {'types': ['战机'], 'hitMin': 50, 'hitMax': 70},
                        {'types': ['登陆舰'], 'hitMin': 50, 'hitMax': 70},
                        {'types': ['驱逐舰'], 'hitMin': 50, 'hitMax': 70},
                        {'types': ['护卫舰'], 'hitMin': 50, 'hitMax': 70}],
            'dpm': {'antiShip': 6400, 'antiAir': 3840, 'siege': 576},
            '_src': 'Wiki 天枢 M1 联合作战平台I：4架ET-21精密协同攻击无人艇 对舰6400/防空3840/攻城576，单发100，弹药1×4，持续3秒，冷却12秒，锁定8秒，反击防空'}]
        log.append('✓ 天枢 M1 补入 精密协同攻击无人艇 对舰6400/防空3840')

# ⑤ 康纳马拉：加 AM-4x60B型对空导弹发射巢(×2) 对空 529/门
cm = next((x for x in ships if x.get('id') == 'connemara-A'), None)
if cm:
    bad = cm.get('modules', {}).get('AD')
    if bad: del cm['modules']['AD']
    if 'AA' not in cm.setdefault('modules', {}):
        cm['modules']['AA'] = {'name': '防空系统', 'type': 'system', 'weapons': [{
            'name': 'AM-4x60B型对空导弹发射巢(×2)', 'dmgType': 'physical', 'weaponType': 'projectile',
            'singleDmg': 12, 'ammo': 1, 'attacks': 4, 'mounts': 2, 'atkDuration': 0, 'lockTime': 0, 'cooldown': 5,
            'priority': '战机', 'antiAirType': 'counter',
            'targets': [{'types': ['战机'], 'hitMin': 70, 'hitMax': 100},
                        {'types': ['护航艇', '登陆舰'], 'hitMin': 70, 'hitMax': 100}],
            'dpm': {'antiShip': 0, 'antiAir': 1058},
            '_src': 'Wiki 康纳马拉混沌级-高速等离子体巡洋舰：AM-4x60B型对空导弹发射巢×2，整舰对空火力529（按 ×2 安装数计 1058）'}]
        }
        log.append('✓ 康纳马拉 补入 AM-4x60B对空导弹发射巢(×2) 对空1058')

json.dump(db, open('data/ship_database.json', 'w', encoding='utf-8'), ensure_ascii=False)
for l in log:
    print('  ' + l)
