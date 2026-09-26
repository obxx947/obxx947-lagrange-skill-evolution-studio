# -*- coding: utf-8 -*-
"""把全库对账查出的 6 艘缺失模块补进 ship_database.json（数值全部来自《舰船资料》）"""
import json, re

db = json.load(open('data/ship_database.json', encoding='utf-8'))
ships = list(db) if isinstance(db, list) else list(db.values())

def find_mod(ship, key_hint, name_hint):
    for k, m in (ship.get('modules') or {}).items():
        if k.startswith('_'):
            continue
        if m.get('type') == 'moduleGroup' and m.get('variants'):
            for vk, v in m['variants'].items():
                if key_hint and (vk == key_hint or vk.endswith(key_hint)):
                    return v
                if name_hint and name_hint in str(v.get('name') or ''):
                    return v
        else:
            if key_hint and k == key_hint:
                return m
            if name_hint and name_hint in str(m.get('name') or ''):
                return m
    return None

def repair_w(name, val, src):
    return {'name': name, 'dmgType': 'none', 'weaponType': 'support',
            'singleDmg': 0, 'ammo': 1, 'attacks': 1, 'atkDuration': 0,
            'lockTime': 0, 'cooldown': 0, 'priority': '友方',
            'dpm': {'repair': val}, 'targets': [], '_src': src}

def dmg_w(name, val, src, aa=True):
    return {'name': name, 'dmgType': 'physical', 'weaponType': 'direct',
            'singleDmg': max(1, int(val / 6)), 'ammo': 1, 'attacks': 1, 'mounts': 1,
            'atkDuration': 0, 'lockTime': 0, 'cooldown': 3, 'priority': '舰载机',
            'antiAirType': 'counter' if aa else None,
            'targets': [{'types': ['战机'], 'hitMin': 70, 'hitMax': 100},
                        {'types': ['护航艇', '登陆舰'], 'hitMin': 70, 'hitMax': 100}],
            'dpm': {'antiShip': 0, 'antiAir': val}, '_src': src}

JOBS = [
    ('eternal-vault', 'C3', '支援维修无人机', repair_w('支援维修无人机系统', 8181, '《舰船资料》C3 支援维修无人机系统：维修量 8181/分钟')),
    ('s-levi9', 'M1', '综合支援平台', dmg_w('SG-1120通用火炮', 270, '《舰船资料》M1 综合支援平台：SG-1120通用火炮 270/分钟', aa=False)),
    ('s-levi9', 'D2', '维修无人机', repair_w('维修无人机系统', 5454, '《舰船资料》D2 维修无人机系统：维修量 5454/分钟')),
    ('s-levi9', 'E1', '区域防空', dmg_w('SM-4x40B防空导弹发射井', 882, '《舰船资料》E1 区域防空系统：SM-4x40B防空导弹发射井 882/分钟')),
    ('ediacara', 'D2', '自维修', repair_w('纳米级自维修系统', 5169, '《舰船资料》D2 纳米级自维修系统：维修量 5169/分钟')),
    ('antontas', 'C1', '强化装甲', repair_w('强化装甲系统', 6545, '《舰船资料》C1 强化装甲系统：维修量 6545/分钟')),
    ('uranus-spear', 'B3', '损管', repair_w('CRT-3工程机器人维修仓', 5727, '《舰船资料131》B3 综合损管系统：CRT-3工程机器人维修仓 维修量 5727/分钟')),
    ('constantine', 'D3', '损管', repair_w('AST-50型损伤管理系统', 4800, '《舰船资料》D3 损管系统：AST-50型损伤管理系统 维修量 4800/分钟')),
]

log = []
for sid, key, namehint, weapon in JOBS:
    s = next((x for x in ships if x.get('id') == sid), None)
    if not s:
        log.append('✗ 找不到 ' + sid); continue
    v = find_mod(s, key, namehint)
    if not v:
        log.append('✗ %s 找不到模块 %s / %s（现有：%s）' % (sid, key, namehint, ','.join((s.get('modules') or {}).keys())))
        continue
    v.setdefault('weapons', [])
    if any((w.get('dpm') or {}).get('repair') or w.get('name') == weapon['name'] for w in v['weapons']):
        log.append('· %s %s 已有，跳过' % (sid, key)); continue
    v['weapons'].append(weapon)
    log.append('✓ %s %s「%s」→ 补入 %s' % (sid, key, v.get('name'), weapon['name']))

# 野火条目改名（库内 `wildfire` 的 hp=6800 对应《舰船资料161》野火-战术鱼雷护航艇（防御A型））
wf = next((x for x in ships if x.get('id') == 'wildfire'), None)
if wf and wf.get('name') != '野火-战术鱼雷护航艇（防御A型）':
    log.append('✓ 改名 %s：%s → 野火-战术鱼雷护航艇（防御A型）' % ('wildfire', wf.get('name')))
    wf['name'] = '野火-战术鱼雷护航艇（防御A型）'

json.dump(db, open('data/ship_database.json', 'w', encoding='utf-8'), ensure_ascii=False)
for l in log:
    print('  ' + l)
