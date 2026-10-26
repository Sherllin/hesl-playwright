import { expect, type Page } from '@playwright/test';
import { businessResponse, responseFor } from '../support/api';
import { ComposePage } from './compose.page';

export class StyleExamComposePage {
  constructor(private readonly page: Page) { }

  async addAndScore(expectedIds: readonly string[]) {
    const loaded = responseFor(this.page, 'POST', '/qrQuestionEntity/getByCatalogForProject');
    await this.page.getByText('添加题目', { exact: true }).click();
    await businessResponse(await loaded);
    const drawer = this.page.getByRole('dialog').filter({ hasText: '添加题目' });
    await expect(drawer).toBeVisible();
    const expanded = responseFor(this.page, 'POST', '/qrQuestionEntity/getByCatalogForProject');
    await drawer.getByTitle('10 条/页', { exact: true }).click();
    await this.page.locator('.ant-select-dropdown:visible').getByTitle('50 条/页', { exact: true }).click();
    const data = await businessResponse<{ records: Array<{ id: string }> }>(await expanded);
    expect(data.records.map(q => q.id).sort(), '同一项目审核通过的37题全部可选').toEqual([...expectedIds].sort());
    for (const id of expectedIds) {
      const card = drawer.locator(`[data-confidential-target-id="${id}"]`);
      await expect(card).toHaveCount(1);
      const reserved = this.page.waitForResponse(r => r.request().method() === 'POST' &&
        new URL(r.url()).pathname.endsWith('/paper-compose/reserve-question') && r.request().postDataJSON()?.questionId === id);
      await card.locator('xpath=ancestor::div[.//button[contains(.,"加入试卷")]][1]')
        .getByRole('button', { name: /加入试卷/ }).click();
      expect(await businessResponse(await reserved)).toMatchObject({ questionId: id, locked: true });
    }
    await expect(drawer.getByRole('button', { name: /取消添加/ })).toHaveCount(expectedIds.length);
    await drawer.getByRole('button', { name: /close|关闭/i }).click();
    await expect(drawer).toBeHidden();
    await new ComposePage(this.page).setChildScores(expectedIds.map((_, index) => index === expectedIds.length - 1 ? 28 : 2));
    await new ComposePage(this.page).expectTotal(37, 100);
  }
}
