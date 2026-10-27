import { expect } from '@playwright/test';
import type { PdfBorders, PdfBorderLine } from '../../../packages/runtime/pdf-borders';

type Box = [number, number, number, number];
interface Marker { page: number; box: Box }
export interface ColumnMarkers { top: Marker; body: Marker; bottom: Marker }
export interface ColumnBorderStyle { widthPt: number; color: readonly [number, number, number]; style: 'dashed' }
export const EDITOR_COLUMN_BORDER: ColumnBorderStyle = { widthPt: 0.75, color: [221 / 255, 221 / 255, 221 / 255], style: 'dashed' };

function hasStyle(line: PdfBorderLine, style: ColumnBorderStyle): boolean {
  return Math.abs(line.width - style.widthPt) <= 0.2
    && line.color.every((value, index) => Math.abs(value - style.color[index]) <= 12 / 255);
}

/** 用最终像素检查dash/gap，不能因路径元数据声称虚线就通过。 */
function visibleDashedSide(line: PdfBorderLine, start: number, end: number): boolean {
  if (line.start > start + 3 || line.end < end - 3) return false;
  const ink = line.ink.map(([a, b]) => [Math.max(a, start), Math.min(b, end)])
    .filter(([a, b]) => b > a);
  if (ink.length < 3) return false;
  const lengths = ink.map(([a, b]) => b - a);
  const gaps = ink.slice(1).map(([a], index) => a - ink[index][1]);
  const coverage = lengths.reduce((a, b) => a + b, 0) / (end - start);
  // Missing sides/large missing chunks cannot masquerade as the spaces in dashes.
  return coverage >= 0.2 && coverage <= 0.88
    && Math.max(...lengths) <= 12 && Math.max(...gaps) <= 12
    && gaps.filter(gap => gap >= 0.25).length >= 2
    && lengths.filter(length => length >= line.width * 1.2).length >= 2
    && ink[0][0] - start <= 3 && end - ink.at(-1)![1] <= 3;
}

/** 每个矩形必须包围本栏三个真实标记，并且不能包住相邻栏或借用无关装饰线。 */
export function assertColumnPdfBorders(pdf: PdfBorders, columns: readonly ColumnMarkers[], style = EDITOR_COLUMN_BORDER) {
  expect(columns.length).toBeGreaterThanOrEqual(2);
  const results = columns.map((column, index) => {
    const markers = [column.top, column.body, column.bottom];
    expect(markers.every(marker => marker.page === column.top.page)).toBe(true);
    const page = pdf.pages[column.top.page];
    expect(page, '边框与文字必须来自同一实际PDF页面').toBeTruthy();
    const bounds: Box = [Math.min(...markers.map(m => m.box[0])), Math.min(...markers.map(m => m.box[1])),
      Math.max(...markers.map(m => m.box[2])), Math.max(...markers.map(m => m.box[3]))];
    const lines = page.lines.filter(line => hasStyle(line, style));
    const top = lines.filter(line => line.axis === 'h' && line.coordinate <= bounds[1] + 1 && line.coordinate >= bounds[1] - 24);
    const bottom = lines.filter(line => line.axis === 'h' && line.coordinate >= bounds[3] - 1 && line.coordinate <= bounds[3] + 24);
    const left = lines.filter(line => line.axis === 'v' && line.coordinate <= bounds[0] + 1 && line.coordinate >= bounds[0] - 24);
    const right = lines.filter(line => line.axis === 'v' && line.coordinate >= bounds[2] - 1 && line.coordinate <= page.width);
    const rectangles = [];
    for (const t of top) for (const b of bottom) for (const l of left) for (const r of right) {
      const box: Box = [l.coordinate, t.coordinate, r.coordinate, b.coordinate];
      if (box[2] <= box[0] || box[3] <= box[1]) continue;
      const otherColumnInside = columns.some((other, otherIndex) => otherIndex !== index
        && [other.top, other.body, other.bottom].some(marker => marker.page === column.top.page
          && marker.box[0] < box[2] - 1 && marker.box[2] > box[0] + 1
          && marker.box[1] < box[3] - 1 && marker.box[3] > box[1] + 1));
      if (otherColumnInside) continue;
      if (!visibleDashedSide(t, box[0], box[2]) || !visibleDashedSide(b, box[0], box[2])
        || !visibleDashedSide(l, box[1], box[3]) || !visibleDashedSide(r, box[1], box[3])) continue;
      rectangles.push({ page: column.top.page, box, sides: { top: t, right: r, bottom: b, left: l } });
    }
    expect(rectangles, `第${index + 1}栏必须有包围全部三个标记的四边虚线边框，颜色#ddd、线宽0.75pt且实际像素可见`).toHaveLength(1);
    return rectangles[0];
  });
  for (let index = 1; index < results.length; index++) {
    expect(results[index].box[0], '每栏独立边框不能重叠').toBeGreaterThanOrEqual(results[index - 1].box[2] - 1);
  }
  return results;
}

export interface EditorColumnBorder {
  top: { width: string; style: string; color: string };
  right: { width: string; style: string; color: string };
  bottom: { width: string; style: string; color: string };
  left: { width: string; style: string; color: string };
}
export function assertEditorColumnBorder(border: EditorColumnBorder): void {
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const value = border[side];
    expect(value, `编辑器必须返回${side}边框计算样式`).toBeTruthy();
    expect(value.width, `编辑器列${side}边框宽度`).toBe('1px');
    expect(value.style, `编辑器列${side}边框样式`).toBe('dashed');
    expect(value.color, `编辑器列${side}边框颜色`).toBe('rgb(221, 221, 221)');
  }
}
