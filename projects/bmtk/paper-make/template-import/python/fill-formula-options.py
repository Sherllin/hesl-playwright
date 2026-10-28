"""Fill the downloaded official template with labeled native OMML fractions."""
import json
import re
import sys
import zipfile
from xml.sax.saxutils import escape

source, destination, sample_file = sys.argv[1:]
with open(sample_file, encoding="utf8") as stream:
    questions = json.load(stream)


def text(value):
    return '<w:r><w:t xml:space="preserve">' + escape(value) + '</w:t></w:r>'


paragraphs = []
for number, question in enumerate(questions, 1):
    paragraphs.extend(['<w:p>' + text('【单选题】') + '</w:p>',
                       '<w:p>' + text(f'{number}. ' + question['stem']) + '</w:p>'])
    for index, option in enumerate(question['options']):
        content = text('ABCD'[index] + '. ')
        if isinstance(option, str):
            content += text(option)
        else:
            def mathrun(value):
                return '<m:r><m:t>' + escape(value) + '</m:t></m:r>'
            content += '<m:oMath><m:f><m:num>' + mathrun(option['numerator'])
            content += '</m:num><m:den>' + mathrun(option['denominator']) + '</m:den></m:f></m:oMath>'
        paragraphs.append('<w:p>' + content + '</w:p>')
    for value in ['答案：' + question['answer'], '难度：0.5', '解析：按题设计算，保持原生分式与选项字母对应。']:
        paragraphs.append('<w:p>' + text(value) + '</w:p>')

with zipfile.ZipFile(source) as stream:
    archive = {name: stream.read(name) for name in stream.namelist()}
xml = archive['word/document.xml'].decode('utf8')
section = re.search(r'<w:sectPr\b[\s\S]*?</w:sectPr>', xml)
xml, changed = re.subn(r'<w:body>[\s\S]*?</w:body>',
                       lambda _: '<w:body>' + ''.join(paragraphs) + (section[0] if section else '') + '</w:body>', xml)
assert changed == 1, 'official template body missing'
if 'xmlns:m=' not in xml:
    xml = xml.replace('<w:document ', '<w:document xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ', 1)
archive['word/document.xml'] = xml.encode('utf8')
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as stream:
    for name, data in archive.items():
        stream.writestr(name, data)
