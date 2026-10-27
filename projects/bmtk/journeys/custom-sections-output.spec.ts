import { test } from '../support/fixtures';
import { runCustomSectionsOutput } from '../flows/custom-sections-output.flow';

for (const [index, selection] of (['continuous', 'separate'] as const).entries()) {
  test(`CASE-010.${index + 1} ${selection === 'continuous' ? '同窗口连续选入' : '按题型分批选入'}四种简答结构题型保存重进及PDF和Word导出保留独立大题标题`, async ({ actors, bmtkConfig }, info) => {
    test.setTimeout(1_200_000);
    info.annotations.push(
      { type: 'TAPD', description: 'https://www.tapd.cn/tapd_fe/my/work?dialog_preview_id=bug_1155506846001007401' },
      { type: 'scope', description: '四种简答结构7/9/8/2题专项重建；真实UI出题组卷导出，不覆盖原Excel/Word模板解析' },
    );
    await runCustomSectionsOutput(actors, bmtkConfig, info, selection);
  });
}
