// 生成业务用例清单。数据源是 Playwright 自己的 `test --list --reporter=json`，
// 所以清单永远等于实际会被收集的用例：journeys/ 下新增 .spec.ts 不用改这个脚本。
// 只收业务用例（project: bmtk）；离线检查（project: checks）不进这份清单。
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BUSINESS_PROJECT = 'bmtk';
const root = process.cwd();
const cli = path.join(root, 'node_modules/@playwright/test/cli.js');
const listed = spawnSync(process.execPath, [cli, 'test', '--list', '--reporter=json'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});
if (listed.status !== 0) {
  process.stderr.write(listed.stderr || listed.stdout);
  process.exit(listed.status ?? 1);
}

const report = JSON.parse(listed.stdout);
const rows = [];
const walk = suite => {
  for (const spec of suite.specs ?? []) {
    if (spec.tests?.[0]?.projectName !== BUSINESS_PROJECT) continue;
    rows.push({ file: spec.file ?? '', title: spec.title });
  }
  for (const child of suite.suites ?? []) walk(child);
};
for (const suite of report.suites ?? []) walk(suite);

// 用例名开头的 REMOTE-MATCH-09 这类标记单独成一列，便于和需求单对号。
const splitId = title => {
  const matched = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+(?:\.\d+)*)\s+(.*)$/.exec(title);
  return matched ? { id: matched[1], name: matched[2] } : { id: '', name: title };
};

const lines = [
  '# 业务用例清单',
  '',
  `> 自动生成，请勿手工编辑。重新生成：\`pnpm run cases\`（数据源 \`playwright test --list\`）`,
  `> 生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })} / 共 ${rows.length} 条`,
  '',
  '| # | 编号 | 用例名 | 文件 |',
  '|---|---|---|---|',
];
rows.forEach((row, index) => {
  const { id, name } = splitId(row.title);
  lines.push(`| ${index + 1} | ${id || '—'} | ${name} | \`${row.file}\` |`);
});

mkdirSync(path.join(root, 'docs'), { recursive: true });
const target = path.join(root, 'docs/业务用例清单.md');
writeFileSync(target, `${lines.join('\n')}\n`);

process.stdout.write(`业务用例 ${rows.length} 条\n已写入 docs/业务用例清单.md\n`);
