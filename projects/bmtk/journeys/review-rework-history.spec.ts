import { test as base } from '@playwright/test';
import { Actors } from '../support/actors';
import { loadBmtkConfig } from '../support/config';
import { runReviewReworkHistory } from '../flows/review-rework-history.flow';

const test = base.extend<{ actors: Actors }>({
  actors: async ({ browser }, use) => {
    const actors = new Actors(browser, loadBmtkConfig());
    try { await use(actors); } finally { await actors.close(); }
  },
});

test('CASE-004.1 返工复审通过后首轮驳回理由保留，已通过题不变且原题完整入库', async ({ actors }, info) => {
  test.setTimeout(900_000);
  info.annotations.push(
    { type: 'source-case', description: 'REMOTE-77' },
    { type: 'TAPD', description: 'https://www.tapd.cn/tapd_fe/55506846/bug/detail/1155506846001007380' },
  );
  await runReviewReworkHistory(actors);
});
