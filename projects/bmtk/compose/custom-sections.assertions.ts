import { expect } from '@playwright/test';
import { parseJson } from '../support/api';

export const sectionTypes = [
  { name: '物化简答', count: 7 }, { name: '物化问答', count: 9 },
  { name: '物化论述', count: 8 }, { name: '简答题', count: 2 },
] as const;
export interface SectionType { id: string; name: string; count: number }
export interface SectionQuestion {
  id: string; questionType: number; questionTypeId: string; questionTypeName: string;
  question: string; answer: string;
}
export interface SectionPaper {
  paperId: string; paperScore: string | number;
  qrPaperStemDTOList: Array<{ stemsNo: number; questionType: number; questionTypeId: string; questionStem: string }>;
  qrPaperQuestionDTOList: Array<{ originalQuestionId: string; questionStemNo: number; questionScore: number | string; questionContent: string }>;
}
export function sectionSamples() {
  return sectionTypes.flatMap((type, group) => Array.from({ length: type.count }, (_, index) => ({
    typeName: type.name,
    // 标记不含题型名，避免缺失大题标题时从题干命中同名文字而假通过。
    stem: `S${group + 1}Q${String(index + 1).padStart(2, '0')}STEM：请说明实验${group + 1}中条件${index + 1}与测量结果的关系。`,
    answer: `S${group + 1}Q${String(index + 1).padStart(2, '0')}ANSWER：保持其余条件不变，比较测量结果${index + 1}。`,
  })));
}
const compact = (value: string) => value.replace(/<[^>]*>/g, '').replace(/[\s\u200B]/g, '');

export function assertCustomSectionPaper(paper: SectionPaper, sources: readonly SectionQuestion[], types: readonly SectionType[]): void {
  expect(typeof paper.paperId, '试卷ID保持字符串').toBe('string');
  expect(types.map(type => ({ name: type.name, count: type.count }))).toEqual(sectionTypes);
  expect(new Set(types.map(type => type.id)).size, '四种题型身份必须不同').toBe(4);
  expect(sources, '本次原题总数').toHaveLength(26);
  expect(new Set(sources.map(source => source.id)).size, '原题身份唯一').toBe(26);
  expect(Number(paper.paperScore), '26题每题2分').toBe(52);
  expect(paper.qrPaperStemDTOList, '同基础结构必须保留四个大题').toHaveLength(4);
  expect(paper.qrPaperQuestionDTOList).toHaveLength(26);
  expect(paper.qrPaperQuestionDTOList.map(item => item.originalQuestionId).sort(), '保存重进保持全部原题身份')
    .toEqual(sources.map(source => source.id).sort());
  for (const [index, type] of types.entries()) {
    const stem = paper.qrPaperStemDTOList[index];
    expect(typeof type.id).toBe('string');
    expect(stem.questionType).toBe(5);
    expect(stem.questionTypeId, '大题按自定义题型身份分组').toBe(type.id);
    expect(compact(stem.questionStem), '大题标题独立保留').toBe(`${['一', '二', '三', '四'][index]}、${type.name}`);
    const group = paper.qrPaperQuestionDTOList.filter(item => item.questionStemNo === stem.stemsNo);
    expect(group, `${type.name}题量`).toHaveLength(type.count);
    expect(sources.filter(source => source.questionTypeId === type.id)).toHaveLength(type.count);
    for (const item of group) {
      const source = sources.find(question => question.id === item.originalQuestionId);
      expect(source, '必须是本次确认的原题').toBeTruthy();
      expect(typeof item.originalQuestionId).toBe('string');
      expect(source!.questionType).toBe(5);
      expect(source!.questionTypeId).toBe(type.id);
      expect(source!.questionTypeName).toBe(type.name);
      const content = parseJson<SectionQuestion>(item.questionContent);
      expect(content.questionTypeId).toBe(type.id);
      expect(content.questionTypeName).toBe(type.name);
      expect(content.questionType).toBe(5);
      expect(content.question, '题干全文保持').toBe(source!.question);
      expect(content.answer, '答案全文保持').toBe(source!.answer);
      expect(Number(item.questionScore)).toBe(2);
    }
  }
}

export function assertCustomSectionOutput(text: string, content: 'question' | 'answer' | 'combined'): void {
  const actual = compact(text);
  const samples = sectionSamples();
  let previous = -1;
  for (const [index, type] of sectionTypes.entries()) {
    expect(actual.split(type.name), `${type.name}大题标题必须恰好出现一次`).toHaveLength(2);
    const start = actual.indexOf(type.name);
    expect(start, '大题顺序保持').toBeGreaterThan(previous);
    const end = index + 1 < sectionTypes.length ? actual.indexOf(sectionTypes[index + 1].name) : actual.length;
    const group = actual.slice(start, end);
    const expected = samples.filter(sample => sample.typeName === type.name);
    let previousQuestion = -1;
    for (const [questionIndex, sample] of expected.entries()) {
      const position = group.indexOf(compact(content === 'answer' ? sample.answer : sample.stem));
      expect(position, '同一大题内题目和答案顺序保持').toBeGreaterThan(previousQuestion);
      previousQuestion = position;
      const required = content === 'question' ? [sample.stem] : content === 'answer' ? [sample.answer] : [sample.stem, sample.answer];
      for (const value of required) {
        const marker = compact(value);
        expect(actual.split(marker), '原始正文或答案必须完整且唯一').toHaveLength(2);
        expect(group, `${type.name}内容不可移到其他大题`).toContain(marker);
      }
      if (content === 'combined') {
        const questionStart = group.indexOf(compact(sample.stem));
        const next = expected[questionIndex + 1];
        const nextStart = next ? group.indexOf(compact(next.stem)) : group.length;
        expect(group.slice(questionStart, nextStart), '答案必须跟随对应题干').toContain(compact(sample.answer));
      }
      if (content === 'answer') expect(actual, '仅答案不得混入题干').not.toContain(compact(sample.stem));
      if (content === 'question') expect(actual, '仅题目不得混入答案').not.toContain(compact(sample.answer));
    }
    previous = start;
  }
}
