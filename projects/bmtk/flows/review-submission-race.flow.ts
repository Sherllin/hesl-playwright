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
import { ReviewSubmissionRacePage } from '../question-review/submission-race.page';

/** TAPD 1007364；保留两题真实出题、双页签、改判/提交、历史及最终入库闭环。 */
export async function runReviewSubmissionRace(actors: Actors, mode: 'serial' | 'simultaneous') {
  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  const folderName = `E2E-竞争学科-${runId}`;
  const bankName = `E2E-竞争题库-${runId}`;
  const projectName = `E2E-审题竞争-${runId}`;
  const admin = await actors.get('admin');
  const leader = await actors.get('leader');
  const author = await actors.get('author');
  const reviewer = await actors.get('questionReviewer');
  const banks = new BankPage(admin.page);
  const project = new ProjectPage(leader.page);
  const activities = new ActivitiesPage(leader.page);
  const bankId = await test.step('创建独立学科、题库、开放式征题和两题任务', async () => {
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
    await activities.createQuestionTask({ name: `E2E-竞争出题-${runId}`, author: author.name, quantity: 2 });
    return id!;
  });
  const confirmed = await test.step('出题专家真实填写、确认并提交两道单选题', async () => {
    await new TaskPage(author.page).openNodeTask(projectName, /去出题/);
    return new SingleChoiceAuthoringPage(author.page).confirmAndSubmit([
      { stem: `E2E-${runId}-北京位于哪个地区`, options: ['华北', '华东', '华南', '西南'], answer: 'A' },
      { stem: `E2E-${runId}-上海位于哪个地区`, options: ['华北', '华东', '华南', '西南'], answer: 'B' },
    ]);
  });
  const originals = await test.step('开启审题并按原题身份核对题干、选项和答案', async () => {
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
    return runtime.questions.records;
  });
  const taskId = new URL(reviewer.page.url()).searchParams.get('taskId');
  await test.info().attach('review-race-fixture', { contentType: 'application/json', body: JSON.stringify({
    mode, bankId, projectName, taskId, questionIds: confirmed.map(q => q.id),
  }, null, 2) });
  const race = new ReviewSubmissionRacePage(reviewer.page, reviewer.token, mode);
  const review = new QuestionReviewPage(reviewer.page);
  const count = await race.run(async () => {
    await test.step('按当前题目身份逐题通过，两题都只保存决定、暂不正式提交', async () => {
      const remaining = new Set(originals.map(q => q.id));
      const content = reviewer.page.getByTestId('review-content')
        .locator('[data-confidential-content="readonly"][data-confidential-target-name="审题题目"]');
      for (let index = 0; index < 2; index++) {
        await expect.poll(async () => remaining.has(await content.getAttribute('data-confidential-target-id') ?? ''),
          { timeout: 90_000, message: '当前待审必须是本轮未审过的原题' }).toBe(true);
        const id = (await content.getAttribute('data-confidential-target-id'))!;
        await review.approveCurrentQuestion(id);
        remaining.delete(id);
      }
      expect(remaining.size).toBe(0);
      await expect(reviewer.page.getByRole('button', { name: '提交任务', exact: true })).toBeEnabled();
    });
    await race.verifyStaleTabs();
    await test.step(mode === 'serial' ? '重新确认后正常提交' : '正式提交与改判驳回同时发出并核对收敛结果',
      () => review.submitTask());
    return 2;
  });
  expect(count).toBe(2);
  await test.step('负责人结束审题，项目完成且两道原题唯一完整入库', async () => {
    await project.enterProject(projectName);
    await activities.finishQuestionReview();
    await project.expectCompleted(projectName);
    const loaded = admin.page.waitForResponse(r => {
      const url = new URL(r.url());
      return (r.request().method() === 'POST' && url.pathname.endsWith('/qrQuestionEntity/getByCatalog') &&
        r.request().postDataJSON()?.bankId === bankId && Number(r.request().postDataJSON()?.count) !== 1) ||
        (r.request().method() === 'GET' && url.pathname.endsWith('/bankFolder/subject-questions') && url.searchParams.get('bankId') === bankId);
    });
    await admin.page.goto(`/question/course/manage/${bankId}`, { waitUntil: 'domcontentloaded' });
    const data = await businessResponse<{ records: SingleChoiceQuestion[]; total: number }>(await loaded);
    expect(Number(data.total)).toBe(2);
    expect(data.records).toHaveLength(2);
    expect(data.records.map(q => q.id).sort()).toEqual(originals.map(q => q.id).sort());
    for (const source of originals) {
      const published = data.records.find(q => q.id === source.id)!;
      expect(published.question).toBe(source.question);
      expect(published.questionType).toBe(source.questionType);
      expect(published.questionTypeId).toBe(source.questionTypeId);
      expect(published.subQuestions.map(q => ({ id: q.id, question: q.question, answer: q.answer })))
        .toEqual(source.subQuestions.map(q => ({ id: q.id, question: q.question, answer: q.answer })));
      const content = admin.page.locator(`[data-confidential-target-type="QUESTION"][data-confidential-target-id="${source.id}"]`);
      await expect(content).toHaveCount(1);
      const sample = confirmed.find(q => q.id === source.id)!;
      await expect(content).toContainText(sample.question.replace(/<[^>]*>|\u200B/g, '').trim());
    }
    await expect(admin.page.getByText(/^当前结果\s*2\s*道$/)).toBeVisible();
    await test.info().attach('review-race-published', { contentType: 'image/png',
      body: await admin.page.screenshot({ fullPage: true }) });
  });
}
