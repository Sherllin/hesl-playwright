import { test as base } from '@playwright/test';
import { Actors } from '../support/actors';
import { loadBmtkConfig } from '../support/config';
import { runTaskStartRace } from '../flows/task-start-race.flow';

const test = base.extend<{ actors: Actors }>({
  actors: async ({ browser }, use) => {
    const actors = new Actors(browser, loadBmtkConfig());
    try { await use(actors); } finally { await actors.close(); }
  },
});

for (const scenario of [
  { id: 'CASE-007.1', source: 'REMOTE-TASK-START-RACE-01', order: 'create-first',
    title: '先发新增再发开启，两条并发新任务与活动一致且串行对照正常' },
  { id: 'CASE-007.2', source: 'REMOTE-TASK-START-RACE-02', order: 'start-first',
    title: '先发开启再发新增，两条并发新任务与活动一致且串行对照正常' },
] as const) {
  test(`${scenario.id} ${scenario.title}`, async ({ actors }, info) => {
    test.setTimeout(600_000);
    info.annotations.push(
      { type: 'source-scenario', description: scenario.source },
      { type: 'TAPD', description: 'https://www.tapd.cn/tapd_fe/55506846/bug/detail/1155506846001007378' },
    );
    await runTaskStartRace(actors, scenario.order);
  });
}
