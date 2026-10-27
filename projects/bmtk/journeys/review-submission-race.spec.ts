import { test as base } from '@playwright/test';
import { Actors } from '../support/actors';
import { loadBmtkConfig } from '../support/config';
import { runReviewSubmissionRace } from '../flows/review-submission-race.flow';

// 本组只需浏览器和业务账号，不触发PDF工具前置。
const test = base.extend<{ actors: Actors }>({
  actors: async ({ browser }, use) => {
    const actors = new Actors(browser, loadBmtkConfig());
    try { await use(actors); } finally { await actors.close(); }
  },
});

for (const scenario of [
  { id: 'CASE-003.1', original: 'REMOTE-REVIEW-RACE-01', mode: 'simultaneous',
    title: '同一审题任务同时改判与提交正确收敛且原题唯一入库' },
  { id: 'CASE-003.2', original: 'REMOTE-REVIEW-TABS-01', mode: 'serial',
    title: '双页签改判拒绝旧快照，重新确认提交后历史唯一且原题完整入库' },
] as const) {
  test(`${scenario.id} ${scenario.title}`, async ({ actors }, info) => {
    test.setTimeout(720_000);
    info.annotations.push(
      { type: 'source-case', description: scenario.original },
      { type: 'TAPD', description: 'https://www.tapd.cn/tapd_fe/55506846/bug/detail/1155506846001007364' },
    );
    await runReviewSubmissionRace(actors, scenario.mode);
  });
}
