import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { InterventionRecoveryPage } from './intervention-recovery.page';

test('申请成功后按新标题关闭提交记录弹窗，不再寻找已不存在的申请弹窗', async ({ browser }) => {
  const record = { id: '9007199254740993', projectId: '9007199254740995',
    projectName: '离线项目', reason: '结束原任务交负责人补建', status: 1, remark: null };
  // page.request不会经过page.route；本机HTTP夹具同时承接UI及只读API，不访问真实服务。
  const server = createServer((request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname;
    if (path === '/api/qrProject/intervention/apply') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ code: 'E200', data: record.id }));
    } else if (path === '/api/qrProject/intervention/list') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ code: 'E200', data: [record] }));
    } else {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`
        <button id="open">申请管理员介入</button>
        <section hidden role="dialog" aria-label="申请管理员介入">
          <textarea placeholder="请填写申请系统管理员介入的理由"></textarea><button id="submit">确定</button>
        </section>
        <script>
          const dialog = document.querySelector('section');
          document.querySelector('#open').onclick = () => { dialog.hidden = false; };
          document.querySelector('#submit').onclick = async () => {
            const reason = dialog.querySelector('textarea').value;
            await fetch('/api/qrProject/intervention/apply', { method: 'POST' });
            dialog.setAttribute('aria-label', '提交记录');
            dialog.innerHTML = '<p></p><button aria-label="关闭">×</button>';
            dialog.querySelector('p').textContent = reason;
            dialog.querySelector('button').onclick = () => { dialog.hidden = true; };
          };
        </script>`);
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('本机测试HTTP服务未启动');
  const context = await browser.newContext({ baseURL: `http://127.0.0.1:${address.port}` });
  try {
    const page = await context.newPage();
    await page.goto('/project/my/question');
    const result = await new InterventionRecoveryPage(page, 'offline-token').apply(record.projectId, record.reason);
    expect(result).toEqual(record);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally {
    await context.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('结束任务按业务ID定位，不会结束另一条任务', async ({ page }) => {
  const ended: string[] = [];
  await page.route('https://bmtk.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/qrProject/question-creation/void/')) {
      ended.push(path.split('/').at(-1)!);
      await route.fulfill({ json: { code: 'E200', data: true } });
    } else {
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        <table><tbody>
          <tr data-row-key="9007199254740993"><td>其他任务<button>结束</button></td></tr>
          <tr data-row-key="9007199254740995"><td>目标任务<button>结束</button></td></tr>
        </tbody></table>
        <script>
          for (const row of document.querySelectorAll('tr')) row.querySelector('button').onclick = () => {
            const modal = document.createElement('section');
            modal.setAttribute('role', 'dialog');
            modal.innerHTML = '<h1>确认结束任务</h1><button>确认结束</button>';
            modal.querySelector('button').onclick = async () => {
              await fetch('/api/qrProject/question-creation/void/' + row.dataset.rowKey, { method: 'POST' });
              row.remove(); modal.remove();
            };
            document.body.appendChild(modal);
          };
        </script>` });
    }
  });
  await page.goto('https://bmtk.test/project/my/question');
  await new InterventionRecoveryPage(page, 'offline-token').voidTask('9007199254740995');
  expect(ended).toEqual(['9007199254740995']);
  await expect(page.getByRole('row').filter({ hasText: '其他任务' })).toHaveCount(1);
});
