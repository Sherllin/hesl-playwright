// 从原 e2e/src/remote/bank-management.page.ts 仅提取本场景使用的页面能力。
import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { waitForBusinessResponse } from '../support/api';
type Envelope = { code?: string; message?: string };
export class BankPage {
  constructor(private readonly page: Page) { }

  private folderCard(name: string): Locator {
    return this.page.getByText(name, { exact: true }).locator('xpath=ancestor::div[@role="button"][1]');
  }

  private bankRow(name: string): Locator {
    return this.page.getByRole('row').filter({ has: this.page.getByText(name, { exact: true }) });
  }

  private async expectBusinessSuccess(response: Response, operation: string): Promise<void> {
    const body = (await response.json()) as Envelope;
    expect(body.code, `${operation} 应返回 E200：${body.message ?? ''}`).toBe('E200');
  }

  async gotoRoot(): Promise<void> {
    // 谓词只判断 method+url，body 在回调之外读取：导航取消的旧响应 body 可能已被回收。
    // 登录落地页也会请求列表，所以只接受业务成功的响应作为本次页面已加载的证据。
    const loaded = waitForBusinessResponse(
      this.page,
      response => response.request().method() === 'GET'
        && new URL(response.url()).pathname.endsWith('/bankFolder/list'),
      { accept: body => body.code === 'E200' },
    );
    await this.page.goto('/question/course/manage', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await loaded;
    await expect(this.page).not.toHaveURL(/\/(?:login|403)(?:\?|$)/);
    await expect(this.page.getByRole('button', { name: '新建学科题库' })).toBeVisible();
  }

  async createFolder(name: string): Promise<void> {
    await this.gotoRoot();
    await this.page.getByRole('button', { name: '新建学科题库' }).click();
    await this.page.getByRole('menuitem', { name: /单个创建/ }).click();
    const dialog = this.page.getByRole('dialog', { name: '新建学科题库' });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('请输入学科题库名称').fill(name);
    const created = this.page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().includes('/bankFolder/add'),
    );
    await dialog.getByRole('button', { name: /确\s*定/ }).click();
    await this.expectBusinessSuccess(await created, `创建学科题库 ${name}`);
    await expect(this.folderCard(name)).toBeVisible();
  }

  async openFolder(name: string): Promise<void> {
    await this.gotoRoot();
    await this.folderCard(name).click();
    await expect(this.page).toHaveURL(/folderId=/);
    await expect(this.page.getByRole('tab', { name: '项目题库', exact: true })).toBeVisible();
  }

  async createProjectBank(folderName: string, bankName: string): Promise<void> {
    await this.openFolder(folderName);
    await this.page.getByRole('button', { name: '新建项目题库' }).click();
    const drawer = this.page.getByRole('dialog').filter({
      has: this.page.getByPlaceholder('请输入项目题库名称'),
    });
    await expect(drawer).toBeVisible();
    await drawer.getByPlaceholder('请输入项目题库名称').fill(bankName);
    const created = this.page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().includes('/qrCourseBank/add'),
    );
    await drawer.getByRole('button', { name: '确认', exact: true }).click();
    await this.expectBusinessSuccess(await created, `创建项目题库 ${bankName}`);
    await expect(this.bankRow(bankName)).toBeVisible();
  }

  async openQuestionTypeSettings(folderName: string): Promise<Locator> {
    await this.gotoRoot();
    // 持久环境保留多轮数据，先筛选目标卡片，避免底部卡片的浮层被固定页头遮挡。
    await this.page.getByPlaceholder('请输入搜索', { exact: true }).fill(folderName);
    await expect(this.page.getByText(/^共 1 个学科题库$/)).toBeVisible();
    await expect(this.folderCard(folderName)).toBeVisible();
    // 此 Dropdown 使用 AntD 默认 hover 触发，点击并不是展开契约。
    await this.folderCard(folderName).getByRole('button', { name: /管\s*理/ }).hover();
    await this.page.getByRole('menuitem', { name: '题型设置' }).click();
    const dialog = this.page.getByRole('dialog', { name: '题型设置' });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  async openProjectBank(bankName: string): Promise<void> {
    await this.bankRow(bankName).getByRole('button', { name: '进入题库' }).click();
    // 学科页也有“题目”标签；先确认已进入项目题库详情，查询参数允许保留来源学科。
    await expect(this.page).toHaveURL(
      url => /^\/question\/course\/manage\/\d+$/.test(url.pathname),
      { timeout: 30_000 },
    );
    await expect(this.page.getByPlaceholder('请输入题目关键字')).toBeVisible();
  }

  async setQuestionTypeEnabled(folderName: string, name: string): Promise<void> {
    const settings = await this.openQuestionTypeSettings(folderName);
    await settings.getByRole('checkbox', { name, exact: true }).setChecked(true);
    const saved = this.page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname.includes('/question-type/folder-settings/'));
    await settings.getByRole('button', { name: '保存题型设置' }).click();
    await this.expectBusinessSuccess(await saved, '保存题型设置');
    await expect(settings).toBeHidden();
  }
}
