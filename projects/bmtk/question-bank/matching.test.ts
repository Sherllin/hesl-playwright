import { test, expect } from '@playwright/test';
import { assertPublishedMatching, type MatchingQuestion } from './matching';

const persisted: MatchingQuestion = {
  id: '9007199254740993', question: '匹配题', questionScore: 0,
  options: [{ id: '9007199254740994', question: '选项A' }],
  subQuestions: [{ id: '9007199254740995', question: '原小题', answer: 'A', questionScore: 0 }],
};
test('真实审核入库可改变保密元数据，但不能误报小题正文变化', () => {
  const before = structuredClone(persisted);
  Object.assign(before.subQuestions[0], { isConfidential: 1, taskId: '9007199254740996' });
  const after = structuredClone(persisted);
  Object.assign(after.subQuestions[0], { isConfidential: 0 });
  expect(() => assertPublishedMatching(before, after)).not.toThrow();
});
test('公开题库裁剪选项内部元数据不应误报', () => {
  const before = structuredClone(persisted);
  Object.assign(before.options[0], { isConfidential: 1 });
  expect(() => assertPublishedMatching(before, structuredClone(persisted))).not.toThrow();
});
test('审核入库不得更换原小题身份', () => {
  const after = structuredClone(persisted); after.subQuestions[0].id = '9007199254740996';
  expect(() => assertPublishedMatching(persisted, after)).toThrow();
});
