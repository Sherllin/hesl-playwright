"""Read visible glyph order, preserve columns and exclude verified page footers."""
import json
import re
import sys
from pathlib import Path
import pymupdf as fitz

text_only = '--text-only' in sys.argv[1:]
layout = json.loads(sys.argv[sys.argv.index('--layout') + 1]) if '--layout' in sys.argv else {}
destination = None if text_only else Path(sys.argv[1])
if destination is not None:
    destination.mkdir(parents=True, exist_ok=True)
document = fitz.open(stream=sys.stdin.buffer.read(), filetype="pdf")
pages = []


def ordered_glyphs(glyphs):
    """Font fallback can split one baseline into several lines in one block."""
    rows = []
    for glyph in sorted(glyphs, key=lambda item: item['baseline']):
        if not rows or abs(glyph['baseline'] - rows[-1][0]) > 1:
            rows.append((glyph['baseline'], [glyph]))
        else:
            rows[-1][1].append(glyph)
    return [glyph for _, row in rows for glyph in sorted(row, key=lambda item: item['box'][0])]


for index, page in enumerate(document):
    columns = [[], []] if layout.get('columns') == 2 else [[]]
    left, right = layout.get('leftMarginCm', 3.2), layout.get('rightMarginCm', 1.2)
    if layout.get('mirrorMargins') and index % 2:
        left, right = right, left
    center = (page.rect.width + (left - right) * 72 / 2.54) / 2
    footers = []
    for block in page.get_text("rawdict")["blocks"]:
        glyphs = []
        for line in block.get("lines", []):
            for span in line["spans"]:
                glyphs.extend({"text": char["c"], "box": list(char["bbox"]),
                    "font": span["font"], "size": span["size"], "color": span["color"],
                    "baseline": char["origin"][1]} for char in span["chars"])
        if not glyphs:
            continue
        ordered = ordered_glyphs(glyphs)
        value = re.sub(r'\s+', '', ''.join(glyph['text'] for glyph in ordered))
        footer = re.fullmatch(r'第(\d+)页[（(]共(\d+)页[）)]', value)
        # Only remove the actual page counter at the bottom. Identical wording
        # in a question remains part of its content and must still be checked.
        if (footer and int(footer[1]) == index + 1 and int(footer[2]) == len(document)
                and min(glyph['box'][1] for glyph in glyphs) >= page.rect.height * 0.85):
            footers.append(value)
            continue
        if len(columns) == 2:
            # A PDF block may contain BOTH paper columns. Split using the
            # configured paper layout before ordering, never across the whole page.
            for side in range(2):
                group = [glyph for glyph in glyphs
                         if int((glyph['box'][0] + glyph['box'][2]) / 2 >= center) == side]
                columns[side].extend(ordered_glyphs(group))
        else:
            columns[0].extend(ordered)
    chars = [{key: value for key, value in glyph.items() if key != 'baseline'}
             for column in columns for glyph in column]
    image = ''
    if destination is not None:
        target = destination / f"page-{index + 1}.png"
        page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(str(target))
        image = str(target)
    pages.append({"width": page.rect.width, "height": page.rect.height, "chars": chars,
                  "image": image, "excludedFooters": footers})

result = {"pages": len(pages), "text": '\n'.join(''.join(c['text'] for c in p['chars']) for p in pages)} if text_only else {"pages": pages}
print(json.dumps(result, ensure_ascii=True))
