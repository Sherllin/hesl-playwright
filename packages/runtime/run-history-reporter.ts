import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

const header = '# 测试运行记录\n\n仅保存在本机；最多保留最新 100 条，编号持续递增，最新记录在上，时间为北京时间。\n\n'
  + '| 编号 | 运行时间（北京时间） | 项目 | 环境 | 地址 | 用例 | 结果 | 耗时 | 重试次数 |\n'
  + '|---|---|---|---|---|---|---|---|---|\n';
const statuses: Record<TestResult['status'], string> = {
  passed: '通过', failed: '失败', timedOut: '超时', skipped: '跳过', interrupted: '中断',
};
const clock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function cell(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

// 耗时按分秒显示：1m30s；不足一分钟保留一位小数，便于区分毫秒级的离线检查。
function elapsed(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = (milliseconds - minutes * 60_000) / 1000;
  return minutes > 0 ? `${minutes}m${seconds.toFixed(0)}s` : `${seconds.toFixed(1)}s`;
}


// 只记录站点地址，避免把 URL 中的凭据或查询参数写进历史。
function siteAddress(value: unknown): string {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : '-';
  } catch {
    return '-';
  }
}

// 只按未转义的竖线拆列，保留环境名、用例名中的转义字符。
function columns(line: string): string[] {
  const cells = [''];
  let escaped = false;
  for (const char of line.slice(1, -1)) {
    if (char === '|' && !escaped) {
      cells.push('');
      continue;
    }
    cells[cells.length - 1] += char;
    escaped = char === '\\' ? !escaped : false;
  }
  return cells.map(value => value.trim());
}

function readHistory(file: string): { id: number; values: string[] }[] {
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return content.split('\n')
    .filter(line => /^\| (?:\d+ \||\d{4}-\d{2}-\d{2} )/.test(line))
    .map((line, index) => {
      const values = columns(line);
      // 旧版记录按时间正序保存，迁移时依次补编号。
      const id = values.length === 8 ? index + 1 : Number(values.shift());
      if (values[3] === '未配置' || !values[3]) values[3] = '-';
      return { id, values };
    })
    .sort((a, b) => b.id - a.id);
}

export default class RunHistoryReporter implements Reporter {
  private outputFile = '';

  constructor(private options: { outputFile?: string } = {}) {}

  onBegin(config: FullConfig): void {
    const root = config.configFile ? dirname(config.configFile) : config.rootDir;
    this.outputFile = resolve(root, this.options.outputFile ?? 'docs/测试运行记录.md');
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const project = test.parent.project();
    const environment = project?.metadata.runEnvironment;
    const values = [
      clock.format(result.startTime), project?.name ?? '',
      environment?.name || '未命名环境', siteAddress(environment?.baseURL), test.title,
      statuses[result.status], elapsed(result.duration), result.retry,
    ].map(cell);
    const history = readHistory(this.outputFile);
    const id = (history[0]?.id ?? 0) + 1;
    const rows = [{ id, values }, ...history].slice(0, 100);
    mkdirSync(dirname(this.outputFile), { recursive: true });
    // 每次落盘都读取已有编号，UI 重跑或重新打开后仍然连续递增。
    writeFileSync(this.outputFile, header + rows.map(row => `| ${row.id} | ${row.values.join(' | ')} |\n`).join(''));
  }

  printsToStdio(): boolean { return false; }
}
