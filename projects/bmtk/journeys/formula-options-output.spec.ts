import { test } from '../support/fixtures';
import { runFormulaOptionsOutput } from '../flows/formula-options-output.flow';

test('CASE-012.1 Word原生分式选项两轮导入审题入库制卷后PDF及Word保留ABCD标签', async ({ actors, bmtkConfig }, info) => {
  test.setTimeout(900_000);
  info.annotations.push(
    { type: 'source-case', description: 'TASK-TPL-ROUNDTRIP word：TAPD1007409专项重建，两轮各三题，不代替七题型40题完整回归' },
    { type: 'TAPD', description: 'https://www.tapd.cn/tapd_fe/my/work?dialog_preview_id=bug_1155506846001007409' },
  );
  await runFormulaOptionsOutput(actors, bmtkConfig, info);
});
