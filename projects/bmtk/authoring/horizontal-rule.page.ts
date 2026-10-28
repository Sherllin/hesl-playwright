import { expect, test, type Page } from '@playwright/test';
import { businessResponse, parseJson, responseFor } from '../support/api';
import { TaskPage } from '../support/task.page';
import { focusEditorEnd } from './editor-caret';
import type { RuleSample } from '../paper-make/horizontal-rule.assertions';

interface Question { id: string; question: string; answer: string; questionType: number; questionTypeId: string }
interface Workspace { slots: Array<{ slotId: string; questionId: string; confirmed: boolean; draftPayload: Question }> }

export class HorizontalRuleAuthoringPage {
  constructor(private readonly page: Page) { }

  private stem() {
    return this.page.locator('[data-confidential-target-name="题目编辑"]')
      .locator('.question-label').filter({ hasText: /^题干$/ }).locator('..').locator('[contenteditable="true"]');
  }

  private async expectContent(sample: RuleSample, phase: string) {
    const stem = this.stem();
    await expect(stem).toContainText(sample.before);
    await expect(stem).toContainText(sample.bold);
    const rule = stem.getByRole('separator');
    await expect(rule).toHaveCount(1);
    await expect(rule).toBeVisible();
    const conclusion = stem.getByText(sample.bold, { exact: true });
    await expect(conclusion).toHaveCount(1);
    const weight = await conclusion.evaluate(element => getComputedStyle(element).fontWeight);
    expect(Number(weight), '编辑器实验结论必须实际加粗').toBeGreaterThanOrEqual(600);
    const before = await stem.getByText(sample.before, { exact: true }).boundingBox();
    const line = await rule.boundingBox();
    const after = await conclusion.boundingBox();
    expect(before).not.toBeNull();
    expect(line).not.toBeNull();
    expect(after).not.toBeNull();
    expect(line!.width).toBeGreaterThan(100);
    expect(line!.y).toBeGreaterThanOrEqual(before!.y + before!.height - 2);
    expect(line!.y + line!.height).toBeLessThanOrEqual(after!.y + 2);
    await test.info().attach(`horizontal-rule-editor-${phase}`, {
      body: await this.page.screenshot({ fullPage: true }), contentType: 'image/png',
    });
    await test.info().attach(`horizontal-rule-computed-${phase}`, {
      body: JSON.stringify({ before, line, after, weight }), contentType: 'application/json',
    });
  }

  private expectPayload(payload: Question, sample: RuleSample) {
    expect(payload.question).toContain(sample.before);
    expect(payload.question).toContain(sample.bold);
    expect(payload.question).toMatch(/<hr\b/i);
    expect(payload.answer).toContain(sample.answer);
  }

  async confirmAndSubmit(projectName: string, sample: RuleSample): Promise<Question> {
    const allocation = this.page.getByRole('dialog').filter({ hasText: '设置题目分配' });
    await expect(allocation).toBeVisible({ timeout: 90_000 });
    await allocation.getByRole('button', { name: '添加题型' }).click();
    const selection = allocation.locator('.ant-select-selection-item');
    await expect(selection).toHaveCount(1);
    if ((await selection.innerText()).trim() !== '简答题') {
      await selection.click();
      await this.page.locator('.ant-select-dropdown:visible').getByText('简答题', { exact: true }).click();
    }
    await expect(selection).toHaveText('简答题');
    await allocation.locator('.ant-input-number-input').fill('1');
    const planned = responseFor(this.page, 'PUT', '/question-creation/workspace/plan');
    await allocation.getByRole('button', { name: /^确\s*定$/ }).click();
    await businessResponse(await planned);
    await expect(allocation).toBeHidden();
    const stem = this.stem();
    await expect(stem).toHaveCount(1);
    await stem.click();
    await this.page.keyboard.insertText(sample.before);
    await focusEditorEnd(stem);
    const editor = this.page.locator('[data-confidential-target-name="题目编辑"]');
    await editor.getByRole('button', { name: 'Insert specialized editor node', exact: true }).click();
    await this.page.getByRole('button').filter({ has: this.page.getByText('水平分割线', { exact: true }) }).click();
    await expect(stem.getByRole('separator')).toHaveCount(1);
    // 明确点击横线后的新段落，避免工具栏焦点残留使结论写入错误位置。
    const afterRule = stem.locator(':scope > hr + p');
    await expect(afterRule).toHaveCount(1);
    await afterRule.click();
    await editor.getByRole('button', { name: /^Format text as bold\./ }).click();
    await this.page.keyboard.insertText(sample.bold);
    const answer = editor.locator('.question-label').filter({ hasText: /^答案$/ }).locator('..');
    await answer.locator('[data-confidential-content="readonly"]').click();
    await answer.locator('[contenteditable="true"]').click();
    await this.page.keyboard.insertText(sample.answer);
    await this.expectContent(sample, 'initial');
    await this.page.getByTestId('task-workbench-header').getByRole('button').filter({
      has: this.page.getByText(/^返\s*回$/),
    }).click();
    await this.page.waitForURL(url => url.pathname === '/project/task');
    const reopened = responseFor(this.page, 'GET', '/question-creation/workspace');
    await new TaskPage(this.page).openNodeTask(projectName, /去出题|继续出题/);
    const workspace = await businessResponse<Workspace>(await reopened);
    expect(workspace.slots).toHaveLength(1);
    const original = workspace.slots[0];
    this.expectPayload(original.draftPayload, sample);
    await this.expectContent(sample, 'reopened');
    const refreshed = responseFor(this.page, 'GET', '/question-creation/workspace');
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    const reload = await businessResponse<Workspace>(await refreshed);
    expect(reload.slots).toHaveLength(1);
    expect(reload.slots[0].slotId).toBe(original.slotId);
    expect(reload.slots[0].draftPayload.question).toBe(original.draftPayload.question);
    this.expectPayload(reload.slots[0].draftPayload, sample);
    await this.expectContent(sample, 'refreshed');
    const saved = this.page.waitForResponse(response => response.request().method() === 'PUT'
      && new URL(response.url()).pathname.endsWith('/question-creation/workspace/slots')
      && response.request().postDataJSON()?.mode === 'CONFIRM');
    await this.page.getByRole('button', { name: '确认并继续', exact: true }).click();
    const response = await saved;
    const data = await businessResponse<Workspace>(response);
    const sent = parseJson<{ slots: Array<{ slotId: string }> }>(response.request().postData()!).slots;
    expect(sent).toHaveLength(1);
    const slot = data.slots.find(item => item.slotId === sent[0].slotId)!;
    expect(slot?.confirmed).toBe(true);
    expect(slot.slotId).toBe(original.slotId);
    expect(slot.questionId).toMatch(/^\d+$/);
    expect(typeof slot.questionId).toBe('string');
    expect(slot.draftPayload.question).toBe(original.draftPayload.question);
    this.expectPayload(slot.draftPayload, sample);
    const submitted = responseFor(this.page, 'POST', '/question-creation/workspace/submit');
    await this.page.getByRole('button', { name: '提交任务', exact: true }).click();
    const proceed = this.page.getByRole('button', { name: '继续提交', exact: true });
    const confirm = this.page.getByRole('button', { name: '确认提交', exact: true });
    await expect(proceed.or(confirm)).toBeVisible();
    await (await proceed.isVisible() ? proceed : confirm).click();
    expect((await businessResponse<{ submitted: boolean }>(await submitted)).submitted).toBe(true);
    await this.page.waitForURL(url => url.pathname === '/project/task');
    return { ...slot.draftPayload, id: slot.questionId };
  }
}
