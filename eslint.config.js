import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// 只启用与类型无关的规则：类型正确性由 tsc 负责，这里兜住 tsc 管不到的地方
// （未使用变量、松散比较、重复声明等）。故意不开 stylistic 规则，避免重排现有格式。
export default tseslint.config(
  { ignores: ['node_modules/**', '.pnpm-store/**', 'node_modules/.cache/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      // 脚本跑在 Node 里；不引 globals 包，只声明脚本实际用到的全局。
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', setTimeout: 'readonly' },
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      // 环境全局（process、Buffer、setTimeout）由 tsc 的 node 类型提供。
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
      // Playwright fixture 用 `async ({}, use)` 声明"不依赖任何 fixture"，是官方写法。
      'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
);
