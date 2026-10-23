import { defineConfig } from '@playwright/test';
import 'dotenv/config';
import { runtimeDefaults } from './packages/runtime/playwright-defaults';

export default defineConfig({
  ...runtimeDefaults,
  projects: [
    {
      name: 'bmtk',
      testDir: './projects/bmtk/journeys',
    },
    {
      name: 'checks',
      testDir: '.',
      testMatch: '**/*.test.ts',
    },
  ],
});
