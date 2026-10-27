"""Collect visible axis-aligned borders, then measure real rendered ink and gaps.

LibreOffice can encode dashed table borders as individual filled rectangles.
Grouping collinear pieces BEFORE raster sampling avoids mistaking those for solid
borders or requiring any particular PDF path representation.
"""
import json
import sys
import pymupdf as fitz
from PIL import Image

SCALE = 4
pages = []


def rgb(color):
    if len(color) == 1:
        return [color[0]] * 3
    if len(color) == 4:
        c, m, y, k = color
        return [1 - min(1, value + k) for value in (c, m, y)]
    return list(color)


for page in fitz.open(stream=sys.stdin.buffer.read(), filetype='pdf'):
    parts = []

    def segment(a, b, width, color):
        if abs(a.y - b.y) < 0.1 and abs(a.x - b.x) > 0.1:
            parts.append(dict(axis='h', coordinate=(a.y + b.y) / 2,
                              start=min(a.x, b.x), end=max(a.x, b.x), width=width, color=color))
        elif abs(a.x - b.x) < 0.1 and abs(a.y - b.y) > 0.1:
            parts.append(dict(axis='v', coordinate=(a.x + b.x) / 2,
                              start=min(a.y, b.y), end=max(a.y, b.y), width=width, color=color))

    for drawing in page.get_drawings():
        stroke = drawing.get('color')
        fill = drawing.get('fill')
        for item in drawing['items']:
            if stroke is not None and drawing.get('stroke_opacity', 1) > 0.9:
                width, color = drawing['width'], rgb(stroke)
                if item[0] == 'l':
                    segment(item[1], item[2], width, color)
                elif item[0] == 're':
                    rect = item[1]
                    for a, b in [(rect.tl, rect.tr), (rect.tr, rect.br), (rect.br, rect.bl), (rect.bl, rect.tl)]:
                        segment(a, b, width, color)
                elif item[0] == 'qu':
                    q = item[1]
                    for a, b in [(q.ul, q.ur), (q.ur, q.lr), (q.lr, q.ll), (q.ll, q.ul)]:
                        segment(a, b, width, color)
        if fill is not None and drawing.get('fill_opacity', 1) > 0.9:
            # Only narrow, axis-aligned filled rectangles represent border dashes.
            rectangles = []
            for item in drawing['items']:
                if item[0] == 're':
                    rectangles.append(item[1])
                elif item[0] == 'qu' and item[1].is_rectangular:
                    rectangles.append(item[1].rect)
            if not rectangles and all(item[0] == 'l' for item in drawing['items']):
                points = [point for item in drawing['items'] for point in item[1:3]]
                rect = drawing['rect']
                if points and all((abs(p.x - rect.x0) < 0.1 or abs(p.x - rect.x1) < 0.1)
                                  and (abs(p.y - rect.y0) < 0.1 or abs(p.y - rect.y1) < 0.1) for p in points):
                    rectangles.append(rect)
            for rect in rectangles:
                if 0 < rect.height <= 4 and rect.width > rect.height * 1.4:
                    segment(fitz.Point(rect.x0, (rect.y0 + rect.y1) / 2),
                            fitz.Point(rect.x1, (rect.y0 + rect.y1) / 2), rect.height, rgb(fill))
                elif 0 < rect.width <= 4 and rect.height > rect.width * 1.4:
                    segment(fitz.Point((rect.x0 + rect.x1) / 2, rect.y0),
                            fitz.Point((rect.x0 + rect.x1) / 2, rect.y1), rect.width, rgb(fill))

    groups = []
    for part in sorted(parts, key=lambda p: (p['axis'], p['coordinate'], p['start'])):
        group = next((g for g in groups if g['axis'] == part['axis']
                      and abs(g['coordinate'] - part['coordinate']) <= 0.2
                      and abs(g['width'] - part['width']) <= 0.12
                      and max(abs(a - b) for a, b in zip(g['color'], part['color'])) < 0.025), None)
        if group is None:
            groups.append(dict(part))
        else:
            group['start'] = min(group['start'], part['start'])
            group['end'] = max(group['end'], part['end'])
    pix = page.get_pixmap(matrix=fitz.Matrix(SCALE, SCALE), colorspace=fitz.csRGB, alpha=False)
    image = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
    for group in groups:
        target = [round(c * 255) for c in group['color']]
        ink = []
        first, last = round(group['start'] * SCALE), round(group['end'] * SCALE)
        center = group['coordinate'] * SCALE
        offsets = range(round(center - group['width'] * SCALE / 2), round(center + group['width'] * SCALE / 2) + 1)
        run = None
        for value in range(first, last):
            painted = False
            for offset in offsets:
                x, y = (value, offset) if group['axis'] == 'h' else (offset, value)
                if 0 <= x < image.width and 0 <= y < image.height:
                    pixel = image.getpixel((x, y))
                    # Anti-aliasing is allowed; white background is never ink.
                    if max(abs(a - b) for a, b in zip(pixel, target)) <= 13 and min(pixel) < 246:
                        painted = True
                        break
            if painted and run is None:
                run = value
            elif not painted and run is not None:
                ink.append([run / SCALE, value / SCALE])
                run = None
        if run is not None:
            ink.append([run / SCALE, last / SCALE])
        group['ink'] = ink
    pages.append(dict(width=page.rect.width, height=page.rect.height, lines=groups))
print(json.dumps(dict(pages=pages)))
