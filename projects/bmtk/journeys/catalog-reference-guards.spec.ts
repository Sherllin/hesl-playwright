import { test as base } from '@playwright/test';
import { Actors } from '../support/actors';
import { loadBmtkConfig } from '../support/config';
import { runCatalogReferenceGuards } from '../flows/catalog-reference-guards.flow';

const test = base.extend<{ actors: Actors }>({
  actors: async ({ browser }, use) => {
    const actors = new Actors(browser, loadBmtkConfig());
    try { await use(actors); } finally { await actors.close(); }
  },
});

for (const scenario of [
  { id: 'CASE-013.1', operation: 'full', source: 'SUBJECT-CATALOG-FULL-GUARDS',
    title: '被题目引用的知识点全量覆盖：取消不改数据，旧确认拒绝，重新确认仅解除关联' },
  { id: 'CASE-013.2', operation: 'delete', source: 'SUBJECT-CATALOG-DELETE-GUARDS',
    title: '被题目引用的父子知识点删除：取消不改数据，确认后保留题目、任务和对照分支' },
] as const) {
  test(`${scenario.id} ${scenario.title}`, async ({ actors }, info) => {
    test.setTimeout(900_000);
    info.annotations.push(
      { type: 'source-case', description: scenario.source },
      { type: 'TAPD', description: 'https://www.tapd.cn/tapd_fe/my/work?dialog_preview_id=bug_1155506846001007399' },
    );
    await runCatalogReferenceGuards(actors, process.env.BMTK_PDF_PYTHON || 'python3', scenario.operation);
  });
}
