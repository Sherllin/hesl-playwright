import { test as base } from '@playwright/test';
import { Actors } from '../support/actors';
import { loadBmtkConfig } from '../support/config';
import { runReviewHeaderLayout } from '../flows/review-header-layout.flow';

const test = base.extend<{ actors: Actors }>({
  actors: async ({ browser }, use) => {
    const actors = new Actors(browser, loadBmtkConfig());
    try { await use(actors); } finally { await actors.close(); }
  },
});

test('CASE-008 审题工作台四档宽度下任务进度与提交按钮完整可见且不重叠', async ({ actors }, info) => {
  test.setTimeout(720_000);
  info.annotations.push(
    { type: 'source-case', description: 'REMOTE-47 / ReviewDecisionsPage.verifyHeaderLayout（仅提取TAPD1007314布局部分）' },
    { type: 'TAPD', description: 'https://www.tapd.cn/tapd_fe/55506846/bug/detail/1155506846001007314' },
  );
  await runReviewHeaderLayout(actors);
});
