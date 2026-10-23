import { expect, type Page } from '@playwright/test';
import type { MatchingQuestion } from '../question-bank/matching';
import { ComposePage } from './compose.page';
import { assertMatchingPaper, assertPaperPreserved, type SavedPaper } from './matching.assertions';

// 流程只组合组卷积木；页面类无需知道是哪条测试、哪个账号或哪个环境。
export async function scoreAndSwapMatching(page: Page, input: {
  projectName: string; title: string; stem: string; source: MatchingQuestion; scores: [number, number];
}): Promise<SavedPaper> {
  const compose = new ComposePage(page);
  const expected = { scores: input.scores, order: [1, 0] };
  await compose.setTitle(input.title);
  await compose.addQuestion(input.source, input.stem);
  await compose.setChildScores(input.scores);
  await compose.moveChildDown(input.stem, 1);
  expect(await compose.readChildScores(), '界面分值必须随原小题移动').toEqual([...input.scores].reverse());
  await compose.expectTotal(1, input.scores[0] + input.scores[1]);
  const saved = await compose.saveDraft();
  assertMatchingPaper(saved, input.source, expected);
  const restored = await compose.reopen(input.projectName, saved.paperId);
  assertMatchingPaper(restored, input.source, expected);
  assertPaperPreserved(saved, restored);
  return restored;
}
