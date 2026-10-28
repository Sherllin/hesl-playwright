import { expect, test } from '@playwright/test';
import { runPython } from '../../../packages/runtime/python';
import { inspectHorizontalRuleOutputs, assertHorizontalRuleOutput } from './horizontal-rule.assertions';

// 真正构造PDF和DOCX；横线丢失、无关横线、加粗丢失均必须被输出断言拒绝。
for (const defect of ['none', 'styled-bold', 'docx-line', 'pdf-line', 'unrelated-line', 'pdf-unrelated-line',
  'docx-bold', 'pdf-bold', 'bold-off', 'text'] as const) {
  test(`水平分割线实际文件检查：${defect}`, async ({}, info) => {
    const python = process.env.BMTK_PDF_PYTHON || 'python3';
    const fixtures = JSON.parse((await runPython(python, [
      'import io,sys,json,zipfile,base64,pymupdf',
      'defect=sys.argv[1]',
      'before="RULE_BEFORE"; after="RULE_CONCLUSION"',
      'doc=pymupdf.open(); page=doc.new_page(width=595,height=842)',
      'page.insert_text((70,100),before,fontsize=12)',
      'page.insert_text((70,150),after,fontname="helv" if defect=="pdf-bold" else "hebo",fontsize=12)',
      'if defect!="pdf-line": page.draw_line((70,200 if defect=="pdf-unrelated-line" else 120),(500,200 if defect=="pdf-unrelated-line" else 120),width=1)',
      'border=\'<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6"/></w:pBdr></w:pPr></w:p>\'',
      'body=f"<w:p><w:r><w:t>{before}</w:t></w:r></w:p>"',
      'if defect not in ("docx-line","unrelated-line"): body+=border',
      'bold=\'<w:rStyle w:val="Strong"/><w:b w:val="0"/>\' if defect=="bold-off" else \'<w:rStyle w:val="Strong"/>\' if defect=="styled-bold" else "" if defect=="docx-bold" else "<w:b/>"',
      'body+=f"<w:p><w:r><w:rPr>{bold}</w:rPr><w:t>{after if defect!=\'text\' else \'MISSING\'}</w:t></w:r></w:p>"',
      'if defect=="unrelated-line": body+=border',
      'buf=io.BytesIO()',
      'with zipfile.ZipFile(buf,"w") as z:',
      ' z.writestr("word/document.xml",\'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>\'+body+"</w:body></w:document>")',
      ' z.writestr("word/styles.xml",\'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="character" w:styleId="Strong"><w:rPr><w:b/></w:rPr></w:style></w:styles>\')',
      'print(json.dumps({"pdf":base64.b64encode(doc.tobytes()).decode(),"docx":base64.b64encode(buf.getvalue()).decode()}))',
    ].join('\n'), [defect])).toString()) as { pdf: string; docx: string };
    const sample = { before: 'RULE_BEFORE', bold: 'RULE_CONCLUSION', answer: 'ANSWER' };
    const evidence = await inspectHorizontalRuleOutputs(python, Buffer.from(fixtures.pdf, 'base64'),
      Buffer.from(fixtures.docx, 'base64'), info.outputPath('pages'), sample);
    const check = () => {
      for (const format of ['pdf', 'docx'] as const) assertHorizontalRuleOutput(evidence[format], sample, format);
    };
    if (defect === 'none' || defect === 'styled-bold') expect(check).not.toThrow();
    else expect(check).toThrow();
  });
}
