import glob, os, io
from PIL import Image
from rapidocr import RapidOCR
e = RapidOCR()
fs = [f for f in sorted(glob.glob(r'C:\Users\Administrator\Desktop\拉格朗日_战报1\*.jpg'))
      if 'Screenshot_' not in os.path.basename(f)]
out = open('_ov_text.txt', 'w', encoding='utf-8')
out.write('总览图 %d 张\n' % len(fs))
for f in fs:
    im = Image.open(f)
    r = e(im)
    txts = list(r.txts) if r.txts else []
    out.write('\n===== %s  %s\n' % (os.path.basename(f)[:20], im.size))
    out.write('  ' + ' | '.join(t.replace('\n', ' ') for t in txts) + '\n')
    out.flush()
out.close()
print('DONE')
