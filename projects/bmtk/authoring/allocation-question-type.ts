import { expect, type Locator, type Page } from '@playwright/test';

export async function selectAllocationQuestionType(page: Page, selection: Locator, name: string): Promise<void> {
  if ((await selection.innerText()).trim() === name) return;
  const combobox = selection.locator('..').getByRole('combobox');
  await selection.click();
  const popup = page.locator('.ant-select-dropdown:visible');
  await expect(popup).toHaveCount(1);
  const target = popup.getByTitle(name, { exact: true });
  const active = popup.locator('.ant-select-item-option-active');
  const visited = new Set<string>();
  // rc-select不会为未滚动到的选项创建DOM。键盘导航会让虚拟列表滚动并挂载目标项。
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await target.isVisible()) {
      await expect(target, `${name}必须允许分配`).not.toHaveClass(/ant-select-item-option-disabled/);
      await target.click();
      await expect(selection).toHaveText(name);
      return;
    }
    const before = await active.getAttribute('title');
    if (before === null || visited.has(before)) break;
    visited.add(before);
    await combobox.press('ArrowDown');
    // 等待实际活动项改变，避免键盘操作快于React虚拟窗口的提交。
    await expect(active).not.toHaveAttribute('title', before);
  }
  throw new Error(`题型列表中未找到可分配的完整名称：${name}`);
}
