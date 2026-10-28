import { expect } from '@playwright/test';

export interface ImageBox { role: string; page: number; box: number[]; width: number; height: number; corners: number[][] }
export interface ImagePdf {
  text: string;
  pages: Array<{ width: number; height: number; image: string; words: Array<{ text: string; box: number[] }> }>;
  pictures: ImageBox[];
}
export type ImageOutput = 'paper' | 'combined' | 'answer';

export function assertImageLayout(pdf: ImagePdf, output: ImageOutput, columns: 1 | 2): void {
  const counts = output === 'answer' ? { answer: 2, tall: 1 }
    : { choice: 1, option: 1, parent: 1, child: 1, tall: output === 'combined' ? 2 : 1,
      ...(output === 'combined' ? { answer: 2 } : {}) };
  expect(pdf.pages.length, '必须有实际PDF页面').toBeGreaterThan(0);
  expect(pdf.pictures.length, '水印不能代替原题图片').toBe(Object.values(counts).reduce((sum, count) => sum + count, 0));
  for (const [role, count] of Object.entries(counts))
    expect(pdf.pictures.filter(image => image.role === role), `${role}原图的绘制次数`).toHaveLength(count);
  const text = pdf.text.replace(/[\s\u200B]/g, '');
  for (const label of ['CHOICE', 'OPTION', 'PARENT', 'CHILD', 'TALL']) {
    for (const edge of ['BEFORE', 'AFTER']) {
      const marker = `I14${label}${edge}`;
      expect(text.includes(marker), `${marker}题干/选项是否应出现`).toBe(output !== 'answer');
    }
  }
  for (let number = 0; number < 36; number++) {
    const marker = `I14MATERIAL${String(number).padStart(2, '0')}`;
    expect(text.includes(marker), '跨页材料不得缺行').toBe(output !== 'answer');
    if (output !== 'answer') expect(text, `${marker}材料正文必须完整`).toContain(`${marker}Longexperimentalmaterialcontinueswithfulloriginaltext.`);
  }
  if (output !== 'answer') expect(text, '非图片B选项正文必须完整').toContain('OTHEROPTION');
  for (const edge of ['BEFORE', 'AFTER']) {
    expect(text.split(`I14ANSWER${edge}`).length - 1, '子题答案及父题汇总必须完整').toBe(output === 'paper' ? 0 : 2);
    expect(text.includes(`I14TALLRESPONSE${edge}`), '高图答案前后文字完整').toBe(output !== 'paper');
  }
  if (output !== 'paper') expect(text, '单选答案必须仍是A').toContain('答案：A');
  const colors = [[240, 30, 30], [30, 180, 30], [30, 30, 240], [180, 30, 180]];
  for (const page of pdf.pages) {
    expect(page.width).toBeCloseTo(columns === 1 ? 595.28 : 1190.55, 0);
    expect(page.height).toBeCloseTo(841.89, 0);
  }
  for (const image of pdf.pictures) {
    const page = pdf.pages[image.page];
    expect(page, '图片必须属于实际页面').toBeTruthy();
    const [x0, y0, x1, y1] = image.box;
    expect(x1).toBeGreaterThan(x0);
    expect(y1).toBeGreaterThan(y0);
    expect(Math.abs((x1 - x0) / (y1 - y0) / (image.width / image.height) - 1), `${image.role}不能拉伸变形`).toBeLessThan(.02);
    const left = 3.2 * 72 / 2.54, right = page.width - 1.2 * 72 / 2.54;
    expect(x0, '图片不能进入左边距').toBeGreaterThanOrEqual(left - 1);
    expect(x1, '图片不能越出右边距').toBeLessThanOrEqual(right + 1);
    expect(y0, '图片不能进入页眉').toBeGreaterThanOrEqual(1.2 * 72 / 2.54 - 1);
    expect(y1, '图片不能进入页脚').toBeLessThanOrEqual(page.height - 1.2 * 72 / 2.54 + 1);
    if (columns === 2) {
      const column = (right - left - 36) / 2;
      expect(x1 <= left + column + 1 || x0 >= left + column + 35, '图片不能越过栏缝').toBe(true);
    }
    expect(image.corners, `${image.role}必须保留四角`).toHaveLength(4);
    image.corners.forEach((actual, index) => {
      expect(actual, '图片被裁切或被其他内容盖住').toHaveLength(3);
      actual.forEach((channel, i) => expect(Math.abs(channel - colors[index][i])).toBeLessThan(20));
    });
    for (const word of page.words) {
      const overlapWidth = Math.min(x1 - 1, word.box[2]) - Math.max(x0 + 1, word.box[0]);
      const overlapHeight = Math.min(y1 - 1, word.box[3]) - Math.max(y0 + 1, word.box[1]);
      expect(overlapWidth > 0 && overlapHeight > 0, `${image.role}遮挡文字：${word.text}`).toBe(false);
    }
  }
}
