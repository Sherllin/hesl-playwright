import { test, expect } from '@playwright/test';
import { assertPaperStylePdf, type StylePdf } from './style.assertions';
import { PAPER_STYLE_LAYOUTS } from './style-layouts';

function fixture(layout: typeof PAPER_STYLE_LAYOUTS[number]) {
  const markers = Array.from({ length: 36 }, (_, i) => `LAYOUT${String(i + 1).padStart(4, '0')}`);
  const width = layout.paperSize === 1 ? 595 : 1190;
  const pdf: StylePdf = { pages: Array.from({ length: 3 }, (_, page) => {
    const left = 100 - (layout.printSetup === 2 && page % 2 ? 2 * 72 / 2.54 : 0);
    const chars = markers.slice(page * 12, (page + 1) * 12).flatMap((marker, row) =>
      [...marker].map((text, index) => ({ text, box: [
        left + (layout.paperSize === 0 && row >= 6 ? width / 2 : 0) + index * 6,
        100 + (row % 6) * 24,
        left + (layout.paperSize === 0 && row >= 6 ? width / 2 : 0) + index * 6 + 6,
        114 + (row % 6) * 24,
      ] as [number, number, number, number], font: 'Arial', size: 13.5, color: 0x1677ff })));
    if (layout.paperSize === 1) for (let i = 0; i < 12; i++) for (const x of [width / 2, width / 2 + 50])
      chars.push({ text: '文', box: [x, 100 + i * 24, x + 6, 114 + i * 24], font: 'Arial', size: 13.5, color: 0x1677ff });
    return { width, height: 842, chars, image: '' };
  }) };
  return { pdf, markers };
}

for (const layout of PAPER_STYLE_LAYOUTS) {
  test(`${layout.label}真实几何通过，反转栏数或单双面必须失败`, () => {
    const { pdf, markers } = fixture(layout);
    expect(() => assertPaperStylePdf(pdf, layout, markers)).not.toThrow();
    expect(() => assertPaperStylePdf(pdf, { ...layout, paperSize: layout.paperSize === 1 ? 0 : 1 }, markers)).toThrow(/纵向/);
    expect(() => assertPaperStylePdf(pdf, { ...layout, printSetup: layout.printSetup === 1 ? 2 : 1 }, markers)).toThrow(/页边距/);
  });
}

test('错误字体、字号、颜色、漏正文和中缝连写必须失败', () => {
  const layout = PAPER_STYLE_LAYOUTS[2];
  const { pdf, markers } = fixture(layout);
  for (const [key, value, message] of [
    ['font', 'TimesNewRoman', /Arial/], ['size', 18, /13.5/], ['color', 0, /蓝色/],
  ] as const) {
    const altered = structuredClone(pdf);
    Object.assign(altered.pages[0].chars[0], { [key]: value });
    expect(() => assertPaperStylePdf(altered, layout, markers)).toThrow(message);
  }
  expect(() => assertPaperStylePdf(pdf, layout, [...markers, 'MISSING0000'])).toThrow(/漏正文/);
  const altered = structuredClone(pdf);
  altered.pages[0].chars.push({ text: '文', box: [620, 100, 627, 114], font: 'Arial', size: 13.5, color: 0x1677ff });
  expect(() => assertPaperStylePdf(altered, layout, markers)).toThrow(/栏间空隙/);
});

test('双面偶页中缝随非对称边距移动，物理中线处合法正文不能误报', () => {
  const layout = PAPER_STYLE_LAYOUTS[3];
  const { pdf, markers } = fixture(layout);
  // 偶页左1.2/右3.2cm，正文中缝中心为566.65pt；物理中线595pt属于右栏。
  pdf.pages[1].chars.push({ text: '文', box: [595, 100, 601, 114], font: 'Arial', size: 13.5, color: 0x1677ff });
  expect(() => assertPaperStylePdf(pdf, layout, markers)).not.toThrow();
  pdf.pages[1].chars.push({ text: '文', box: [563, 100, 570, 114], font: 'Arial', size: 13.5, color: 0x1677ff });
  expect(() => assertPaperStylePdf(pdf, layout, markers)).toThrow(/栏间空隙/);
});
