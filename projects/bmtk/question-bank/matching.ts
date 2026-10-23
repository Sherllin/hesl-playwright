export interface MatchingOption { id: string; question: string }
export interface MatchingChild extends MatchingOption {
  answer: string;
  questionScore: number | string;
}
export interface MatchingQuestion {
  id: string;
  question: string;
  questionScore: number | string;
  options: MatchingOption[];
  subQuestions: MatchingChild[];
  questionType?: number;
  questionTypeId?: string;
  answer?: string | null;
  analysis?: string | null;
}
export interface MatchingSample {
  stem: string;
  options: string[];
  children: [string, string];
  answers: [string, string];
}
export interface BankRef { id: string; name: string }
import { expect } from '@playwright/test';


export function assertPublishedMatching(before: MatchingQuestion, after: MatchingQuestion): void {
  expect(after.id, '审核入库保持原根题身份').toBe(before.id);
  expect(after.question, '审核入库保持题干').toBe(before.question);
  // 入库会解除保密并裁剪内部字段；只比较该阶段必须保持的身份、正文和答案。
  const options = (question: MatchingQuestion) => question.options.map(o => ({ id: o.id, question: o.question }));
  const children = (question: MatchingQuestion) => question.subQuestions.map(q => ({ id: q.id, question: q.question, answer: q.answer }));
  expect(options(after), '审核入库保持选项身份与全文').toEqual(options(before));
  expect(children(after), '审核入库保持小题身份、全文与答案').toEqual(children(before));
}
