import { expect, type Page } from '@playwright/test';
import { selectMembersInModal } from '../support/member-picker';
import { businessResponse, responseFor } from '../support/api';

// 负责人配置任务和推进项目活动；不操作专家的作答页面。
export class ActivitiesPage {
  constructor(private readonly page: Page) { }

  private async addExpert(kind: string, name: string) {
    const heading = this.page.getByRole('heading', { name: `${kind}专家`, exact: true });
    await expect(heading).toBeVisible({ timeout: 60_000 });
    const section = heading.locator('xpath=ancestor::div[.//button[contains(normalize-space(.),"添加")]][1]');
    await section.getByRole('button', { name: /添\s*加/ }).click();
    const saved = responseFor(this.page, 'POST', '/qrProject/replace-member');
    await selectMembersInModal(this.page, [name]);
    await businessResponse(await saved);
  }

  private async start(kind: string, path: string | RegExp) {
    await this.page.getByRole('button', { name: `开启${kind}活动`, exact: true }).click();
    const modal = this.page.getByRole('dialog').filter({ hasText: `确认开启${kind}活动` });
    const started = responseFor(this.page, 'POST', path);
    await modal.getByRole('button', { name: /确\s*认/ }).click();
    await businessResponse(await started);
    await expect(modal).toBeHidden();
  }

  private async finish(kind: string, path: string | RegExp) {
    const button = this.page.getByRole('button', { name: `结束${kind}活动`, exact: true });
    await expect(button).toBeEnabled({ timeout: 60_000 });
    const finished = responseFor(this.page, 'POST', path);
    await button.click();
    await businessResponse(await finished);
  }

  async createQuestionTask(input: { name: string; author: string; quantity: number }) {
    await this.addExpert('出题', input.author);
    await this.page.getByRole('button', { name: /新建出题任务/ }).hover();
    await this.page.getByRole('menuitem', { name: /单个(?:创建|出题任务)/ }).click();
    const drawer = this.page.locator('.ant-drawer-content').filter({ hasText: '新建单个出题任务' });
    await drawer.getByPlaceholder('任务名称').fill(input.name);
    await drawer.locator('.ant-select-selector').filter({ hasText: '出题专家' }).click();
    await this.page.locator('.ant-select-dropdown:visible').getByText(input.author, { exact: true }).click();
    await drawer.locator('.ant-select-selector').filter({ hasText: '题型' }).click();
    await this.page.locator('.ant-select-dropdown:visible').getByText('不限题型', { exact: true }).click();
    await drawer.getByPlaceholder('数量不限').fill(String(input.quantity));
    const created = responseFor(this.page, 'POST', '/qrProject/question-creation/addBatch');
    await drawer.getByRole('button', { name: /确\s*认/ }).click();
    await businessResponse(await created);
    await expect(drawer).toBeHidden();
    await this.start('出题', /\/question-creation\/start\/\d+$/);
  }

  async openQuestionReview(reviewer: string) {
    await this.page.getByRole('tab', { name: '出题进度', exact: true }).click();
    await this.finish('出题', /\/question-creation\/end\/\d+$/);
    await this.addExpert('审题', reviewer);
    await this.page.getByRole('button', { name: /新建审题任务/ }).click();
    const modal = this.page.locator('.ant-modal-content').filter({ hasText: '审题任务分配' });
    const selectors = modal.locator('.ant-table-tbody .ant-table-row .ant-select');
    await expect(selectors).toHaveCount(1);
    await expect(selectors.locator('.ant-select-selection-item')).toHaveText(reviewer);
    const saved = responseFor(this.page, 'POST', '/question-review/question-tasks/save');
    await modal.getByRole('button', { name: /确\s*定/ }).click();
    await businessResponse(await saved);
    await expect(modal).toBeHidden();
    await this.start('审题', '/question-review/start');
  }

  async finishQuestionReview() {
    if (!new URL(this.page.url()).pathname.endsWith('/project/my/review')) {
      await this.page.getByText('审题', { exact: true }).first().click();
      await this.page.waitForURL(url => url.pathname.endsWith('/project/my/review'));
    }
    await this.page.getByRole('tab', { name: '审题进度', exact: true }).click();
    await this.finish('审题', /\/question-review\/end(?:\/\d+)?$/);
  }

  async createComposeTask(input: { name: string; composer: string; total: number }) {
    await this.addExpert('组卷', input.composer);
    await this.page.getByRole('button', { name: /新建组卷任务/ }).click();
    const drawer = this.page.getByRole('dialog').filter({ has: this.page.getByPlaceholder('请输入试卷名称') });
    await drawer.getByPlaceholder('请输入试卷名称').fill(input.name);
    await drawer.locator('.ant-select-selector').filter({ hasText: '请选择组卷专家' }).click();
    await this.page.locator('.ant-select-dropdown:visible').getByText(input.composer, { exact: true }).click();
    await drawer.getByPlaceholder('请输入试卷分值').fill(String(input.total));
    const created = responseFor(this.page, 'POST', '/paper-compose/add-paper-compose');
    await drawer.getByRole('button', { name: /确\s*认/ }).click();
    await businessResponse(await created);
    await expect(drawer).toBeHidden();
    await this.start('组卷', '/paper-compose/start-paper-compose');
  }

  async openPaperReview(reviewer: string) {
    await this.finish('组卷', '/paper-compose/end-paper-compose');
    await this.addExpert('审卷', reviewer);
    const configure = this.page.getByRole('button', { name: /去配置/ });
    await expect(configure).toHaveCount(1);
    await configure.click();
    const drawer = this.page.locator('.ant-drawer-content').filter({ hasText: '审卷配置' });
    const round = drawer.locator('.ant-form-item').filter({ hasText: '第1轮审核专家' });
    await round.locator('.ant-select-selector').click();
    await this.page.locator('.ant-select-dropdown:visible').getByText(reviewer, { exact: true }).click();
    const saved = responseFor(this.page, 'POST', '/paper-review/paper-tasks/config');
    await drawer.getByRole('button', { name: /确\s*认/ }).click();
    await businessResponse(await saved);
    await expect(drawer).toBeHidden();
    await this.start('审卷', '/paper-review/start');
  }

  async finishPaperReview() {
    const current = new URL(this.page.url());
    await this.finish('审卷', '/paper-review/end');
    // E200先完成，Next路由内容可能仍在加载；等待自动跳转，避免发起竞争导航。
    await expect(this.page).toHaveURL(url => url.origin === current.origin
      && url.pathname === '/project/my/makePaper'
      && url.searchParams.get('projectId') === current.searchParams.get('projectId'), { timeout: 90_000 });
    await expect(this.page.getByRole('heading', { name: '试卷样式关联', exact: true })).toBeVisible({ timeout: 60_000 });
  }
}
