import { test, expect } from '@playwright/test';
import { PaperMakePage } from './paper-make.page';

test('关联成功后占位符消失并重绘行，仍能定位同一试卷核对样式', async ({ page }) => {
  // 复现现场DOM变化；本地拦截外部接口，不登录、不修改任何环境业务数据。
  await page.route('https://bmtk.test/**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/paper-make/associate-style')) {
      await route.fulfill({ json: { code: 'E200', data: null } });
      return;
    }
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
      <section>
        <h1>试卷样式关联</h1>
        <div class="border-b" id="paper-row">
          <h2>独立测试试卷</h2><span>关联试卷样式</span><span>-</span>
          <button id="open">关联样式</button>
        </div>
      </section>
      <div class="ant-modal-content" role="dialog" hidden>
        <h2>选择试卷使用的样式</h2>
        <label><input type="radio" name="style">E2E-一栏单面样式</label>
        <button id="confirm">关联</button>
      </div>
      <script>
        document.querySelector('#open').onclick = () => {
          document.querySelector('[role=dialog]').hidden = false;
        };
        document.querySelector('#confirm').onclick = async () => {
          await fetch('/api/qrProject/paper-make/associate-style?projectId=9007199254740993&taskId=9007199254740994&paperId=9007199254740995&styleId=9007199254740996', {method:'POST'});
          const row = document.querySelector('#paper-row');
          const replacement = document.createElement('div');
          replacement.className = 'border-b';
          replacement.innerHTML = '<h2>独立测试试卷</h2><span>关联试卷样式</span><span>E2E-一栏单面样式</span><button>关联样式</button>';
          row.replaceWith(replacement);
          document.querySelector('[role=dialog]').hidden = true;
        };
      </script>` });
  });
  await page.goto('https://bmtk.test/project/my/makePaper');
  const binding = await new PaperMakePage(page).associateStyle(
    { id: '9007199254740996', name: 'E2E-一栏单面样式' }, '9007199254740995');
  expect(binding).toEqual({ projectId: '9007199254740993', paperId: '9007199254740995', styleId: '9007199254740996' });
  await expect(page.getByText('-', { exact: true })).toHaveCount(0);
  await expect(page.getByText('E2E-一栏单面样式', { exact: true }).filter({ visible: true })).toHaveCount(1);
});
