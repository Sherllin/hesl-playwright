import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Actors } from '../support/actors';
import { businessResponse, responseFor } from '../support/api';
import { TaskPage } from '../support/task.page';
import { BankPage } from '../question-bank/bank.page';
import { ProjectPage } from '../project-management/project.page';
import { ActivitiesPage } from '../project-management/activities.page';
import { SingleChoiceAuthoringPage, type SingleChoiceQuestion } from '../authoring/single-choice.page';
import { QuestionReviewPage } from '../question-review/question-review.page';
import { ReviewReworkHistoryPage, type ReworkSlot } from '../question-review/rework-history.page';
import { expectOldHistoryPreserved, expectReworkOptionContinuity, historySnapshot } from '../question-review/rework-history.assertions';

/** TAPD 1007380 / REMOTE-77：保留原题返工、已通过题隔离、跨轮历史和最终完整入库。 */
export async function runReviewReworkHistory(actors: Actors) {
  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  const folderName = `E2E-返工历史学科-${runId}`;
  const bankName = `E2E-返工历史题库-${runId}`;
  const projectName = `E2E-返工历史-${runId}`;
  const reason = '请补充作答要求。';
  const addition = 'E2E重交：请选择唯一正确答案。';
  const admin = await actors.get('admin');
  const leader = await actors.get('leader');
  const author = await actors.get('author');
  const reviewer = await actors.get('questionReviewer');
  const banks = new BankPage(admin.page);
  const project = new ProjectPage(leader.page);
  const activities = new ActivitiesPage(leader.page);
  const authoring = new ReviewReworkHistoryPage(author.page, author.token);
  const reviewing = new ReviewReworkHistoryPage(reviewer.page, reviewer.token);
  const review = new QuestionReviewPage(reviewer.page);
  const bankId = await test.step('创建独立学科、题库、开放式征题项目和两题任务', async () => {
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
    await activities.createQuestionTask({ name: `E2E-返工出题-${runId}`, author: author.name, quantity: 2 });
    return id!;
  });
  let authorTaskId = '';
  let originalSlots: ReworkSlot[] = [];
  const confirmed = await test.step('真实填写两道单选题，记录提交前题位并正式提交', async () => {
    await new TaskPage(author.page).openNodeTask(projectName, /去出题/);
    authorTaskId = new URL(author.page.url()).searchParams.get('taskId')!;
    expect(authorTaskId).toBeTruthy();
    const samples = [
      { stem: `E2E-${runId}-北京位于哪个地区`, options: ['华北', '华东', '华南', '西南'], answer: 'A' },
      { stem: `E2E-${runId}-上海位于哪个地区`, options: ['华北', '华东', '华南', '西南'], answer: 'B' },
    ];
    // 最后一题的 CONFIRM 回执含全部题位；在正式提交隐藏正文前保留实际数据。
    const snapshot = author.page.waitForResponse(response => {
      if (response.request().method() !== 'PUT' ||
        !new URL(response.url()).pathname.endsWith('/question-creation/workspace/slots')) return false;
      const sent = response.request().postDataJSON();
      return sent?.mode === 'CONFIRM' && sent.slots?.some((slot: { draftPayload?: { question?: string } }) =>
        slot.draftPayload?.question?.includes(samples[1].stem));
    }).then(response => businessResponse<{ slots: ReworkSlot[] }>(response));
    void snapshot.catch(() => undefined);
    const questions = await new SingleChoiceAuthoringPage(author.page).confirmAndSubmit(samples);
    originalSlots = (await snapshot).slots;
    expect(originalSlots).toHaveLength(2);
    expect(originalSlots.map(slot => slot.questionId).sort()).toEqual(questions.map(q => q.id).sort());
    return questions;
  });
  const { taskId: reviewTaskId, persistedQuestions } = await test.step('负责人开启审题，核对两道原题的正文与选项答案', async () => {
    await project.enterProject(projectName);
    await activities.openQuestionReview(reviewer.name);
    const loaded = reviewer.page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith('/question-review/question-tasks'));
    void loaded.catch(() => undefined);
    await new TaskPage(reviewer.page).openNodeTask(projectName, /去审题/);
    const runtime = await businessResponse<{ questions: { records: SingleChoiceQuestion[] } }>(await loaded);
    expect(runtime.questions.records).toHaveLength(2);
    for (const source of confirmed) {
      const actual = runtime.questions.records.find(q => q.id === source.id)!;
      expect(actual).toBeTruthy();
      expect(actual.question).toBe(source.question);
      expect(actual.subQuestions.map(q => ({ question: q.question, answer: q.answer })))
        .toEqual(source.subQuestions.map(q => ({ question: q.question, answer: q.answer })));
      for (const option of actual.subQuestions) {
        expect(option.id, '正式审题数据必须携带选项ID，不能用草稿中的空ID作入库基线').toMatch(/^\d+$/);
      }
    }
    const id = new URL(reviewer.page.url()).searchParams.get('taskId');
    expect(id).toBeTruthy();
    await test.info().attach('rework-fixture', { contentType: 'application/json', body: JSON.stringify({
      runId, projectName, bankId, authorTaskId, reviewTaskId: id, questionIds: confirmed.map(q => q.id),
      reason, addition, persistedQuestions: runtime.questions.records,
    }, null, 2) });
    // CONFIRM 的 draftPayload 不保证携带选项ID；从首次审题的正式数据冻结身份基线。
    return { taskId: id!, persistedQuestions: structuredClone(runtime.questions.records) };
  });
  const initial = await test.step('首轮一题通过、一题填写理由驳回，正式提交后历史理由正确', async () => {
    const approvedId = await reviewing.currentQuestionId();
    expect(confirmed.map(q => q.id)).toContain(approvedId);
    await review.approveCurrentQuestion(approvedId);
    await expect.poll(() => reviewing.currentQuestionId()).not.toBe(approvedId);
    const rejectedId = await reviewing.currentQuestionId();
    expect(confirmed.map(q => q.id)).toContain(rejectedId);
    await reviewing.rejectCurrent(rejectedId, reason);
    const before = await reviewing.reviewSnapshot(reviewTaskId);
    await reviewing.submitRound(2);
    const history = await reviewing.history(reviewTaskId, '01-first-round');
    const records = historySnapshot(history);
    expect(records).toHaveLength(2);
    expect(records.map(r => r.id).sort()).toEqual(confirmed.map(q => q.id).sort());
    expect(records.find(r => r.id === rejectedId)).toMatchObject({ round: 1, result: 2, comment: reason });
    expect(records.find(r => r.id === approvedId)).toMatchObject({ round: 1, result: 1 });
    const frozen = await reviewing.reviewSnapshot(reviewTaskId, false);
    const content = before.map(q => ({ ...q, decision: frozen.find(item => item.id === q.id)!.decision }));
    return { approvedId, rejectedId, history, content };
  });
  const revised = await test.step('作者只修改驳回原题并重提，已通过题位及选项答案保持', async () => {
    const change = await authoring.reviseSameQuestion(projectName, authorTaskId, initial.rejectedId, addition);
    expect(change.after.map(slot => slot.slotId).sort()).toEqual(change.before.map(slot => slot.slotId).sort());
    const control = originalSlots.filter(slot => slot.questionId === initial.approvedId);
    expect(control).toHaveLength(1);
    const pick = (slot: ReworkSlot) => ({ slotId: slot.slotId, questionId: slot.questionId, version: slot.version,
      confirmed: slot.confirmed, marked: slot.marked, questionStatus: slot.questionStatus,
      draftPayload: slot.draftPayload, reviewDecision: slot.reviewDecision });
    const before = change.before.find(slot => slot.slotId === control[0].slotId)!;
    const after = change.after.find(slot => slot.slotId === control[0].slotId)!;
    expect(before).toBeTruthy(); expect(after).toBeTruthy();
    expect(pick(after), '返工不得改变已通过题位的版本、确认态、可见数据或决定').toEqual(pick(before));
    return { ...change.revised.draftPayload!, id: initial.rejectedId };
  });
  const reviewedQuestions = await test.step('重提不改首轮历史，复审只处理返工原题并正式通过', async () => {
    const resubmitted = await reviewing.history(reviewTaskId, '02-after-resubmit');
    expect(historySnapshot(resubmitted), '作者重提不得新增或改写首轮历史').toEqual(historySnapshot(initial.history));
    const current = await reviewing.reviewSnapshot(reviewTaskId);
    expect(current.find(q => q.id === initial.approvedId)).toEqual(initial.content.find(q => q.id === initial.approvedId));
    const rework = current.find(q => q.id === initial.rejectedId)!;
    expect(rework.round).toBe(2);
    expect(rework.question).toContain(addition);
    expect(rework.fingerprint).not.toBe(initial.content.find(q => q.id === initial.rejectedId)!.fingerprint);
    const loaded = responseFor(reviewer.page, 'POST', '/question-review/question-tasks');
    void loaded.catch(() => undefined);
    await reviewing.openTask(projectName, reviewTaskId, '审题');
    const runtime = await businessResponse<{ questions: { records: SingleChoiceQuestion[] } }>(await loaded);
    const reviewed = structuredClone(runtime.questions.records);
    expect(reviewed.map(q => q.id).sort()).toEqual(persistedQuestions.map(q => q.id).sort());
    for (const question of reviewed) {
      const firstRound = persistedQuestions.find(q => q.id === question.id)!;
      expectReworkOptionContinuity(firstRound.subQuestions, question.subQuestions, question.id === initial.rejectedId);
    }
    // 最终入库必须保持实际复审时的选项ID，不跨过作者重新保存题树的边界比较。
    await test.info().attach('rework-review-options-baseline', { contentType: 'application/json',
      body: JSON.stringify({ firstRound: persistedQuestions, beforeSecondReview: reviewed }, null, 2) });
    expect(await reviewing.currentQuestionId()).toBe(initial.rejectedId);
    await review.approveCurrentQuestion(initial.rejectedId);
    const submitted = responseFor(reviewer.page, 'POST', '/question-review/submit');
    void submitted.catch(() => undefined);
    await review.submitTask();
    expect((await businessResponse<{ submittedCount: number }>(await submitted)).submittedCount,
      '第二轮只能提交一条返工原题决定').toBe(1);
    const final = await reviewing.history(reviewTaskId, '03-after-second-round');
    expect(final.records).toHaveLength(3);
    // 软断言只用于继续收集结项/入库证据；首轮理由丢失仍令整条用例 FAIL。
    expectOldHistoryPreserved(initial.history, final, true);
    const latest = historySnapshot(final).filter(r => r.id === initial.rejectedId && r.round === 2);
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ result: 1, comment: null, question: revised.question });
    return reviewed;
  });
  await test.step('负责人结束审题，核对原题完整唯一入库及返工后的最新正文', async () => {
    await project.enterProject(projectName);
    await activities.finishQuestionReview();
    await project.expectCompleted(projectName);
    const loaded = admin.page.waitForResponse(response => {
      const url = new URL(response.url());
      return (response.request().method() === 'POST' && url.pathname.endsWith('/qrQuestionEntity/getByCatalog') &&
        response.request().postDataJSON()?.bankId === bankId && Number(response.request().postDataJSON()?.count) !== 1) ||
        (response.request().method() === 'GET' && url.pathname.endsWith('/bankFolder/subject-questions') && url.searchParams.get('bankId') === bankId);
    });
    void loaded.catch(() => undefined);
    await admin.page.goto(`/question/course/manage/${bankId}`, { waitUntil: 'domcontentloaded' });
    const data = await businessResponse<{ records: SingleChoiceQuestion[]; total: number }>(await loaded);
    expect(Number(data.total)).toBe(2);
    expect(data.records).toHaveLength(2);
    expect(data.records.map(q => q.id).sort()).toEqual(confirmed.map(q => q.id).sort());
    for (const original of confirmed) {
      const expected = original.id === initial.rejectedId ? revised : original;
      const actual = data.records.find(q => q.id === expected.id)!;
      expect(actual.question).toBe(expected.question);
      expect(actual.questionType).toBe(expected.questionType);
      expect(actual.questionTypeId).toBe(expected.questionTypeId);
      const persisted = reviewedQuestions.find(q => q.id === original.id);
      expect(persisted, '必须找到该原题在复审前的正式选项基线').toBeTruthy();
      expect(actual.subQuestions.map(q => ({ id: q.id, question: q.question, answer: q.answer })))
        .toEqual(persisted!.subQuestions.map(q => ({ id: q.id, question: q.question, answer: q.answer })));
      const card = admin.page.locator(`[data-confidential-target-type="QUESTION"][data-confidential-target-id="${expected.id}"]`);
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(expected.question.replace(/<[^>]*>|\u200B/g, '').trim());
    }
    await expect(admin.page.getByText(/^当前结果\s*2\s*道$/)).toBeVisible();
    await test.info().attach('rework-published', { contentType: 'image/png',
      body: await admin.page.screenshot({ fullPage: true }) });
  });
}
