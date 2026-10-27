"""Separate logical word text from painted glyphs, including complex-script clusters."""
import hashlib
import json
import sys
from pathlib import Path
import pymupdf

words = ['ข่าว', 'ข้าว', 'ขาว', 'เข้า']
destination = Path(sys.argv[1])
destination.mkdir(parents=True, exist_ok=True)
observations = []
results = {word: {'word': word, 'count': 0, 'rasterHashes': [], 'images': []} for word in words}
with pymupdf.open(stream=sys.stdin.buffer.read(), filetype='pdf') as document:
    for page_index, page in enumerate(document):
        # TextPage/search_for uses ActualText where present; get_texttrace exposes
        # the lower-level ToUnicode CMap, which need not map each painted tone.
        regions = {word: page.search_for(word) for word in words}
        word_boxes = [box for boxes in regions.values() for box in boxes]
        for span in page.get_texttrace():
            previous = None
            for codepoint, glyph_id, origin, box in span['chars']:
                continuation = None
                if (glyph_id == -1 and previous is not None
                        and abs(box[2] - box[0]) < 0.00001
                        and all(abs(a - b) < 0.00001 for a, b in zip(origin, previous[2]))):
                    continuation = previous[1]
                if glyph_id != -1:
                    previous = (codepoint, glyph_id, origin, box)
                # Include actual tone glyphs (often U+FFFD in the trace) within
                # the word, not just glyphs with an independently decoded Thai Unicode.
                inside_word = any(region.x0 - 0.5 <= origin[0] <= region.x1 + 0.5
                    and region.y0 - 0.5 <= origin[1] <= region.y1 + 0.5 for region in word_boxes)
                if 0xE00 <= codepoint <= 0xE7F or inside_word:
                    item = {'page': page_index + 1,
                        'character': chr(codepoint) if 0 <= codepoint <= 0x10FFFF else '\ufffd',
                        'glyphId': glyph_id, 'font': span['font'], 'box': list(box)}
                    if continuation is not None:
                        item['clusterGlyphId'] = continuation
                    observations.append(item)
        for index, word in enumerate(words):
            for box in regions[word]:
                result = results[word]
                result['count'] += 1
                pixmap = page.get_pixmap(matrix=pymupdf.Matrix(3, 3), clip=box)
                result['rasterHashes'].append(hashlib.sha256(pixmap.samples).hexdigest())
                target = destination / f'word-{index + 1}-page-{page_index + 1}-{result["count"]}.png'
                pixmap.save(str(target))
                result['images'].append(str(target))
print(json.dumps({'observations': observations, 'words': list(results.values())}, ensure_ascii=True))
