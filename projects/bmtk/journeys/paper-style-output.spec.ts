import { test } from '../support/fixtures';
import { PAPER_STYLE_LAYOUTS } from '../paper-make/style-layouts';
import { runPaperStyleOutput } from '../flows/paper-style-output.flow';

// 原 REMOTE-19.3；缺陷 https://www.tapd.cn/tapd_fe/55506846/bug/detail/1155506846001007305
// CASE-002 是本工程标题编号，不冒充TAPD测试管理编号。
for (const [index, layout] of PAPER_STYLE_LAYOUTS.entries()) {
  test(`CASE-002.${index + 1} ${layout.label}药学37题全流程关联新样式及PDF和Word六种输出`, async ({ actors, bmtkConfig }, info) => {
    await runPaperStyleOutput(actors, bmtkConfig, info, layout);
  });
}
