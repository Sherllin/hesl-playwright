import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { waitForBusinessResponse } from './api';
const ROUTES = { myTask: '/project/task', forbidden: '/403' };
const MY_TASK_LIST = '/qrProject/my-task/list';
const isMyTaskList = (response: Response) =>
  response.request().method() === 'POST' && response.url().includes(MY_TASK_LIST);

export async function gotoMyTask(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    // 先挂监听再导航；被回收的响应由 waitForBusinessResponse 跳过，不再抛 CDP 协议错误。
    const loaded = waitForBusinessResponse(page, isMyTaskList).then(
      value => value,
      () => undefined,
    );
    if (attempt === 0) {
      await page.goto(ROUTES.myTask, {
        waitUntil: 'domcontentloaded',
        timeout: 90_000,
      });
    } else {
      await page.reload({
        waitUntil: 'domcontentloaded',
        timeout: 90_000,
      });
    }
    if (page.url().includes(ROUTES.forbidden)) return;
    await page.getByTestId('my-task-sticky-top').waitFor({
      state: 'visible',
      timeout: 90_000,
    });
    const located = await loaded;
    if (!located) continue;
    expect(located.response.ok(), '“我的任务”列表请求必须成功').toBeTruthy();
    expect(located.body.code, '“我的任务”列表请求必须业务成功').toBe('E200');
    await page.locator('.ant-spin-spinning').waitFor({
      state: 'hidden',
      timeout: 30_000,
    });
    return;
  }
  throw new Error('“我的任务”列表请求没有拿到可读的成功响应（已重载一次）');
}

export function myTaskProjectGroup(page: Page, projectName: string): Locator {
  return page
    .getByRole('heading', { name: projectName, exact: true })
    .locator('xpath=ancestor::section[.//*[@data-testid="my-task-node"]][1]');
}

// 仅负责从项目任务分组进入详情，不承担出题、审题或组卷。
export class TaskPage {
  constructor(private readonly page: Page) { }

  async openNodeTask(
    taskHint: string,
    buttonText: RegExp | string,
  ): Promise<void> {
    // dev 水合边缘：按钮首次点击可能不导航。每轮重新进入我的任务页并以当前聚合分组为锚点，
    // 不再依赖已删除的列表/搜索结构；最多 3 轮（含重载）。
    const matches = (url: URL) =>
      /\/project\/(?:task\/|my\/makePaper)/.test(url.pathname);
    for (let round = 0; round < 3; round++) {
      await gotoMyTask(this.page);
      const projectGroup = myTaskProjectGroup(this.page, taskHint);
      if (
        !(await projectGroup
          .waitFor({ state: "visible", timeout: 30_000 })
          .then(() => true)
          .catch(() => false))
      ) {
        continue;
      }
      const btn = projectGroup
        .getByRole("button", { name: buttonText })
        .first();
      if (
        !(await btn
          .waitFor({ state: "visible", timeout: 30_000 })
          .then(() => true)
          .catch(() => false))
      )
        continue;
      // 详情路由随节点分叉到 /project/task/<sub>；制卷由负责人从我的项目进入。3 次点击尝试。
      let navigated = false;
      for (let attempt = 0; attempt < 3 && !navigated; attempt++) {
        await btn.click().catch(() => { });
        navigated = await this.page
          .waitForURL(matches, { timeout: attempt < 2 ? 20_000 : 40_000 })
          .then(() => true)
          .catch(() => false);
      }
      if (navigated) {
        await this.page.waitForLoadState("networkidle").catch(() => { });
        return;
      }
    }
    throw new Error(
      `openNodeTask: 点击「${taskHint}」任务卡「${buttonText}」按钮后未跳转详情（3 轮含重载仍停在 ${this.page.url()}）`,
    );
  }
}
