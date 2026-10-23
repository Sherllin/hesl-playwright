import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const cli = require.resolve('@playwright/test/cli');

test('真实运行按编号倒序保留本地历史，列举用例不写历史', () => {
  test.setTimeout(30_000);
  const dir = mkdtempSync(join(tmpdir(), 'bmtk-history-check-'));
  const history = join(dir, 'history.md');
  try {
    writeFileSync(join(dir, 'playwright.config.cjs'), `module.exports = {
      testDir: '.', testMatch: '*.spec.cjs', workers: 1,
      outputDir: ${JSON.stringify(join(dir, 'results'))},
      reporter: [[${JSON.stringify(resolve('packages/runtime/run-history-reporter.ts'))},
        { outputFile: ${JSON.stringify(history)} }]],
      projects: [{ name: 'sample', metadata: { runEnvironment: {
        name: '离线 | 样例', baseURL: 'https://user:secret@example.test/?token=hidden'
      } } }]
    };`);
    writeFileSync(join(dir, 'sample.spec.cjs'), `const { test, expect } = require(${JSON.stringify(require.resolve('@playwright/test'))});
      test('CASE-LOCAL 通过', () => expect(1).toBe(1));
      test('CASE-LOCAL 失败', () => expect(1).toBe(2));
      test.skip('CASE-LOCAL 跳过', () => {});
    `);
    const run = (...args: string[]) => spawnSync(process.execPath,
      [cli, 'test', '--config', join(dir, 'playwright.config.cjs'), ...args],
      { encoding: 'utf8', timeout: 15_000 });
    const listed = run('--list');
    expect(listed.status, listed.stdout + listed.stderr).toBe(0);
    expect(existsSync(history)).toBe(false);
    const first = run();
    expect(first.status, first.stdout + first.stderr).toBe(1);
    expect(existsSync(history), first.stdout + first.stderr).toBe(true);
    const content = readFileSync(history, 'utf8');
    expect(content).toContain('北京时间');
    expect(content).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect(content).toContain('离线 \\| 样例');
    expect(content).toContain('https://example.test');
    expect(content).not.toMatch(/secret|token|hidden/);
    expect(content).toMatch(/CASE-LOCAL 通过.*通过.*\d+(?:\.\d)?s/);
    expect(content).toMatch(/CASE-LOCAL 失败.*失败/);
    expect(content).toMatch(/CASE-LOCAL 跳过.*跳过/);
    const second = run('--grep', '通过');
    expect(second.status, second.stdout + second.stderr).toBe(0);
    const appended = readFileSync(history, 'utf8');
    const rows = appended.split('\n').filter(line => /^\| \d+ \|/.test(line));
    expect(rows.map(line => Number(line.split('|')[1]))).toEqual([4, 3, 2, 1]);
    expect(rows[0]).toContain('CASE-LOCAL 通过');
    expect(rows.slice(1).join('\n')).toBe(content.split('\n').filter(line => /^\| \d+ \|/.test(line)).join('\n'));
    expect(appended.match(/CASE-LOCAL 通过/g)).toHaveLength(2);
    expect(appended.match(/运行时间（北京时间）/g)).toHaveLength(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test('兼容旧历史，缺少地址显示横线，只保留最新100条且编号持续递增', () => {
  test.setTimeout(30_000);
  const dir = mkdtempSync(join(tmpdir(), 'bmtk-history-limit-'));
  const history = join(dir, 'history.md');
  const config = join(dir, 'playwright.config.cjs');
  try {
    writeFileSync(config, `module.exports = {
      testDir: '.', testMatch: '*.spec.cjs', workers: 1,
      outputDir: ${JSON.stringify(join(dir, 'results'))},
      reporter: [[${JSON.stringify(resolve('packages/runtime/run-history-reporter.ts'))},
        { outputFile: ${JSON.stringify(history)} }]],
    };`);
    writeFileSync(join(dir, 'sample.spec.cjs'), `const { test } = require(${JSON.stringify(require.resolve('@playwright/test'))});
      test('CASE-NEW', () => {});
      for (let n = 1; n <= 101; n++) test('BULK-' + n, () => {});
    `);
    // 旧版文件按时间正序写入，环境和标题中的转义竖线不能影响迁移。
    writeFileSync(history, '# 测试运行记录\n\n'
      + '| 运行时间（北京时间） | 项目 | 环境 | 地址 | 用例 | 结果 | 耗时 | 重试次数 |\n'
      + '|---|---|---|---|---|---|---|---|\n'
      + '| 2026-10-22 08:00:00 | checks | 本地 | 未配置 | OLD-1 | 通过 | 1.00 秒 | 0 |\n'
      + '| 2026-10-22 09:00:00 | checks | 本地 \\| 样例 | 未配置 | OLD-2 \\| 标题 | 通过 | 2.00 秒 | 0 |\n');
    const run = (grep: string) => {
      const result = spawnSync(process.execPath, [cli, 'test', '--config', config, '--grep', grep],
        { encoding: 'utf8', timeout: 15_000 });
      expect(result.status, result.stdout + result.stderr).toBe(0);
      return readFileSync(history, 'utf8').split('\n').filter(line => /^\| \d+ \|/.test(line));
    };
    const migrated = run('CASE-NEW');
    expect(migrated.map(line => Number(line.split('|')[1]))).toEqual([3, 2, 1]);
    expect(migrated[0]).toMatch(/ \| - \| CASE-NEW \|/);
    expect(migrated[1]).toContain('本地 \\| 样例 | - | OLD-2 \\| 标题');
    expect(migrated[2]).toContain('OLD-1');
    const capped = run('BULK-');
    expect(capped).toHaveLength(100);
    expect(capped.map(line => Number(line.split('|')[1]))).toEqual(Array.from({ length: 100 }, (_, i) => 104 - i));
    expect(capped[0]).toContain('BULK-101');
    expect(capped[99]).toContain('BULK-2');
    const next = run('CASE-NEW');
    expect(next).toHaveLength(100);
    expect(next[0]).toMatch(/^\| 105 \|/);
    expect(next[0]).toContain('CASE-NEW');
    expect(next[1]).toContain('BULK-101');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('不在记录名单内的项目不写运行记录', () => {
  test.setTimeout(30_000);
  const dir = mkdtempSync(join(tmpdir(), 'bmtk-history-filter-'));
  const history = join(dir, 'history.md');
  try {
    writeFileSync(join(dir, 'playwright.config.cjs'), `module.exports = {
      testDir: '.', testMatch: '*.spec.cjs', workers: 1,
      outputDir: ${JSON.stringify(join(dir, 'results'))},
      reporter: [[${JSON.stringify(resolve('packages/runtime/run-history-reporter.ts'))},
        { outputFile: ${JSON.stringify(history)}, projects: ['bmtk'] }]],
      projects: [{ name: 'checks' }]
    };`);
    writeFileSync(join(dir, 'sample.spec.cjs'), `const { test } = require(${JSON.stringify(require.resolve('@playwright/test'))});
      test('离线检查', () => {});
    `);
    const run = spawnSync(process.execPath,
      [cli, 'test', '--config', join(dir, 'playwright.config.cjs')],
      { encoding: 'utf8', timeout: 15_000 });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(existsSync(history), 'checks 项目不应写入运行记录').toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
