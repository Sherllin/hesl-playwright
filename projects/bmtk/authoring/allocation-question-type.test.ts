import { test, expect, type Page } from '@playwright/test';
import { selectAllocationQuestionType } from './allocation-question-type';

async function allocation(page: Page, disabled = false) {
  // 复现实际 rc-select 虚拟列表：9个选项、首屏只有8个DOM，键盘推进才渲染最后一项。
  await page.setContent(`
    <div role="dialog" aria-label="设置题目分配">
      <div class="ant-select-selector"><input role="combobox" readonly aria-controls="types-list" aria-expanded="false">
        <span class="ant-select-selection-item">单选题</span></div>
    </div>
    <div class="ant-select-dropdown" hidden><div id="types-list" role="listbox"></div></div>
    <script>
      const names = ['单选题','多选题','填空题','判断题','简答题','组合题','物化简答','物化问答','物化论述'];
      const selected = document.querySelector('.ant-select-selection-item');
      const combo = document.querySelector('[role=combobox]');
      const popup = document.querySelector('.ant-select-dropdown');
      const list = document.querySelector('[role=listbox]');
      let active = 0;
      function render() {
        list.replaceChildren();
        const start = active === 8 ? 1 : 0;
        names.slice(start, start + 8).forEach((name, offset) => {
          const index = start + offset;
          const node = document.createElement('div');
          node.className = 'ant-select-item ant-select-item-option'
            + (active === index ? ' ant-select-item-option-active' : '')
            + (${disabled} && index === 8 ? ' ant-select-item-option-disabled' : '');
          node.title = name; node.textContent = name;
          node.onclick = () => {
            if (${disabled} && index === 8) return;
            selected.textContent = name; popup.hidden = true; combo.setAttribute('aria-expanded','false');
          };
          list.append(node);
        });
      }
      selected.onclick = () => { popup.hidden = false; combo.setAttribute('aria-expanded','true'); render(); };
      combo.onkeydown = event => {
        if (event.key !== 'ArrowDown') return;
        event.preventDefault();
        active = (active + 1) % names.length;
        // 模拟键盘事件后React异步提交新虚拟窗口；用例不能靠固定sleep同步。
        setTimeout(render, 10);
      };
      render();
    </script>
  `);
  return page.getByRole('dialog', { name: '设置题目分配' }).locator('.ant-select-selection-item');
}

test('1007401分配题型：首屏未渲染的第9项物化论述也能按完整名称选中', async ({ page }) => {
  page.setDefaultTimeout(800);
  const selection = await allocation(page);
  await expect(page.getByTitle('物化论述', { exact: true })).toHaveCount(0);
  await selectAllocationQuestionType(page, selection, '物化论述');
  await expect(selection).toHaveText('物化论述');
  await expect(page.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
});
test('1007401分配题型：首屏选项与已选名称均正确，不能误选基础简答', async ({ page }) => {
  const selection = await allocation(page);
  await selectAllocationQuestionType(page, selection, '物化简答');
  await expect(selection).toHaveText('物化简答');
  await selectAllocationQuestionType(page, selection, '物化简答');
  await expect(page.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
});
test('1007401分配题型：遍历一圈仍无目标时明确失败，不能静默选择首项', async ({ page }) => {
  const selection = await allocation(page);
  await expect(selectAllocationQuestionType(page, selection, '不存在的题型')).rejects.toThrow(/未找到可分配/);
  await expect(selection).toHaveText('单选题');
});
test('1007401分配题型：已渲染但禁用的同名题型不能当作选择成功', async ({ page }) => {
  const selection = await allocation(page, true);
  await expect(selectAllocationQuestionType(page, selection, '物化论述')).rejects.toThrow(/必须允许分配/);
  await expect(selection).toHaveText('单选题');
});
