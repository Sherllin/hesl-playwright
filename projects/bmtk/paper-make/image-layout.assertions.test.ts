import { expect, test } from '@playwright/test';
import { assertImageLayout, type ImagePdf } from './image-layout.assertions';

const colors = [[240, 30, 30], [30, 180, 30], [30, 30, 240], [180, 30, 180]];
function validAnswer(): ImagePdf {
  return {
    text: '答案：A I14ANSWERBEFORE I14ANSWERAFTER I14ANSWERBEFORE I14ANSWERAFTER I14TALLRESPONSEBEFORE I14TALLRESPONSEAFTER',
    pages: [{ width: 595.3, height: 841.9, image: '', words: [] }],
    pictures: [
      { role: 'answer', page: 0, box: [100, 100, 250, 175], width: 200, height: 100, corners: colors },
      { role: 'answer', page: 0, box: [100, 200, 250, 275], width: 200, height: 100, corners: colors },
      { role: 'tall', page: 0, box: [100, 300, 340, 740], width: 1200, height: 2200, corners: colors },
    ],
  };
}
function validQuestionOutput(output: 'paper' | 'combined'): ImagePdf {
  const roles = ['choice', 'option', 'parent', 'child', 'tall', ...(output === 'combined' ? ['answer', 'answer', 'tall'] : [])];
  return {
    text: [
      ...['CHOICE', 'OPTION', 'PARENT', 'CHILD', 'TALL'].map(label => `I14${label}BEFORE I14${label}AFTER`),
      ...Array.from({ length: 36 }, (_, i) => `I14MATERIAL${String(i).padStart(2, '0')} Long experimental material continues with full original text.`),
      'OTHER OPTION',
      output === 'combined' ? validAnswer().text : '',
    ].join('\n'),
    pages: roles.map(() => ({ width: 595.3, height: 841.9, image: '', words: [] })),
    pictures: roles.map((role, page) => ({ role, page,
      box: role === 'tall' ? [100, 200, 340, 640] : [100, 100, 250, 175],
      width: role === 'tall' ? 1200 : 200, height: role === 'tall' ? 2200 : 100, corners: colors,
    })),
  };
}
for (const output of ['paper', 'combined'] as const) {
  test(`${output}保留全部材料正文和非图片选项时通过`, () => {
    const pdf = validQuestionOutput(output);
    pdf.text = pdf.text.replaceAll('experimental material', 'experimental\nmaterial');
    expect(() => assertImageLayout(pdf, output, 1)).not.toThrow();
  });
  for (const [name, corrupt] of [
    ['仅余36个材料标记而正文全部丢失', (text: string) => text.replaceAll(' Long experimental material continues with full original text.', '')],
    ['最后一段材料正文被截断', (text: string) => text.replace('I14MATERIAL35 Long experimental material continues with full original text.', 'I14MATERIAL35 Long experimental material')],
    ['非图片B选项正文丢失', (text: string) => text.replace('OTHER OPTION', '')],
  ] as const) {
    test(`${output}${name}必须失败`, () => {
      const pdf = validQuestionOutput(output);
      pdf.text = corrupt(pdf.text);
      expect(() => assertImageLayout(pdf, output, 1)).toThrow();
    });
  }
}
test('纯答案必须有两处子题答案图与完整高图，不能以任意图片代替', () => {
  expect(() => assertImageLayout(validAnswer(), 'answer', 1)).not.toThrow();
});
for (const [name, corrupt] of [
  ['图片丢失', (pdf: ImagePdf) => { pdf.pictures.pop(); }],
  ['水印冒充原题图片', (pdf: ImagePdf) => { pdf.pictures[2].role = 'watermark'; }],
  ['图片被压扁', (pdf: ImagePdf) => { pdf.pictures[0].box[3] = 140; }],
  ['图片被裁掉上半部分', (pdf: ImagePdf) => { pdf.pictures[0].corners = [[255, 255, 255], ...colors.slice(1)]; }],
  ['图片遮住题号和文字', (pdf: ImagePdf) => { pdf.pages[0].words.push({ text: '2.1', box: [110, 120, 140, 133] }); }],
  ['图片越出纸张', (pdf: ImagePdf) => { pdf.pictures[0].box = [520, 100, 670, 175]; }],
  ['图片进入页脚', (pdf: ImagePdf) => { pdf.pictures[0].box = [100, 750, 250, 825]; }],
  ['正文丢失', (pdf: ImagePdf) => { pdf.text = pdf.text.replace('I14TALLRESPONSEAFTER', ''); }],
  ['纯答案混入题干', (pdf: ImagePdf) => { pdf.text += ' I14CHOICEBEFORE'; }],
] as const) {
  test(`${name}必须失败`, () => {
    const pdf = structuredClone(validAnswer());
    corrupt(pdf);
    expect(() => assertImageLayout(pdf, 'answer', 1)).toThrow();
  });
}
test('双栏输出中的图片不能穿过中间栏缝', () => {
  const pdf = validAnswer();
  pdf.pages[0].width = 1190.55;
  pdf.pictures[0].box = [560, 100, 710, 175];
  expect(() => assertImageLayout(pdf, 'answer', 2)).toThrow();
});
