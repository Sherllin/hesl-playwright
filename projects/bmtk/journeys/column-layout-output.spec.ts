import { test } from '../support/fixtures';
import { COLUMN_SAMPLES, runColumnLayoutOutput } from '../flows/column-layout-output.flow';

// 重建原TASK-EDITOR-TOOLBAR双栏/三栏业务场景；CASE编号只属于本工程。
for (const [index, { label, sample }] of COLUMN_SAMPLES.entries()) {
  test(`CASE-005.${index + 1} ${label}保存重进及审题入库制卷后PDF仍左右并排`, async ({ actors, bmtkConfig }, info) => {
    info.annotations.push(
      { type: 'source-case', description: `TASK-EDITOR-TOOLBAR ${index === 0 ? '双栏材料' : '三栏步骤'} 实际编辑保存刷新与审题入库` },
      { type: 'TAPD', description: 'https://www.tapd.cn/tapd_fe/55506846/bug/detail/1155506846001007416' },
    );
    await runColumnLayoutOutput(actors, bmtkConfig, info, sample);
  });
}
