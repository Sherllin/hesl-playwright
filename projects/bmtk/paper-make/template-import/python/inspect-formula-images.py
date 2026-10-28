"""Locate actual painted fraction images; image existence alone is insufficient."""
import itertools
import json
import sys
import pymupdf

document = pymupdf.open(stream=sys.stdin.buffer.read(), filetype="pdf")
images = []
for page_index, page in enumerate(document):
    for image in page.get_image_info():
        box = pymupdf.Rect(image['bbox'])
        visible = False
        ink_ratio = 0
        if not box.is_empty and page.rect.contains(box):
            # Inspect the final page crop, so a white overlay cannot hide a lost formula.
            pix = page.get_pixmap(matrix=pymupdf.Matrix(3, 3), clip=box,
                                  colorspace=pymupdf.csGRAY, alpha=False)
            if pix.width >= 3 and pix.height >= 6:
                samples = pix.samples
                rows = [[samples[y * pix.width + x] < 180 for x in range(pix.width)]
                        for y in range(pix.height)]
                counts = [sum(row) for row in rows]
                ink_ratio = sum(counts) / (pix.width * pix.height)
                for y in range(int(pix.height * .3), int(pix.height * .7)):
                    longest = max((sum(1 for _ in group) for dark, group in itertools.groupby(rows[y]) if dark), default=0)
                    # A fraction has a central horizontal bar and visible ink above and below.
                    if (longest >= max(3, pix.width * .45)
                            and sum(counts[:max(0, y - 2)]) >= 2
                            and sum(counts[y + 3:]) >= 2):
                        visible = .01 < ink_ratio < .8
                        break
        images.append({'pageIndex': page_index, 'box': list(box),
                       'visibleFraction': visible, 'inkRatio': ink_ratio})
print(json.dumps(images))
