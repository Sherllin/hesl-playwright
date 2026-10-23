import { expect } from '@playwright/test';
import type { Actors } from '../support/actors';
import { businessResponse } from '../support/api';
import { TaskPage } from '../support/task.page';
import { BankPage } from '../question-bank/bank.page';
import type { BankRef, MatchingQuestion, MatchingSample } from '../question-bank/matching';
import { assertPublishedMatching } from '../question-bank/matching';
import { ProjectPage } from '../project-management/project.page';
import { ActivitiesPage } from '../project-management/activities.page';
import { MatchingAuthoringPage } from '../authoring/matching.page';
import { QuestionReviewPage } from '../question-review/question-review.page';

// 跨业务前置：题库、项目、出题、审题；显式返回题库和原题，不通过监听别的流程猜ID。
export async function publishMatchingQuestion(actors: Actors, sample: MatchingSample, runId: string):
  Promise<{ bank: BankRef; source: MatchingQuestion }> {
  const admin = await actors.get('admin');
  const leader = await actors.get('leader');
  const author = await actors.get('author');
  const reviewer = await actors.get('questionReviewer');
  const folder = `E2E-匹配学科-${runId}`;
  const bankName = `E2E-匹配题库-${runId}`;
  const projectName = `E2E-匹配征题-${runId}`;
  const banks = new BankPage(admin.page);
  await banks.createFolder(folder);
  await banks.setQuestionTypeEnabled(folder, '匹配题');
  await banks.createProjectBank(folder, bankName);
  await banks.openProjectBank(bankName);
  const bankId = new URL(admin.page.url()).pathname.match(/\/manage\/(\d+)$/)?.[1];
  expect(bankId, '真实题库URL必须包含字符串ID').toBeTruthy();
  const created = await new ProjectPage(admin.page).create({
    name: projectName, leader: leader.name,
    activity: '开放式征题', bankName
  });
  expect(created.bankId).toBe(bankId);
  const project = new ProjectPage(leader.page);
  await project.enterProject(projectName);
  await new ActivitiesPage(leader.page).createQuestionTask({ name: `E2E-匹配任务-${runId}`, author: author.name, quantity: 1 });
  await new TaskPage(author.page).openNodeTask(projectName, /去出题/);
  const confirmed = await new MatchingAuthoringPage(author.page).confirmAndSubmit(sample);
  await project.enterProject(projectName);
  await new ActivitiesPage(leader.page).openQuestionReview(reviewer.name);
  const reviewRead = reviewer.page.waitForResponse(r => r.request().method() === 'POST' &&
    new URL(r.url()).pathname.endsWith('/question-review/question-tasks'));
  await new TaskPage(reviewer.page).openNodeTask(projectName, /去审题/);
  const reviewData = await businessResponse<{ questions: { records: MatchingQuestion[] } }>(await reviewRead);
  const persisted = reviewData.questions.records.find(q => q.id === confirmed.questionId);
  expect(persisted, '审核前必须能读取已确认的原题').toBeTruthy();
  expect(persisted!.question).toBe(confirmed.payload.question);
  expect(persisted!.options.map(o => o.question)).toEqual(confirmed.payload.options.map(o => o.question));
  expect(persisted!.subQuestions.map(q => ({ question: q.question, answer: q.answer })))
    .toEqual(confirmed.payload.subQuestions.map(q => ({ question: q.question, answer: q.answer })));
  const ids = [persisted!.id, ...persisted!.options.map(o => o.id), ...persisted!.subQuestions.map(q => q.id)];
  for (const id of ids) { expect(typeof id).toBe('string'); expect(id).toMatch(/^\d+$/); }
  expect(new Set(ids).size).toBe(ids.length);
  const review = new QuestionReviewPage(reviewer.page);
  await review.approveCurrentQuestion(confirmed.questionId);
  await review.submitTask();
  await project.enterProject(projectName);
  await new ActivitiesPage(leader.page).finishQuestionReview();
  await project.expectCompleted(projectName);
  const bankRead = admin.page.waitForResponse(r => {
    const url = new URL(r.url());
    return r.request().method() === 'POST' && url.pathname.endsWith('/qrQuestionEntity/getByCatalog') && r.request().postDataJSON()?.bankId === bankId ||
      r.request().method() === 'GET' && url.pathname.endsWith('/bankFolder/subject-questions') && url.searchParams.get('bankId') === bankId;
  });
  await admin.page.goto(`/question/course/manage/${bankId}`, { waitUntil: 'domcontentloaded' });
  const bankData = await businessResponse<{ records: MatchingQuestion[] }>(await bankRead);
  expect(bankData.records).toHaveLength(1);
  const source = bankData.records[0];
  assertPublishedMatching(persisted!, source);
  await expect(admin.page.locator(`[data-confidential-target-type="QUESTION"][data-confidential-target-id="${source.id}"]`)).toContainText(sample.stem);
  return { bank: { id: bankId!, name: bankName }, source };
}
