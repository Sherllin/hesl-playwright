import { expect, type Page } from '@playwright/test';
import { businessResponse, readApi, responseFor } from '../support/api';
import { BankPage } from './bank.page';
import { sectionTypes, type SectionType } from '../compose/custom-sections.assertions';

export class CustomSectionTypesPage {
  constructor(private readonly page: Page) { }

  async prepare(folderName: string): Promise<void> {
    expect(folderName).toMatch(/^E2E-/);
    const bank = new BankPage(this.page);
    await bank.createFolder(folderName);
    await bank.setQuestionTypeEnabled(folderName, '简答题');
    for (const type of sectionTypes.filter(type => type.name !== '简答题')) {
      const settings = await bank.openQuestionTypeSettings(folderName);
      await settings.getByRole('button', { name: '添加自定义题型', exact: true }).click();
      const dialog = this.page.getByRole('dialog', { name: '添加自定义题型', exact: true });
      await dialog.getByPlaceholder('请输入题型名称').fill(type.name);
      const added = responseFor(this.page, 'POST', '/question-type/folder-custom');
      await dialog.getByRole('button', { name: /确\s*定/ }).click();
      await businessResponse(await added);
      await expect(dialog).toBeHidden();
      await expect(settings.getByRole('checkbox', { name: type.name, exact: true })).toBeChecked();
      const saved = responseFor(this.page, 'PUT', /\/question-type\/folder-settings\//);
      await settings.getByRole('button', { name: '保存题型设置', exact: true }).click();
      await businessResponse(await saved);
      await expect(settings).toBeHidden();
    }
  }

  async readBankTypes(token: string, bankId: string): Promise<SectionType[]> {
    const rows = await readApi<Array<{ id: string; name: string; questionType: number }>>(
      this.page.request, token, `/qrepo/question-type/list/${bankId}`,
    );
    const result = sectionTypes.map(type => {
      const matched = rows.filter(row => row.name === type.name);
      expect(matched, '按完整题型名唯一匹配').toHaveLength(1);
      expect(matched[0].questionType, '四种题型必须共用简答结构').toBe(5);
      expect(typeof matched[0].id).toBe('string');
      return { ...type, id: matched[0].id };
    });
    expect(new Set(result.map(type => type.id)).size).toBe(4);
    return result;
  }
}
