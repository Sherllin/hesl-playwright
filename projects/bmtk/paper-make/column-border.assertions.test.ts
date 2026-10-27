import { test, expect, type TestInfo } from '@playwright/test';
import { inspectPdf } from '../../../packages/runtime/document-layout';
import { inspectPdfBorders } from '../../../packages/runtime/pdf-borders';
import { runPython } from '../../../packages/runtime/python';
import { assertColumnLayoutPdf } from './column-layout.assertions';
import { assertColumnPdfBorders, assertEditorColumnBorder, type EditorColumnBorder } from './column-border.assertions';

const python = process.env.BMTK_PDF_PYTHON || 'python3';
const sample = { columns: [
  { top: 'A_TOP', body: 'FIRST', bottom: 'A_END' },
  { top: 'B_TOP', body: 'SECOND', bottom: 'B_END' },
  { top: 'C_TOP', body: 'THIRD', bottom: 'C_END' },
] };

async function fixture(info: TestInfo, count: number, mode = 'dashed', missing = '') {
  const data = { columns: sample.columns.slice(0, count) };
  // 独立人工给定几何，不从待测边框检查实现生成预期值。
  const bytes = await runPython(python, [
    'import pymupdf as fitz,sys,json',
    'data=json.loads(sys.argv[1]);mode=sys.argv[2];missing=sys.argv[3]',
    'doc=fitz.open();page=doc.new_page(width=595,height=842)',
    'color=(221/255,)*3 if mode!="black" else (0,0,0);width=0.25 if mode=="thin" else 1 if mode=="thick" else 0.75',
    'def side(a,b):',
    ' if mode=="filled":',
    '  horizontal=a[1]==b[1]; start=a[0] if horizontal else a[1];end=b[0] if horizontal else b[1]',
    '  while start<end:',
    '   stop=min(start+3,end)',
    '   rect=fitz.Rect(start,a[1]-width/2,stop,a[1]+width/2) if horizontal else fitz.Rect(a[0]-width/2,start,a[0]+width/2,stop)',
    '   page.draw_rect(rect,color=None,fill=color);start+=5',
    ' else: page.draw_line(a,b,color=color,width=width,dashes="[] 0" if mode=="solid" else "[3 2] 0")',
    'for i,column in enumerate(data["columns"]):',
    ' x=50+i*170',
    ' for row,key in enumerate(["top","body","bottom"]):page.insert_text((x,100+row*18),column[key],fontsize=12)',
    ' if mode in ["none","outer","shared"]: continue',
    ' left=x-5;right=x+150;top=85+(100 if mode=="unrelated" else 0);bottom=157+(100 if mode=="unrelated" else 0)',
    ' sides={"top":((left,top),(right,top)),"bottom":((left,bottom),(right,bottom)),"left":((left,top),(left,bottom)),"right":((right,top),(right,bottom))}',
    ' for name,(a,b) in sides.items():',
    '  if missing!=f"{i}:{name}":side(a,b)',
    ' if mode=="invisible":',
    '  for rect in [fitz.Rect(left-1,top-1,right+1,top+1),fitz.Rect(left-1,bottom-1,right+1,bottom+1),fitz.Rect(left-1,top-1,left+1,bottom+1),fitz.Rect(right-1,top-1,right+1,bottom+1)]:page.draw_rect(rect,color=None,fill=(1,1,1))',
    'if mode in ["outer","shared"]:',
    ' left,right,top,bottom=45,200+(len(data["columns"])-1)*170,85,157',
    ' for a,b in [((left,top),(right,top)),((left,bottom),(right,bottom)),((left,top),(left,bottom)),((right,top),(right,bottom))]:side(a,b)',
    ' if mode=="shared":',
    '  for i in range(1,len(data["columns"])):side((45+i*170,top),(45+i*170,bottom))',
    'sys.stdout.buffer.write(doc.tobytes())',
  ].join('\n'), [JSON.stringify(data), mode, missing]);
  const pdf = await inspectPdf(python, bytes, info.outputPath('rendered'));
  const geometry = assertColumnLayoutPdf(pdf, data);
  const borders = await inspectPdfBorders(python, bytes);
  return { borders, geometry };
}

for (const count of [2, 3]) for (const mode of ['dashed', 'filled', 'shared']) {
  test(`${count}栏真实PDF的${mode}四边通过向量与实际像素检查`, async ({}, info) => {
    const { borders, geometry } = await fixture(info, count, mode);
    const result = assertColumnPdfBorders(borders, geometry);
    expect(result).toHaveLength(count);
    for (const column of result) expect(Object.keys(column.sides)).toHaveLength(4);
  });
}

for (const mode of ['none', 'black', 'thin', 'thick', 'solid', 'unrelated', 'outer']) {
  test(`真实PDF反例 ${mode} 不能冒充每栏四边默认虚线`, async ({}, info) => {
    const { borders, geometry } = await fixture(info, 3, mode);
    expect(() => assertColumnPdfBorders(borders, geometry)).toThrow(/四边虚线边框/);
  });
}
for (let column = 0; column < 3; column++) for (const side of ['top', 'right', 'bottom', 'left']) {
  test(`真实PDF第${column + 1}栏缺失${side}边必须转红`, async ({}, info) => {
    const { borders, geometry } = await fixture(info, 3, 'dashed', `${column}:${side}`);
    expect(() => assertColumnPdfBorders(borders, geometry)).toThrow(/四边虚线边框/);
  });
}

test('PDF向量存在但白色遮挡导致最终不可见时，像素证据必须拒绝', async ({}, info) => {
  // 遮挡仅盖边框而保留文字，确保拒绝来自实际边框像素检查。
  const { borders, geometry } = await fixture(info, 2, 'invisible');
  expect(borders.pages[0].lines.some(line => line.color[0] < 0.9)).toBe(true);
  expect(() => assertColumnPdfBorders(borders, geometry)).toThrow(/四边虚线边框/);
});

function editor(): EditorColumnBorder {
  const side = () => ({ width: '1px', style: 'dashed', color: 'rgb(221, 221, 221)' });
  return { top: side(), right: side(), bottom: side(), left: side() };
}
test('浏览器四边计算样式逐一核对宽度、颜色和虚线', () => {
  assertEditorColumnBorder(editor());
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const missing = editor();
    delete (missing as Partial<EditorColumnBorder>)[side];
    expect(() => assertEditorColumnBorder(missing)).toThrow();
    for (const [key, value] of [['width', '0px'], ['style', 'solid'], ['color', 'rgb(0, 0, 0)']] as const) {
      const border = editor();
      border[side][key] = value;
      expect(() => assertEditorColumnBorder(border)).toThrow();
    }
  }
});
