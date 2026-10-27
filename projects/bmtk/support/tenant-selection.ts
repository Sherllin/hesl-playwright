import { expect, type Locator, type Page } from '@playwright/test';
import { businessResponse, parseJson, responseFor, type Envelope } from './api';

export interface TenantIdentity { tenantUserDTO: { id: string; code: string; name: string } }

/** 不拦截认证请求；等待浏览器身份请求完成后，以当前会话回读真实身份。 */
export async function selectTenant(
  page: Page, tenant: Locator, settled: () => Promise<void> = async () => {},
): Promise<TenantIdentity> {
  const completed = async (path: string) => {
    const response = await responseFor(page, 'GET', path);
    expect(response.ok(), `${path}的真实浏览器HTTP响应必须成功`).toBe(true);
    const error = await response.finished();
    if (error) throw error;
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      // getUserInfo成功后才会自动导航；只对已证实的CDP响应体回收采用可观测URL证据。
      if (!(error instanceof Error) || !/Network\.getResponseBody.*No resource with given identifier/.test(error.message)) throw error;
      await expect(page, '身份响应体被回收时必须已完成真实自动导航').not.toHaveURL(url => url.pathname === '/pick');
      return;
    }
    const body = parseJson<Envelope<unknown>>(text);
    expect(body.code, `浏览器原生身份请求业务失败：${body.message ?? body.code}`).toBe('E200');
  };
  // 两条监听都在点击前注册；身份响应体被自动导航回收时，以实际URL变化确认浏览器初始化成功。
  const refreshed = responseFor(page, 'GET', '/tenant/refreshToken').then(response => businessResponse(response));
  const identified = completed('/tenant-user/get-user-info');
  await Promise.all([tenant.click(), refreshed, identified]);
  const token = (await page.context().cookies()).find(cookie => cookie.name === 'token')?.value
    ?? await page.evaluate(() => localStorage.getItem('token') ?? '');
  const url = new URL('/api/user/tenant-user/get-user-info', page.url());
  const response = await page.request.get(url.toString(), { headers: { Authorization: token } });
  expect(response.ok(), '当前会话身份回读HTTP必须成功').toBe(true);
  const body = parseJson<Envelope<TenantIdentity>>(await response.text());
  expect(body.code, `当前会话身份回读业务失败：${body.message ?? body.code}`).toBe('E200');
  await settled();
  return body.data;
}
