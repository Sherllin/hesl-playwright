import { expect } from '@playwright/test';
import type { LayoutPdf } from '../../../../packages/runtime/document-layout';

export interface FormulaPdf extends LayoutPdf {
  formulaImages?: Array<{ pageIndex: number; box: [number, number, number, number]; visibleFraction: boolean }>;
}

export type FormulaOption = string | { numerator: string; denominator: string };
export interface FormulaSample { stem: string; answer: string; options: FormulaOption[] }
export const formulaSamples = (runId: string): FormulaSample[] => [1, 2].flatMap(round => [
  { stem: `F${runId}_R${round}_PROB 四份样品三份合格，随机取一份的合格概率是多少？`, answer: 'A',
    options: [{ numerator: '3', denominator: '4' }, { numerator: '1', denominator: '4' }, { numerator: '4', denominator: '3' }, '1'] },
  { stem: `F${runId}_R${round}_ALL 四个等可能结果中三个成功，成功概率是多少？`, answer: 'D',
    options: [{ numerator: '1', denominator: '2' }, { numerator: '1', denominator: '3' }, { numerator: '1', denominator: '4' }, { numerator: '3', denominator: '4' }] },
  { stem: `F${runId}_R${round}_MATRIX 矩阵A等于二倍单位矩阵，逆矩阵的第一行第一列元素是多少？`, answer: 'C',
    options: [{ numerator: '1', denominator: '4' }, { numerator: '1', denominator: '3' }, { numerator: '1', denominator: '2' }, '2'] },
]);

const compact = (text: string) => text.replace(/[\s\u200B]/g, '');
export interface FormulaQuestion {
  id: string; question: string; questionType: number;
  subQuestions: Array<{ question: string; answer: string }>;
}
export interface FormulaDraftSlot {
  slotId: string; questionId: string | null; confirmed: boolean;
  draftPayload?: FormulaQuestion | null;
}

export function assertFormulaDraftSlots(slots: FormulaDraftSlot[], samples: FormulaSample[]): void {
  const occupied = slots.filter(slot => slot.draftPayload?.question);
  expect(occupied).toHaveLength(samples.length);
  expect(new Set(occupied.map(slot => slot.slotId)).size, '导入草稿必须占用不同题位').toBe(samples.length);
  for (const slot of occupied) {
    expect(slot.slotId, '题位ID必须是完整字符串').toMatch(/^\d+$/);
    expect(slot.confirmed).toBe(false);
    expect(slot.questionId, '尚未确认的导入草稿没有正式题目ID').toBeNull();
  }
  assertFormulaContents(occupied.map(slot => slot.draftPayload!), samples);
}

/** 对每道原题分块；答案A、别题标签或空的A.均不能冒充本题的选项。 */
export function assertFormulaLabels(text: string, samples: FormulaSample[], withAnswers: boolean, requireObjects = false): void {
  const offsets = Array.from({ length: text.length }, (_, index) => index).filter(index => !/[\s\u200B]/.test(text[index]));
  const value = offsets.map(index => text[index]).join('');
  const starts = samples.map(sample => {
    const stem = compact(sample.stem);
    expect(value.split(stem).length - 1, '每道原题干必须完整且唯一输出').toBe(1);
    return value.indexOf(stem) + stem.length;
  });
  for (const [index, sample] of samples.entries()) {
    const end = Math.min(...starts.filter(start => start > starts[index]).map(start => {
      const next = samples[starts.indexOf(start)];
      return start - compact(next.stem).length;
    }), value.length);
    // 在保留段落边界的原文中剥离下一题号，再去空白；D.1\n2.不能被合成D.12.。
    const rawBlock = text.slice(offsets[starts[index]] ?? text.length, offsets[end] ?? text.length)
      .replace(/(?:^|[\r\n])\s*\d+[.．、]\s*$/, '');
    const block = compact(rawBlock);
    const answer = block.search(/答案[：:]/);
    const options = answer < 0 ? block : block.slice(0, answer);
    const labels = [...options.matchAll(/([A-D])[.．、]/g)];
    expect(labels.map(match => match[1]), `${sample.stem}选项标签必须是完整且唯一的ABCD`).toEqual(['A', 'B', 'C', 'D']);
    labels.forEach((label, option) => {
      const content = options.slice(label.index! + label[0].length, labels[option + 1]?.index ?? options.length);
      expect(content, `${sample.stem} ${label[1]}标签后必须有真实选项内容`).toMatch(/[\d\uFFFC]/);
      if (typeof sample.options[option] === 'string')
        expect(content, '普通文字选项必须保留源值，不能用其他数字代替').toBe(sample.options[option]);
      if (requireObjects && typeof sample.options[option] !== 'string')
        expect(content.split('\uFFFC').length - 1, 'Word的每个纯分式选项必须保留一个公式对象').toBe(1);
    });
    if (withAnswers) {
      expect(block.match(/答案[：:]([A-D])(?=[^A-Z]|$)/)?.[1], '导出答案必须对应源选项').toBe(sample.answer);
    } else expect(answer, '仅题目输出不能混入正确答案').toBe(-1);
  }
}

/** 还原公式源码再比较；不能用KaTeX辅助显示层的重复文字代替原式。 */
export function formulaSource(html: string): string {
  const opening = /<(div|span)\b[^>]*\bdata-lexical-equation=(["'])(.*?)\2[^>]*>/gi;
  let result = '', cursor = 0, match: RegExpExecArray | null;
  while ((match = opening.exec(html))) {
    const tags = new RegExp(`<\\/?${match[1]}\\b[^>]*>`, 'gi');
    tags.lastIndex = opening.lastIndex;
    let depth = 1, closing: RegExpExecArray | null;
    while (depth && (closing = tags.exec(html))) depth += closing[0].startsWith('</') ? -1 : 1;
    if (depth) throw new Error('公式节点未闭合');
    const source = Buffer.from(match[3], 'base64').toString('utf8');
    if (!source || Buffer.from(source).toString('base64') !== match[3]) throw new Error('公式编码无效');
    result += html.slice(cursor, match.index) + source;
    cursor = tags.lastIndex;
    opening.lastIndex = cursor;
  }
  return compact((result + html.slice(cursor)).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' '));
}

export function assertStoredFormulaQuestions(questions: FormulaQuestion[], samples: FormulaSample[]): void {
  expect(questions).toHaveLength(samples.length);
  expect(new Set(questions.map(q => q.id)).size).toBe(samples.length);
  for (const question of questions) {
    expect(typeof question.id, 'int64 ID保持字符串').toBe('string');
    expect(question.id, '确认后必须分配正式题目ID').toMatch(/^\d+$/);
  }
  assertFormulaContents(questions, samples);
}

function assertFormulaContents(questions: Omit<FormulaQuestion, 'id'>[], samples: FormulaSample[]): void {
  for (const sample of samples) {
    const matches = questions.filter(q => formulaSource(q.question) === compact(sample.stem));
    expect(matches, '源题干必须唯一保留').toHaveLength(1);
    const question = matches[0];
    expect(question.questionType).toBe(1);
    expect(question.subQuestions).toHaveLength(4);
    for (const [index, expected] of sample.options.entries()) {
      const source = typeof expected === 'string' ? expected : `\\frac{${expected.numerator}}{${expected.denominator}}`;
      expect(formulaSource(question.subQuestions[index].question), '原生分式内容与选项顺序必须保持').toBe(source);
      expect(question.subQuestions[index].answer).toBe('ABCD'[index] === sample.answer ? 'true' : 'false');
    }
  }
}

/** 分式的分子/分母与字母不在同一基线，PDF流顺序不能用作选项内容顺序。 */
export function assertFormulaPdf(pdf: FormulaPdf, samples: FormulaSample[], withAnswers: boolean): void {
  const glyphs = pdf.pages.flatMap((page, pageIndex) => page.chars.flatMap(char =>
    compact(char.text).split('').map(text => ({ ...char, text, pageIndex }))));
  const text = glyphs.map(c => c.text).join('');
  const starts = samples.map(sample => {
    expect(text.split(compact(sample.stem)).length - 1, 'PDF每道题干必须唯一完整').toBe(1);
    return text.indexOf(compact(sample.stem));
  });
  for (const [index, sample] of samples.entries()) {
    const begin = starts[index] + compact(sample.stem).length;
    const end = Math.min(...starts.filter(start => start > begin), text.length);
    const block = text.slice(begin, end);
    const answer = block.search(/答案[：:]/);
    const questionEnd = answer < 0 ? end : begin + answer;
    const options = text.slice(begin, questionEnd);
    const labels = [...options.matchAll(/([A-D])[.．、]/g)];
    expect(labels.map(m => m[1]), `${sample.stem} PDF必须保留完整ABCD`).toEqual(['A', 'B', 'C', 'D']);
    const centers = labels.map(label => {
      const letter = glyphs[begin + label.index!];
      const dot = glyphs[begin + label.index! + 1];
      return { page: letter.pageIndex, x: letter.box[0], right: dot.box[2], y: (letter.box[1] + letter.box[3]) / 2, size: letter.size };
    });
    for (const [option, label] of centers.entries()) {
      const nextX = Math.min(...centers.filter(other => other.page === label.page && other.x > label.x &&
        Math.abs(other.y - label.y) < label.size * 0.6).map(other => other.x), Infinity);
      // 两行选项的公式常向上对齐；用同列标签的中线划分行，不能让A借到C的图片。
      const column = centers.filter(other => other.page === label.page && Math.abs(other.x - label.x) < label.size * .6);
      const top = Math.max(...column.filter(other => other.y < label.y).map(other => (other.y + label.y) / 2), -Infinity);
      const bottom = Math.min(...column.filter(other => other.y > label.y).map(other => (other.y + label.y) / 2), Infinity);
      const inCell = (page: number, box: [number, number, number, number]) => {
        const centerY = (box[1] + box[3]) / 2;
        return page === label.page && box[0] >= label.right - .2 && box[0] < nextX &&
          centerY >= top && centerY < bottom && Math.abs(centerY - label.y) < label.size * 1.4;
      };
      const digits = glyphs.slice(begin, questionEnd).filter(c => c.pageIndex === label.page && /\d/.test(c.text) &&
        inCell(c.pageIndex, c.box))
        .sort((a, b) => (a.box[1] - b.box[1]) || (a.box[0] - b.box[0]));
      const expected = sample.options[option];
      if (typeof expected === 'string' || digits.length > 0) {
        expect(digits.map(c => c.text).join(''), `${sample.stem} ${'ABCD'[option]}右侧必须是原分子分母或文本值`).toBe(
          typeof expected === 'string' ? expected : expected.numerator + expected.denominator);
      } else {
        // 栅格公式没有数字glyph；核对本选项旁实际绘制的分式，不能借用别题或水印图片。
        const images = (pdf.formulaImages ?? []).filter(image => inCell(image.pageIndex, image.box) && image.box[2] <= nextX);
        expect(images, `${sample.stem} ${'ABCD'[option]}右侧必须有唯一公式图片`).toHaveLength(1);
        expect(images[0].visibleFraction, '公式图片必须在最终页面可见，且有分子、分母及分数线').toBe(true);
      }
    }
    if (withAnswers) expect(block.match(/答案[：:]([A-D])(?=[^A-Z]|$)/)?.[1]).toBe(sample.answer);
    else expect(answer, '试卷PDF不能混入答案').toBe(-1);
  }
}
