import { expect, test } from '@playwright/test';
import { ColumnLayoutAuthoringPage } from './column-layout.page';

for (const { label, other } of [{ label: '返回', other: '返回其他' }, { label: '返 回', other: '返回' }]) {
  test(`工作区${label}按钮带图标时仍能返回任务列表，且不误点正文同名按钮`, async ({ page }) => {
    // 复现真实trace中header、button、图标的DOM；所有请求由本地fixture拦截，无账号或业务写入。
    await page.route('https://bmtk-fixture.invalid/**', route => route.fulfill({
      contentType: 'text/html; charset=utf-8', body: `
        <header data-testid="task-workbench-header">
          <div><button type="button" id="back"><span role="img" aria-label="chevron_left"></span><span>${label}</span></button></div>
        </header>
        <main><button type="button" id="other">${other}</button></main>
        <output id="clicked"></output>
        <script>
          document.querySelector('#back').onclick = () => {
            document.querySelector('#clicked').textContent = 'header';
            history.pushState(null, '', '/project/task');
          };
          document.querySelector('#other').onclick = () => document.querySelector('#clicked').textContent = 'wrong';
        </script>`,
    }));
    await page.goto('https://bmtk-fixture.invalid/project/task/question');
    page.setDefaultTimeout(1500);
    page.setDefaultNavigationTimeout(1500);
    await new ColumnLayoutAuthoringPage(page).returnToTasks();
    await expect(page).toHaveURL('https://bmtk-fixture.invalid/project/task');
    await expect(page.locator('#clicked')).toHaveText('header');
  });
}
