import { test } from '../support/fixtures';
import { runThaiTemplateOutput } from '../flows/thai-template-output.flow';

// 迁入原 REMOTE-TPL-MIXED diverse-faculty-languages（原8题语料），不是Python合成导出单测。
for (const [index, format] of (['word', 'excel'] as const).entries()) {
  test(`CASE-009.${index + 1} ${format === 'word' ? 'Word' : 'Excel'}泰语模板导入保存后预览及PDF选项字形正确`, async ({ actors, bmtkConfig }, info) => {
    test.setTimeout(360_000);
    info.annotations.push(
      { type: 'source-case', description: `REMOTE-TPL-MIXED ${format} 数据多样性 diverse-faculty-languages 导入保存及最终导出` },
      { type: 'TAPD', description: 'https://www.tapd.cn/tapd_fe/55506846/bug/detail/1155506846001007366' },
    );
    await runThaiTemplateOutput(actors, bmtkConfig, info, format);
  });
}
