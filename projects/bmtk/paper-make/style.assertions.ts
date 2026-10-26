import { expect } from '@playwright/test';
import type { PaperStyleLayout } from './style-layouts';

export type { LayoutPdf as StylePdf } from '../../../packages/runtime/document-layout';
import type { LayoutPdf as StylePdf } from '../../../packages/runtime/document-layout';
const compact = (s: string) => s.replace(/\s+/g, '');

/** 检查下载PDF的实际字符与位置；不以styleId、HTML或文件名代替版面证据。 */
export function assertPaperStylePdf(pdf: StylePdf, layout: PaperStyleLayout, markers: readonly string[]) {
  const chars = pdf.pages.flatMap((p, pageIndex) => p.chars.filter(c => compact(c.text))
    .map(c => ({ ...c, pageIndex })));
  const text = chars.map(c => c.text).join('');
  expect(pdf.pages.length, '单双面必须用多页正文验证，不能只检查封面').toBeGreaterThanOrEqual(3);
  const starts = markers.map(marker => {
    const index = text.indexOf(marker);
    expect(index, `导出PDF不得漏正文标记 ${marker}`).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(marker, index + marker.length), `正文标记 ${marker} 不得重复`).toBe(-1);
    return chars[index];
  });
  // Arial只核对原题中的拉丁字符，中文允许系统CJK回退字体。
  const latin = markers.flatMap(marker => {
    const index = text.indexOf(marker);
    return chars.slice(index, index + marker.length).filter(c => /[A-Za-z]/.test(c.text));
  });
  expect(latin.length, '真实科学试卷须提供可验证Arial的拉丁文字').toBeGreaterThan(0);
  for (const font of new Set(latin.map(s => s.font)))
    expect(font, '实际正文应使用Arial或其服务端等度量替代字体').toMatch(/Arial|LiberationSans|NimbusSans/i);
  for (const size of new Set(starts.map(s => s.size)))
    expect(size, '18px正文在PDF中应为13.5pt').toBeCloseTo(13.5, 1);
  expect([...new Set(starts.map(s => s.color))], '实际正文必须保留蓝色#1677ff').toEqual([0x1677ff]);
  const geometry = pdf.pages.map((page, pageIndex) => {
    expect(page.width > page.height, '一栏纵向，两栏横向').toBe(layout.paperSize === 0);
    // 几何证据按实际正文特征取样；字体颜色错误不能把真实正文误判为空白。
    const body = page.chars.filter(c => compact(c.text) && starts.some(s => s.color === c.color && Math.abs(s.size - c.size) < 0.1));
    const mirrored = layout.printSetup === 2 && pageIndex % 2 === 1;
    const leftMargin = (mirrored ? 1.2 : 3.2) * 72 / 2.54;
    const rightMargin = (mirrored ? 3.2 : 1.2) * 72 / 2.54;
    // 非对称边距下，中缝位于正文区域中心；双面偶页随边距反向移动。
    const center = layout.paperSize === 0 ? (page.width + leftMargin - rightMargin) / 2 : page.width / 2;
    expect(body.filter(c => c.box[0] < 0 || c.box[2] > page.width + 1 || c.box[1] < 0 || c.box[3] > page.height + 1),
      '正文不能越出页面边界').toHaveLength(0);
    const pageStarts = starts.filter(s => s.pageIndex === pageIndex);
    return { pageIndex, width: page.width, height: page.height, bodyCount: body.length,
      left: pageStarts.length ? Math.min(...pageStarts.map(c => c.box[0])) : null,
      center,
      leftCount: body.filter(c => c.box[2] < center - 6).length,
      rightCount: body.filter(c => c.box[0] > center + 6).length,
      gutterCount: body.filter(c => c.box[0] < center + 6 && c.box[2] > center - 6).length };
  });
  const full = geometry.filter(p => starts.filter(s => s.pageIndex === p.pageIndex).length >= 10);
  expect(full.length, '必须有足量正文填充页以观察分栏').toBeGreaterThan(0);
  for (const page of full) {
    expect(page.leftCount, '有效页必须有左侧正文').toBeGreaterThan(10);
    expect(page.rightCount, '有效页必须有右侧正文，不能拿半张空白页冒充两栏').toBeGreaterThan(10);
    if (layout.paperSize === 0) expect(page.gutterCount, '两栏正文应保留中间栏间空隙').toBe(0);
    else expect(page.gutterCount, '一栏正文应横跨页面中部，不能误用两栏').toBeGreaterThan(0);
  }
  const odd = geometry.find(p => p.pageIndex % 2 === 0 && p.left != null);
  const even = geometry.find(p => p.pageIndex % 2 === 1 && p.left != null);
  expect(odd, '必须观测到奇数页正文').toBeTruthy();
  expect(even, '必须观测到偶数页正文').toBeTruthy();
  if (odd?.left != null && even?.left != null) {
    // 测试配置左3.2cm、右1.2cm；双面反面交换边距，单面每页保持同侧。
    const expectedDelta = layout.printSetup === 2 ? -2 * 72 / 2.54 : 0;
    expect(Math.abs((even.left - odd.left) - expectedDelta), '单面页边距固定，双面奇偶页交换左右边距').toBeLessThan(4);
  }
  return { layout: layout.label, pages: geometry, markerCount: starts.length };
}
