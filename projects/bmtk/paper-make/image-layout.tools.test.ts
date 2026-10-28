import { expect, test } from '@playwright/test';
import { runPython } from '../../../packages/runtime/python';
import { assertImageLayout } from './image-layout.assertions';
import { createImageFixtures, imageSamples, inspectImagePdf } from './image-layout.tools';

const python = process.env.BMTK_PDF_PYTHON || 'python3';
test('独立生成六张不同原图及三种题目，组合子题使用真实简答题型身份', async ({}, info) => {
  const fixture = await createImageFixtures(python, info.outputPath('sources'));
  expect(fixture.images.map(image => image.role)).toEqual(['choice', 'option', 'parent', 'child', 'answer', 'tall']);
  expect(new Set(fixture.images.map(image => image.src)).size).toBe(6);
  const samples = imageSamples(fixture.images, 'UNIQUE-RUN', '9007199254742001');
  expect(samples.map(sample => sample.type)).toEqual([1, 6, 5]);
  expect(samples[1].payload).toMatchObject({ subQuestions: [{ questionType: 5, questionTypeId: '9007199254742001' }] });
  expect(JSON.stringify(samples)).toContain('I14MATERIAL35');
  expect(JSON.stringify(samples)).toContain('width=\\"1200\\"');
});

for (const defect of ['none', 'clip', 'overlap', 'stretch', 'missing'] as const) {
  test(`真实PDF图片像素分析：${defect === 'none' ? '完整图片通过且忽略不可见签名字形' : defect + '必须失败'}`, async ({}, info) => {
    const fixture = await createImageFixtures(python, info.outputPath('sources'));
    const bytes = await runPython(python, [
      'import json,sys,pymupdf',
      'images=json.loads(open(sys.argv[1]).read()); defect=sys.argv[2]; doc=pymupdf.open()',
      'for index,role in enumerate(["answer","answer","tall"]):',
      ' page=doc.new_page(width=595.3,height=841.9)',
      ' if index==0:',
      '  lines=["答案：A","I14ANSWERBEFORE","I14ANSWERBEFORE","I14ANSWERAFTER","I14ANSWERAFTER","I14TALLRESPONSEBEFORE","I14TALLRESPONSEAFTER"]',
      '  for line,text in enumerate(lines): page.insert_text((100,40+line*18),text,fontname="china-s",fontsize=12)',
      ' picture=next(image for image in images if image["role"]==role)',
      ' box=pymupdf.Rect(100,200,250,275) if role=="answer" else pymupdf.Rect(100,200,340,640)',
      ' if defect=="stretch" and index==0: box.y1=230',
      ' if not (defect=="missing" and index==2): page.insert_image(box,filename=picture["path"],keep_proportion=False)',
      ' if index==0:',
      '  page.insert_text((110,240),"hidden-signature",render_mode=3,fontsize=12)',
      '  if defect=="overlap": page.insert_text((110,240),"2.1",fontsize=12)',
      '  if defect=="clip": page.draw_rect(pymupdf.Rect(100,200,120,220),fill=(1,1,1),color=None,overlay=True)',
      'sys.stdout.buffer.write(doc.tobytes())',
    ].join('\n'), [fixture.manifest, defect]);
    const pdf = await inspectImagePdf(python, bytes, fixture.manifest, info.outputPath('pages'));
    if (defect === 'none') {
      expect(pdf.pictures.map(image => image.role)).toEqual(['answer', 'answer', 'tall']);
      expect(() => assertImageLayout(pdf, 'answer', 1)).not.toThrow();
    } else expect(() => assertImageLayout(pdf, 'answer', 1)).toThrow();
  });
}
