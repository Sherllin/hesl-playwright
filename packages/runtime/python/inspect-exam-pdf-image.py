"""核对实际PDF是否嵌入指定科学题图，不能拿水印或任意图片代替。"""
import io
import json
import sys
import pymupdf
from PIL import Image, ImageChops, ImageStat

expected = Image.open(sys.argv[1]).convert('RGB').resize((190, 115))
document = pymupdf.open(stream=sys.stdin.buffer.read(), filetype='pdf')
matches = []
for number, page in enumerate(document):
    for item in page.get_images(full=True):
        extracted = document.extract_image(item[0])
        actual = Image.open(io.BytesIO(extracted['image'])).convert('RGB')
        if abs(actual.width / actual.height - 760 / 460) > 0.03:
            continue
        delta = sum(ImageStat.Stat(ImageChops.difference(expected, actual.resize((190, 115)))).mean) / 3
        if delta < 5:
            for box in page.get_image_rects(item[0]):
                matches.append({'page': number + 1, 'box': list(box), 'delta': delta,
                                'aspectError': abs((box.width / box.height) / (760 / 460) - 1),
                                'insidePage': page.rect.contains(box)})
print(json.dumps({'matches': matches}))
