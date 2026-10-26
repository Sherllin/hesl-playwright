import { test, expect } from '@playwright/test';
import { assertExamQuestions, assertExamAnswers, questionOrder } from './style-output.assertions';
import { paperStyleExam, type ExamQuestion } from './style-exam';
import { existsSync } from 'node:fs';
import { assertPreparedStyle } from './style-fixture';

const questions: ExamQuestion[] = [
  { stem: '第一个独立题干', options: ['甲选项内容', '乙选项内容'], answer: 'A' },
  { stem: '第二个独立题干', answer: '计算结果为50。' },
];
const paper = '1.第一个独立题干 A.甲选项内容 B.乙选项内容 2.第二个独立题干';
test('37题语料和图片随工程迁移，答案明确是测试补充值', () => {
  const exam = paperStyleExam();
  expect(exam.questions).toHaveLength(37);
  expect(exam.questions.filter(q => q.options)).toHaveLength(30);
  expect(exam.questions.flatMap(q => q.options ?? [])).toHaveLength(120);
  expect(exam.questions.filter(q => q.formula)).toHaveLength(3);
  expect(exam.sources.every(c => c.answerOrigin.includes('测试构造'))).toBe(true);
  expect(existsSync(exam.questions.find(q => q.image)!.image!)).toBe(true);
  expect(exam.markers.length).toBeGreaterThan(30);
});
test('真实正文与答案通过，漏选项、错题配答案、仅答案泄露题干不能通过', () => {
  assertExamQuestions(paper, questions);
  const order = questionOrder(paper, questions);
  assertExamAnswers('1.答案：A 2.答案：计算结果为50。', order, false);
  assertExamAnswers('1.第一个独立题干 A.甲选项内容 B.乙选项内容 答案：A 2.第二个独立题干 答案：计算结果为50。', order, true);
  expect(() => assertExamQuestions(paper.replace('乙选项内容', ''), questions)).toThrow(/选项/);
  expect(() => assertExamAnswers('1.答案：B 2.答案：计算结果为50。', order, false)).toThrow(/对应/);
  expect(() => assertExamAnswers('第一个独立题干 1.答案：A 2.答案：计算结果为50。', order, false)).toThrow(/混入/);
  expect(() => assertExamAnswers('1.答案：A', order, false)).toThrow(/答案数量/);
});
test('答案跟随实际卷面题序，而非录入数组顺序', () => {
  const order = questionOrder('第二个独立题干 第一个独立题干 甲选项内容 乙选项内容', questions);
  assertExamAnswers('1.答案：计算结果为50。 2.答案：A', order, false);
  expect(() => assertExamAnswers('1.答案：A 2.答案：计算结果为50。', order, false)).toThrow(/对应/);
});
test('样式body正确但fontStyle继承旧CSS仍必须拒绝', () => {
  const expected = { body: { fontName: 'Arial', fontSize: 18 }, fontStyle: 'font-family:Arial;font-size:18px;' };
  assertPreparedStyle({ ...expected, fontStyle: `"${expected.fontStyle}"` }, expected);
  expect(() => assertPreparedStyle({ ...expected, fontStyle: 'font-family:SimSun;font-size:14px;' }, expected)).toThrow(/旧CSS/);
});
