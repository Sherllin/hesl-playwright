// 生成中文用例清单。数据源是 Playwright 自己的 `test --list --reporter=json`，
// 所以清单永远等于实际会被收集的用例：新增 .spec.ts / .test.ts 不用改这个脚本。
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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
    rows.push({ project: spec.tests?.[0]?.projectName ?? '', file: spec.file ?? '', title: spec.title });
  }
  for (const child of suite.suites ?? []) walk(child);
};
for (const suite of report.suites ?? []) walk(suite);

// 用例名开头的 REMOTE-MATCH-09 这类标记单独成一列，便于和需求单对号。
const splitId = title => {
  const matched = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+)\s+(.*)$/.exec(title);
  return matched ? { id: matched[1], name: matched[2] } : { id: '', name: title };
};

const sections = {
  bmtk: '业务用例（真浏览器、按 .env 指向的环境写数据）',
  checks: '离线检查（不连服务器、不起浏览器，纯断言与纯函数）',
};
const order = ['bmtk', 'checks', ...new Set(rows.map(row => row.project))];
const projects = [...new Set(order)].filter(project => rows.some(row => row.project === project));

const lines = [
  '# 用例清单',
  '',
  `> 自动生成，请勿手工编辑。重新生成：\`pnpm run cases\`（数据源 \`playwright test --list\`）`,
  `> 生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })} / 共 ${rows.length} 条`,
  '',
];

for (const project of projects) {
  const own = rows.filter(row => row.project === project);
  lines.push(`## ${project} — ${sections[project] ?? '未分类'}（${own.length} 条）`, '');
  lines.push('| # | 编号 | 用例名 | 文件 |', '|---|---|---|---|');
  own.forEach((row, index) => {
    const { id, name } = splitId(row.title);
    lines.push(`| ${index + 1} | ${id || '—'} | ${name} | \`${row.file}\` |`);
  });
  lines.push('');
}

mkdirSync(path.join(root, 'docs'), { recursive: true });
const target = path.join(root, 'docs/用例清单.md');
writeFileSync(target, `${lines.join('\n')}\n`);

const summary = projects.map(project => `${project} ${rows.filter(row => row.project === project).length} 条`).join('，');
process.stdout.write(`共 ${rows.length} 条：${summary}\n已写入 docs/用例清单.md\n`);
