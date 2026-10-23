import { expect, type Page } from '@playwright/test';
import { businessResponse, parseJson, responseFor } from '../support/api';
import type { MatchingSample, MatchingQuestion } from '../question-bank/matching';

export interface MatchingSubmission { questionId: string; payload: MatchingQuestion }

// 来源：原 matching-question.page.ts；只保留正常创建匹配题的能力。
export class MatchingAuthoringPage {
  constructor(private readonly page: Page) { }

  async confirmAndSubmit(sample: MatchingSample): Promise<MatchingSubmission> {
    await expect(this.page).toHaveURL(url => url.pathname === '/project/task/question');
    const allocation = this.page.locator('.ant-modal-content:visible').filter({ hasText: '设置题目分配' });
    await expect(allocation).toBeVisible({ timeout: 90_000 });
    await allocation.getByRole('button', { name: '添加题型' }).click();
    await allocation.locator('.ant-select-selection-item').click();
    await this.page.locator('.ant-select-dropdown:visible').getByText('匹配题', { exact: true }).click();
    await allocation.locator('.ant-input-number-input').fill('1');
    const plan = responseFor(this.page, 'PUT', '/question-creation/workspace/plan');
    await allocation.getByRole('button', { name: /确\s*定/, exact: true }).click();
    await businessResponse(await plan);
    await expect(allocation).toBeHidden();
    // 当前工作台没有 tabpanel；用题目编辑区域及匹配题特有的共享选项限定范围。
    const editor = this.page.locator('[data-confidential-target-name="题目编辑"]').filter({
      has: this.page.locator('.question-label').filter({ hasText: /^共享选项$/ }),
    });
    const stem = editor.locator('.question-label').filter({ hasText: /^题干$/ })
      .locator('..').locator('[contenteditable="true"]');
    await expect(stem).toHaveCount(1);
    await expect(stem).toBeEditable();
    await stem.pressSequentially(sample.stem);
    const shared = this.page.locator('.question-label').filter({ hasText: /^共享选项$/ }).locator('..');
    expect(sample.options).toHaveLength(4);
    for (const [i, content] of sample.options.entries()) {
      const option = shared.locator('div.flex.items-center.gap-2.pr-2').filter({
        has: this.page.getByRole('button', { name: `删除选项${'ABCD'[i]}`, exact: true }),
      });
      await expect(option).toHaveCount(1);
      await option.locator('[data-confidential-content="readonly"]').click();
      await option.locator('[contenteditable="true"]').pressSequentially(content);
    }
    for (const [i, answer] of sample.answers.entries()) {
      await this.page.getByRole('button', { name: '添加小题', exact: true }).click();
      const child = this.page.locator('.ant-collapse-item').filter({
        has: this.page.getByText(`第${i + 1}小题: 单选题`, { exact: true }),
      });
      await expect(child).toHaveCount(1);
      await child.locator('.question-label').filter({ hasText: /^题干$/ }).locator('..')
        .locator('[contenteditable="true"]').pressSequentially(sample.children[i]);
      await child.locator('.question-label').filter({ hasText: /^答案$/ }).locator('..')
        .locator('.cursor-pointer').filter({ hasText: new RegExp(`^${answer}$`) }).click();
    }
    const confirmed = this.page.waitForResponse(r => r.request().method() === 'PUT' &&
      new URL(r.url()).pathname.endsWith('/question-creation/workspace/slots') && r.request().postDataJSON()?.mode === 'CONFIRM');
    await this.page.getByRole('button', { name: '确认并继续', exact: true }).click();
    const response = await confirmed;
    const body = await businessResponse<{ slots: Array<{ slotId: string; questionId: string; confirmed: boolean; draftPayload: MatchingQuestion }> }>(response);
    const sent = parseJson<{ slots: Array<{ slotId: string }> }>(response.request().postData()!).slots[0];
    const slot = body.slots.find(s => s.slotId === sent.slotId);
    expect(slot, '响应必须包含本次确认的真实题位').toBeTruthy();
    expect(slot!.confirmed, '完整匹配题必须真正确认').toBe(true);
    expect(typeof slot!.questionId).toBe('string');
    const payload = slot!.draftPayload;
    expect(payload.questionType).toBe(43);
    expect(payload.question).toContain(sample.stem);
    expect(payload.options.map(o => o.question.replace(/<[^>]*>/g, ''))).toEqual(sample.options);
    expect(payload.subQuestions.map(q => q.answer)).toEqual(sample.answers);
    expect(payload.subQuestions.map(q => q.question.replace(/<[^>]*>|\u200B/g, '').trim())).toEqual(sample.children);
    const submitted = responseFor(this.page, 'POST', '/question-creation/workspace/submit');
    await this.page.getByRole('button', { name: '提交任务', exact: true }).click();
    const proceed = this.page.getByRole('button', { name: '继续提交', exact: true });
    const confirm = this.page.getByRole('button', { name: '确认提交', exact: true });
    await expect(proceed.or(confirm)).toBeVisible();
    await (await proceed.isVisible() ? proceed : confirm).click();
    expect((await businessResponse<{ submitted: boolean }>(await submitted)).submitted).toBe(true);
    await this.page.waitForURL(url => url.pathname === '/project/task');
    return { questionId: slot!.questionId, payload };
  }
}
