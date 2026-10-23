import { defineConfig } from '@playwright/test';
import 'dotenv/config';
import { runtimeDefaults } from './packages/runtime/playwright-defaults';

export default defineConfig({
  ...runtimeDefaults,
  projects: [
    {
      name: 'bmtk',
      testDir: './projects/bmtk/journeys',
      metadata: {
        runEnvironment: {
          name: process.env.BMTK_ENV_NAME || '未命名环境',
          baseURL: process.env.BMTK_BASE_URL,
        },
      },
    },
    {
      name: 'checks',
      testDir: '.',
      testMatch: '**/*.test.ts',
      metadata: { runEnvironment: { name: '本地离线检查' } },
    },
  ],
});
