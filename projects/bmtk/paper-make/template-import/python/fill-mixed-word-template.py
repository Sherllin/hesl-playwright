"""Fill downloaded DOCX with mixed types, actual OMML equations and embedded PNG."""
import io
import json
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape
from PIL import Image, ImageDraw

source, destination, sample_path = sys.argv[1:]
with open(sample_path, encoding="utf-8") as stream:
    sample = json.load(stream)
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
M = "http://schemas.openxmlformats.org/officeDocument/2006/math"
paragraphs = []
images = []
def paragraph(text):
    # Word line breaks are w:br, not literal newlines inside a text node.
    runs = '</w:t><w:br/><w:t xml:space="preserve">'.join(escape(line) for line in text.replace('\r\n', '\n').split('\n'))
    return f'<w:p><w:r><w:t xml:space="preserve">{runs}</w:t></w:r></w:p>'
def mathrun(text):
    return f'<m:r><m:t>{text}</m:t></m:r>'
def append_image(q):
    images.append(q.get("image"))
    paragraphs.append('''<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="1905000" cy="952500"/><wp:docPr id="9001" name="E2E embedded shapes"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="9001" name="mixed-shapes.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdMixedImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="952500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>''')
    image_id = len(images)
    if q.get("image"):
        with Image.open(Path(sample_path).parent / q["image"]) as original:
            height = round(1905000 * original.height / original.width)
        paragraphs[-1] = paragraphs[-1].replace('cy="952500"', f'cy="{height}"')
    paragraphs[-1] = paragraphs[-1].replace("rIdMixedImage", f"rIdMixedImage{image_id}").replace('id="9001"', f'id="{9000+image_id}"')

def add(q, number, child=False):
    if not child:
        paragraphs.append(paragraph(f'【{q["type"]}】'))
    prefix = f'&gt;（{number}）【{q["type"]}】' if child else f'{number}. '
    # Escape once; the child marker is literal > in Word.
    prefix = prefix.replace('&gt;', '>')
    paragraphs.append(paragraph(prefix + q["stem"]))
    media = q.get("media")
    if media and media != "嵌入图片":
        if q.get("omml"):
            math = q["omml"]
        elif media == "分数公式":
            math = f'<m:f><m:num>{mathrun("1")}</m:num><m:den>{mathrun("2")}</m:den></m:f>'
        elif media == "上标公式":
            math = f'<m:sSup><m:e>{mathrun("x")}</m:e><m:sup>{mathrun("2")}</m:sup></m:sSup>'
        else:
            math = f'<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>{mathrun("x+1")}</m:e></m:rad>'
        paragraphs.append(f'<w:p><m:oMathPara><m:oMath>{math}</m:oMath></m:oMathPara></w:p>')
    if media == "嵌入图片":
        append_image(q)
    for index, option in enumerate(q.get("options", [])):
        paragraphs.append(paragraph(f'{"ABCDEFGH"[index]}. {option}'))
        option_image = q.get("optionImages", {}).get(str(index))
        if option_image:
            append_image({"image": option_image})
    answer = q.get("answer")
    if q.get('answerOmml'):
        # Use the same native Word equation input required by the official template help.
        paragraphs.append('<w:p><w:r><w:t>答案：</w:t></w:r><m:oMath>' + q['answerOmml'] + '</m:oMath></w:p>')
    elif answer is not None:
        paragraphs.append(paragraph('答案：' + (' | '.join(answer) if isinstance(answer, list) else answer)))
    paragraphs.extend([paragraph('难度：' + str(q['level'])), paragraph('解析：' + q["analysis"])])
    if 'knowledge' in q:
        paragraphs.append(paragraph('知识点：' + '；'.join(q['knowledge'])))
    for index, sub in enumerate(q.get("children", []), 1):
        add(sub, index, child=True)

for i, question in enumerate(sample["questions"] + sample["wordExtras"], 1):
    add(question, i)
with zipfile.ZipFile(source) as stream:
    archive = {name: stream.read(name) for name in stream.namelist()}
import re
xml = archive['word/document.xml'].decode()
section = re.search(r'<w:sectPr\b[\s\S]*?</w:sectPr>', xml)
archive['word/document.xml'] = re.sub(r'<w:body>[\s\S]*?</w:body>', lambda _match: '<w:body>' + ''.join(paragraphs) + (section[0] if section else '') + '</w:body>', xml).encode()
# Declare math namespace if the downloaded template omitted it.
xml = archive['word/document.xml'].decode()
if 'xmlns:m=' not in xml:
    xml = xml.replace('<w:document ', f'<w:document xmlns:m="{M}" ', 1)
archive['word/document.xml'] = xml.encode()
image = Image.new('RGB', (400, 200), 'white')
draw = ImageDraw.Draw(image)
draw.rectangle((20, 40, 120, 140), outline='red', width=5)
draw.ellipse((160, 40, 260, 140), outline='blue', width=5)
draw.polygon([(300,140),(350,40),(390,140)], outline='green', width=5)
buffer = io.BytesIO()
image.save(buffer, format='PNG')
rels = archive['word/_rels/document.xml.rels'].decode()
for image_id, filename in enumerate(images, 1):
    data = (Path(sample_path).parent / filename).read_bytes() if filename else buffer.getvalue()
    name = f'mixed-image-{image_id}.png'
    archive['word/media/' + name] = data
    rels = rels.replace('</Relationships>', f'<Relationship Id="rIdMixedImage{image_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{name}"/></Relationships>')
archive['word/_rels/document.xml.rels'] = rels.encode()
types = archive['[Content_Types].xml'].decode()
if 'Extension="png"' not in types:
    types = types.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>')
archive['[Content_Types].xml'] = types.encode()
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as stream:
    for name, data in archive.items():
        stream.writestr(name, data)
