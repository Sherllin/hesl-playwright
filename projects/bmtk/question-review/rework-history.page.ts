import { expect, test, type Page } from '@playwright/test';
import { businessResponse, parseJson, readApi, responseFor, type Envelope } from '../support/api';
import { gotoMyTask, myTaskProjectGroup } from '../support/task.page';
import type { SingleChoiceQuestion } from '../authoring/single-choice.page';
import { historySnapshot, type ReviewHistory } from './rework-history.assertions';

export interface ReworkSlot {
  slotId: string; questionId: string | null; version: number; confirmed: boolean; marked: boolean;
  questionStatus: number; contentHidden: boolean; draftPayload: SingleChoiceQuestion | null;
  reviewDecision?: unknown;
}
interface RuntimeQuestion {
  id: string; question?: string; questionFingerprint?: string;
  currentDecision: unknown; approvalRound: number;
}

/** 从 REMOTE-77 迁入；界面执行返工，接口保留各轮真实快照，不假设存在历史页面入口。 */
export class ReviewReworkHistoryPage {
  constructor(private readonly page: Page, private readonly token: string) { }

  async history(taskId: string, label: string): Promise<ReviewHistory> {
    const data = await readApi<ReviewHistory>(this.page.request, this.token,
      `/qrProject/question-review/approval-history-questions?taskId=${taskId}&pageSize=100&pageNum=1`);
    // 原始业务数据和便于比较的字段同时保留，数值型 int64 仍按字符串解析。
    await test.info().attach(`rework-history-${label}`, { contentType: 'application/json',
      body: JSON.stringify({ taskId, history: data, snapshot: historySnapshot(data) }, null, 2) });
    return data;
  }

  async reviewSnapshot(taskId: string, visible = true) {
    const response = await this.page.request.post('/api/qrProject/question-review/question-tasks', {
      headers: { Authorization: this.token }, data: { taskId, pageNum: 1, pageSize: 100 },
    });
    expect(response.ok()).toBe(true);
    const body = parseJson<Envelope<{ questions: { records: RuntimeQuestion[] } }>>(await response.text());
    expect(body.code).toBe('E200');
    expect(body.data.questions.records).toHaveLength(2);
    return body.data.questions.records.map(question => {
      expect(typeof question.id).toBe('string');
      if (visible) {
        expect(question.question).toBeTruthy();
        expect(question.questionFingerprint).toMatch(/^[0-9a-f]{64}$/);
      }
      return { id: question.id, question: question.question, fingerprint: question.questionFingerprint,
        decision: question.currentDecision, round: question.approvalRound };
    });
  }

  async currentQuestionId() {
    // 动态审题内容无 role/label；使用现有显式业务ID属性确认当前原题。
    const content = this.page.getByTestId('review-content')
      .locator('[data-confidential-content="readonly"][data-confidential-target-name="审题题目"]');
    await expect(content).toHaveAttribute('data-confidential-target-id', /^\d+$/);
    return (await content.getAttribute('data-confidential-target-id'))!;
  }

  async rejectCurrent(questionId: string, reason: string) {
    expect(await this.currentQuestionId()).toBe(questionId);
    await this.page.getByTestId('review-action-bar').getByRole('button', { name: '驳回', exact: true }).click();
    const dialog = this.page.getByRole('dialog', { name: '驳回题目' });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder(/^请填写驳回题目的理由/).fill(reason);
    await test.info().attach('rework-first-round-rejection', {
      contentType: 'image/png', body: await this.page.screenshot({ fullPage: true }),
    });
    const rejected = responseFor(this.page, 'POST', '/question-review/reject');
    await dialog.getByRole('button', { name: '确定驳回', exact: true }).click();
    await businessResponse(await rejected);
    await expect(dialog).toBeHidden();
  }

  // 首轮含驳回时不能沿用“提交后任务已完成”的前置；保留实际正式提交数量断言。
  async submitRound(expectedCount: number) {
    const submit = this.page.getByRole('button', { name: '提交任务', exact: true });
    await expect(submit).toBeEnabled();
    await submit.click();
    const proceed = this.page.getByRole('dialog').filter({ hasText: /AI检查|仍有.*问题待解决/ })
      .getByRole('button', { name: '继续提交', exact: true });
    const confirm = this.page.getByRole('button', { name: '确认提交', exact: true });
    await expect(proceed.or(confirm)).toBeVisible();
    const submitted = responseFor(this.page, 'POST', '/question-review/submit');
    await (await proceed.isVisible() ? proceed : confirm).click();
    expect((await businessResponse<{ submittedCount: number }>(await submitted)).submittedCount)
      .toBe(expectedCount);
  }

  async authorSnapshot(taskId: string): Promise<ReworkSlot[]> {
    const workspace = await readApi<{ taskId: string; slots: ReworkSlot[] }>(this.page.request, this.token,
      `/qrProject/question-creation/workspace?taskId=${taskId}`);
    expect(workspace.taskId).toBe(taskId);
    expect(workspace.slots).toHaveLength(2);
    for (const slot of workspace.slots) {
      expect(typeof slot.slotId).toBe('string');
      expect(typeof slot.version).toBe('number');
      if (slot.contentHidden) {
        expect(slot.questionId).toBeNull();
        expect(slot.draftPayload).toBeNull();
      } else {
        expect(typeof slot.questionId).toBe('string');
        expect(slot.draftPayload?.question).toBeTruthy();
      }
    }
    return workspace.slots;
  }

  async openTask(projectName: string, taskId: string, node: '出题' | '审题') {
    await gotoMyTask(this.page);
    const group = myTaskProjectGroup(this.page, projectName).getByTestId('my-task-node')
      .filter({ has: this.page.getByText(node, { exact: true }) });
    await expect(group).toHaveCount(1);
    const action = group.getByRole('button', { name: node === '出题' ? /^(?:查看|去出题)$/ : /^(?:查看|去审题)$/ });
    await expect(action).toHaveCount(1);
    await action.click();
    await this.page.waitForURL(url => url.pathname === (node === '出题' ? '/project/task/question' : '/project/task/review')
      && url.searchParams.get('taskId') === taskId);
    expect(new URL(this.page.url()).searchParams.get('taskId')).toBe(taskId);
  }

  async reviseSameQuestion(projectName: string, taskId: string, questionId: string, addition: string) {
    const before = await this.authorSnapshot(taskId);
    const rejected = before.filter(slot => slot.questionId === questionId);
    expect(rejected).toHaveLength(1);
    await this.openTask(projectName, taskId, '出题');
    // 题位行没有原题ID属性；接口先锁定唯一原题，界面按唯一驳回状态消歧。
    const row = this.page.locator('[data-question-row]').filter({ hasText: '驳回待修改' });
    await expect(row).toHaveCount(1);
    await row.click();
    const editor = this.page.locator('[data-confidential-target-name="题目编辑"]');
    const stem = editor.locator('.question-label').filter({ hasText: /^题干$/ })
      .locator('..').locator('[contenteditable="true"]');
    await expect(stem).toHaveCount(1);
    await stem.click();
    await stem.press('ControlOrMeta+End');
    await this.page.keyboard.insertText(` ${addition}`);
    await expect(stem).toContainText(addition);
    await test.info().attach('rework-author-real-edit', { contentType: 'image/png',
      body: await this.page.screenshot({ fullPage: true }) });
    const saved = this.page.waitForResponse(response => response.request().method() === 'PUT'
      && new URL(response.url()).pathname.endsWith('/question-creation/workspace/slots')
      && response.request().postDataJSON()?.mode === 'CONFIRM');
    await this.page.getByRole('button', { name: '确认并继续', exact: true }).click();
    const response = await saved;
    const sent = parseJson<{ taskId: string; slots: Array<{ slotId: string; draftPayload: SingleChoiceQuestion }> }>(response.request().postData()!);
    expect(sent.taskId).toBe(taskId);
    expect(sent.slots).toHaveLength(1);
    expect(sent.slots[0].slotId).toBe(rejected[0].slotId);
    expect(sent.slots[0].draftPayload.question).toContain(addition);
    const workspace = await businessResponse<{ slots: ReworkSlot[] }>(response);
    const revised = workspace.slots.find(slot => slot.slotId === rejected[0].slotId)!;
    expect(revised).toBeTruthy();
    expect(revised.questionId, '真实返工必须保留原题ID').toBe(questionId);
    expect(revised.version).toBeGreaterThan(rejected[0].version);
    expect(revised.confirmed).toBe(true);
    expect(revised.draftPayload!.question).not.toBe(rejected[0].draftPayload!.question);
    expect(revised.draftPayload!.question).toContain(addition);
    expect(revised.draftPayload!.subQuestions).toEqual(rejected[0].draftPayload!.subQuestions);
    expect(revised.draftPayload!.answer).toEqual(rejected[0].draftPayload!.answer);
    const submitted = responseFor(this.page, 'POST', '/question-creation/workspace/submit');
    await this.page.getByRole('button', { name: '提交任务', exact: true }).click();
    const proceed = this.page.getByRole('button', { name: '继续提交', exact: true });
    const confirm = this.page.getByRole('button', { name: '确认提交', exact: true });
    await expect(proceed.or(confirm)).toBeVisible();
    await (await proceed.isVisible() ? proceed : confirm).click();
    expect((await businessResponse<{ submitted: boolean }>(await submitted)).submitted).toBe(true);
    return { before, revised, after: await this.authorSnapshot(taskId) };
  }
}
