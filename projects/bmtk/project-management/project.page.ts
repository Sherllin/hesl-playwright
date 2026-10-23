import { expect, type Page } from '@playwright/test';
import { selectMembersInModal } from '../support/member-picker';
import { businessResponse, parseJson, responseFor } from '../support/api';
const ROUTES = { myProject: '/project/my' };
export class ProjectPage {
  async create(input: { name: string; leader: string; activity: '开放式征题' | '只制卷'; bankName: string }): Promise<{ bankId: string }> {
    await this.page.goto('/project/manage', { waitUntil: 'domcontentloaded' });
    await this.page.getByRole('button', { name: '新建命题项目', exact: true }).click();
    const drawer = this.page.locator('.ant-drawer-content').filter({ hasText: '新建命题项目' });
    await drawer.getByPlaceholder('请填写项目名称').fill(input.name);
    await this.fillProjectDateRange(drawer);
    await drawer.getByText('请选择项目负责人', { exact: true }).click();
    await selectMembersInModal(this.page, [input.leader]);
    if (input.activity === '开放式征题') {
      await drawer.getByRole('radio', { name: /^(开放式征题|常态化征题)$/ }).check();
    } else {
      await this.page.getByRole('button', { name: /编辑活动/ }).click();
      const modal = this.page.locator('.ant-modal-content').filter({ hasText: '选择项目活动' });
      await modal.getByRole('radio', { name: /^组卷审卷制卷[：:]/ }).click();
      await modal.getByRole('button', { name: /确\s*定/ }).click();
      await expect(modal).toBeHidden();
    }
    const bank = drawer.getByRole('combobox');
    await bank.click();
    if (await bank.isEditable()) await bank.fill(input.bankName);
    await this.page.locator('.ant-select-dropdown:visible').getByTitle(input.bankName, { exact: true }).click();
    await drawer.getByText('题库资源配置', { exact: true }).click();
    const created = responseFor(this.page, 'POST', '/qrProject/add');
    await drawer.getByRole('button', { name: /^确\s*定$/ }).click();
    const response = await created;
    await businessResponse(response);
    const sent = parseJson<{ projectManagers: Array<{ name: string }>; bankMode: string; bankIds: string[]; primaryBankId: string }>(response.request().postData()!);
    expect(sent.projectManagers.map(m => m.name)).toEqual([input.leader]);
    expect(sent.bankMode).toBe('EXISTING');
    expect(sent.bankIds).toHaveLength(1);
    expect(typeof sent.primaryBankId).toBe('string');
    expect(sent.primaryBankId).toBe(sent.bankIds[0]);
    await expect(drawer).toBeHidden();
    await expect(this.page.getByText(input.name, { exact: true })).toBeVisible();
    return { bankId: sent.primaryBankId };
  }
  constructor(private readonly page: Page) { }

  private async fillProjectDateRange(
    drawer: ReturnType<Page["locator"]>,
  ): Promise<void> {
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 30);
    const formatDate = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    const startInput = drawer.getByPlaceholder("请选择开始日期");
    const endInput = drawer.getByPlaceholder("请选择结束日期");
    await startInput.click();
    // RangePicker uses two calendar panels; restrict to the owning month so
    // spillover days cannot select a duplicate cell or leave an uncommitted range.
    const calendar = this.page.locator(".ant-picker-dropdown:visible");
    await calendar
      .getByTitle(formatDate(startDate), { exact: true })
      .and(calendar.locator(".ant-picker-cell-in-view"))
      .click();
    await calendar
      .getByTitle(formatDate(endDate), { exact: true })
      .and(calendar.locator(".ant-picker-cell-in-view"))
      .click();
    await expect(calendar).toBeHidden();
    await expect(startInput).toHaveValue(formatDate(startDate));
    await expect(endInput).toHaveValue(formatDate(endDate));
    await expect(drawer.getByText("请选择完整的项目起止日期")).toHaveCount(0);
  }

  async enterProject(projectName: string): Promise<void> {
    await this.page.goto(ROUTES.myProject, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await expect(this.page).toHaveURL(
      (url) => url.pathname === ROUTES.myProject,
      {
        timeout: 60_000,
      },
    );
    const search = this.page.getByPlaceholder("请输入命题项目搜索");
    await expect(search).toBeVisible({ timeout: 60_000 });
    await search.fill(projectName);
    const card = this.page
      .getByText(projectName, { exact: true })
      .locator(
        'xpath=ancestor::div[.//button[contains(@class,"ant-btn-primary")]][1]',
      );
    await expect(card).toBeVisible({ timeout: 60_000 });
    await card.locator(".ant-btn-primary").first().click();
    await this.page.waitForURL(
      (url) => url.pathname.startsWith("/project/my/"),
      {
        timeout: 60_000,
      },
    );
    await expect(
      this.page.getByText(projectName, { exact: true }).first(),
    ).toBeVisible({
      timeout: 60_000,
    });
  }

  async expectCompleted(projectName: string): Promise<void> {
    await this.page.goto(ROUTES.myProject, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    const search = this.page.getByPlaceholder("请输入命题项目搜索");
    await expect(search).toBeVisible({ timeout: 60_000 });
    await search.fill(projectName);
    const card = this.page
      .locator(".ant-list-item")
      .filter({ hasText: projectName })
      .first();
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card.getByText("已完成", { exact: true }).first()).toBeVisible(
      {
        timeout: 60_000,
      },
    );
  }
}
