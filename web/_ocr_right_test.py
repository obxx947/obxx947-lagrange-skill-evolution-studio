import glob, re
from PIL import Image
from rapidocr import RapidOCR
e = RapidOCR()
fs = sorted(glob.glob(r'C:\Users\Administrator\Desktop\拉格朗日_战报1\Screenshot_2026*.jpg'))
BOX=(760,150,2010,1010)
for f in [fs[3], fs[10]]:
    r = e(Image.open(f).crop(BOX))
    print('=====', f[-24:])
    if r.txts:
        for t in r.txts: print('   ', t)
