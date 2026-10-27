import { expect, test } from '@playwright/test';
import type { MatchingQuestion } from '../question-bank/matching';
import { assertProjectColumnQuestion } from './column-layout.assertions';

const source: MatchingQuestion = {
  id: '2114888851843702785', question: '<div data-lexical-layout-container="true">LEFT RIGHT</div>',
  answer: '<p>合成答案</p>', questionScore: 0, options: [], subQuestions: [],
};
test('保密题在授权项目选题中完整保留原题ID、题干与答案', () => {
  expect(assertProjectColumnQuestion([structuredClone(source)], source)).toEqual(source);
});
test('普通题库可见为零不能替代授权选题入库证据', () => {
  expect(() => assertProjectColumnQuestion([], source)).toThrow();
});
for (const [field, value] of [
  ['id', '2114888851843702786'], ['question', '<p>分栏丢失</p>'], ['answer', '错误答案'],
] as const) {
  test(`授权项目选题中的${field}被替换必须失败`, () => {
    expect(() => assertProjectColumnQuestion([{ ...source, [field]: value }], source)).toThrow();
  });
}
test('同一原题重复出现或混入其他题都不能通过', () => {
  expect(() => assertProjectColumnQuestion([source, structuredClone(source)], source)).toThrow();
  expect(() => assertProjectColumnQuestion([source, { ...source, id: '2114888851843702786' }], source)).toThrow();
});
