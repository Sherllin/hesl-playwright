import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Actors } from '../support/actors';
import { businessResponse } from '../support/api';
import { TaskPage } from '../support/task.page';
import { BankPage } from '../question-bank/bank.page';
import { ProjectPage } from '../project-management/project.page';
import { ActivitiesPage } from '../project-management/activities.page';
import { SingleChoiceAuthoringPage, type SingleChoiceQuestion } from '../authoring/single-choice.page';
import { QuestionReviewPage } from '../question-review/question-review.page';
import { verifyReviewHeaderLayout } from '../question-review/header-layout.page';

/** TAPD1007314，复用目标工程真实业务前置；不依赖历史任务ID或原仓库目录。 */
export async function runReviewHeaderLayout(actors: Actors) {
  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  const folderName = `E2E-页头学科-${runId}`;
  const bankName = `E2E-页头题库-${runId}`;
  const projectName = `E2E-窄屏审题-${runId}`;
  const admin = await actors.get('admin');
  const leader = await actors.get('leader');
  const author = await actors.get('author');
  const reviewer = await actors.get('questionReviewer');
  const banks = new BankPage(admin.page);
  const project = new ProjectPage(leader.page);
  const activities = new ActivitiesPage(leader.page);
  const bankId = await test.step('新建独立学科、题库、项目和两题出题任务', async () => {
    await banks.createFolder(folderName);
    await banks.setQuestionTypeEnabled(folderName, '单选题');
    await banks.createProjectBank(folderName, bankName);
    await banks.openProjectBank(bankName);
    const id = new URL(admin.page.url()).pathname.match(/\/manage\/(\d+)$/)?.[1];
    expect(id).toBeTruthy();
    const created = await new ProjectPage(admin.page).create({
      name: projectName, leader: leader.name, activity: '开放式征题', bankName,
    });
    expect(created.bankId).toBe(id);
    await project.enterProject(projectName);
    await activities.createQuestionTask({ name: `E2E-页头出题-${runId}`, author: author.name, quantity: 2 });
    return id!;
  });
  const confirmed = await test.step('出题专家填写并提交两道单选题', async () => {
    await new TaskPage(author.page).openNodeTask(projectName, /去出题/);
    return new SingleChoiceAuthoringPage(author.page).confirmAndSubmit([
      { stem: `E2E-${runId}-北京位于哪个地区`, options: ['华北', '华东', '华南', '西南'], answer: 'A' },
      { stem: `E2E-${runId}-上海位于哪个地区`, options: ['华北', '华东', '华南', '西南'], answer: 'B' },
    ]);
  });
  await test.step('受派审题专家进入真实任务并逐题通过，保持尚未提交', async () => {
    await project.enterProject(projectName);
    await activities.openQuestionReview(reviewer.name);
    const loaded = reviewer.page.waitForResponse(r => r.request().method() === 'POST' &&
      new URL(r.url()).pathname.endsWith('/question-review/question-tasks'));
    await new TaskPage(reviewer.page).openNodeTask(projectName, /去审题/);
    const runtime = await businessResponse<{ questions: { records: SingleChoiceQuestion[] } }>(await loaded);
    expect(runtime.questions.records).toHaveLength(2);
    for (const source of confirmed) {
      const current = runtime.questions.records.find(q => q.id === source.id);
      expect(current).toBeTruthy();
      expect(current!.question).toBe(source.question);
      expect(current!.subQuestions.map(q => ({ question: q.question, answer: q.answer })))
        .toEqual(source.subQuestions.map(q => ({ question: q.question, answer: q.answer })));
    }
    const remaining = new Set(confirmed.map(q => q.id));
    const content = reviewer.page.getByTestId('review-content')
      .locator('[data-confidential-content="readonly"][data-confidential-target-name="审题题目"]');
    const review = new QuestionReviewPage(reviewer.page);
    for (let index = 0; index < 2; index++) {
      await expect.poll(async () => remaining.has(await content.getAttribute('data-confidential-target-id') ?? ''),
        { timeout: 90_000, message: '当前必须是本次尚未审核的原题' }).toBe(true);
      const id = (await content.getAttribute('data-confidential-target-id'))!;
      await review.approveCurrentQuestion(id);
      remaining.delete(id);
    }
    expect(remaining.size).toBe(0);
    await expect(reviewer.page.getByRole('button', { name: '提交任务', exact: true })).toBeEnabled();
  });
  await test.info().attach('review-header-fixture', {
    contentType: 'application/json', body: JSON.stringify({
      runId, bankId, projectName, taskId: new URL(reviewer.page.url()).searchParams.get('taskId'),
      questionIds: confirmed.map(q => q.id),
    }, null, 2),
  });
  await verifyReviewHeaderLayout(reviewer.page);
  await test.step('正常提交并由负责人结束审题', async () => {
    await new QuestionReviewPage(reviewer.page).submitTask();
    await project.enterProject(projectName);
    await activities.finishQuestionReview();
    await project.expectCompleted(projectName);
  });
}
