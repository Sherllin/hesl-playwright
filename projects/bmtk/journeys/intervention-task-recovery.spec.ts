import { test as base } from '@playwright/test';
import { Actors } from '../support/actors';
import { loadBmtkConfig } from '../support/config';
import { runInterventionTaskRecovery } from '../flows/intervention-task-recovery.flow';

const test = base.extend<{ actors: Actors }>({
  actors: async ({ browser }, use) => {
    const actors = new Actors(browser, loadBmtkConfig());
    try { await use(actors); } finally { await actors.close(); }
  },
});

test('CASE-006.1 全部出题任务作废且未建替代就结束介入，负责人可重新分配并完成新任务', async ({ actors }) => {
  test.setTimeout(900_000);
  await runInterventionTaskRecovery(actors, false);
});

test('CASE-006.2 作废一项且未建替代就结束介入，负责人可补建任务且其他进行中任务保持', async ({ actors }) => {
  test.setTimeout(900_000);
  await runInterventionTaskRecovery(actors, true);
});
