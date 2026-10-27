import { expect, test, type Page } from '@playwright/test';
import { expectHeaderLayout, type HeaderGeometry } from './header-layout.assertions';

/** 从原工程 ReviewDecisionsPage.verifyHeaderLayout 提取，保持四档真实页面几何验收。 */
export async function verifyReviewHeaderLayout(page: Page) {
  const original = page.viewportSize();
  const header = page.getByTestId('task-workbench-header');
  const submit = header.getByRole('button', { name: '提交任务', exact: true });
  const progress = header.getByText('任务进度', { exact: true }).locator('..');
  const evidence: HeaderGeometry[] = [];
  try {
    for (const width of [1920, 1280, 1024, 768]) {
      await test.step(`${width}px进度和按钮完整可见、无重叠`, async () => {
        await page.setViewportSize({ width, height: 900 });
        await expect(header).toBeVisible();
        await expect(progress).toBeVisible();
        await expect(submit).toBeVisible();
        await expect(submit, '两题均判定后提交操作必须可用').toBeEnabled();
        // 用最终几何同步浏览器重排；保留软断言以继续收集四种宽度的现场。
        await expect.soft(async () => {
          const p = await progress.boundingBox();
          const s = await submit.boundingBox();
          expect(p).not.toBeNull();
          expect(s).not.toBeNull();
          expectHeaderLayout({ width, progress: p!, submit: s! });
        }).toPass({ timeout: 5000 });
        const p = await progress.boundingBox();
        const s = await submit.boundingBox();
        await test.info().attach(`review-header-${width}`, {
          body: await page.screenshot({ fullPage: false }), contentType: 'image/png',
        });
        await test.info().attach(`review-header-${width}-geometry`, {
          body: JSON.stringify({ url: page.url(), width, progress: p, submit: s }), contentType: 'application/json',
        });
        expect(p).not.toBeNull();
        expect(s).not.toBeNull();
        evidence.push({ width, progress: p!, submit: s! });
      });
    }
  } finally {
    if (original) await page.setViewportSize(original);
  }
  return evidence;
}
