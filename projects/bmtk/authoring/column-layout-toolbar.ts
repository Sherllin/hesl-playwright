import { expect, type Locator, type Page } from '@playwright/test';

/** 图标会参与accessible name；按button内完整可见文案定位，忽略装饰图标名称。 */
export async function insertColumnLayout(page: Page, editor: Locator, columns: number): Promise<void> {
  const textButton = (scope: Page | Locator, label: string) => scope.getByRole('button').filter({
    has: page.getByText(label, { exact: true }),
  });
  await editor.getByRole('button', { name: 'Insert specialized editor node', exact: true }).click();
  await textButton(page, '列布局').click();
  const dialog = page.getByRole('dialog').filter({ hasText: '插入列布局' });
  await expect(dialog).toBeVisible();
  if (columns === 3) {
    await textButton(dialog, '2 列 (等宽)').click();
    await textButton(page, '3 列 (等宽)').click();
  }
  await expect(textButton(dialog, `${columns} 列 (等宽)`)).toBeVisible();
  await dialog.getByRole('button', { name: '插入', exact: true }).click();
  await expect(dialog).toBeHidden();
}
