import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runPython } from '../../../../packages/runtime/python';
import { assertThaiGlyphs } from './language.assertions';
import { checkLanguageTools, fillLanguageTemplate, inspectThaiPdf } from './template-tools';

const python = process.env.BMTK_PDF_PYTHON || 'python3';
test('真实Word/Excel文件填写保留八题语料、四个泰文选项和B答案，不依赖产品源码', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bmtk-thai-template-'));
  try {
    await checkLanguageTools(python);
    const word = path.join(dir, 'template.docx');
    const excel = path.join(dir, 'template.xlsx');
    await runPython(python, [
      'import sys,zipfile,openpyxl',
      'with zipfile.ZipFile(sys.argv[1],"w") as z:',
      ' z.writestr("word/document.xml",\'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/><w:sectPr></w:sectPr></w:body></w:document>\')',
      ' z.writestr("word/_rels/document.xml.rels",\'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>\')',
      ' z.writestr("[Content_Types].xml",\'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>\')',
      'book=openpyxl.Workbook();book.remove(book.active)',
      'for name,headers in [("单选题",["题干","选项A","选项B","选项C","选项D","正确答案","解析","难度"]),("填空题",["题干","答案1","解析","难度"]),("简答题",["题干","答案","解析","难度"])]:',
      ' sheet=book.create_sheet(name);sheet.append(headers);sheet.append(["EXAMPLE"]);sheet.column_dimensions["A"].width=42',
      'book.save(sys.argv[2])',
    ].join('\n'), [word, excel]);
    const outputWord = path.join(dir, 'filled.docx');
    const outputExcel = path.join(dir, 'filled.xlsx');
    await fillLanguageTemplate(python, 'word', word, outputWord);
    await fillLanguageTemplate(python, 'excel', excel, outputExcel);
    const result = JSON.parse((await runPython(python, [
      'import sys,json,zipfile,xml.etree.ElementTree as ET,openpyxl',
      'with zipfile.ZipFile(sys.argv[1]) as z: root=ET.fromstring(z.read("word/document.xml"))',
      'ns={"w":"http://schemas.openxmlformats.org/wordprocessingml/2006/main"}',
      'paras=["".join(p.itertext()) for p in root.findall(".//w:p",ns)]',
      'book=openpyxl.load_workbook(sys.argv[2]);rows=[dict(zip([c.value for c in s[1]],row)) for s in book for row in s.iter_rows(min_row=2,values_only=True)]',
      'thai=[r for r in rows if str(r.get("题干","")).startswith("泰语词义练习")]',
      'print(json.dumps({"paras":paras,"count":len(rows),"thai":thai,"width":book["单选题"].column_dimensions["A"].width}))',
    ].join('\n'), [outputWord, outputExcel])).toString()) as {
      paras: string[]; count: number; thai: Array<Record<string, string>>; width: number;
    };
    expect(result.count).toBe(8);
    expect(result.width).toBe(42);
    expect(result.thai).toHaveLength(1);
    expect(['选项A', '选项B', '选项C', '选项D'].map(key => result.thai[0][key])).toEqual(['ข่าว', 'ข้าว', 'ขาว', 'เข้า']);
    expect(result.thai[0]['正确答案']).toBe('B');
    expect(result.paras.filter(p => /^\d+\. /.test(p))).toHaveLength(8);
    for (const value of ['A. ข่าว', 'B. ข้าว', 'C. ขาว', 'D. เข้า']) expect(result.paras).toContain(value);
    const stemIndex = result.paras.findIndex(p => p.includes('泰语词义练习'));
    expect(result.paras[stemIndex + 5]).toBe('答案：B');
    expect(result.paras.join('')).not.toContain('EXAMPLE');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('真实PDF字形和像素检查：正确泰文通过，空白或方框输出不能通过', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bmtk-thai-pdf-'));
  try {
    // MuPDF's bundled fallback fonts make this fixture independent of desktop LibreOffice/fonts.
    const bytes = await runPython(python, [
      'import pymupdf,sys',
      'doc=pymupdf.open();page=doc.new_page()',
      'page.insert_htmlbox(pymupdf.Rect(30,30,500,700),"<p>ข่าว</p><p>ข้าว</p><p>ขาว</p><p>เข้า</p>")',
      'sys.stdout.buffer.write(doc.tobytes())',
    ].join('\n'));
    const good = await inspectThaiPdf(python, bytes, path.join(dir, 'good'));
    assertThaiGlyphs(good);
    expect(good.words.every(word => word.images.length > 0)).toBe(true);
    expect((await readFile(good.words[0].images[0])).subarray(1, 4).toString()).toBe('PNG');
    const badBytes = await runPython(python, [
      'import pymupdf,sys', 'doc=pymupdf.open();page=doc.new_page()',
      'page.insert_text((30,50),"AAAA BBBB CCC DDDD")', 'sys.stdout.buffer.write(doc.tobytes())',
    ].join('\n'));
    const empty = await inspectThaiPdf(python, badBytes, path.join(dir, 'empty'));
    expect(() => assertThaiGlyphs(empty)).toThrow();
    // Preserve the real ToUnicode text but force every CID to the missing glyph.
    // This reproduces the important trap: extracting the words still succeeds.
    const boxesBytes = await runPython(python, [
      'import pymupdf,sys,re',
      'doc=pymupdf.open(stream=sys.stdin.buffer.read(),filetype="pdf")',
      'for font in doc.get_page_fonts(0):',
      ' if font[2]!="Type0": continue',
      ' descendants=doc.xref_get_key(font[0],"DescendantFonts")[1]',
      ' cid=int(re.search(r"(\\d+) 0 R",descendants)[1])',
      ' mapping=doc.get_new_xref();doc.update_object(mapping,"<<>>");doc.update_stream(mapping,bytes(131072))',
      ' doc.xref_set_key(cid,"CIDToGIDMap",f"{mapping} 0 R")',
      'sys.stdout.buffer.write(doc.tobytes())',
    ].join('\n'), [], bytes);
    const boxes = await inspectThaiPdf(python, boxesBytes, path.join(dir, 'boxes'));
    expect(boxes.words.every(word => word.count > 0), '方框PDF仍能抽取四个泰文词语').toBe(true);
    expect(() => assertThaiGlyphs(boxes)).toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('真实PDF复合ToUnicode映射与ActualText保留不同声调，不把-1误判为方框', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bmtk-thai-clusters-'));
  try {
    const bytes = await runPython(python, [
      'import pymupdf,sys,re',
      'seed=pymupdf.open();sp=seed.new_page();sp.insert_htmlbox(pymupdf.Rect(30,30,500,700),"<p>ข่าว</p>")',
      'buffer=seed.extract_font(seed.get_page_fonts(0)[0][0])[3];font=pymupdf.Font(fontbuffer=buffer)',
      'doc=pymupdf.open();page=doc.new_page();font_xref=page.insert_font(fontname="Thai",fontbuffer=buffer)',
      'operations=[]',
      'for i,word in enumerate(["ข่าว","ข้าว","ขาว","เข้า"]):',
      ' x=30;y=750-i*60',
      ' for char in word:',
      '  glyph=font.has_glyph(ord(char));logical=char.encode("utf-16-be").hex()',
      '  operations.append(f"/Span << /ActualText <FEFF{logical}> >> BDC BT /Thai 12 Tf 1 0 0 1 {x} {y} Tm <{glyph:04x}> Tj ET EMC")',
      '  x+=font.glyph_advance(ord(char))*12',
      'content=doc.get_new_xref();doc.update_object(content,"<<>>");doc.update_stream(content,"\\n".join(operations).encode());page.set_contents(content)',
      'xref=int(doc.xref_get_key(font_xref,"ToUnicode")[1].split()[0]);cmap=doc.xref_stream(xref).decode()',
      'cmap=re.sub(r"(<[0-9a-f]+>\\s*)<0e02>",lambda match: match[1]+"<0e020e48>",cmap,flags=re.I)',
      'cmap=re.sub(r"(<[0-9a-f]+>\\s*)<0e4[89]>",lambda match: match[1]+"<fffd>",cmap,flags=re.I)',
      'doc.update_stream(xref,cmap.encode());sys.stdout.buffer.write(doc.tobytes())',
    ].join('\n'));
    const result = await inspectThaiPdf(python, bytes, dir);
    expect(result.observations.some(item => item.glyphId === -1 && (item.clusterGlyphId ?? 0) > 0)).toBe(true);
    expect(result.observations.some(item => item.character === '\ufffd' && item.glyphId > 0)).toBe(true);
    assertThaiGlyphs(result);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
