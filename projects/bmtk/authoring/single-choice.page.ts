import { expect, type Page } from '@playwright/test';
import { businessResponse, parseJson, responseFor } from '../support/api';

export interface SingleChoiceQuestion {
  id: string;
  question: string;
  questionType: number;
  questionTypeId: string;
  answer?: string | null;
  subQuestions: Array<{ id: string; question: string; answer: string }>;
}
export interface SingleChoiceSample { stem: string; options: string[]; answer: string }

// 从原单选出题链提取；只生成本次并发回归所需的两题，不依赖试卷语料或PDF工具。
export class SingleChoiceAuthoringPage {
  constructor(private readonly page: Page) { }

  async confirmAndSubmit(samples: readonly SingleChoiceSample[]): Promise<SingleChoiceQuestion[]> {
    const allocation = this.page.getByRole('dialog').filter({ hasText: '设置题目分配' });
    await expect(allocation).toBeVisible({ timeout: 90_000 });
    await allocation.getByRole('button', { name: '添加题型' }).click();
    const selection = allocation.locator('.ant-select-selection-item');
    await expect(selection).toHaveCount(1);
    if ((await selection.innerText()).trim() !== '单选题') {
      await selection.click();
      await this.page.locator('.ant-select-dropdown:visible').getByText('单选题', { exact: true }).click();
    }
    await expect(selection).toHaveText('单选题');
    await allocation.locator('.ant-input-number-input').fill(String(samples.length));
    const planned = responseFor(this.page, 'PUT', '/question-creation/workspace/plan');
    await allocation.getByRole('button', { name: /^确\s*定$/ }).click();
    await businessResponse(await planned);
    await expect(allocation).toBeHidden();
    await expect(this.page.locator('[data-question-row]')).toHaveCount(samples.length);
    const confirmed: SingleChoiceQuestion[] = [];
    for (const sample of samples) {
      const editor = this.page.locator('[data-confidential-target-name="题目编辑"]');
      const stem = editor.locator('.question-label').filter({ hasText: /^题干$/ })
        .locator('..').locator('[contenteditable="true"]');
      await expect(stem).toHaveCount(1);
      await expect.poll(async () => (await stem.innerText()).replace(/\u200B/g, '').trim(),
        { timeout: 90_000, message: '确认上一题后必须进入空白的新题位' }).toBe('');
      await stem.click();
      await this.page.keyboard.insertText(sample.stem);
      await expect(stem).toContainText(sample.stem);
      expect(sample.options).toHaveLength(4);
      for (const [index, text] of sample.options.entries()) {
        const option = editor.locator('.question-box').filter({
          has: this.page.locator(':scope > div').filter({ hasText: new RegExp(`^${'ABCD'[index]}$`) }),
        });
        await expect(option).toHaveCount(1);
        await option.locator('[data-confidential-content="readonly"] > .question-box').click();
        const content = option.locator('[contenteditable="true"]');
        await content.click();
        await this.page.keyboard.insertText(text);
        await expect(content).toContainText(text);
      }
      const answer = editor.locator('.question-label').filter({ hasText: /^答案$/ }).locator('..');
      await answer.locator('.cursor-pointer').filter({ hasText: new RegExp(`^${sample.answer}$`) }).click();
      const saved = this.page.waitForResponse(r => r.request().method() === 'PUT' &&
        new URL(r.url()).pathname.endsWith('/question-creation/workspace/slots') && r.request().postDataJSON()?.mode === 'CONFIRM');
      await this.page.getByRole('button', { name: '确认并继续', exact: true }).click();
      const response = await saved;
      const data = await businessResponse<{ slots: Array<{
        slotId: string; questionId: string; confirmed: boolean; draftPayload: SingleChoiceQuestion;
      }> }>(response);
      const sent = parseJson<{ slots: Array<{ slotId: string }> }>(response.request().postData()!).slots;
      expect(sent).toHaveLength(1);
      const slot = data.slots.find(s => s.slotId === sent[0].slotId);
      expect(slot, '确认响应必须包含本次题位').toBeTruthy();
      expect(slot!.confirmed).toBe(true);
      expect(typeof slot!.questionId).toBe('string');
      expect(slot!.draftPayload.question).toContain(sample.stem);
      expect(slot!.draftPayload.subQuestions.map(o => o.question.replace(/<[^>]*>|\u200B/g, '').trim()))
        .toEqual(sample.options);
      const expectedIndex = 'ABCD'.indexOf(sample.answer);
      expect(expectedIndex).toBeGreaterThanOrEqual(0);
      // 单选题答案存于选项标记；以真实确认回执记录后续入库对照。
      const options = slot!.draftPayload.subQuestions;
      expect(options.filter(o => o.answer === 'true')).toHaveLength(1);
      expect(options[expectedIndex].answer).toBe('true');
      confirmed.push({ ...slot!.draftPayload, id: slot!.questionId });
    }
    expect(new Set(confirmed.map(q => q.id)).size).toBe(samples.length);
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
