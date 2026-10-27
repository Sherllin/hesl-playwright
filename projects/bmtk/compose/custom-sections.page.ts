import { expect, type Page } from '@playwright/test';
import { businessResponse, responseFor } from '../support/api';
import type { SectionQuestion, SectionType } from './custom-sections.assertions';

export type SectionSelection = 'continuous' | 'separate';
export class CustomSectionsComposePage {
  constructor(private readonly page: Page) { }

  async addQuestions(sources: readonly SectionQuestion[], types: readonly SectionType[], selection: SectionSelection) {
    const groups = types.map(type => sources.filter(source => source.questionTypeId === type.id));
    const batches = selection === 'continuous' ? [groups.flat()] : groups;
    for (const batch of batches) {
      const loaded = responseFor(this.page, 'POST', '/qrQuestionEntity/getByCatalogForProject');
      await this.page.getByText('添加题目', { exact: true }).click();
      await businessResponse(await loaded);
      const drawer = this.page.getByRole('dialog').filter({ hasText: '添加题目' });
      await expect(drawer).toBeVisible();
      const expanded = responseFor(this.page, 'POST', '/qrQuestionEntity/getByCatalogForProject');
      await drawer.getByTitle('10 条/页', { exact: true }).click();
      await this.page.locator('.ant-select-dropdown:visible').getByTitle('50 条/页', { exact: true }).click();
      const available = await businessResponse<{ records: SectionQuestion[] }>(await expanded);
      expect(available.records.map(question => question.id).sort(), '本轮26道原题在受派组卷任务中可选')
        .toEqual(sources.map(source => source.id).sort());
      for (const source of sources) {
        const actual = available.records.find(question => question.id === source.id)!;
        expect(actual.questionTypeId).toBe(source.questionTypeId);
        expect(actual.questionTypeName).toBe(source.questionTypeName);
        expect(actual.question).toBe(source.question);
        expect(actual.answer).toBe(source.answer);
      }
      for (const source of batch) {
        const card = drawer.locator(`[data-confidential-target-type="QUESTION"][data-confidential-target-id="${source.id}"]`);
        await expect(card).toHaveCount(1);
        const reserved = this.page.waitForResponse(response => response.request().method() === 'POST'
          && new URL(response.url()).pathname.endsWith('/paper-compose/reserve-question')
          && response.request().postDataJSON()?.questionId === source.id);
        await card.locator('xpath=ancestor::div[.//button[contains(.,"加入试卷")]][1]')
          .getByRole('button', { name: /加入试卷/ }).click();
        expect(await businessResponse(await reserved)).toMatchObject({ questionId: source.id, locked: true });
      }
      await drawer.getByRole('button', { name: /close|关闭/i }).click();
      await expect(drawer).toBeHidden();
    }
  }

  async expectTitles(types: readonly SectionType[]) {
    const sections = this.page.locator('[id^="question-stem-"]');
    await expect(sections, '组卷编辑页应立即显示四个独立大题').toHaveCount(4);
    for (const [index, type] of types.entries()) {
      // question-stem-N 是界面大题顺序标识；以该顺序检查标题和7/9/8/2题量。
      const section = this.page.locator(`#question-stem-${index}`);
      await expect(section).toContainText(`${['一', '二', '三', '四'][index]}、${type.name}`);
      await expect(section.locator('[data-ai-review-numbering-path]')).toHaveCount(type.count);
    }
  }
}
