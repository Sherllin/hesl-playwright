import { expect } from '@playwright/test';
import type { LayoutPdf } from '../../../packages/runtime/document-layout';

export interface ColumnSample { stem: string; columns: readonly { top: string; body: string; bottom: string }[]; answer: string }
type Box = [number, number, number, number];

/** 用实际PDF字符坐标判定分栏，不将“全文都在”当作布局保留。 */
export function assertColumnLayoutPdf(pdf: LayoutPdf, sample: Pick<ColumnSample, 'columns'> & Partial<Pick<ColumnSample, 'stem'>>) {
  if (sample.stem) {
    const compact = (text: string) => text.replace(/\s+/g, '');
    const text = pdf.pages.map(page => page.chars.map(c => c.text).join('')).join('');
    expect(compact(text), 'PDF必须保留题干开头的完整作答要求').toContain(compact(sample.stem));
  }
  const find = (marker: string) => {
    const matches: Array<{ page: number; box: Box }> = [];
    for (const [pageIndex, page] of pdf.pages.entries()) {
      const text = page.chars.map(c => c.text).join('');
      for (let start = text.indexOf(marker); start >= 0; start = text.indexOf(marker, start + marker.length)) {
        // PDF提取器返回逐字符数组；按文本偏移映射到字形，兼容一个字形含多个字符。
        let offset = 0;
        const glyphs = page.chars.filter(c => {
          const end = offset + c.text.length;
          const included = offset < start + marker.length && end > start;
          offset = end;
          return included;
        });
        const box: Box = [Math.min(...glyphs.map(c => c.box[0])), Math.min(...glyphs.map(c => c.box[1])),
          Math.max(...glyphs.map(c => c.box[2])), Math.max(...glyphs.map(c => c.box[3]))];
        expect(box.every(Number.isFinite), `${marker}坐标必须有效`).toBe(true);
        expect(box[0], `${marker}不能越出页面左边界`).toBeGreaterThanOrEqual(0);
        expect(box[1]).toBeGreaterThanOrEqual(0);
        expect(box[2]).toBeLessThanOrEqual(page.width);
        expect(box[3]).toBeLessThanOrEqual(page.height);
        matches.push({ page: pageIndex, box });
      }
    }
    expect(matches, `${marker}必须完整且只输出一次`).toHaveLength(1);
    return matches[0];
  };
  expect(sample.columns.length).toBeGreaterThanOrEqual(2);
  const columns = sample.columns.map(column => ({ top: find(column.top), body: find(column.body), bottom: find(column.bottom) }));
  const first = columns[0].top;
  for (const [index, column] of columns.entries()) {
    expect(column.top.page, '各列必须位于同页').toBe(first.page);
    expect(Math.abs(column.top.box[1] - first.box[1]), '各列首行顶部应对齐，容差1pt').toBeLessThanOrEqual(1);
    expect(column.body.page).toBe(first.page);
    expect(column.bottom.page).toBe(first.page);
    expect(column.body.box[1], '正文必须位于本栏首行之下').toBeGreaterThan(column.top.box[1]);
    expect(column.bottom.box[1], '栏末不能丢失或跑到首行上方').toBeGreaterThan(column.body.box[1]);
    if (index > 0) {
      const previous = columns[index - 1];
      const previousRight = Math.max(previous.top.box[2], previous.body.box[2], previous.bottom.box[2]);
      const currentLeft = Math.min(column.top.box[0], column.body.box[0], column.bottom.box[0]);
      expect(currentLeft, '后一栏全部文字必须位于前一栏右侧且不重叠').toBeGreaterThan(previousRight);
    }
  }
  return columns;
}
