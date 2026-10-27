import { expect, test } from '@playwright/test';
import { insertColumnLayout } from './column-layout-toolbar';

// 本次真实trace：列布局button含role=img aria-label=columns_stroked，
// DropDown列数button还包含chevron_down。复现可访问名称，不登录或操作业务数据。
for (const columns of [2, 3]) {
  test(`${columns}列工具栏允许图标参与可访问名称，仍按完整可见文案操作`, async ({ page }) => {
    await page.setContent(`
      <div data-confidential-target-name="题目编辑">
        <button type="button" aria-label="Insert specialized editor node" id="open">+</button>
      </div>
      <output id="result"></output>
      <script>
        document.querySelector('#open').onclick = () => {
          const dropdown = document.createElement('div');
          dropdown.className = 'dropdown';
          dropdown.innerHTML = '<button type="button" id="layout"><span role="img" aria-label="columns_stroked"></span><span class="text">列布局</span></button>';
          document.body.append(dropdown);
          document.querySelector('#layout').onclick = () => {
            dropdown.remove();
            const dialog = document.createElement('div');
            dialog.setAttribute('role', 'dialog');
            dialog.innerHTML = '<h2>插入列布局</h2><button type="button" id="choice"><span class="text">2 列 (等宽)</span><span role="img" aria-label="chevron_down"></span></button><button type="button" id="insert">插入</button>';
            dialog.dataset.columns = '2';
            document.body.append(dialog);
            document.querySelector('#choice').onclick = () => {
              const options = document.createElement('div');
              options.className = 'dropdown';
              options.innerHTML = '<button type="button" id="three"><span class="text">3 列 (等宽)</span></button>';
              document.body.append(options);
              document.querySelector('#three').onclick = () => {
                dialog.querySelector('#choice .text').textContent = '3 列 (等宽)';
                dialog.dataset.columns = '3';
                options.remove();
              };
            };
            document.querySelector('#insert').onclick = () => {
              document.querySelector('#result').textContent = dialog.dataset.columns;
              dialog.remove();
            };
          };
        };
      </script>
    `);
    // 点击记录必须来自实际控件，不能通过执行脚本绕过定位。
    const editor = page.locator('[data-confidential-target-name="题目编辑"]');
    page.setDefaultTimeout(1500);
    await insertColumnLayout(page, editor, columns);
    await expect(page.locator('#result')).toHaveText(String(columns));
  });
}
