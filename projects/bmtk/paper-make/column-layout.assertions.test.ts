import { expect, test } from '@playwright/test';
import type { LayoutPdf, PdfCharacter } from '../../../packages/runtime/document-layout';
import { assertColumnLayoutPdf } from './column-layout.assertions';

// 人工给定坐标：同一行左右并排；上下堆叠即为TAPD1007416原始现象。
const sample = { columns: [
  { top: 'LEFT', body: 'Condition', bottom: 'ENDLAAA' },
  { top: 'RIGHT', body: 'Result', bottom: 'ENDRBBBB' },
] };
function chars(text: string, x: number, y: number): PdfCharacter[] {
  return [...text].map((text, index) => ({ text, box: [x + index * 5, y, x + index * 5 + 5, y + 12],
    font: 'Arial', size: 12, color: 0 }));
}
function pdf(rightX = 220, rightY = 100): LayoutPdf {
  return { pages: [{ width: 595, height: 842, image: '', chars: [
    ...chars('LEFT', 50, 100), ...chars('Condition', 50, 118), ...chars('ENDLAAA', 50, 136),
    ...chars('RIGHT', rightX, rightY), ...chars('Result', rightX, rightY + 18), ...chars('ENDRBBBB', rightX, rightY + 36),
  ] }] };
}
test('PDF双栏内容齐全且首行对齐、左右并排才通过', () => {
  expect(assertColumnLayoutPdf(pdf(), sample)).toHaveLength(2);
});
test('三栏位于同页同一行并各保留结尾才通过', () => {
  const data = pdf();
  data.pages[0].chars.push(...chars('THIRD', 390, 100), ...chars('Model', 390, 118), ...chars('ENDTCCCC', 390, 136));
  expect(assertColumnLayoutPdf(data, { columns: [...sample.columns,
    { top: 'THIRD', body: 'Model', bottom: 'ENDTCCCC' }] })).toHaveLength(3);
});
test('文字齐全但从相同横坐标上下堆叠必须失败', () => {
  expect(() => assertColumnLayoutPdf(pdf(50, 160), sample)).toThrow();
});
test('不能仅检查横坐标而漏掉各栏首行高低错位', () => {
  expect(() => assertColumnLayoutPdf(pdf(220, 128), sample)).toThrow();
});
test('两栏文字重叠必须失败', () => {
  expect(() => assertColumnLayoutPdf(pdf(60), sample)).toThrow();
});
test('列顺序左右颠倒必须失败', () => {
  expect(() => assertColumnLayoutPdf(pdf(10), sample)).toThrow();
});
test('缺少一栏不能把空匹配当作通过', () => {
  const data = pdf();
  data.pages[0].chars.splice(4 + 9 + 7);
  expect(() => assertColumnLayoutPdf(data, sample)).toThrow();
});
test('重复输出同一栏标记必须失败', () => {
  const data = pdf();
  data.pages[0].chars.push(...chars('LEFT', 50, 200));
  expect(() => assertColumnLayoutPdf(data, sample)).toThrow();
});
test('某栏丢失后半段正文必须失败', () => {
  const data = pdf();
  data.pages[0].chars = data.pages[0].chars.slice(0, -8);
  expect(() => assertColumnLayoutPdf(data, sample)).toThrow();
});
test('把左右栏拆到两页即使坐标相同也必须失败', () => {
  const data = pdf();
  const right = data.pages[0].chars.splice(4 + 9 + 7);
  data.pages.push({ width: 595, height: 842, image: '', chars: right });
  expect(() => assertColumnLayoutPdf(data, sample)).toThrow();
});
test('文字越出纸张边界必须失败', () => {
  expect(() => assertColumnLayoutPdf(pdf(590), sample)).toThrow();
});

// 穿过真实Python PDF读取链；手写字节坐标与上面的TS数据结构检查相互独立。
for (const columns of [2, 3]) {
  test(`${columns}栏真实PDF读取后，正确并排通过而上下堆叠被拒绝`, async ({}, info) => {
    const { runPython } = await import('../../../packages/runtime/python');
    const { inspectPdf } = await import('../../../packages/runtime/document-layout');
    const python = process.env.BMTK_PDF_PYTHON || 'python3';
    const fixture = { columns: [
      { top: 'A_TOP', body: 'FIRST', bottom: 'A_END' },
      { top: 'B_TOP', body: 'SECOND', bottom: 'B_END' },
      { top: 'C_TOP', body: 'THIRD', bottom: 'C_END' },
    ].slice(0, columns) };
    for (const stacked of [false, true]) {
      const bytes = await runPython(python, [
        'import pymupdf,sys,json',
        'data=json.loads(sys.argv[1]); stacked=sys.argv[2]=="true"',
        'doc=pymupdf.open();page=doc.new_page(width=595,height=842)',
        'for i,column in enumerate(data["columns"]):',
        ' x=50 if stacked else 50+i*170; y=100+i*70 if stacked else 100',
        ' for line,key in enumerate(["top","body","bottom"]): page.insert_text((x,y+line*18),column[key],fontsize=12)',
        'sys.stdout.buffer.write(doc.tobytes())',
      ].join('\n'), [JSON.stringify(fixture), String(stacked)]);
      const parsed = await inspectPdf(python, bytes, info.outputPath(stacked ? 'stacked' : 'parallel'));
      if (stacked) expect(() => assertColumnLayoutPdf(parsed, fixture)).toThrow(/首行顶部应对齐/);
      else expect(assertColumnLayoutPdf(parsed, fixture)).toHaveLength(columns);
    }
  });
}


test('分栏完整也不能遗漏题干开头的作答要求', () => {
  expect(() => assertColumnLayoutPdf(pdf(), { ...sample, stem: 'QUESTION' })).toThrow();
});
test('题干开头和完整分栏同时输出才通过', () => {
  const data = pdf();
  data.pages[0].chars.unshift(...chars('QUESTION', 50, 50));
  expect(assertColumnLayoutPdf(data, { ...sample, stem: 'QUESTION' })).toHaveLength(2);
});
