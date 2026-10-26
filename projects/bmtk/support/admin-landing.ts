import { expect, type Page } from '@playwright/test';

export async function waitForAdminLanding(page: Page): Promise<void> {
  const target = '/question/course/manage';
  const origin = new URL(page.url()).origin;
  // useRefreshToken 读取身份后会 window.location.href 跳转；只等待最终状态，避免发起竞争导航。
  await expect(page).toHaveURL(url => url.origin === origin && url.pathname === target, { timeout: 60_000 });
  await expect(page.locator('.aside-nav')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: '新建学科题库', exact: true })).toBeVisible({ timeout: 60_000 });
}
