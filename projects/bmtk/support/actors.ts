import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { BmtkConfig, Credentials, Role } from './config';
import { businessResponse, responseFor } from './api';
import { selectTenant } from './tenant-selection';
import { waitForAdminLanding } from './admin-landing';

export interface Actor { page: Page; token: string; id: string; name: string }

async function readToken(page: Page): Promise<string> {
  const cookie = (await page.context().cookies()).find(c => c.name === 'token')?.value;
  return cookie ?? await page.evaluate(() => localStorage.getItem('token') ?? '').catch(() => '');
}

async function login(page: Page, credentials: Credentials, tenantName: string, role: Role): Promise<Actor> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const accountLogin = page.getByText('账号登录', { exact: true });
  if (await accountLogin.isVisible()) await accountLogin.click();
  await page.getByPlaceholder('账户').fill(credentials.username);
  await page.getByPlaceholder('密码').fill(credentials.password);
  const loggedIn = responseFor(page, 'POST', '/auth/login');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  const result = await businessResponse<{ initPwd?: boolean }>(await loggedIn);
  if (result?.initPwd) throw new Error('测试账号尚未完成初始化改密，请预先准备可用专用账号');
  await page.waitForURL(url => url.pathname === '/pick' || url.pathname.includes('/system/change-password'));
  if (new URL(page.url()).pathname !== '/pick') throw new Error('账号要求改密，请预先初始化专用测试账号');
  const tenant = page.locator('div.cursor-pointer').filter({ has: page.getByText(tenantName, { exact: true }) });
  await expect(tenant, '组织必须按完整名称唯一匹配').toHaveCount(1);
  const previousToken = await readToken(page);
  const identity = await selectTenant(page, tenant, async () => {
    if (role === 'admin') await waitForAdminLanding(page);
  });
  await expect.poll(() => readToken(page), { timeout: 30_000 }).not.toBe(previousToken);
  await expect.poll(() => readToken(page), { timeout: 30_000 }).not.toBe('');
  const token = await readToken(page);
  expect(identity.tenantUserDTO.code, '当前登录者必须是指定账号').toBe(credentials.username);
  expect(typeof identity.tenantUserDTO.id).toBe('string');
  expect(identity.tenantUserDTO.name).toBeTruthy();
  return { page, token, id: identity.tenantUserDTO.id, name: identity.tenantUserDTO.name };
}

// 一次用例内每个角色只有一个独立会话；按需登录，不反复重登使自己的页面失效。
export class Actors {
  private readonly sessions = new Map<Role, Promise<Actor>>();
  private readonly authenticated = new Map<Role, Actor>();
  private readonly contexts: BrowserContext[] = [];
  constructor(private readonly browser: Browser, private readonly config: BmtkConfig) { }

  get(role: Role): Promise<Actor> {
    let actor = this.sessions.get(role);
    if (!actor) { actor = this.open(role); this.sessions.set(role, actor); }
    return actor;
  }

  private async open(role: Role): Promise<Actor> {
    const context = await this.browser.newContext({
      baseURL: this.config.baseURL, locale: 'zh-CN',
      serviceWorkers: 'block'
    });
    this.contexts.push(context);
    context.setDefaultTimeout(30_000);
    context.setDefaultNavigationTimeout(90_000);
    const actor = await login(await context.newPage(), this.config.accounts[role], this.config.tenantName, role);
    for (const other of this.authenticated.values()) {
      expect(actor.id, '不同测试角色不能映射同一成员').not.toBe(other.id);
      expect(actor.name, '成员选择需要可唯一匹配的完整姓名').not.toBe(other.name);
    }
    this.authenticated.set(role, actor);
    return actor;
  }

  async close(): Promise<void> {
    await Promise.all(this.contexts.map(context => context.close()));
  }
}
