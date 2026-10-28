import { expect } from '@playwright/test';
import { parseJson } from '../support/api';
import type { MatchingQuestion } from '../question-bank/matching';
import { assertPaperPreserved, type SavedPaper } from './matching.assertions';

interface QuestionNode { id: string; rootId?: string; questionType?: number; subQuestions?: QuestionNode[]; options?: QuestionNode[] }

export function assertImagePaperSources(paper: SavedPaper, sources: MatchingQuestion[]): void {
  expect(paper.qrPaperQuestionDTOList.map(q => q.originalQuestionId), '首次保存保持原题身份和选入顺序')
    .toEqual(sources.map(q => q.id));
  expect(Number(paper.paperScore)).toBe(6);
  for (const [index, item] of paper.qrPaperQuestionDTOList.entries()) {
    const source = sources[index];
    const content = parseJson<MatchingQuestion>(item.questionContent);
    expect(content.id, '首次保存保持来源根题ID').toBe(source.id);
    expect(Number(content.questionScore), '首次保存每道原题均为2分').toBe(2);
    expect(content.question).toBe(source.question);
    expect(content.answer ?? null).toBe(source.answer ?? null);
    const children = (q: MatchingQuestion) => (q.subQuestions ?? []).map(child => ({ id: child.id, question: child.question, answer: child.answer }));
    expect(children(content), '组合子题和选项身份/正文/答案保持').toEqual(children(source));
    if (source.questionType === 6) for (const child of content.subQuestions)
      expect(Number(child.questionScore), '首次保存组合直接子题为2分').toBe(2);
  }
}

export function assertImagePaperPreserved(before: SavedPaper, after: SavedPaper): void {
  assertPaperPreserved(before, after);
  for (const [index, item] of before.qrPaperQuestionDTOList.entries()) {
    const root = parseJson<QuestionNode>(item.questionContent);
    if (root.questionType !== 6) continue;
    const actual = parseJson<QuestionNode>(after.qrPaperQuestionDTOList[index].questionContent);
    expect((actual.subQuestions ?? []).map(child => child.rootId), '读取保持卷内小题根归属')
      .toEqual((root.subQuestions ?? []).map(child => child.rootId));
  }
}

export function assertImagePaperSave(sent: SavedPaper, stored: SavedPaper): void {
  expect(stored.qrPaperQuestionDTOList).toHaveLength(sent.qrPaperQuestionDTOList.length);
  const expected = structuredClone(sent);
  const existing = new Set<string>();
  const collectIds = (node: QuestionNode) => {
    if (node.id != null) existing.add(String(node.id));
    for (const child of [...(node.subQuestions ?? []), ...(node.options ?? [])]) collectIds(child);
  };
  for (const item of sent.qrPaperQuestionDTOList) collectIds(parseJson<QuestionNode>(item.questionContent));
  const assigned = new Set<string>();
  for (const [index, item] of expected.qrPaperQuestionDTOList.entries()) {
    const root = parseJson<QuestionNode>(item.questionContent);
    if (root.questionType !== 6) continue;
    const saved = parseJson<QuestionNode>(stored.qrPaperQuestionDTOList[index].questionContent);
    const children = root.subQuestions ?? [], savedChildren = saved.subQuestions ?? [];
    expect(savedChildren, '保存必须保留组合小题数量和顺序').toHaveLength(children.length);
    for (const [childIndex, child] of children.entries()) {
      const actual = savedChildren[childIndex];
      expect(typeof actual.id, '卷内小题ID保持字符串').toBe('string');
      expect(actual.id).toMatch(/^\d+$/);
      expect(existing.has(actual.id), '组合小题的新卷内ID不得复用任何已有节点ID').toBe(false);
      expect(assigned.has(actual.id), '卷内小题ID不得重复').toBe(false);
      expect(actual.rootId, '卷内小题必须仍归属原根题').toBe(root.id);
      assigned.add(actual.id);
      // Java fillCombItemId only replaces direct combination-child IDs on each save.
      child.id = actual.id;
      child.rootId = actual.rootId;
    }
    item.questionContent = JSON.stringify(root);
  }
  assertImagePaperPreserved(expected, stored);
}
