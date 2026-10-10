# -*- coding: utf-8 -*-
"""抽每份《舰船资料》的「整体火力总览：对舰X/分钟、防空Y/分钟」"""
import glob, re, json
out = []
for f in sorted(glob.glob('data/knowledge/舰船资料*.md'), key=lambda x: int(re.search(r'(\d+)', x).group(1))):
    t = open(f, encoding='utf-8', errors='replace').read()
    nm = t.split('\n')[0].strip()
    m = re.search(r'(?:整体)?火力总览[^\n]*', t)
    if not m: continue
    s = m.group(0)
    def g(k):
        mm = re.search(k + r'([0-9.]+)', s)
        return float(mm.group(1)) if mm else 0.0
    out.append({'file': f, 'name': nm, 'as': g('对舰'), 'aa': g('防空'), 'sg': g('攻城')})
json.dump(out, open('_kb_fire.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(out), '份带火力总览')
