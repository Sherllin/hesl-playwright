"""Generate six identifiable PNGs; no external image or source repository."""
import base64
import json
from pathlib import Path
import sys
from PIL import Image, ImageDraw

output = Path(sys.argv[1])
output.mkdir(parents=True, exist_ok=True)
result = []
for role, width, height, fill in [
    ('choice', 180, 120, (40, 130, 210)), ('option', 120, 80, (210, 120, 40)),
    ('parent', 300, 150, (130, 70, 180)), ('child', 240, 120, (40, 170, 170)),
    ('answer', 200, 100, (150, 170, 50)), ('tall', 1200, 2200, (180, 110, 150)),
]:
    image = Image.new('RGB', (width, height), fill)
    pen = ImageDraw.Draw(image)
    for box, color in [
        ((0, 0, 19, 19), (240, 30, 30)), ((width-20, 0, width-1, 19), (30, 180, 30)),
        ((0, height-20, 19, height-1), (30, 30, 240)),
        ((width-20, height-20, width-1, height-1), (180, 30, 180)),
    ]:
        pen.rectangle(box, fill=color)
    target = output / f'{role}.png'
    image.save(target)
    result.append({'role': role, 'width': width, 'height': height, 'path': str(target),
                   'src': 'data:image/png;base64,' + base64.b64encode(target.read_bytes()).decode()})
print(json.dumps(result))
