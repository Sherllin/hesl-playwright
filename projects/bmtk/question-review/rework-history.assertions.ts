import { expect } from '@playwright/test';

export interface ReviewHistoryRecord {
  id: string;
  question: string;
  approvalRound: number;
  approvalResult: number;
  approvalComment?: string | null;
}
export interface ReviewHistory { records: ReviewHistoryRecord[]; total: number | string }

interface ReviewOption { id: string; question: string; answer: string }

export function expectReworkOptionContinuity(before: readonly ReviewOption[], after: readonly ReviewOption[], reworked: boolean) {
  for (const option of after) expect(option.id, '复审选项必须携带完整字符串ID').toMatch(/^\d+$/);
  expect(new Set(after.map(option => option.id)).size, '复审选项ID不能重复').toBe(after.length);
  const content = (items: readonly ReviewOption[]) => items.map(({ question, answer }) => ({ question, answer }));
  expect(content(after), '返工不能改变原选项顺序、正文和答案').toEqual(content(before));
  // 返工重新保存题树时允许分配新选项ID；未修改的对照题仍保持原选项身份。
  if (!reworked) expect(after.map(option => option.id), '未返工题的选项ID必须保持')
    .toEqual(before.map(option => option.id));
}

// 只比较原用例承诺的正文、轮次、结果和理由；不能把 null 理由归一成旧理由。
export function historySnapshot(history: ReviewHistory) {
  expect(String(history.total)).toBe(String(history.records.length));
  return history.records.map(record => {
    expect(typeof record.id).toBe('string');
    expect(record.question).toBeTruthy();
    return { id: record.id, round: record.approvalRound, result: record.approvalResult,
      comment: record.approvalComment ?? null, question: record.question };
  }).sort((a, b) => a.id.localeCompare(b.id) || a.round - b.round);
}

export function expectOldHistoryPreserved(before: ReviewHistory, after: ReviewHistory, soft = false) {
  const old = historySnapshot(before);
  expect(old.length, '必须先取得非空首轮历史，避免空集合误通过').toBeGreaterThan(0);
  const current = historySnapshot(after);
  expect(new Set(current.map(item => `${item.id}/${item.round}`)).size,
    '同一道原题的同一轮正式历史不能重复').toBe(current.length);
  const check = soft ? expect.soft : expect;
  check(current, '复审提交不能覆盖首轮正式历史的正文、结果或驳回理由')
    .toEqual(expect.arrayContaining(old));
}
