import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Actors } from '../support/actors';
import { BankPage } from '../question-bank/bank.page';
import { ProjectPage } from '../project-management/project.page';
import { ActivitiesPage } from '../project-management/activities.page';
import { TaskStartRacePage, type LaunchOrder } from '../project-management/task-start-race.page';
import { expectCreationSnapshot, type CreationSnapshot, type ExpectedCreationTask } from '../project-management/task-start-race.assertions';

/** TAPD 1007378：独立业务数据，真实请求并发，不连接数据库或依赖产品源码。 */
export async function runTaskStartRace(actors: Actors, order: LaunchOrder) {
  const marker = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  const folderName = `E2E-开启竞争学科-${marker}`;
  const bankName = `E2E-开启竞争题库-${marker}`;
  const projectName = `E2E-开启竞争-${marker}`;
  const admin = await actors.get('admin');
  const leader = await actors.get('leader');
  const author = await actors.get('author');
  const banks = new BankPage(admin.page);
  const project = new ProjectPage(leader.page);
  const activities = new ActivitiesPage(leader.page);
  let bankId = '';
  const projectId = await test.step('新建独立学科、题库和开放式征题项目，配置出题专家', async () => {
    await banks.createFolder(folderName);
    await banks.setQuestionTypeEnabled(folderName, '单选题');
    await banks.createProjectBank(folderName, bankName);
    bankId = (await new ProjectPage(admin.page).create({ name: projectName, leader: leader.name,
      activity: '开放式征题', bankName })).bankId;
    await project.enterProject(projectName);
    const id = new URL(leader.page.url()).searchParams.get('projectId');
    expect(id).toMatch(/^\d+$/);
    await activities.configureQuestionExperts([author.name]);
    return id!;
  });
  const race = new TaskStartRacePage(leader, author, projectId);
  const expected: ExpectedCreationTask[] = [];
  const attachSnapshot = (name: string, snapshot: CreationSnapshot) => test.info().attach(name, {
    contentType: 'application/json', body: JSON.stringify(snapshot, null, 2),
  });
  try {
    const original = await test.step('真实UI创建单选1题原任务，确认活动和任务均未开始', async () => {
      const initial = await race.createInitialTask(`E2E-原任务-${marker}`);
      expected.push(race.expected(initial.task, initial.request));
      const before = await race.snapshot();
      await attachSnapshot('task-start-race-before', before);
      expectCreationSnapshot(before, { projectId, tasks: expected, status: 0 });
      await race.showOwnerTasks(expected, 0);
      return initial;
    });
    const batch = ['并发甲', '并发乙'].map(name => race.cloneRequest(original.request, `E2E-${name}-${marker}`));
    await test.info().attach('task-start-race-fixture', { contentType: 'application/json', body: JSON.stringify({
      order, projectId, bankId, projectName, authorId: author.id, originalTaskId: original.task.taskId,
      concurrentRequests: batch,
    }, null, 2) });

    const raced = await test.step(`${order} 发起批量新增两任务与开启活动，全部任务和题位正确收敛`, async () => {
      const created = await race.startAndCreate(batch, order);
      created.forEach((task, index) => expected.push(race.expected(task, batch[index])));
      const snapshot = await race.snapshot();
      // 在断言前附真实状态，失败时仍能直接查看两条任务的ID和taskStatus。
      await attachSnapshot('task-start-race-after-concurrent', snapshot);
      return snapshot;
    });

    // 核心断言延后到同项目串行对照后执行；原缺陷存在时仍采集对照和负责人截图。
    const control = await test.step('同项目等开启完成后串行新增同专家单选1题作为对照', async () => {
      const request = race.cloneRequest(original.request, `E2E-串行对照-${marker}`);
      const [task] = await race.createBatch([request]);
      const expectedControl = race.expected(task, request);
      const snapshot = await race.snapshot();
      await attachSnapshot('task-start-race-with-serial-control', snapshot);
      const tasks = snapshot.tasks.filter(item => item.taskId === task.taskId);
      const workspaces = snapshot.workspaces.filter(item => item.taskId === task.taskId);
      expectCreationSnapshot({ stage: snapshot.stage, tasks, workspaces }, { projectId, tasks: [expectedControl], status: 1 });
      await leader.page.reload({ waitUntil: 'domcontentloaded' });
      await expect(leader.page.getByText(request.taskName, { exact: true })).toBeVisible({ timeout: 60_000 });
      await test.info().attach('task-start-race-owner-with-control', { contentType: 'image/png',
        body: await leader.page.screenshot({ fullPage: true }) });
      return { expected: expectedControl, snapshot };
    });
    expectCreationSnapshot(raced, { projectId, tasks: expected, status: 1 });
    expected.push(control.expected);
    expectCreationSnapshot(control.snapshot, { projectId, tasks: expected, status: 1 });

    await test.step('原批次重放不重复建任务和题位，重复开启及旧编辑拒绝且数据不变', async () => {
      const replayed = await race.createBatch(batch);
      expect(replayed.map(task => task.taskId)).toEqual(expected.slice(1, 3).map(task => task.taskId));
      const afterReplay = await race.snapshot();
      await attachSnapshot('task-start-race-after-replay', afterReplay);
      expect(afterReplay).toEqual(control.snapshot);
      await race.rejectRepeatStartAndOldEdit(original.request, original.task.taskId);
      const afterRejection = await race.snapshot();
      await attachSnapshot('task-start-race-after-rejections', afterRejection);
      expect(afterRejection).toEqual(control.snapshot);
      expectCreationSnapshot(afterRejection, { projectId, tasks: expected, status: 1 });
      await race.showOwnerTasks(expected, 1);
      await test.info().attach('task-start-race-owner-final', { contentType: 'image/png',
        body: await leader.page.screenshot({ fullPage: true }) });
    });
  } finally {
    await test.info().attach('task-start-race-responses', { contentType: 'application/json',
      body: JSON.stringify({ order, projectId, bankId, projectName, requests: race.evidence }, null, 2) });
  }
}
