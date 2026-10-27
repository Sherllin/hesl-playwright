import { expect, type Page } from '@playwright/test';
import { businessResponse, parseJson, responseFor } from '../support/api';
import { sectionSamples, type SectionQuestion, type SectionType } from '../compose/custom-sections.assertions';
import { selectAllocationQuestionType } from './allocation-question-type';

interface Slot { slotId: string; questionId: string; questionTypeId: string; questionTypeName: string; confirmed: boolean; draftPayload: SectionQuestion }
export class CustomSectionsAuthoringPage {
  constructor(private readonly page: Page) { }

  async confirmAndSubmit(types: readonly SectionType[]): Promise<SectionQuestion[]> {
    const allocation = this.page.getByRole('dialog').filter({ hasText: '设置题目分配' });
    await expect(allocation).toBeVisible({ timeout: 90_000 });
    for (const type of types) {
      await allocation.getByRole('button', { name: '添加题型', exact: true }).click();
      // 操作刚新增的最后一行，按本次配置顺序分配四种题型。
      const selection = allocation.locator('.ant-select-selection-item').last();
      await selectAllocationQuestionType(this.page, selection, type.name);
      await expect(selection).toHaveText(type.name);
      await allocation.locator('.ant-input-number-input').last().fill(String(type.count));
    }
    const planned = responseFor(this.page, 'PUT', '/question-creation/workspace/plan');
    await allocation.getByRole('button', { name: /^确\s*定$/ }).click();
    const plan = await businessResponse<{ slots: Slot[] }>(await planned);
    await expect(allocation).toBeHidden();
    expect(plan.slots).toHaveLength(26);
    await expect(this.page.locator('[data-question-row]')).toHaveCount(26);
    const samples = sectionSamples();
    const counters = new Map<string, number>();
    const confirmed: SectionQuestion[] = [];
    // 采用真实计划返回的题位顺序，不假设服务端按题型ID或名称排序。
    for (const plannedSlot of plan.slots) {
      const type = types.find(type => type.id === plannedSlot.questionTypeId);
      expect(type, '计划必须使用本轮项目题库的独立题型').toBeTruthy();
      const index = counters.get(type!.id) ?? 0;
      const sample = samples.filter(sample => sample.typeName === type!.name)[index];
      expect(sample, '本题型题位数量不能超过预期').toBeTruthy();
      counters.set(type!.id, index + 1);
      const editor = this.page.locator('[data-confidential-target-name="题目编辑"]');
      const stem = editor.locator('.question-label').filter({ hasText: /^题干$/ }).locator('..').locator('[contenteditable="true"]');
      await expect.poll(async () => (await stem.innerText()).replace(/\u200B/g, '').trim(),
        { timeout: 90_000, message: '确认上一题后应进入下个空白题位' }).toBe('');
      await stem.click();
      await this.page.keyboard.insertText(sample.stem);
      await expect(stem).toContainText(sample.stem);
      const answer = editor.locator('.question-label').filter({ hasText: /^答案$/ }).locator('..');
      await answer.locator('[data-confidential-content="readonly"]').click();
      const content = answer.locator('[contenteditable="true"]');
      await content.click();
      await this.page.keyboard.insertText(sample.answer);
      await expect(content).toHaveText(sample.answer);
      const saved = this.page.waitForResponse(response => response.request().method() === 'PUT'
        && new URL(response.url()).pathname.endsWith('/question-creation/workspace/slots')
        && response.request().postDataJSON()?.mode === 'CONFIRM');
      await this.page.getByRole('button', { name: '确认并继续', exact: true }).click();
      const response = await saved;
      const sent = parseJson<{ slots: Array<{ slotId: string }> }>(response.request().postData()!);
      expect(sent.slots.map(slot => slot.slotId), '实际编辑题位与计划顺序一致').toEqual([plannedSlot.slotId]);
      const result = await businessResponse<{ slots: Slot[] }>(response);
      const slot = result.slots.find(slot => slot.slotId === plannedSlot.slotId);
      expect(slot?.confirmed, '原题必须真正通过确认').toBe(true);
      expect(typeof slot!.questionId).toBe('string');
      expect(slot!.draftPayload.questionTypeId).toBe(type!.id);
      expect(slot!.draftPayload.questionTypeName).toBe(type!.name);
      expect(slot!.draftPayload.questionType).toBe(5);
      expect(slot!.draftPayload.question).toContain(sample.stem);
      expect(slot!.draftPayload.answer).toContain(sample.answer);
      confirmed.push({ ...slot!.draftPayload, id: slot!.questionId });
    }
    for (const type of types) expect(counters.get(type.id)).toBe(type.count);
    expect(new Set(confirmed.map(question => question.id)).size).toBe(26);
    await this.page.getByRole('button', { name: '提交任务', exact: true }).click();
    const proceed = this.page.getByRole('button', { name: '继续提交', exact: true });
    const confirm = this.page.getByRole('button', { name: '确认提交', exact: true });
    await expect(proceed.or(confirm)).toBeVisible();
    const submitted = responseFor(this.page, 'POST', '/question-creation/workspace/submit');
    await (await proceed.isVisible() ? proceed : confirm).click();
    expect((await businessResponse<{ submitted: boolean }>(await submitted)).submitted).toBe(true);
    await this.page.waitForURL(url => url.pathname === '/project/task');
    return confirmed;
  }
}
