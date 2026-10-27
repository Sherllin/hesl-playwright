import { test, expect } from '@playwright/test';
import { ActivitiesPage } from './activities.page';

// 复现已结束审卷、制卷页请求尚未完成的现场；不登录真实站点。
test('结束审卷后等待超过默认5秒的自动制卷导航，不提前检查新页标题', async ({ page }) => {
  const requests: string[] = [];
  await page.route('https://bmtk.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    requests.push(`${route.request().method()} ${path}`);
    if (path === '/api/qrProject/paper-review/end') {
      await route.fulfill({ json: { code: 'E200', data: null } });
    } else if (path === '/project/my/makePaper') {
      // 模拟 Next 路由内容加载超过5秒；此为受控外部响应延迟，不是用例同步等待。
      await new Promise(resolve => setTimeout(resolve, 6_000));
      await route.fulfill({ contentType: 'text/html', body: '<h1>试卷样式关联</h1>' });
    } else {
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        <h1>审卷任务管理</h1><button>结束审卷活动</button>
        <script>
          document.querySelector('button').onclick = async () => {
            await fetch('/api/qrProject/paper-review/end?projectId=9007199254740993', { method: 'POST' });
            const target = '/project/my/makePaper?projectId=9007199254740993';
            const content = await (await fetch(target)).text();
            history.pushState({}, '', target);
            document.body.innerHTML = content;
          };
        </script>` });
    }
  });
  await page.goto('https://bmtk.test/project/my/reviewPaper?projectId=9007199254740993');
  await new ActivitiesPage(page).finishPaperReview();
  await expect(page).toHaveURL('https://bmtk.test/project/my/makePaper?projectId=9007199254740993');
  await expect(page.getByRole('heading', { name: '试卷样式关联', exact: true })).toBeVisible();
  // 不应goto/reload与自动导航竞争；开始页与制卷内容分别仅请求一次。
  expect(requests).toEqual([
    'GET /project/my/reviewPaper', 'POST /api/qrProject/paper-review/end', 'GET /project/my/makePaper',
  ]);
});
