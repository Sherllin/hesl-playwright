import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { businessResponse, responseFor } from '../support/api';
import { ProjectPage } from '../project-management/project.page';

export class PaperMakePage {
  constructor(private readonly page: Page) { }

  async associateStyle() {
    const section = this.page.locator('section').filter({ has: this.page.getByRole('heading', { name: '试卷样式关联' }) });
    const unassociated = section.getByText('-', { exact: true });
    await expect(unassociated).toHaveCount(1);
    const row = unassociated.locator("xpath=ancestor::div[contains(@class, 'border-b')][1]");
    await row.getByRole('button', { name: /关联样式/ }).click();
    const modal = this.page.locator('.ant-modal-content').filter({ hasText: '选择试卷使用的样式' });
    const confirm = modal.getByRole('button', { name: /^关\s*联$/ });
    // 与原用例一致使用系统默认样式；这里只测试换序后的内容输出。
    if (await confirm.isDisabled()) await modal.locator('.ant-radio-wrapper').first().click();
    await expect(confirm).toBeEnabled();
    const associated = responseFor(this.page, 'POST', '/paper-make/associate-style');
    await confirm.click();
    const response = await associated;
    await businessResponse(response);
    const url = new URL(response.url());
    for (const key of ['projectId', 'taskId', 'paperId']) expect(url.searchParams.get(key)).toMatch(/^\d+$/);
    await expect(modal).toBeHidden();
    await expect(row.getByText('-', { exact: true })).toHaveCount(0);
  }

  async finishProject(projectName: string) {
    const finish = this.page.getByRole('button', { name: '结束制卷活动', exact: true });
    await expect(finish).toBeEnabled({ timeout: 60_000 });
    await finish.click();
    const modal = this.page.locator('.ant-modal-content').filter({ hasText: '结束制卷任务后将结束项目' });
    const finished = responseFor(this.page, 'POST', /\/paper-make\/end\/\d+$/);
    await modal.getByRole('button', { name: /确\s*认/ }).click();
    await businessResponse(await finished);
    await expect(modal).toBeHidden();
    const project = new ProjectPage(this.page);
    await project.expectCompleted(projectName);
    await project.enterProject(projectName);
    await expect(this.page).toHaveURL(url => url.pathname === '/project/my/makePaper');
  }

  async downloadPdf(kind: '试卷' | '答案'): Promise<Buffer> {
    const action = this.page.getByRole('button', { name: `下载${kind}`, exact: true });
    await expect(action).toHaveCount(1);
    await action.click();
    const dialog = this.page.getByRole('dialog', { name: `下载${kind}`, exact: true });
    await expect(dialog).toBeVisible();
    if (kind === '答案') {
      await dialog.getByRole('radio', { name: 'PDF', exact: true }).check();
      await expect(dialog.getByRole('checkbox', { name: '答案', exact: true })).toBeChecked();
    } else await expect(dialog).toContainText('题目 PDF');
    const [response, download] = await Promise.all([
      responseFor(this.page, 'POST', '/security-governance/controlled-outputs'),
      this.page.waitForEvent('download', { timeout: 90_000 }),
      dialog.getByRole('button', { name: /^确\s*定$/ }).click(),
    ]);
    const ticket = await businessResponse<{ traceId: string; artifactId: string }>(response);
    expect(ticket.traceId, '输出必须可追溯').toBeTruthy();
    expect(typeof ticket.artifactId, '产物ID保持字符串').toBe('string');
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    const file = await download.path();
    expect(file).toBeTruthy();
    const bytes = await readFile(file!);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    await expect(dialog).toBeHidden();
    return bytes;
  }
}
