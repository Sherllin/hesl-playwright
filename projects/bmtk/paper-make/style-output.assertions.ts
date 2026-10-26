import { expect } from '@playwright/test';
import type { ExamQuestion } from './style-exam';
const compact = (text: string) => text.replace(/\s+/g, '');

export function assertExamQuestions(text: string, questions: readonly ExamQuestion[]): void {
  const value = compact(text);
  for (const question of questions) {
    expect(value, '实际输出完整保留原题干').toContain(compact(question.stem));
    for (const option of question.options ?? []) expect(value, '实际输出完整保留原选项').toContain(compact(option));
  }
  for (const latex of ['\\frac', '\\sqrt', 'V_{\\max}']) expect(value, '公式应实际渲染，不能泄露LaTeX源码').not.toContain(latex);
}

export function questionOrder(text: string, questions: readonly ExamQuestion[]): ExamQuestion[] {
  const value = compact(text);
  const offsets = questions.map(question => {
    const offset = value.indexOf(compact(question.stem));
    expect(offset, '提取卷面题序不能漏正文').toBeGreaterThanOrEqual(0);
    return { question, offset };
  });
  return offsets.sort((a, b) => a.offset - b.offset).map(item => item.question);
}

export function assertExamAnswers(text: string, questions: readonly ExamQuestion[], withQuestions: boolean): void {
  const value = compact(text);
  const answers = value.split(/答案[：:]/).slice(1);
  expect(answers, '实际输出答案数量必须与全部题目一致').toHaveLength(questions.length);
  if (withQuestions) {
    assertExamQuestions(text, questions);
    for (const question of questions) {
      const start = value.indexOf(compact(question.stem));
      const next = questions.map(q => value.indexOf(compact(q.stem), start + compact(question.stem).length)).filter(i => i >= 0);
      const section = value.slice(start, next.length ? Math.min(...next) : value.length);
      expect(section, '答案必须与同一题干对应').toMatch(new RegExp(`答案[：:]${escape(compact(question.answer))}`));
    }
  } else {
    for (const [index, question] of questions.entries()) {
      expect(value, '仅答案不得混入原题干').not.toContain(compact(question.stem));
      for (const [i, option] of (question.options ?? []).entries())
        expect(value, '仅答案不得混入带标识的原选项').not.toMatch(new RegExp(`${'ABCD'[i]}[.、．)]${escape(compact(option))}`));
      expect(answers[index], '答案必须按实际卷面题序与原题对应').toMatch(
        new RegExp(`^${escape(compact(question.answer))}${question.options ? '(?:[^A-Z]|$)' : ''}`));
    }
  }
}

function escape(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
