// 题库项目内复用的成员选择控件；保持完整姓名唯一匹配与虚拟列表处理。
import { expect, type Page } from '@playwright/test';

export async function selectMembersInModal(
  page: Page,
  names: string[],
  options?: { beforeConfirm?: () => void | Promise<void>; modalTitle?: string },
): Promise<void> {
  const modal = options?.modalTitle
    ? page.getByRole('dialog', { name: options.modalTitle, exact: true })
    : page.getByRole('dialog').filter({ has: page.getByPlaceholder('搜索部门、成员') });
  await expect(modal).toHaveCount(1);
  const search = modal.getByPlaceholder('搜索部门、成员');
  await search.waitFor({ state: 'visible', timeout: 15_000 });
  // A visible search box can precede the asynchronous organization tree.
  // Search only after real nodes render, otherwise the debounce may search an empty tree.
  await expect.poll(() => modal.locator('.ant-tree-title').count(), { timeout: 30_000 }).toBeGreaterThan(0);
  const selectionSummary = modal.getByText(/^已选择\s*\d+\s*位成员$/);
  for (const [index, name] of names.entries()) {
    // 搜索会自动展开并滚动到匹配成员；逐人搜索，避免共同前缀命中大量虚拟节点。
    await search.fill(name);
    const exactName = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    const node = modal
      .locator('.ant-tree-treenode')
      // 树行可含辅助文字；标题必须全名匹配，防止 E2E1 的搜索高亮误选 E2E10。
      .filter({ has: page.locator('.ant-tree-title').filter({ hasText: exactName }) });
    // 搜索仅高亮并滚到第一个子串匹配（如名字1可能先命中名字10），不筛掉其他成员。
    // 等到本轮高亮生效后遍历虚拟列表，仍以完整姓名唯一匹配，不能误选子串。
    await expect(modal.locator('.text-orange-500').filter({ hasText: exactName }).first()).toBeVisible();
    if (await node.count() === 0) {
      const holder = modal.locator('.ant-tree-list-holder');
      await holder.evaluate(el => { el.scrollTop = 0; });
      await expect.poll(async () => {
        if (await node.count() > 0) return true;
        return holder.evaluate(el => {
          if (el.scrollTop + el.clientHeight >= el.scrollHeight) return false;
          el.scrollTop += Math.max(1, el.clientHeight - 32);
          return false;
        });
      }, { timeout: 60_000, message: `遍历虚拟成员列表查找完整姓名：${name}` }).toBe(true);
    }
    await expect(node, `成员选择必须唯一：${name}；同名成员需按账号或成员 ID 消歧，禁止默认选择第一项`).toHaveCount(1, { timeout: 15_000 });
    // 输入框值改变早于防抖搜索完成；高亮文本证明这次搜索已实际应用。
    await expect(node.locator('.text-orange-500').filter({ hasText: name })).toHaveText(name);
    // AntD 树没有可用的复选框 role，按已消歧的业务成员节点限定。
    const checkbox = node.locator('.ant-tree-checkbox');
    await expect(checkbox).toBeVisible({ timeout: 15_000 });
    const checked = await checkbox.evaluate((el) => el.classList.contains('ant-tree-checkbox-checked'));
    if (!checked) await checkbox.click({ timeout: 30_000 });
    await expect(checkbox).toHaveClass(/ant-tree-checkbox-checked/, { timeout: 10_000 });
    await expect.poll(async () => Number((await selectionSummary.innerText()).match(/\d+/)?.[0]),
      { message: '每次勾选后已选成员列表必须累计保留' }).toBeGreaterThanOrEqual(index + 1);
  }
  await expect(selectionSummary).toHaveText(new RegExp(`^已选择\\s*${names.length}\\s*位成员$`), {
    timeout: 10_000,
  });
  await options?.beforeConfirm?.();
  await modal.getByRole('button', { name: /确\s*定/ }).click();
  await expect(modal).toBeHidden();
}
