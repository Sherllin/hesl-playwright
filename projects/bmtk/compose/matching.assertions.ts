import { expect } from '@playwright/test';
import { parseJson } from '../support/api';
import type { MatchingQuestion } from '../question-bank/matching';

export interface SavedPaper {
  paperId: string;
  paperScore: number | string;
  qrPaperQuestionDTOList: Array<{ originalQuestionId: string; questionContent: string }>;
}
export interface ReorderExpectation { scores: readonly number[]; order: readonly number[] }

export function assertMatchingPaper(paper: SavedPaper, source: MatchingQuestion,
  expected: ReorderExpectation): MatchingQuestion {
  const { scores, order } = expected;
  expect([...order].sort(), '换序必须是原小题的完整排列').toEqual(source.subQuestions.map((_, i) => i));
  expect(scores, '每个原小题都必须有分值').toHaveLength(source.subQuestions.length);
  const total = scores.reduce((a, b) => a + b, 0);
  expect(Number(paper.paperScore), '试卷总分').toBe(total);
  expect(paper.qrPaperQuestionDTOList, '独立匹配题试卷只有一道整题').toHaveLength(1);
  const item = paper.qrPaperQuestionDTOList[0];
  expect(item.originalQuestionId, '原题身份').toBe(source.id);
  expect(typeof item.originalQuestionId, '原题ID为字符串').toBe('string');
  const content = parseJson<MatchingQuestion>(item.questionContent);
  expect(content.question, '整题题干保持').toBe(source.question);
  expect(Number(content.questionScore), '整题分值汇总').toBe(total);
  const options = (question: MatchingQuestion) => question.options.map(o => ({ id: o.id, question: o.question }));
  expect(options(content), '共享选项内容、身份和顺序保持').toEqual(options(source));
  expect(content.subQuestions, '小题数量保持').toHaveLength(order.length);
  for (const [position, sourceIndex] of order.entries()) {
    const actual = content.subQuestions[position];
    const original = source.subQuestions[sourceIndex];
    expect(actual.id, '小题身份必须随原内容移动').toBe(original.id);
    expect(typeof actual.id, '小题身份为字符串').toBe('string');
    expect(actual.id, '小题身份必须是完整十进制ID').toMatch(/^\d+$/);
    expect(actual.question, '小题内容必须随原题移动').toBe(original.question);
    expect(actual.answer, '小题答案必须随原内容移动').toBe(original.answer);
    expect(Number(actual.questionScore), '小题分值必须随原内容移动').toBe(scores[sourceIndex]);
  }
  expect(new Set(content.subQuestions.map(q => q.id)).size, '小题身份不能复用').toBe(order.length);
  return content;
}

function businessContent(node: Record<string, unknown>): unknown {
  return {
    id: node.id, questionType: node.questionType, questionTypeId: node.questionTypeId,
    question: node.question, answer: node.answer ?? null, analysis: node.analysis ?? null,
    level: node.level ?? null, language: node.language ?? null,
    options: ((node.options ?? []) as Array<Record<string, unknown>>).map(businessContent),
    subQuestions: ((node.subQuestions ?? []) as Array<Record<string, unknown>>).map(businessContent)
  };
}

function contentIdentity(question: MatchingQuestion) {
  return {
    content: businessContent(question as unknown as Record<string, unknown>),
    score: Number(question.questionScore), childScores: question.subQuestions.map(q => Number(q.questionScore))
  };
}

export function assertPaperPreserved(before: SavedPaper, after: SavedPaper): void {
  expect(after.paperId, '保存重进保持原试卷身份').toBe(before.paperId);
  expect(Number(after.paperScore), '保存重进保持总分').toBe(Number(before.paperScore));
  expect(after.qrPaperQuestionDTOList).toHaveLength(before.qrPaperQuestionDTOList.length);
  for (const [i, original] of before.qrPaperQuestionDTOList.entries()) {
    expect(after.qrPaperQuestionDTOList[i].originalQuestionId, '保存重进保持原题身份').toBe(original.originalQuestionId);
    expect(contentIdentity(parseJson(after.qrPaperQuestionDTOList[i].questionContent)), '保存重进保持全部业务内容')
      .toEqual(contentIdentity(parseJson(original.questionContent)));
  }
}

// 来源：原 e2e/src/remote/paper-score-contract.ts 的 assertMatchingDeliveryText。
export function assertMatchingDeliveryText(paperText: string, answerText: string,
  sample: { stem: string; children: readonly string[]; options: readonly string[] }): void {
  const compact = (text: string) => text.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
  const paper = compact(paperText);
  expect(paper).toContain(compact(sample.stem));
  const [originalFirst, originalSecond] = sample.children.map(compact);
  const first = paper.indexOf(originalSecond), second = paper.indexOf(originalFirst);
  expect(first, '原第二小题必须完整输出').toBeGreaterThanOrEqual(0);
  expect(second, '原第一小题排在第二位').toBeGreaterThan(first);
  expect(paper.indexOf(originalSecond, first + originalSecond.length), '小题不能重复输出').toBe(-1);
  expect(paper.indexOf(originalFirst, second + originalFirst.length), '小题不能重复输出').toBe(-1);
  expect(paper.slice(first, second), '原第二小题仍为5分').toContain('5分');
  expect(paper.slice(second), '原第一小题仍为2分').toContain('2分');
  let cursor = -1;
  for (const option of sample.options) {
    const position = paper.indexOf(compact(option));
    expect(position, '共享选项全文及顺序保持').toBeGreaterThan(cursor);
    cursor = position;
  }
  expect(compact(answerText), '换序后的答案必须为B/A')
    .toMatch(/答案[：:](?:1\.B[；;]2\.A|B(?:[^A-Z]|$).*答案[：:]A(?:[^A-Z]|$))/);
}
