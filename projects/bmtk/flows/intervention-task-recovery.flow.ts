import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Actors } from '../support/actors';
import { businessResponse, parseJson, readApi, responseFor, type Envelope } from '../support/api';
import { BankPage } from '../question-bank/bank.page';
import { ProjectPage } from '../project-management/project.page';
import { ActivitiesPage } from '../project-management/activities.page';
import { InterventionRecoveryPage } from '../project-management/intervention-recovery.page';
import { expectRecoveryTasks, type CreationTask } from '../project-management/intervention-recovery.assertions';
import { TaskPage } from '../support/task.page';
import { SingleChoiceAuthoringPage } from '../authoring/single-choice.page';

export async function runInterventionTaskRecovery(actors: Actors, keepOtherTask: boolean) {
  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  const folderName = `E2E-介入恢复学科-${runId}`;
  const bankName = `E2E-介入恢复题库-${runId}`;
  const projectName = `E2E-介入恢复-${runId}`;
  const replacementName = `E2E-补建出题-${runId}`;
  const admin = await actors.get('admin');
  const leader = await actors.get('leader');
  const originalAuthor = await actors.get('author');
  // 本用例把独立的审题账号配置为替代出题专家，不登录第二份相同账号会话。
  const replacementAuthor = await actors.get('questionReviewer');
  const errors: string[] = [];
  for (const actor of [admin, leader, originalAuthor, replacementAuthor]) {
    actor.page.on('pageerror', error => errors.push(error.message));
  }
  const project = new ProjectPage(leader.page);
  const activities = new ActivitiesPage(leader.page);
  const bank = new BankPage(admin.page);
  let projectId = '';
  const tasks = () => readApi<CreationTask[]>(leader.page.request, leader.token,
    `/qrProject/question-creation/list?projectId=${projectId}`);
  const stage = () => readApi<{ projectStage: number; projectStageStatus: number }>(leader.page.request,
    leader.token, `/qrProject/get-project-stage-status?projectId=${projectId}`);

  const { original, retained } = await test.step('创建独立项目并开启出题，按场景保留另一任务', async () => {
    await bank.createFolder(folderName);
    await bank.setQuestionTypeEnabled(folderName, '单选题');
    await bank.createProjectBank(folderName, bankName);
    await new ProjectPage(admin.page).create({ name: projectName, leader: leader.name,
      activity: '开放式征题', bankName });
    await project.enterProject(projectName);
    projectId = new URL(leader.page.url()).searchParams.get('projectId')!;
    expect(projectId).toMatch(/^\d+$/);
    await activities.createQuestionTask({ name: `E2E-将作废-${runId}`, author: originalAuthor.name, quantity: 1 },
      { deferStart: true });
    if (keepOtherTask) {
      await activities.createQuestionTask({ name: `E2E-保持原样-${runId}`, author: originalAuthor.name, quantity: 1 },
        { expertAlreadyConfigured: true, deferStart: true });
    }
    await activities.startQuestionCreation();
    const snapshot = await tasks();
    expect(snapshot).toHaveLength(keepOtherTask ? 2 : 1);
    expect(snapshot.map(task => task.taskName).sort()).toEqual(
      (keepOtherTask ? [`E2E-将作废-${runId}`, `E2E-保持原样-${runId}`] : [`E2E-将作废-${runId}`]).sort());
    expect(snapshot.map(task => task.taskStatus)).toEqual(keepOtherTask ? [1, 1] : [1]);
    const original = snapshot.find(task => task.taskName === `E2E-将作废-${runId}`)!;
    expect(original).toBeTruthy();
    expect(original.taskStatus).toBe(1);
    return { original, retained: snapshot.filter(task => task.taskId !== original.taskId) };
  });
  await test.info().attach('intervention-recovery-fixture', { contentType: 'application/json',
    body: JSON.stringify({ projectId, projectName, voidedTaskId: original.taskId, retained }, null, 2) });
  const originalTaskUrl = `/project/task/question?projectId=${projectId}&taskId=${original.taskId}`;
  await test.step('作废前原专家确实可以进入原任务页面', async () => {
    const accessible = responseFor(originalAuthor.page, 'GET', '/question-creation/page-view-token');
    await originalAuthor.page.goto(originalTaskUrl, { waitUntil: 'domcontentloaded' });
    await businessResponse(await accessible);
    await expect(originalAuthor.page.getByRole('dialog').filter({ hasText: '设置题目分配' })).toBeVisible();
  });
  let startRequests = 0;
  leader.page.on('request', request => {
    if (request.method() === 'POST' && /\/question-creation\/start\/\d+$/.test(new URL(request.url()).pathname)) startRequests++;
  });
  await test.step('管理员作废原任务，不建替代任务就结束介入', async () => {
    const record = await new InterventionRecoveryPage(leader.page, leader.token)
      .apply(projectId, `${projectName}-结束原任务，交负责人补建`);
    const intervening = new InterventionRecoveryPage(admin.page, admin.token);
    await intervening.acknowledge(record);
    await intervening.voidTask(original.taskId);
    expect(await tasks(), '结束介入前不得提前创建替代任务').toEqual(retained);
    await intervening.finishWithoutReplacement(record, `${projectName}-未创建替代任务，结束介入`);
    expect(await tasks(), '介入已结束但仍没有替代任务').toEqual(retained);
    expect(await stage()).toMatchObject({ projectStage: 1, projectStageStatus: 2 });
  });
  const replacement = await test.step('负责人通过真实页面添加替代专家并补建任务，无需重开活动', async () => {
    await project.enterProject(projectName);
    await expect(leader.page.getByRole('button', { name: '开启出题活动', exact: true })).toHaveCount(0);
    await activities.configureQuestionExperts([originalAuthor.name, replacementAuthor.name]);
    const poolResponse = await leader.page.request.post('/api/qrProject/member-list', {
      headers: { Authorization: leader.token }, data: { projectId, role: 'QUESTION_EXPERT' },
    });
    expect(poolResponse.ok()).toBe(true);
    const pool = parseJson<Envelope<Array<{ memberId: string }>>>(await poolResponse.text());
    expect(pool.code, '负责人专家池读回必须业务成功').toBe('E200');
    expect(pool.data.map(expert => expert.memberId).sort()).toEqual([originalAuthor.id, replacementAuthor.id].sort());
    for (const task of retained) {
      const row = leader.page.locator(`tr[data-row-key="${task.taskId}"]`);
      await expect(row.getByRole('button', { name: '编辑', exact: true })).toBeDisabled();
      await expect(row.getByRole('button', { name: '删除', exact: true })).toBeDisabled();
    }
    await activities.createQuestionTask({ name: replacementName, author: replacementAuthor.name, quantity: 1 },
      { expertAlreadyConfigured: true, deferStart: true });
    const replacement = expectRecoveryTasks(await tasks(), { voidedTaskId: original.taskId, retained,
      replacementName, replacementExpertId: replacementAuthor.id });
    expect(await stage()).toMatchObject({ projectStage: 1, projectStageStatus: 2 });
    expect(startRequests, '恢复后不得再次开启活动').toBe(0);
    await test.info().attach('intervention-recovery-leader', { contentType: 'image/png',
      body: await leader.page.screenshot({ fullPage: true }) });
    return replacement;
  });
  await test.step('新专家实际完成新任务，原任务仍拒绝访问，其他任务不变', async () => {
    const denied = await originalAuthor.page.request.get(`/api/qrProject/question-creation/get/${original.taskId}`,
      { headers: { Authorization: originalAuthor.token } });
    expect(denied.ok()).toBe(true);
    expect(parseJson<Envelope<unknown>>(await denied.text()).code).toBe('10301');
    const rejectedLoad = responseFor(originalAuthor.page, 'GET', '/question-creation/page-view-token');
    await originalAuthor.page.goto(originalTaskUrl, { waitUntil: 'domcontentloaded' });
    expect(parseJson<Envelope<unknown>>(await (await rejectedLoad).text()).code).toBe('10301');
    await expect(originalAuthor.page.getByRole('alert')).toHaveText('该任务已不可访问，请返回任务列表查看当前任务');
    await expect(originalAuthor.page.getByRole('button', { name: '返回任务列表', exact: true })).toBeVisible();
    await test.info().attach('intervention-recovery-old-task-message', { contentType: 'image/png',
      body: await originalAuthor.page.screenshot({ fullPage: true }) });
    const loaded = responseFor(replacementAuthor.page, 'GET', '/question-creation/page-view-token');
    await new TaskPage(replacementAuthor.page).openNodeTask(projectName, /去出题/);
    await businessResponse(await loaded);
    expect(new URL(replacementAuthor.page.url()).searchParams.get('taskId')).toBe(replacement.taskId);
    await new SingleChoiceAuthoringPage(replacementAuthor.page).confirmAndSubmit([{
      stem: `E2E-${runId}-替代任务请选择唯一正确答案`,
      options: ['正确项', '错误项乙', '错误项丙', '错误项丁'], answer: 'A',
    }]);
    const after = await tasks();
    expect(after.find(task => task.taskId === replacement.taskId)?.taskStatus).toBe(2);
    expect(after.map(task => task.taskId)).not.toContain(original.taskId);
    for (const baseline of retained) expect(after.find(task => task.taskId === baseline.taskId)).toEqual(baseline);
    expect(startRequests).toBe(0);
    expect(errors, '业务操作不得产生未处理浏览器异常').toEqual([]);
    await test.info().attach('intervention-recovery-identities', { contentType: 'application/json',
      body: JSON.stringify({ projectId, projectName, voidedTaskId: original.taskId,
        replacementTaskId: replacement.taskId, keptTaskIds: retained.map(task => task.taskId),
        before: retained, after }, null, 2) });
  });
}
