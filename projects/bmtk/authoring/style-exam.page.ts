import { expect, type Page } from '@playwright/test';
import { businessResponse, parseJson, responseFor } from '../support/api';
import type { ExamQuestion } from '../paper-make/style-exam';
import { focusEditorEnd } from './editor-caret';

export interface ConfirmedExamQuestion { id: string; question: string }

/** 仅提取 REMOTE-19.3 使用的单选/简答正常出题能力。 */
export class StyleExamAuthoringPage {
  constructor(private readonly page: Page) { }

  async confirmAndSubmit(questions: readonly ExamQuestion[]): Promise<ConfirmedExamQuestion[]> {
    const allocation = this.page.getByRole('dialog').filter({ hasText: '设置题目分配' });
    await expect(allocation).toBeVisible({ timeout: 90_000 });
    for (const [type, count] of [['单选题', questions.filter(q => q.options).length],
      ['简答题', questions.filter(q => !q.options).length]] as const) {
      await allocation.getByRole('button', { name: '添加题型' }).click();
      // 添加的最后一行就是本次新增的题型配置行，顺序为明确业务操作。
      const selection = allocation.locator('.ant-select-selection-item').last();
      if ((await selection.innerText()).trim() !== type) {
        await selection.click();
        await this.page.locator('.ant-select-dropdown:visible').getByText(type, { exact: true }).click();
      }
      await expect(selection).toHaveText(type);
      await allocation.locator('.ant-input-number-input').last().fill(String(count));
    }
    const plan = responseFor(this.page, 'PUT', '/question-creation/workspace/plan');
    await allocation.getByRole('button', { name: /^确\s*定$/ }).click();
    await businessResponse(await plan);
    await expect(allocation).toBeHidden();
    await expect(this.page.locator('[data-question-row]')).toHaveCount(questions.length);
    const confirmed: ConfirmedExamQuestion[] = [];
    for (const [index, question] of questions.entries()) {
      const editor = this.page.locator('[data-confidential-target-name="题目编辑"]');
      const stem = editor.locator('.question-label').filter({ hasText: /^题干$/ })
        .locator('..').locator('[contenteditable="true"]');
      await expect(stem).toHaveCount(1);
      await expect.poll(async () => (await stem.innerText()).replace(/\u200B/g, '').trim(),
        { timeout: 90_000, message: '确认上一题后必须进入空白的新题位' }).toBe('');
      await stem.click();
      await this.page.keyboard.insertText(question.stem);
      await expect(stem).toContainText(question.stem);
      if (question.formula) {
        await focusEditorEnd(stem);
        await editor.getByRole('button').and(editor.getByTitle('公式', { exact: true })).click();
        const dialog = this.page.getByRole('dialog', { name: '公式', exact: true });
        await dialog.getByRole('textbox').fill(question.formula);
        await expect(dialog.locator('mjx-container svg')).toBeVisible();
        await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
        await expect(dialog).toBeHidden();
      }
      if (question.image) {
        await focusEditorEnd(stem);
        await editor.getByRole('button').and(editor.getByTitle('图片', { exact: true })).click();
        const dialog = this.page.getByRole('dialog', { name: '图片', exact: true });
        await dialog.getByRole('button', { name: '文件', exact: true }).click();
        await dialog.locator('input[type="file"]').setInputFiles(question.image);
        const confirm = dialog.getByRole('button', { name: /^确\s*定$/ });
        await expect(confirm).toBeEnabled();
        await confirm.click();
        await expect(dialog).toBeHidden();
      }
      const answer = editor.locator('.question-label').filter({ hasText: /^答案$/ }).locator('..');
      if (question.options) {
        for (const [optionIndex, text] of question.options.entries()) {
          const letter = 'ABCD'[optionIndex];
          const option = editor.locator('.question-box').filter({
            has: this.page.locator(':scope > div').filter({ hasText: new RegExp(`^${letter}$`) }),
          });
          await expect(option).toHaveCount(1);
          await option.locator('[data-confidential-content="readonly"] > .question-box').click();
          const content = option.locator('[contenteditable="true"]');
          await content.click();
          await this.page.keyboard.insertText(text);
          await expect(content).toContainText(text);
        }
        await answer.locator('.cursor-pointer').filter({ hasText: new RegExp(`^${question.answer}$`) }).click();
      } else {
        const readonly = answer.locator('[data-confidential-content="readonly"]');
        await readonly.click();
        const content = answer.locator('[contenteditable="true"]');
        await content.click();
        await this.page.keyboard.insertText(question.answer);
        await expect(content).toHaveText(question.answer);
      }
      const saved = this.page.waitForResponse(r => r.request().method() === 'PUT' &&
        new URL(r.url()).pathname.endsWith('/question-creation/workspace/slots') && r.request().postDataJSON()?.mode === 'CONFIRM');
      await this.page.getByRole('button', { name: '确认并继续', exact: true }).click();
      const response = await saved;
      const data = await businessResponse<{ slots: Array<{
        slotId: string; questionId: string; confirmed: boolean; draftPayload: { question: string };
      }> }>(response);
      const sent = parseJson<{ slots: Array<{ slotId: string }> }>(response.request().postData()!).slots;
      expect(sent).toHaveLength(1);
      const slot = data.slots.find(s => s.slotId === sent[0].slotId);
      expect(slot?.confirmed, `第${index + 1}题必须真正确认`).toBe(true);
      expect(typeof slot!.questionId).toBe('string');
      expect(slot!.draftPayload.question).toContain(question.stem);
      if (question.formula) expect(slot!.draftPayload.question).toContain(question.formula);
      if (question.image) expect(slot!.draftPayload.question).toMatch(/<img\b/);
      confirmed.push({ id: slot!.questionId, question: slot!.draftPayload.question });
    }
    const submitted = responseFor(this.page, 'POST', '/question-creation/workspace/submit');
    await this.page.getByRole('button', { name: '提交任务', exact: true }).click();
    const proceed = this.page.getByRole('button', { name: '继续提交', exact: true });
    const confirm = this.page.getByRole('button', { name: '确认提交', exact: true });
    await expect(proceed.or(confirm)).toBeVisible();
    await (await proceed.isVisible() ? proceed : confirm).click();
    expect((await businessResponse<{ submitted: boolean }>(await submitted)).submitted).toBe(true);
    await this.page.waitForURL(url => url.pathname === '/project/task');
    return confirmed;
  }
}
