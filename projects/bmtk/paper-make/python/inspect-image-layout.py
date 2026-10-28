"""Match source pixels, then inspect actual page paint rather than file resources."""
import io
import json
from pathlib import Path
import sys
import pymupdf
from PIL import Image, ImageChops, ImageStat

fixtures = json.loads(Path(sys.argv[1]).read_text())
expected = [(image, Image.open(image['path']).convert('RGB').resize((64, 64))) for image in fixtures]
output = Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
document = pymupdf.open(stream=sys.stdin.buffer.read(), filetype='pdf')
pages, pictures = [], []
for page in document:
    raster = page.get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False)
    screenshot = output / f'page-{page.number + 1}.png'
    raster.save(screenshot)
    # Invisible signature glyphs do not obscure the paper's visible content.
    text_boxes = [{'text': chr(char[0]), 'box': list(char[3])}
                  for span in page.get_texttrace() if span['type'] != 3 and span.get('opacity', 1) > 0
                  for char in span['chars'] if 0 <= char[0] <= 0x10FFFF and not chr(char[0]).isspace()]
    pages.append({'width': page.rect.width, 'height': page.rect.height, 'image': str(screenshot), 'words': text_boxes})
    for image in page.get_image_info(xrefs=True):
        if not image['xref']:
            continue
        actual = Image.open(io.BytesIO(document.extract_image(image['xref'])['image'])).convert('RGB').resize((64, 64))
        distances = [(sum(ImageStat.Stat(ImageChops.difference(actual, thumbnail)).mean) / 3, fixture)
                     for fixture, thumbnail in expected]
        delta, fixture = min(distances, key=lambda pair: pair[0])
        if delta > 8:
            continue
        box = pymupdf.Rect(image['bbox'])
        dx, dy = box.width * 5 / fixture['width'], box.height * 5 / fixture['height']
        corners = []
        for x, y in [(box.x0+dx, box.y0+dy), (box.x1-dx, box.y0+dy), (box.x0+dx, box.y1-dy), (box.x1-dx, box.y1-dy)]:
            px, py = round(x*2), round(y*2)
            corners.append(list(raster.pixel(px, py)) if 0 <= px < raster.width and 0 <= py < raster.height else [])
        pictures.append({'role': fixture['role'], 'page': page.number, 'box': list(box),
                         'width': fixture['width'], 'height': fixture['height'], 'corners': corners})
print(json.dumps({'text': '\n'.join(page.get_text() for page in document), 'pages': pages, 'pictures': pictures}))
