import glob, os
from PIL import Image
from rapidocr import RapidOCR
e = RapidOCR()
fs = sorted(glob.glob(r'C:\Users\Administrator\Desktop\拉格朗日_战报2\Screenshot_*.jpg'))
out = open('_r2_text.txt', 'w', encoding='utf-8')
out.write('战报2 截图 %d 张\n' % len(fs))
for f in fs:
    im = Image.open(f)
    r = e(im)
    txts = list(r.txts) if r.txts else []
    out.write('\n===== %s  %s\n' % (os.path.basename(f)[10:16], im.size))
    out.write('  ' + ' | '.join(t.replace('\n', ' ') for t in txts) + '\n')
    out.flush()
out.close()
print('DONE', len(fs))
