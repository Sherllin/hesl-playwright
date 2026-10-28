import { test } from '../support/fixtures';
import { runHorizontalRuleOutput } from '../flows/horizontal-rule-output.flow';

test('CASE-011.1 题干水平分割线与加粗保存重进及审题入库制卷后PDF和Word均保留', async ({ actors, bmtkConfig }, info) => {
  info.annotations.push(
    { type: 'source-case', description: 'TASK-EDITOR-TOOLBAR 分隔线与加粗 实际编辑保存刷新与审题入库（专项重建）' },
    { type: 'TAPD', description: 'https://www.tapd.cn/tapd_fe/55506846/bug/detail/1155506846001007415' },
  );
  await runHorizontalRuleOutput(actors, bmtkConfig, info);
});
