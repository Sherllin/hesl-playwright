import { test as base } from '@playwright/test';
import { checkPdfReader } from '../../../packages/runtime/pdf';
import { loadBmtkConfig, type BmtkConfig } from './config';
import { Actors } from './actors';

export const test = base.extend<{ actors: Actors }, { bmtkConfig: BmtkConfig }>({
  bmtkConfig: [async ({ }, use) => {
    const config = loadBmtkConfig();
    // 先验证所有本机前置，再进行远端业务写入。
    await checkPdfReader(config.pdfPython);
    await use(config);
  }, { scope: 'worker', auto: true }],
  actors: async ({ browser, bmtkConfig }, use) => {
    const actors = new Actors(browser, bmtkConfig);
    try { await use(actors); } finally { await actors.close(); }
  },
});
