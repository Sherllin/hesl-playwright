import { expect } from '@playwright/test';
import type { MatchingQuestion } from '../question-bank/matching';

/** 授权的活动组卷任务可读取本项目保密题；普通题库空列表不能作为入库证据。 */
export function assertProjectColumnQuestion(records: readonly MatchingQuestion[], expected: MatchingQuestion): MatchingQuestion {
  expect(records, '本项目组卷选题必须且仅包含本次审题通过的原题').toHaveLength(1);
  const actual = records[0];
  expect(typeof actual.id, '原题ID必须是字符串').toBe('string');
  expect(actual.id, '授权选题必须保持同一道原题').toBe(expected.id);
  expect(actual.question, '授权选题必须保留完整分栏题干').toBe(expected.question);
  expect(actual.answer, '授权选题必须保留原答案').toBe(expected.answer);
  return actual;
}
