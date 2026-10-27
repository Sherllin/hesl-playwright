import { expect, test, type Page } from '@playwright/test';
import { businessResponse, parseJson, responseFor } from '../support/api';
import { TaskPage } from '../support/task.page';
import { focusEditorEnd } from './editor-caret';
import { insertColumnLayout } from './column-layout-toolbar';
import { assertEditorColumnBorder } from '../paper-make/column-border.assertions';
import type { ColumnSample } from '../paper-make/column-layout.assertions';

interface Question { id: string; question: string; answer: string; questionType: number; questionTypeId: string }
interface Workspace { slots: Array<{ slotId: string; questionId: string; confirmed: boolean; draftPayload: Question }> }

/** 1007416：用实际编辑工具插入列布局，返回保存、重进及刷新后再确认提交。 */
export class ColumnLayoutAuthoringPage {
  constructor(private readonly page: Page) { }

  async returnToTasks(): Promise<void> {
    await this.page.getByTestId('task-workbench-header').getByRole('button').filter({
      has: this.page.getByText(/^返\s*回$/),
    }).click();
    await this.page.waitForURL(url => url.pathname === '/project/task');
  }

  private stem() {
    return this.page.locator('[data-confidential-target-name="题目编辑"]')
      .locator('.question-label').filter({ hasText: /^题干$/ }).locator('..').locator('[contenteditable="true"]');
  }

  private async expectLayout(sample: ColumnSample, phase: string) {
    const stem = this.stem();
    await expect(stem).toContainText(sample.stem);
    const grid = stem.locator('.MyEditor__layoutContainer');
    await expect(grid).toHaveCount(1);
    const cells = grid.locator(':scope > .MyEditor__layoutItem');
    await expect(cells).toHaveCount(sample.columns.length);
    const boxes = [];
    const borders = [];
    for (const [index, column] of sample.columns.entries()) {
      // 列的左右顺序是本用例明确的业务预期。
      const cell = cells.nth(index);
      for (const text of [column.top, column.body, column.bottom]) await expect(cell).toContainText(text);
      boxes.push((await cell.boundingBox())!);
      const border = await cell.evaluate(element => {
        const style = getComputedStyle(element);
        return {
          top: { width: style.borderTopWidth, style: style.borderTopStyle, color: style.borderTopColor },
          right: { width: style.borderRightWidth, style: style.borderRightStyle, color: style.borderRightColor },
          bottom: { width: style.borderBottomWidth, style: style.borderBottomStyle, color: style.borderBottomColor },
          left: { width: style.borderLeftWidth, style: style.borderLeftStyle, color: style.borderLeftColor },
        };
      });
      borders.push(border);
    }
    await test.info().attach(`editor-column-computed-${phase}`, {
      body: JSON.stringify({ boxes, borders }), contentType: 'application/json',
    });
    for (const border of borders) assertEditorColumnBorder(border);
    expect(boxes.every(Boolean)).toBe(true);
    for (const [index, box] of boxes.entries()) {
      expect(Math.abs(box.y - boxes[0].y), '编辑器本身必须仍为并排布局').toBeLessThanOrEqual(1);
      if (index) expect(box.x).toBeGreaterThanOrEqual(boxes[index - 1].x + boxes[index - 1].width);
    }
    return { boxes, borders };
  }

  private expectPayload(payload: Question, sample: ColumnSample) {
    expect(payload.question).toContain(sample.stem);
    expect(payload.question).toContain('data-lexical-layout-container');
    expect(payload.question).toMatch(/grid-template-columns\s*:/);
    for (const column of sample.columns) for (const text of [column.top, column.body, column.bottom])
      expect(payload.question).toContain(text);
    expect(payload.answer).toContain(sample.answer);
  }

  async confirmAndSubmit(projectName: string, sample: ColumnSample): Promise<Question> {
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
    await this.page.keyboard.insertText(sample.stem);
    await focusEditorEnd(stem);
    const editor = this.page.locator('[data-confidential-target-name="题目编辑"]');
    await insertColumnLayout(this.page, editor, sample.columns.length);
    const cells = stem.locator('.MyEditor__layoutContainer > .MyEditor__layoutItem');
    await expect(cells).toHaveCount(sample.columns.length);
    for (const [index, column] of sample.columns.entries()) {
      await cells.nth(index).locator('p').click();
      for (const [line, text] of [column.top, column.body, column.bottom].entries()) {
        if (line) await this.page.keyboard.press('Enter');
        await this.page.keyboard.insertText(text);
      }
    }
    const answer = editor.locator('.question-label').filter({ hasText: /^答案$/ }).locator('..');
    await answer.locator('[data-confidential-content="readonly"]').click();
    await answer.locator('[contenteditable="true"]').click();
    await this.page.keyboard.insertText(sample.answer);
    await this.expectLayout(sample, 'initial');
    // 使用产品返回按钮触发保存队列完成；不以固定等待猜测自动保存结束。
    await this.returnToTasks();
    const reopened = responseFor(this.page, 'GET', '/question-creation/workspace');
    await new TaskPage(this.page).openNodeTask(projectName, /去出题|继续出题/);
    const workspace = await businessResponse<Workspace>(await reopened);
    expect(workspace.slots).toHaveLength(1);
    this.expectPayload(workspace.slots[0].draftPayload, sample);
    await this.expectLayout(sample, 'reopened');
    const refreshed = responseFor(this.page, 'GET', '/question-creation/workspace');
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    const reload = await businessResponse<Workspace>(await refreshed);
    expect(reload.slots).toHaveLength(1);
    expect(reload.slots[0].slotId).toBe(workspace.slots[0].slotId);
    this.expectPayload(reload.slots[0].draftPayload, sample);
    const geometry = await this.expectLayout(sample, 'refreshed');
    await this.page.screenshot({ path: test.info().outputPath('editor-columns.png'), fullPage: true });
    const saved = this.page.waitForResponse(response => response.request().method() === 'PUT'
      && new URL(response.url()).pathname.endsWith('/question-creation/workspace/slots')
      && response.request().postDataJSON()?.mode === 'CONFIRM');
    await this.page.getByRole('button', { name: '确认并继续', exact: true }).click();
    const response = await saved;
    const data = await businessResponse<Workspace>(response);
    const sent = parseJson<{ slots: Array<{ slotId: string }> }>(response.request().postData()!).slots;
    expect(sent).toHaveLength(1);
    const slot = data.slots.find(s => s.slotId === sent[0].slotId)!;
    expect(slot?.confirmed).toBe(true);
    expect(slot.slotId).toBe(workspace.slots[0].slotId);
    expect(slot.questionId).toMatch(/^\d+$/);
    expect(typeof slot.questionId).toBe('string');
    this.expectPayload(slot.draftPayload, sample);
    await test.info().attach('editor-column-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' });
    await test.info().attach('editor-columns', { path: test.info().outputPath('editor-columns.png'), contentType: 'image/png' });
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
