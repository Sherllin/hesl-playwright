import { expect, type Page } from '@playwright/test';
import { businessResponse, responseFor } from '../support/api';

export class QuestionReviewPage {
  constructor(private readonly page: Page) { }

  async approveCurrentQuestion(questionId: string) {
    const content = this.page.getByTestId('review-content')
      .locator('[data-confidential-content="readonly"][data-confidential-target-name="审题题目"]');
    await expect(content).toHaveAttribute('data-confidential-target-id', questionId);
    const approve = this.page.getByTestId('review-action-bar').getByRole('button', { name: '通过', exact: true });
    await expect(approve).toBeEnabled({ timeout: 90_000 });
    const approved = responseFor(this.page, 'POST', '/question-review/approve');
    await approve.click();
    await businessResponse(await approved);
  }

  async submitTask() {
    const originalUrl = this.page.url();
    const taskId = new URL(originalUrl).searchParams.get('taskId');
    expect(taskId).toBeTruthy();
    const submit = this.page.getByRole('button', { name: '提交任务', exact: true });
    await expect(submit).toBeEnabled();
    await submit.click();
    const proceed = this.page.getByRole('dialog').filter({ hasText: /AI检查|仍有.*问题待解决/ })
      .getByRole('button', { name: '继续提交', exact: true });
    const confirm = this.page.getByRole('button', { name: '确认提交', exact: true });
    await expect(proceed.or(confirm)).toBeVisible();
    const submitted = responseFor(this.page, 'POST', '/question-review/submit');
    await (await proceed.isVisible() ? proceed : confirm).click();
    const result = await businessResponse<{ submittedCount: number }>(await submitted);
    expect(result.submittedCount).toBeGreaterThanOrEqual(1);
    const refreshed = this.page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/question-review/question-tasks'));
    await this.page.goto(originalUrl, { waitUntil: 'domcontentloaded' });
    const state = await businessResponse<{ taskId: string; taskStatus: number; currentBatchSubmitted: boolean; confidentialContentHidden: boolean }>(await refreshed);
    expect(state.taskId).toBe(taskId);
    expect(Number(state.taskStatus), '单轮审题提交后任务必须完成').toBe(2);
    expect(state.currentBatchSubmitted).toBe(true);
    expect(state.confidentialContentHidden).toBe(true);
  }
}
