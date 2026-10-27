import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { selectTenant } from './tenant-selection';
import { waitForAdminLanding } from './admin-landing';

for (const { pauseIdentity, autoLand, admin, closeAfterIdentity } of [
  { pauseIdentity: false, autoLand: true, admin: true, closeAfterIdentity: false },
  { pauseIdentity: true, autoLand: true, admin: true, closeAfterIdentity: false },
  { pauseIdentity: false, autoLand: false, admin: false, closeAfterIdentity: false },
  { pauseIdentity: false, autoLand: true, admin: false, closeAfterIdentity: false },
  { pauseIdentity: false, autoLand: false, admin: false, closeAfterIdentity: true },
]) {
  test(`${closeAfterIdentity ? '页面关闭仍保留原始失败；' : ''}选组织读取真实浏览器身份，${autoLand ? admin ? '管理员自动落地' : '普通成员自动落地' : '未分配任务成员可留在组织页'}，响应${pauseIdentity ? '延迟' : '立即'}返回`, async ({ page }) => {
    const landingPath = admin ? '/question/course/manage' : '/project/my';
    let identityRead = 0;
    let nativeIdentityFinished = false;
    let readbackAfterNative = false;
    let finishIdentity: (() => void) | undefined;
    const server = createServer((request, response) => {
      const path = new URL(request.url!, 'http://localhost').pathname;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (path === '/api/user/tenant/refreshToken') {
        response.end(JSON.stringify({ code: 'E200', data: { token: 'synthetic-tenant-session' } }));
      } else if (path === '/api/user/tenant-user/get-user-info') {
        identityRead++;
        const currentRead = identityRead;
        if (currentRead === 2) readbackAfterNative = nativeIdentityFinished;
        const finish = () => {
          if (currentRead === 1) nativeIdentityFinished = true;
          response.end(JSON.stringify({ code: 'E200', data: {
          tenantUserDTO: { id: '2114659223346601984', code: 'synthetic-admin', name: '合成管理员' },
        } }));
        };
        if (pauseIdentity && identityRead === 1) finishIdentity = finish;
        else finish();
      } else if (path === landingPath) {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<nav class="aside-nav">题库</nav><button>新建学科题库</button>');
      } else {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(`<button id="tenant">测试组织</button><output id="state"></output><script>
          document.querySelector('#tenant').onclick = async () => {
            const refreshed = await (await fetch('/api/user/tenant/refreshToken')).json();
            if (refreshed.code !== 'E200') return;
            document.cookie='token='+refreshed.data.token+'; path=/';
            localStorage.setItem('token',refreshed.data.token);
            document.querySelector('#state').textContent = '身份读取中';
            const identity = await (await fetch('/api/user/tenant-user/get-user-info')).json();
            if (identity.code === 'E200') ${autoLand ? `window.location.href='${landingPath}'` : "document.querySelector('#state').textContent='身份就绪'"};
          };
        </script>`);
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('离线HTTP fixture端口不可用');
    try {
      await page.goto(`http://127.0.0.1:${address.port}/pick`);
      const selected = selectTenant(page, page.getByRole('button', { name: '测试组织' }), async () => {
        if (admin) await waitForAdminLanding(page);
        if (closeAfterIdentity) { await page.close(); throw new Error('原始业务失败'); }
      });
      if (pauseIdentity) {
        await expect(page.locator('#state')).toHaveText('身份读取中');
        await expect.poll(() => Boolean(finishIdentity)).toBe(true);
        await expect(page).toHaveURL(/\/pick$/);
        finishIdentity!();
      }
      if (closeAfterIdentity) {
        await expect(selected).rejects.toThrow('原始业务失败');
        return;
      }
      const identity = await selected;
      expect(identity.tenantUserDTO).toEqual({ id: '2114659223346601984', code: 'synthetic-admin', name: '合成管理员' });
      await expect(page).toHaveURL(url => url.pathname === (autoLand ? landingPath : '/pick'));
      if (!autoLand) await expect(page.locator('#state')).toHaveText('身份就绪');
      expect(identityRead, '浏览器原生身份请求与独立身份回读都必须完成').toBe(2);
      expect(readbackAfterNative, '身份回读不能替代或抢在浏览器原生请求完成之前').toBe(true);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
}

for (const failed of ['refreshToken', 'get-user-info']) {
  test(`${failed}返回HTTP200但业务拒绝时，不能把选组织当作成功`, async ({ page }) => {
    const server = createServer((request, response) => {
      const path = new URL(request.url!, 'http://localhost').pathname;
      if (path.startsWith('/api/')) {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({ code: path.endsWith(failed) ? '10301' : 'E200', data: {} }));
      } else {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(`<button id="pick">测试组织</button><script>
          document.querySelector('#pick').onclick = async () => {
            try {
              await fetch('/api/user/tenant/refreshToken');
              await fetch('/api/user/tenant-user/get-user-info');
            } catch {}
          };
        </script>`);
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('离线HTTP fixture端口不可用');
    try {
      await page.goto(`http://127.0.0.1:${address.port}/pick`);
      await expect(selectTenant(page, page.getByRole('button', { name: '测试组织' }))).rejects.toThrow(/E200/);
      await expect(page).toHaveURL(/\/pick$/);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
}


test('浏览器身份业务失败时，后续API回读成功也不能掩盖该失败', async ({ page }) => {
  let reads = 0;
  const server = createServer((request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname;
    if (path.endsWith('/refreshToken')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ code: 'E200', data: { token: 'synthetic-session' } }));
    } else if (path.endsWith('/get-user-info')) {
      reads++;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(reads === 1 ? { code: '10301', data: {} } : {
        code: 'E200', data: { tenantUserDTO: { id: '2114659223346601984', code: 'synthetic-admin', name: '合成管理员' } },
      }));
    } else {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<button id="pick">测试组织</button><script>
        document.querySelector('#pick').onclick = async () => {
          await fetch('/api/user/tenant/refreshToken');
          await fetch('/api/user/tenant-user/get-user-info');
        };
      </script>`);
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('离线HTTP fixture端口不可用');
  try {
    await page.goto(`http://127.0.0.1:${address.port}/pick`);
    await expect(selectTenant(page, page.getByRole('button', { name: '测试组织' }))).rejects.toThrow(/E200/);
    expect(reads).toBe(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
