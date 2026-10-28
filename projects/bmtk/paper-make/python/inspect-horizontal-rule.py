"""核对下载原件中的题干横线与粗体；不连接业务服务。"""
import base64
import io
import json
from pathlib import Path
import sys
import zipfile
import xml.etree.ElementTree as ET

import pymupdf

data = json.load(sys.stdin)
sample = data['sample']
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
W = '{' + ns['w'] + '}'

with zipfile.ZipFile(io.BytesIO(base64.b64decode(data['docx']))) as archive:
    root = ET.fromstring(archive.read('word/document.xml'))
    styles_root = ET.fromstring(archive.read('word/styles.xml')) if 'word/styles.xml' in archive.namelist() else None

styles = {} if styles_root is None else {node.get(W + 'styleId'): node for node in styles_root.findall('w:style', ns)}


def style_properties(style_id, seen=None):
    seen = set() if seen is None else seen
    if style_id in seen or style_id not in styles:
        return []
    seen.add(style_id)
    node = styles[style_id]
    parent = node.find('w:basedOn', ns)
    return (style_properties(parent.get(W + 'val'), seen) if parent is not None else []) + [node.find('w:rPr', ns)]


def bold(properties):
    state = False
    for props in properties:
        if props is None:
            continue
        value = props.find('w:b', ns)
        if value is not None:
            state = value.get(W + 'val', '1').lower() not in ('0', 'false', 'off')
    return state


paragraphs = []
default_style = next((key for key, node in styles.items()
                      if node.get(W + 'type') == 'paragraph' and node.get(W + 'default') == '1'), None)
defaults = styles_root.find('w:docDefaults/w:rPrDefault/w:rPr', ns) if styles_root is not None else None
for paragraph in root.findall('.//w:body//w:p', ns):
    paragraph_style = paragraph.find('w:pPr/w:pStyle', ns)
    inherited = [defaults] + style_properties(paragraph_style.get(W + 'val') if paragraph_style is not None else default_style)
    text, bold_text = '', ''
    for run in paragraph.findall('.//w:r', ns):
        value = ''.join(node.text or '' for node in run.findall('w:t', ns))
        text += value
        run_style = run.find('w:rPr/w:rStyle', ns)
        properties = inherited + (style_properties(run_style.get(W + 'val')) if run_style is not None else []) + [run.find('w:rPr', ns)]
        if bold(properties):
            bold_text += value
    borders = []
    for side in ('top', 'bottom', 'between'):
        border = paragraph.find(f'w:pPr/w:pBdr/w:{side}', ns)
        if border is not None and border.get(W + 'val', 'nil') not in ('nil', 'none') and int(border.get(W + 'sz', '0')) > 0:
            borders.append(side)
    paragraphs.append({'text': text, 'boldText': bold_text, 'borders': borders})

compact = lambda value: ''.join(value.split())
before = [i for i, p in enumerate(paragraphs) if compact(sample['before']) in compact(p['text'])]
after = [i for i, p in enumerate(paragraphs) if compact(sample['bold']) in compact(p['text'])]
rule_between = False
if len(before) == len(after) == 1 and before[0] < after[0]:
    for index in range(before[0], after[0] + 1):
        sides = paragraphs[index]['borders']
        rule_between |= ('bottom' in sides and index < after[0]) or ('top' in sides and index > before[0]) or (
            'between' in sides and before[0] < index < after[0])

docx = {'text': '\n'.join(p['text'] for p in paragraphs), 'boldText': '\n'.join(p['boldText'] for p in paragraphs),
        'ruleBetween': rule_between, 'paragraphs': paragraphs}
output = Path(data['output'])
output.mkdir(parents=True, exist_ok=True)
pages = []
with pymupdf.open(stream=base64.b64decode(data['pdf']), filetype='pdf') as pdf:
    for index, page in enumerate(pdf):
        image = output / f'page-{index + 1}.png'
        page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(image)
        spans = [span for block in page.get_text('dict')['blocks'] if block['type'] == 0
                 for line in block['lines'] for span in line['spans']]
        lines = []
        for drawing in page.get_drawings():
            if drawing['color'] is None and drawing['fill'] is None:
                continue
            for item in drawing['items']:
                if item[0] == 'l' and abs(item[1].y - item[2].y) <= 1:
                    lines.append([min(item[1].x, item[2].x), item[1].y, max(item[1].x, item[2].x), item[2].y])
                elif item[0] == 're' and item[1].height <= 2:
                    lines.append(list(item[1]))
        # ASCII定位标记避免中文PDF断词差异；全文另行检查中文内容。
        first = [list(box) for box in page.search_for(sample['before'].split()[0])]
        last = [list(box) for box in page.search_for(sample['bold'].split()[0])]
        between = len(first) == len(last) == 1 and any(
            line[2] - line[0] >= 100 and first[0][3] - 2 <= line[1] <= last[0][1] + 2
            and line[0] <= first[0][0] + 5 and line[2] >= last[0][2] for line in lines)
        pages.append({'text': page.get_text(), 'boldText': ''.join(s['text'] for s in spans if s['flags'] & 16),
                      'ruleBetween': between, 'image': str(image), 'before': first, 'after': last, 'lines': lines})

print(json.dumps({'docx': docx, 'pdf': {'text': '\n'.join(p['text'] for p in pages),
    'boldText': '\n'.join(p['boldText'] for p in pages), 'ruleBetween': any(p['ruleBetween'] for p in pages), 'pages': pages}}))
