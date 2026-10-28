import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runPython } from '../../../../packages/runtime/python';
import { inspectPdf } from '../../../../packages/runtime/document-layout';
import { formulaSamples, assertFormulaLabels, assertFormulaPdf } from './formula-options.assertions';
import { fillFormulaTemplate, readFormulaDocx, inspectFormulaPdf } from './formula-options.tools';

const python = process.env.BMTK_PDF_PYTHON || 'python3';
test('下载模板填入实际DOCX：两轮6题20个原生分式均与ABCD同段，并保留官方节属性', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bmtk-formula-'));
  try {
    const template = path.join(dir, 'template.docx');
    await runPython(python, [
      'import sys,zipfile',
      'with zipfile.ZipFile(sys.argv[1],"w") as z:',
      ' z.writestr("word/document.xml",\'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/><w:sectPr><w:pgSz w:w="11906"/></w:sectPr></w:body></w:document>\')',
      ' z.writestr("keep.txt","official-template-resource")',
    ].join('\n'), [template]);
    const samples = formulaSamples('OFFLINE');
    const output = path.join(dir, 'rounds.docx');
    await fillFormulaTemplate(python, template, output, samples);
    const bytes = await readFile(output);
    const evidence = await readFormulaDocx(python, bytes);
    expect(evidence.fractions).toBe(20);
    assertFormulaLabels(evidence.text, samples, true, true);
    const values = JSON.parse((await runPython(python, [
      'import json,sys,zipfile,xml.etree.ElementTree as ET',
      'with zipfile.ZipFile(sys.argv[1]) as z:',
      ' root=ET.fromstring(z.read("word/document.xml"));keep=z.read("keep.txt").decode()',
      'W="{http://schemas.openxmlformats.org/wordprocessingml/2006/main}";M="{http://schemas.openxmlformats.org/officeDocument/2006/math}"',
      'pairs=[("".join(p.itertext()),len(p.findall(".//"+M+"f"))) for p in root.findall(".//"+W+"p")]',
      'print(json.dumps({"first":pairs[2:6],"section":root.find(".//"+W+"pgSz").get(W+"w"),"keep":keep}))',
    ].join('\n'), [output])).toString()) as { first: Array<[string, number]>; section: string; keep: string };
    expect(values.first).toEqual([['A. 34', 1], ['B. 14', 1], ['C. 43', 1], ['D. 1', 0]]);
    expect(values.section).toBe('11906');
    expect(values.keep).toBe('official-template-resource');
    expect(() => assertFormulaLabels(evidence.text.replace('A. \uFFFC', '\uFFFC'), samples, true, true)).toThrow();
    expect(() => assertFormulaLabels(evidence.text.replace('A. \uFFFC', 'A. '), samples, true, true)).toThrow();
    // 实际Word输出只有题目时，下一题号紧跟D文本值；不能compact成12再把整段删掉。
    const onlyQuestions = await runPython(python, [
      'import io,sys,zipfile,xml.etree.ElementTree as ET',
      'with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z: archive={n:z.read(n) for n in z.namelist()}',
      'root=ET.fromstring(archive["word/document.xml"]);W="{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"',
      'body=root.find(W+"body")',
      'for p in list(body):',
      ' if "".join(p.itertext()).startswith(("答案：","难度：","解析：","【")):body.remove(p)',
      'archive["word/document.xml"]=ET.tostring(root)',
      'out=io.BytesIO()',
      'with zipfile.ZipFile(out,"w") as z:',
      ' for n,data in archive.items():z.writestr(n,data)',
      'sys.stdout.buffer.write(out.getvalue())',
    ].join('\n'), [], bytes);
    const numbered = await readFormulaDocx(python, onlyQuestions);
    assertFormulaLabels(numbered.text, samples, false, true);
    expect(() => assertFormulaLabels(numbered.text.replace('D. 1', 'D. '), samples, false, true)).toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('真实PDF图片分式：标签旁可见分式可通过；缺标签、缺图、空白遮挡和移位不能通过', async ({}, info) => {
  const sample = { ...formulaSamples('RASTER')[0], stem: 'RASTER_FORMULA' };
  for (const defect of ['none', 'labels', 'missing', 'blank', 'solid', 'misplaced', 'obscured', 'duplicate']) {
    const bytes = await runPython(python, [
      'import sys,pymupdf',
      'defect=sys.argv[1];doc=pymupdf.open();p=doc.new_page();p.insert_text((50,50),"RASTER_FORMULA")',
      'for i,(n,d) in enumerate([(3,4),(1,4),(4,3)]):',
      ' x=[50,150,50][i];baseline=[100,100,120][i]',
      ' if defect!="labels":p.insert_text((x,baseline),"ABCD"[i]+".",fontsize=14)',
      ' if defect=="missing":continue',
      ' raster=pymupdf.open();r=raster.new_page(width=40,height=80)',
      ' if defect not in ("blank","solid"):',
      '  r.insert_text((15,20),str(n),fontsize=15);r.draw_line((10,35),(30,35));r.insert_text((15,60),str(d),fontsize=15)',
      ' if defect=="solid":r.draw_rect(r.rect,fill=(0,0,0),color=(0,0,0))',
      ' image=r.get_pixmap().tobytes("png");y=baseline+80 if defect=="misplaced" else baseline-20;box=pymupdf.Rect(x+25,y,x+33.5,y+17)',
      ' p.insert_image(box,stream=image)',
      ' if defect=="duplicate":p.insert_image(box,stream=image)',
      ' if defect=="obscured":p.draw_rect(box,fill=(1,1,1),color=(1,1,1),overlay=True)',
      'p.insert_text((150,120),"D.1",fontsize=14);sys.stdout.buffer.write(doc.tobytes())',
    ].join('\n'), [defect]);
    const pdf = await inspectFormulaPdf(python, bytes, info.outputPath(`raster-${defect}`));
    const check = () => assertFormulaPdf(pdf, [sample], false);
    if (defect === 'none') expect(check).not.toThrow();
    else expect(check).toThrow();
  }
});

test('真实PDF提取：分式字符分块时标签仍能核对，丢标签的PDF必须拒绝', async ({}, info) => {
  const sample = { ...formulaSamples('PDF')[0], stem: 'FORMULA_PDF' };
  for (const defect of ['none', 'labels', 'formula', 'swapped'] as const) {
    const bytes = await runPython(python, [
      'import sys,pymupdf',
      'doc=pymupdf.open();p=doc.new_page();p.insert_text((50,50),"FORMULA_PDF")',
      'for i,(n,d) in enumerate([(3,4),(1,4),(4,3)]):',
      ' x=50+i*100',
      ' if sys.argv[1]!="labels":p.insert_text((x,100),"ABCD"[i]+".")',
      ' if sys.argv[1]=="formula":continue',
      ' if sys.argv[1]=="swapped":n,d=d,n',
      ' p.insert_text((x+25,94),str(n));p.insert_text((x+25,108),str(d));p.draw_line((x+22,98),(x+35,98))',
      'p.insert_text((350,100),"D.1");sys.stdout.buffer.write(doc.tobytes())',
    ].join('\n'), [defect]);
    const pdf = await inspectPdf(python, bytes, info.outputPath(defect));
    const check = () => assertFormulaPdf(pdf, [sample], false);
    if (defect !== 'none') expect(check).toThrow();
    else expect(check).not.toThrow();
  }
});
