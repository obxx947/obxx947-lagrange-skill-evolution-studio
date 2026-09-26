import glob, re, json
from PIL import Image
from rapidocr import RapidOCR
e = RapidOCR()
fs = sorted(glob.glob(r'C:\Users\Administrator\Desktop\拉格朗日_战报1\Screenshot_2026*.jpg'))
BOX=(300,100,830,990)
def parse(txts):
    d={}
    for i,t in enumerate(txts):
        t2=t.replace(' ','')
        if '对舰伤害分析' in t2 and i+1<len(txts): d['as']=txts[i+1].replace(' ','')
        if '对空伤害分析' in t2 and i+1<len(txts): d['aa']=txts[i+1].replace(' ','')
        if '维修分析' in t2 and i+1<len(txts): d['rep']=txts[i+1].replace(' ','')
        if '生存时间占比分析' in t2 and i+1<len(txts): d['life']=txts[i+1].replace(' ','')
    for t in txts:
        t2=t.replace(' ','')
        if t2=='数据分析': continue
        if re.search(r'[\u4e00-\u9fa5]', t2) and not re.search(r'伤害分析|维修分析|占比分析|数据分析', t2) and not t2.startswith('ADV'):
            d['name']=t2; break
    return d
out=[]
for i,f in enumerate(fs):
    try:
        r = e(Image.open(f).crop(BOX))
        txts = list(r.txts) if r.txts else []
        d = parse(txts)
    except Exception as ex:
        d = {'err':str(ex)}
    d['ts']=re.search(r'_(\d{6})_',f).group(1)
    out.append(d)
    print(i, d.get('name'), d.get('as'), d.get('aa'), d.get('rep'), d.get('life'), flush=True)
json.dump(out, open('_report1_all.json','w',encoding='utf-8'), ensure_ascii=False, indent=1)
seen={}; uniq=[]
for d in out:
    k=(d.get('name'),d.get('as'),d.get('aa'),d.get('rep'),d.get('life'))
    if k not in seen: seen[k]=d; uniq.append(d)
json.dump(uniq, open('_report1_panels.json','w',encoding='utf-8'), ensure_ascii=False, indent=1)
print('DONE screens',len(out),'uniq',len(uniq), flush=True)
