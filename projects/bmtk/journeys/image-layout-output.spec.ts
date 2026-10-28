import { test } from '../support/fixtures';
import { runImageLayoutOutput } from '../flows/image-layout-output.flow';

for (const columns of [1, 2] as const) {
  test(`CASE-014.${columns} ${columns === 1 ? '单栏' : '双栏'}试卷与两种答案PDF图片完整且不裁切、不遮挡文字`, async ({ actors, bmtkConfig }, info) => {
    test.setTimeout(1_200_000);
    info.annotations.push(
      { type: 'TAPD', description: 'https://www.tapd.cn/tapd_fe/my/work?dialog_preview_id=bug_1155506846001007402' },
      { type: 'scope', description: '工作区API准备三道合成图片题，真实审题组卷审卷制卷及三种PDF输出；不覆盖编辑器上传和原Word导入' },
    );
    await runImageLayoutOutput(actors, bmtkConfig, info, columns);
  });
}
