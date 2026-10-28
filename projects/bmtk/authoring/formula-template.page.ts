import { expect, type Page, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { businessResponse, parseJson, readApi, responseFor } from '../support/api';
import { assertFormulaDraftSlots, assertFormulaLabels, assertStoredFormulaQuestions, formulaSource, type FormulaSample, type FormulaDraftSlot } from '../paper-make/template-import/formula-options.assertions';
import { fillFormulaTemplate, readFormulaDocx } from '../paper-make/template-import/formula-options.tools';
import type { SingleChoiceQuestion } from './single-choice.page';

type Slot = FormulaDraftSlot;
interface Workspace { slots: Slot[]; resolvedActiveSlotId: string }
const snapshot = (workspace: Workspace) => workspace.slots.map(slot => ({ slotId: slot.slotId,
  questionId: slot.questionId, confirmed: slot.confirmed, draftPayload: slot.draftPayload ? {
    question: formulaSource(slot.draftPayload.question), questionType: slot.draftPayload.questionType,
    subQuestions: slot.draftPayload.subQuestions.map(option => ({ ...option, question: formulaSource(option.question) })),
  } : null }));

/** 保留原任务工作区入口，不能用历史试卷导入或手工粘贴公式替代。 */
export class FormulaTemplateAuthoringPage {
  constructor(private readonly page: Page) { }

  async confirmAndSubmit(samples: FormulaSample[], python: string, token: string, info: TestInfo): Promise<SingleChoiceQuestion[]> {
    expect(samples).toHaveLength(6);
    const allocation = this.page.getByRole('dialog').filter({ hasText: '设置题目分配' });
    await expect(allocation).toBeVisible({ timeout: 90_000 });
    await allocation.getByRole('button', { name: '添加题型' }).click();
    const selection = allocation.locator('.ant-select-selection-item');
    await expect(selection).toHaveCount(1);
    if ((await selection.innerText()).trim() !== '单选题') {
      await selection.click();
      await this.page.locator('.ant-select-dropdown:visible').getByText('单选题', { exact: true }).click();
    }
    await allocation.locator('.ant-input-number-input').fill('6');
    const planned = responseFor(this.page, 'PUT', '/question-creation/workspace/plan');
    await allocation.getByRole('button', { name: /^确\s*定$/ }).click();
    await businessResponse(await planned);
    await expect(allocation).toBeHidden();
    const taskId = new URL(this.page.url()).searchParams.get('taskId');
    expect(taskId).toMatch(/^\d+$/);
    const read = () => readApi<Workspace>(this.page.request, token, `/qrProject/question-creation/workspace?taskId=${taskId}`);
    const template = await this.page.request.get('/api/qrepo/download?filename=question-template-word.docx', { headers: { Authorization: token } });
    expect(template.ok()).toBe(true);
    const original = info.outputPath('official-word-template.docx');
    await writeFile(original, await template.body());
    const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    await info.attach('official-word-template', { path: original, contentType: mime });
    const parse = async (file: string, round: number) => {
      await this.page.getByRole('button', { name: '导入题目', exact: true }).click();
      const dialog = this.page.getByRole('dialog', { name: '导入题目', exact: true });
      await dialog.locator('input[type="file"]').setInputFiles(file);
      const parsed = responseFor(this.page, 'POST', '/workspace/parse-template');
      const checked = responseFor(this.page, 'POST', '/workspace/import-check');
      await dialog.getByRole('button', { name: '开始解析', exact: true }).click();
      const data = await businessResponse(await parsed);
      const dedup = await businessResponse<{ items: Array<{ state: string; blocked: boolean }> }>(await checked);
      await info.attach(`formula-round-${round}-parse`, { body: JSON.stringify({ data, dedup }), contentType: 'application/json' });
      expect(dedup.items).toHaveLength(3);
      expect(dedup.items.every(item => item.state === 'SUCCEEDED' && !item.blocked)).toBe(true);
      await expect(dialog.getByRole('button', { name: '确认导入', exact: true })).toBeEnabled();
      return dialog;
    };
    for (const round of [0, 1]) {
      const batch = samples.slice(round * 3, round * 3 + 3);
      const file = info.outputPath(`formula-round-${round + 1}.docx`);
      await fillFormulaTemplate(python, original, file, batch);
      const input = await readFormulaDocx(python, await readFile(file));
      assertFormulaLabels(input.text, batch, true, true);
      await info.attach(`formula-round-${round + 1}-actual-input`, { path: file, contentType: mime });
      const before = await read();
      expect(before.slots).toHaveLength(6);
      if (round === 0) {
        const cancelled = await parse(file, round + 1);
        await cancelled.getByRole('button', { name: '取消', exact: true }).click();
        expect(snapshot(await read()), '取消解析预览不能写入题位').toEqual(snapshot(before));
      }
      const dialog = await parse(file, round + 1);
      await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
      const confirmation = this.page.getByRole('dialog').filter({ hasText: '题目确认' });
      const imported = responseFor(this.page, 'PUT', '/workspace/import');
      await confirmation.getByRole('button', { name: '导入', exact: true }).click();
      const workspace = await businessResponse<Workspace>(await imported);
      await expect(dialog).toBeHidden();
      await info.attach(`formula-round-${round + 1}-workspace`, { body: JSON.stringify(workspace), contentType: 'application/json' });
      expect(workspace.slots).toHaveLength(6);
      assertFormulaDraftSlots(workspace.slots, samples.slice(0, (round + 1) * 3));
      for (const old of before.slots.filter(slot => slot.draftPayload?.question)) {
        const retained = workspace.slots.find(slot => slot.slotId === old.slotId);
        expect(retained, '第二轮必须保留第一轮题位身份').toBeTruthy();
        expect(snapshot({ slots: [retained!], resolvedActiveSlotId: '' }), '第二轮不能覆盖第一轮原题')
          .toEqual(snapshot({ slots: [old], resolvedActiveSlotId: '' }));
      }
    }
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    let workspace = await read();
    assertFormulaDraftSlots(workspace.slots, samples);
    let activeSlotId = workspace.resolvedActiveSlotId;
    const confirmed: SingleChoiceQuestion[] = [];
    for (let index = 0; index < samples.length; index++) {
      const active = workspace.slots.find(slot => slot.slotId === activeSlotId);
      expect(active?.draftPayload).toBeTruthy();
      const stem = this.page.locator('[data-confidential-target-name="题目编辑"]')
        .locator('.question-label').filter({ hasText: /^题干$/ }).locator('..').locator('[contenteditable="true"]');
      const sample = samples.find(sample => active!.draftPayload!.question.includes(sample.stem));
      expect(sample, '当前题位必须属于实际Word导入原题').toBeTruthy();
      await expect(stem).toContainText(sample!.stem, { timeout: 90_000 });
      const saved = this.page.waitForResponse(response => response.request().method() === 'PUT' &&
        new URL(response.url()).pathname.endsWith('/workspace/slots') && response.request().postDataJSON()?.mode === 'CONFIRM');
      await this.page.getByRole('button', { name: '确认并继续', exact: true }).click();
      const response = await saved;
      workspace = await businessResponse<Workspace>(response);
      const sent = parseJson<{ slots: Array<{ slotId: string }> }>(response.request().postData()!);
      expect(sent.slots).toHaveLength(1);
      expect(sent.slots[0].slotId).toBe(activeSlotId);
      const slot = workspace.slots.find(slot => slot.slotId === activeSlotId)!;
      expect(slot.confirmed).toBe(true);
      expect(slot.questionId, 'CONFIRM成功后必须返回正式题目ID').toMatch(/^\d+$/);
      const question = { ...slot.draftPayload!, id: slot.questionId } as SingleChoiceQuestion;
      assertStoredFormulaQuestions([question], [sample!]);
      confirmed.push(question);
      const current = workspace.slots.findIndex(slot => slot.slotId === activeSlotId);
      activeSlotId = [...workspace.slots.slice(current + 1), ...workspace.slots.slice(0, current)]
        .find(slot => !slot.confirmed)?.slotId ?? '';
    }
    assertStoredFormulaQuestions(confirmed, samples);
    await info.attach('formula-confirmed-source-questions', { body: JSON.stringify(confirmed), contentType: 'application/json' });
    const submitted = responseFor(this.page, 'POST', '/workspace/submit');
    await this.page.getByRole('button', { name: '提交任务', exact: true }).click();
    await this.page.getByRole('button', { name: /^(确认提交|继续提交)$/, exact: true }).click();
    expect((await businessResponse<{ submitted: boolean }>(await submitted)).submitted).toBe(true);
    await this.page.waitForURL(url => url.pathname === '/project/task');
    return confirmed;
  }
}
