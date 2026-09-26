# -*- coding: utf-8 -*-
"""全库逐舰对账：《舰船资料》187 份  vs  ship_database.json 200 条"""
import glob, re, json, os

def natkey(f):
    m = re.search(r'(\d+)', os.path.basename(f))
    return int(m.group(1)) if m else 0

db = json.load(open('data/ship_database.json', encoding='utf-8'))
dbships = list(db) if isinstance(db, list) else list(db.values())

def db_weapons(s):
    out = []
    for k, m in (s.get('modules') or {}).items():
        if k.startswith('_'):
            continue
        bags = list(m['variants'].values()) if (m.get('type') == 'moduleGroup' and m.get('variants')) else [m]
        for v in bags:
            if not v:
                continue
            for w in (v.get('weapons') or []):
                out.append({'mod': k, 'var': v.get('name') or k, 'name': w.get('name') or '', 'w': w})
    return out

def norm(s):
    x = str(s or '')
    x = re.sub(r'[\uff08(][^\uff09)]*[\uff09)]', '', x)   # 去掉括号内容（含 (x2)/(5架)/（可选））
    x = x.replace('\u00d7', 'x').replace('\uff0a', 'x')
    x = re.sub(r'[\s\u3000\u00b7\u3001,\uff0c]', '', x)
    return x

def core(s):
    x = norm(s)
    x = re.sub(r'x\d+', '', x)
    x = re.sub(r'^\d+', '', x)
    return x

def tok(s):
    x = str(s or '').replace('\u00d7', 'x')
    return set(m.lower() for m in re.findall(r'[A-Za-z]{1,4}[-\u2013]?\d{2,4}[A-Za-z]?', x))

report = []
for f in sorted(glob.glob('data/knowledge/舰船资料*.md'), key=natkey):
    t = open(f, encoding='utf-8', errors='replace').read()
    name = t.split('\n')[0].strip()
    m0 = re.search(r'结构值\*\*:\s*(\d+)', t)
    hp = int(m0.group(1)) if m0 else 0
    secs = re.split(r'\n#{3,5}\s*', t)
    kbmods = []
    for sec in secs[1:]:
        lines = sec.split('\n')
        title = lines[0].strip()
        ws = []
        cur = None
        for L in lines[1:]:
            m = re.match(r'^\s*[-*]?\s*(\d+)\s*[\u00d7xX]\s*(.+?)\s*$', L)
            if m and len(m.group(2)) < 60:
                cur = m.group(2).strip()
                continue
            m2 = re.search(r'每分钟伤害[：:]\s*([0-9.]+)', L)
            if m2 and cur:
                ws.append((cur, float(m2.group(1)), 'dmg')); cur = None; continue
            m3 = re.search(r'维修量[：:]\s*([0-9.]+)\s*/?\s*分钟', L)
            if m3:
                ws.append((cur or title, float(m3.group(1)), 'repair')); cur = None; continue
        if ws:
            kbmods.append((title, ws))
    report.append({'file': os.path.basename(f), 'kbname': name, 'kbhp': hp, 'kbmods': kbmods})

def norm_full(s):
    x = str(s or '')
    x = x.replace(chr(0x00d7), 'x').replace(chr(0xff0a), 'x')
    x = re.sub(r'[\s　·、,，]', '', x)
    return x.lower()

def find_db(kbname):
    n = norm_full(kbname)
    for s in dbships:
        if norm_full(s.get('name')) == n:
            return s
    n = norm(kbname)
    best = None; bs = 0
    for s in dbships:
        sn = norm(s.get('name'))
        sc = 0
        if sn == n:
            sc = 999
        elif sn and (sn in n or n in sn):
            sc = min(len(sn), len(n)) + 10
        else:
            a = re.sub(r'[-].*$', '', n); b = re.sub(r'[-].*$', '', sn)
            if a and b and (a in b or b in a):
                sc = min(len(a), len(b)) + 3
        if sc > bs:
            bs = sc; best = s
    return best if bs >= 3 else None


# 同族不同型号的人工映射（匹配器在这些族上会认错）
OVERRIDE = {
  '卡利莱恩级-侦察护卫舰': 'kalilaien',
  '卡利莱恩级-重炮护卫舰': 'kalilaien-B',
  '红宝石级-实验型离子炮护卫舰': 'ruby-B',
  'FSV380支援舰': 'FSV830',
  'XT-8级-武装导弹调查舰': 'XT8-missile',
  '重炮型B-TE版': 'kalilaien-B-TE',
  '野火-战术鱼雷护航艇': 'wildfire',
  '野火-格斗护航艇': 'wildfire-AA-A',
  '野火-TE-鱼雷艇': 'wildfire-TE',
  'XT-8级-两栖登陆舰': 'XT8-landing',
  'ATO21-重型攻击机-C': 'ship-ato21c',
  '阅神星I级-机动突击驱逐舰A': 'yueshenxing-A',
}
def _find_db2(kbname):
    for k, v in OVERRIDE.items():
        if k in kbname:
            for s2 in dbships:
                if s2.get('id') == v: return s2
    return find_db(kbname)

TOT = {'ships': 0, 'noMatch': [], 'hpDiff': [], 'missingWeapon': [], 'ok': 0}
for r in report:
    s = _find_db2(r['kbname'])
    TOT['ships'] += 1
    if not s:
        TOT['noMatch'].append(r['kbname']); continue
    r['dbid'] = s.get('id')
    if r['kbhp'] and s.get('hp') and r['kbhp'] != s['hp']:
        TOT['hpDiff'].append((r['kbname'], r['kbhp'], s['hp'], s.get('id')))
    dws = db_weapons(s)
    dnames = [core(x['name']) for x in dws]
    dtoks = set()
    for x in dws:
        dtoks |= tok(x['name'])
    miss = []
    for title, ws in r['kbmods']:
        for wn, val, kind in ws:
            c = core(wn)
            hit = any(c and (c in d or d in c) for d in dnames)
            if not hit:
                ct = tok(wn)
                if ct and (ct & dtoks):
                    hit = True
            if not hit and c:
                miss.append({'mod': title, 'weapon': wn, 'val': val, 'kind': kind})
    if miss:
        TOT['missingWeapon'].append({'ship': r['kbname'], 'id': s.get('id'), 'miss': miss})
    else:
        TOT['ok'] += 1

kbset = set(norm(r['kbname']) for r in report)
dbextra = []
for s in dbships:
    c = core(s.get('name'))
    if c and not any(c in kbk or kbk in c for kbk in kbset):
        dbextra.append((s.get('id'), s.get('name')))

print('=' * 78)
print('KB 舰船 %d ｜ 武器全在库 %d ｜ 库内无对应 %d ｜ 结构值不一致 %d ｜ 有武器缺失 %d'
      % (TOT['ships'], TOT['ok'], len(TOT['noMatch']), len(TOT['hpDiff']), len(TOT['missingWeapon'])))
print('=' * 78)
print('\n### 结构值不一致（KB vs 库）###')
for n, a, b, i in TOT['hpDiff']:
    print('  %-36s [%s]  KB %8d  库 %8d  (%+.1f%%)' % (n, i, a, b, (b / a - 1) * 100 if a else 0))
print('\n### 库内无对应 KB 的舰船（%d）###' % len(dbextra))
for i, n in dbextra:
    print('  [%s] %s' % (i, n))
print('\n### 武器有缺失的舰船 ###')
for r in TOT['missingWeapon']:
    print('  ' + r['ship'] + '  [' + str(r['id']) + '] 缺 ' + str(len(r['miss'])) + ' 项')
    for m in r['miss'][:8]:
        print('       · ' + str(m['mod'])[:26] + ' | ' + m['weapon'][:42] + ' = ' + str(m['val']) + ' ' + m['kind'])
json.dump(TOT, open('_fullcheck.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
