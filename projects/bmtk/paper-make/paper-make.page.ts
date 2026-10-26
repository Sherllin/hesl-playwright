import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { businessResponse, parseJson, responseFor } from '../support/api';
import { ProjectPage } from '../project-management/project.page';

export class PaperMakePage {
  constructor(private readonly page: Page) { }

  async associateStyle(style?: { id: string; name: string }, paperId?: string) {
    const section = this.page.locator('section').filter({ has: this.page.getByRole('heading', { name: '试卷样式关联' }) });
    // 单卷场景用稳定的试卷标题定位行；关联后占位符会消失，不能作为行定位的前提。
    const row = section.locator('div.border-b').filter({ has: this.page.getByRole('heading', { level: 2 }) });
    await expect(row).toHaveCount(1);
    await expect(row.getByText('-', { exact: true })).toHaveCount(1);
    await row.getByRole('button', { name: /关联样式/ }).click();
    const modal = this.page.locator('.ant-modal-content').filter({ hasText: '选择试卷使用的样式' });
    const confirm = modal.getByRole('button', { name: /^关\s*联$/ });
    if (style) await modal.getByRole('radio', { name: style.name, exact: true }).check();
    else if (await confirm.isDisabled()) await modal.locator('.ant-radio-wrapper').first().click();
    await expect(confirm).toBeEnabled();
    const associated = responseFor(this.page, 'POST', '/paper-make/associate-style');
    await confirm.click();
    const response = await associated;
    await businessResponse(response);
    const url = new URL(response.url());
    for (const key of ['projectId', 'taskId', 'paperId']) expect(url.searchParams.get(key)).toMatch(/^\d+$/);
    if (style) expect(url.searchParams.get('styleId'), '必须关联本轮完整名称选中的独立样式').toBe(style.id);
    if (paperId) expect(url.searchParams.get('paperId')).toBe(paperId);
    await expect(modal).toBeHidden();
    await expect(row.getByText('-', { exact: true })).toHaveCount(0);
    if (style) await expect(row).toContainText(style.name);
    return { projectId: url.searchParams.get('projectId')!, paperId: url.searchParams.get('paperId')!, styleId: url.searchParams.get('styleId')! };
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

  async downloadPdf(kind: '试卷' | '答案', options: { includeQuestion?: boolean } = {}): Promise<Buffer> {
    return this.download(kind, 'PDF', kind === '试卷' ? ['题目'] : options.includeQuestion ? ['题目', '答案'] : ['答案']);
  }

  async downloadDocx(selection: '仅题目' | '仅答案' | '题目加答案'): Promise<Buffer> {
    const content = selection === '仅题目' ? ['题目'] : selection === '仅答案' ? ['答案'] : ['题目', '答案'];
    return this.download('答案', 'DOCX', content);
  }

  private async download(kind: '试卷' | '答案', format: 'PDF' | 'DOCX', selected: string[]): Promise<Buffer> {
    const action = this.page.getByRole('button', { name: `下载${kind}`, exact: true });
    await expect(action).toHaveCount(1);
    await action.click();
    const dialog = this.page.getByRole('dialog', { name: `下载${kind}`, exact: true });
    await expect(dialog).toBeVisible();
    if (kind === '答案') {
      await dialog.getByRole('radio', { name: format === 'PDF' ? 'PDF' : /^(DOCX|Word)$/i, exact: true }).check();
      for (const name of ['题目', '答案', '知识点', '解析']) {
        const checkbox = dialog.getByRole('checkbox', { name, exact: true });
        await expect(checkbox).toHaveCount(1);
        if (await checkbox.isChecked() !== selected.includes(name)) await dialog.getByText(name, { exact: true }).click();
        await expect(checkbox).toBeChecked({ checked: selected.includes(name) });
      }
    } else await expect(dialog).toContainText('题目 PDF');
    const [response, download] = await Promise.all([
      responseFor(this.page, 'POST', '/security-governance/controlled-outputs'),
      this.page.waitForEvent('download', { timeout: 90_000 }),
      dialog.getByRole('button', { name: /^确\s*定$/ }).click(),
    ]);
    const sent = parseJson<{ format: string; content: string[] }>(response.request().postData()!);
    expect(sent.format).toBe(format);
    expect([...sent.content].sort()).toEqual(selected.map(name => name === '题目' ? 'QUESTION' : 'ANSWER').sort());
    const ticket = await businessResponse<{ traceId: string; artifactId: string }>(response);
    expect(ticket.traceId, '输出必须可追溯').toBeTruthy();
    expect(typeof ticket.artifactId, '产物ID保持字符串').toBe('string');
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(format === 'PDF' ? /\.pdf$/i : /\.docx$/i);
    const file = await download.path();
    expect(file).toBeTruthy();
    const bytes = await readFile(file!);
    expect(bytes.subarray(0, format === 'PDF' ? 5 : 2).toString()).toBe(format === 'PDF' ? '%PDF-' : 'PK');
    await expect(dialog).toBeHidden();
    return bytes;
  }
}
