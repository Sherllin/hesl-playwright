import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { businessResponse, responseFor } from '../../support/api';
import type { SavedQuestion } from './language.assertions';
import type { TemplateFormat } from './template-tools';

export interface LanguagePaper {
  paperName: string; paperYear: string | number; qrPaperQuestionDTOList: SavedQuestion[];
}
export class HistoryImportPage {
  constructor(private readonly page: Page) { }
  private importDialog(): Locator {
    return this.page.getByRole('dialog').filter({ hasText: '历史试卷导入' });
  }
  row(name: string): Locator {
    return this.page.getByRole('row').filter({ has: this.page.getByText(name, { exact: true }) });
  }
  async downloadTemplate(format: TemplateFormat, target: string): Promise<void> {
    await this.page.getByRole('tab', { name: '试卷库', exact: true }).click();
    await this.page.getByRole('button', { name: '历史试卷导入', exact: true }).click();
    const dialog = this.importDialog();
    await expect(dialog.getByText(/请按模板填写题目/), '本单要求关闭AI的官方模板导入入口，请切换到非AI测试环境').toBeVisible();
    const downloaded = this.page.waitForEvent('download');
    await dialog.getByRole('button', { name: format === 'excel' ? /下载 Excel 模板$/ : /下载 Word 模板$/ }).click();
    const file = await downloaded;
    expect(await file.failure()).toBeNull();
    await file.saveAs(target);
  }
  async importTemplate(file: string, name: string): Promise<LanguagePaper> {
    const dialog = this.importDialog();
    await dialog.locator('input[type="file"]').setInputFiles(file);
    await dialog.getByRole('textbox', { name: `${name}试卷年份`, exact: true }).fill('2026');
    const imported = responseFor(this.page, 'POST', '/qrepo/paper/import-template');
    await dialog.getByRole('button', { name: '导入并编辑', exact: true }).click();
    const draft = await businessResponse<LanguagePaper>(await imported);
    // E200 only completes parsing; Next's editor route may still be loading.
    await this.page.waitForURL(/\/create\/paper\?.*draftId=/, {
      waitUntil: 'domcontentloaded', timeout: 90_000,
    });
    await expect(this.page.getByRole('textbox', { name: '请输入试卷标题', exact: true }))
      .toHaveValue(name, { timeout: 30_000 });
    return draft;
  }
  async scoreAndSave(name: string, count: number, info: TestInfo): Promise<string> {
    await this.page.getByText('设置分值', { exact: true }).click();
    const drawer = this.page.locator('.ant-drawer-content').filter({ hasText: '设置分值' });
    // Score rows are ordered by the paper's question order; int32 count is not an entity ID.
    const inputs = drawer.locator('.score-table tbody .ant-input-number-input');
    await expect(inputs).toHaveCount(count);
    for (const input of await inputs.all()) { await input.fill('2'); await input.blur(); }
    await drawer.getByRole('button', { name: /确\s*定/ }).click();
    await expect(drawer).toBeHidden();
    const saved = responseFor(this.page, 'POST', '/qrepo/paper');
    void saved.catch(() => undefined);
    await this.page.getByRole('button', { name: '保存试卷', exact: true }).click();
    const duplicate = this.page.getByRole('dialog').filter({ hasText: '历史试卷查重提示' });
    const outcome = await Promise.race([
      saved.then(() => 'saved' as const),
      duplicate.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'duplicate' as const,
        () => saved.then(() => 'saved' as const)),
    ]);
    if (outcome === 'duplicate') {
      await info.attach('history-duplicate-confirmation', { body: await this.page.screenshot({ fullPage: true }), contentType: 'image/png' });
      await duplicate.getByRole('button', { name: '继续保存', exact: true }).click();
    }
    const result = await businessResponse<{ paperId: string }>(await saved);
    expect(typeof result.paperId, 'int64试卷ID必须保持字符串').toBe('string');
    await expect(this.row(name)).toHaveCount(1);
    await expect(this.row(name)).toBeVisible();
    return result.paperId;
  }
  async preview(name: string, paperId: string, info: TestInfo): Promise<string[]> {
    const loaded = responseFor(this.page, 'GET', `/support/paper/library-preview-pages/${paperId}`);
    await this.row(name).getByRole('button', { name: '预览', exact: true }).click();
    const dialog = this.page.getByRole('dialog', { name: '试卷预览', exact: true });
    await expect(dialog).toBeVisible();
    const result = await businessResponse<{ paperId: string; pages: unknown[] }>(await loaded);
    expect(result.paperId).toBe(paperId);
    expect(result.pages.length).toBeGreaterThan(0);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const images = dialog.getByRole('img', { name: new RegExp(`^${escaped} 第\\d+页$`) });
    await expect(images).toHaveCount(result.pages.length);
    const files: string[] = [];
    for (const [index, image] of (await images.all()).entries()) {
      await expect.poll(() => image.evaluate(node => {
        const img = node as HTMLImageElement;
        return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
      })).toBe(true);
      const src = await image.getAttribute('src');
      expect(src).toMatch(/^data:image\/png;base64,/);
      const target = info.outputPath(`library-preview-page-${index + 1}.png`);
      await writeFile(target, Buffer.from(src!.slice(src!.indexOf(',') + 1), 'base64'));
      files.push(target);
      await info.attach(`library-preview-page-${index + 1}`, { path: target, contentType: 'image/png' });
    }
    await info.attach('library-preview-ui', { body: await this.page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await dialog.getByRole('button', { name: /关闭|Close/ }).click();
    await expect(dialog).toBeHidden();
    return files;
  }
  async download(name: string, info: TestInfo): Promise<Buffer> {
    await this.row(name).getByRole('button', { name: '下载', exact: true }).click();
    const dialog = this.page.getByRole('dialog', { name: '下载试卷', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('可填写本次输出用途').fill('E2E泰语模板导入及PDF字形回归');
    const downloaded = this.page.waitForEvent('download', { timeout: 120_000 });
    await dialog.getByRole('button', { name: /确\s*定/, exact: true }).click();
    const file = await downloaded;
    expect(await file.failure()).toBeNull();
    const target = info.outputPath('actual-question-paper.pdf');
    await file.saveAs(target);
    await info.attach('actual-question-paper', { path: target, contentType: 'application/pdf' });
    return readFile(target);
  }
}
