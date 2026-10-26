import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkDocumentTools, inspectPdf, inspectDocx, compareRenderedLayout, inspectPdfImage, readPdfContent } from './document-layout';
import { runPython } from './python';

const python = process.env.BMTK_PDF_PYTHON || 'python3';
test('检查真实PDF字符几何和页面，蓝色正文参与比较，DOCX读取正文与媒体', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bmtk-layout-check-'));
  try {
    await checkDocumentTools(python);
    const result = JSON.parse((await runPython(python, [
      'import pymupdf,base64,json,io,zipfile,sys',
      'from PIL import Image,ImageDraw',
      'from pathlib import Path',
      'root=Path(sys.argv[1])',
      'image=Image.new("RGB",(760,460),"white"); draw=ImageDraw.Draw(image); draw.line((0,450,750,20),fill="blue",width=8); image.save(root/"image.png")',
      'doc=pymupdf.open();page=doc.new_page(width=595,height=842);page.insert_text((90,90),"STYLE-PDF-READER",fontsize=13.5,color=(22/255,119/255,1));page.insert_image(pymupdf.Rect(90,120,470,350),filename=str(root/"image.png"))',
      'buf=io.BytesIO()',
      'with zipfile.ZipFile(buf,"w") as z:',
      ' z.writestr("word/document.xml",\'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>题目 &amp; 答案</w:t></w:r></w:p></w:body></w:document>\')',
      ' z.writestr("word/media/image1.png",(root/"image.png").read_bytes())',
      'print(json.dumps({"pdf":base64.b64encode(doc.tobytes()).decode(),"docx":base64.b64encode(buf.getvalue()).decode()}))',
    ].join('\n'), [dir])).toString()) as { pdf: string; docx: string };
    const bytes = Buffer.from(result.pdf, 'base64');
    const pdf = await inspectPdf(python, bytes, path.join(dir, 'rendered'));
    expect(pdf.pages).toHaveLength(1);
    expect(pdf.pages[0].width).toBe(595);
    expect(pdf.pages[0].chars.map(c => c.text).join('')).toContain('STYLE-PDF-READER');
    const char = pdf.pages[0].chars.find(c => c.text === 'S')!;
    expect(char.size).toBeCloseTo(13.5, 1);
    expect(char.color).toBe(0x1677ff);
    const same = await compareRenderedLayout(python, pdf.pages[0].image, pdf.pages[0].image);
    expect(same.previewBands.length).toBeGreaterThan(0);
    expect(same.maxDelta).toBe(0);
    const images = await inspectPdfImage(python, bytes, path.join(dir, 'image.png'));
    expect(images.matches).toHaveLength(1);
    expect(images.matches[0].insidePage).toBe(true);
    expect(images.matches[0].aspectError).toBeLessThan(0.03);
    const docx = await inspectDocx(python, Buffer.from(result.docx, 'base64'));
    expect(docx.text).toContain('题目 & 答案');
    expect(docx.mediaCount).toBe(1);
    // 真正不同的预览必须产生不同的行信息，不能用存在文件冒充版面一致。
    await runPython(python, 'from PIL import Image;import sys;Image.new("RGB",(595,842),"white").save(sys.argv[1])', [path.join(dir, 'blank.png')]);
    const blank = await compareRenderedLayout(python, path.join(dir, 'blank.png'), pdf.pages[0].image);
    expect(blank.previewBands).toHaveLength(0);
    expect(blank.pdfBands.length).toBeGreaterThan(0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('非PDF或非DOCX不得冒充实际输出；不存在的Python在写远端前失败', async () => {
  await expect(inspectPdf(python, Buffer.from('<html>error</html>'), 'unused')).rejects.toThrow(/不是PDF/);
  await expect(inspectDocx(python, Buffer.from('not a zip'))).rejects.toThrow(/不是DOCX/);
  await expect(checkDocumentTools('bmtk-nonexistent-python')).rejects.toThrow(/Python/);
});

test('蓝色正文不会被灰度阈值排除，移位超过1.5%可观测', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bmtk-color-check-'));
  try {
    // 同一蓝色矩形的可见位置已知，测试不依赖系统字体。
    await runPython(python, [
      'from PIL import Image,ImageDraw', 'import sys',
      'for name,y in [("before",50),("after",90)]:',
      ' image=Image.new("RGB",(400,400),"white");ImageDraw.Draw(image).rectangle((40,y,300,y+10),fill=(22,119,255));image.save(sys.argv[1]+"/"+name+".png")',
    ].join('\n'), [dir]);
    const result = await compareRenderedLayout(python, path.join(dir, 'before.png'), path.join(dir, 'after.png'));
    expect(result.previewBands).toHaveLength(1);
    expect(result.pdfBands).toHaveLength(1);
    expect(result.maxDelta).toBeGreaterThan(0.015);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('按字形位置恢复同一行的分裂字体，不把连接号提到题干开头', async () => {
  const bytes = await runPython(python, [
    'import pymupdf,sys',
    'doc=pymupdf.open();page=doc.new_page(width=595,height=842)',
    'page.insert_font(fontname="RuntimeFont",fontbuffer=pymupdf.Font("helv").buffer)',
    'page.insert_text((100,100),"–",fontname="RuntimeFont",fontsize=13.5)',
    'page.insert_text((60,100),"DOSE",fontname="RuntimeFont",fontsize=13.5)',
    'page.insert_text((110,100),"TIME",fontname="RuntimeFont",fontsize=13.5)',
    'sys.stdout.buffer.write(doc.tobytes())',
  ].join('\n'));
  const text = (await readPdfContent(python, bytes)).text.replace(/\s+/g, '');
  expect(text).toContain('DOSE–TIME');
  expect(text).not.toContain('–DOSETIME');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bmtk-glyph-check-'));
  try {
    const pdf = await inspectPdf(python, bytes, dir);
    expect(pdf.pages[0].chars.map(c => c.text).join('').replace(/\s+/g, '')).toContain('DOSE–TIME');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('跨页答案忽略真实页脚，正文中同样的页码文字仍保留', async () => {
  const bytes = await runPython(python, [
    'import pymupdf,sys', 'doc=pymupdf.open()',
    'for i in range(2):',
    ' page=doc.new_page(width=595,height=842)',
    ' page.insert_text((250,815),f"第{i+1}页（共2页）",fontname="china-s",fontsize=10)',
    ' page.insert_text((60,100),"答案：" if i==0 else "Vmax=100",fontname="china-s",fontsize=13.5)',
    ' if i==0: page.insert_text((60,200),"题干引用第1页（共2页）",fontname="china-s",fontsize=13.5)',
    'sys.stdout.buffer.write(doc.tobytes())',
  ].join('\n'));
  const text = (await readPdfContent(python, bytes)).text.replace(/\s+/g, '');
  expect(text).not.toContain('第2页（共2页）');
  expect(text.match(/第1页（共2页）/g)).toHaveLength(1);
  expect(text).toContain('题干引用第1页（共2页）');
  expect(text).toContain('Vmax=100');
});

test('两栏在同一个PDF文本块内也按列读取，不能把两栏按全页横向串读', async () => {
  const bytes = await runPython(python, [
    'import pymupdf,sys', 'doc=pymupdf.open();page=doc.new_page(width=1190,height=842)',
    'for text,x,y in [("LEFT1",60,100),("RIGHT1",650,100),("LEFT2",60,120),("RIGHT2",650,120)]: page.insert_text((x,y),text,fontsize=13.5)',
    'sys.stdout.buffer.write(doc.tobytes())',
  ].join('\n'));
  expect((await readPdfContent(python, bytes, { columns: 2 })).text.replace(/\s+/g, '')).toBe('LEFT1LEFT2RIGHT1RIGHT2');
});
