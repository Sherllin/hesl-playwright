import type { PlaywrightTestConfig } from '@playwright/test';

// 所有项目共用运行方式；这里不出现题库地址、账号或业务规则。
export const runtimeDefaults = {
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  // 运行记录收进依赖缓存，避免在项目根目录生成文件夹。
  outputDir: './node_modules/.cache/playwright/test-results',
  reporter: [['list'], ['./packages/runtime/run-history-reporter.ts']],
  use: {
    browserName: 'chromium',
    headless: true,
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    screenshot: 'off',
  },
} satisfies PlaywrightTestConfig;
