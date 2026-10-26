import { test, expect } from '@playwright/test';
import { waitForAdminLanding } from './admin-landing';

test.use({ baseURL: 'https://bmtk.test' });

test('选组织后等待前端自动落地，不主动goto与身份读取的导航竞争', async ({ page }) => {
  let automaticNavigations = 0;
  let forcedNavigations = 0;
  await page.route('https://bmtk.test/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/question/course/manage') {
      // JS正常跳转带pick来源；额外page.goto未声明referer，复现其被浏览器取消。
      if (!request.headers().referer?.endsWith('/pick')) {
        forcedNavigations++;
        await route.abort('aborted');
        return;
      }
      automaticNavigations++;
      await route.fulfill({ contentType: 'text/html; charset=utf-8',
        body: '<nav class="aside-nav">题库</nav><button>新建学科题库</button>' });
    } else if (url.pathname === '/identity') {
      await route.fulfill({ json: { code: 'E200' } });
    } else {
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        <button id="pick">选择测试组织</button>
        <script>document.querySelector('#pick').onclick=async()=>{
          await fetch('/identity');window.location.href='/question/course/manage';
        };</script>` });
    }
  });
  await page.goto('https://bmtk.test/pick');
  await page.getByRole('button', { name: '选择测试组织' }).click();
  await waitForAdminLanding(page);
  await expect(page.getByRole('button', { name: '新建学科题库' })).toBeVisible();
  expect(automaticNavigations).toBe(1);
  expect(forcedNavigations).toBe(0);
});
