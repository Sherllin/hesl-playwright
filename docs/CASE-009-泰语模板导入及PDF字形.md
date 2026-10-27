# CASE-009：泰语模板导入及 PDF 字形

对应 TAPD [1007366](https://www.tapd.cn/tapd_fe/55506846/bug/detail/1155506846001007366)。
入口：`projects/bmtk/journeys/thai-template-output.spec.ts`。

| 编号 | 场景 |
|---|---|
| CASE-009.1 | Word 官方模板导入、保存、预览及题目 PDF 泰文字形 |
| CASE-009.2 | Excel 官方模板导入、保存、预览及题目 PDF 泰文字形 |

在工程根目录执行：

```bash
pnpm run test:ui
# 面板搜索 CASE-009，可分别点击两条用例的运行按钮。
# 命令行单跑 Word：
pnpm run test:bmtk --grep 'CASE-009\.1' --headed
# 单跑 Excel：
pnpm run test:bmtk --grep 'CASE-009\.2' --headed
# 两条串行：
pnpm run test:bmtk --grep CASE-009 --headed
```

本单要求**关闭 AI 的模板导入入口**，与原 39 非 AI 场景一致；请让 `.env` 中的 `BMTK_BASE_URL` 指向对应测试站点，不在本用例中切换站点功能。沿用本工程私有 `.env`。实际只登录管理员，继续使用现有六角色配置校验；执行前释放管理员的其他测试窗口，CLI 和 UI 不同时跑。每条新建并保留一个独立 E2E 学科和一份历史试卷，不复用原问题现场，不清库、不连接数据库。

`BMTK_PDF_PYTHON` 指向的 Python 需要 `openpyxl`、`PyMuPDF`、`Pillow`、`pypdf>=5,<7`。用例在登录和创建业务数据前检查依赖；缺少依赖时直接失败，不跳过。可在该 Python 的虚拟环境中补装：

```bash
python -m pip install openpyxl PyMuPDF Pillow 'pypdf>=5,<7'
```

上面 `python` 应替换为 `.env` 中 `BMTK_PDF_PYTHON` 指定的解释器。无需本机 LibreOffice，不读取产品源码仓、原仓账号池或远程环境配置。

## 检查与证据

复用原 `REMOTE-TPL-MIXED word/excel 数据多样性 diverse-faculty-languages 导入保存及最终导出` 的八题语料和两份模板填写脚本。先从当前站点 UI 下载官方模板，填写并上传，经过真实解析接口、编辑器设分和正式保存；逐题检查题干、题型、解析、难度、答案、选项顺序和声调，保存回读为八题十六分。预览、下载继续走真实 UI 和受控输出流程，无 AI 请求。

泰语原题为“请选择与‘米饭’对应的词语”，A ข่าว、B ข้าว、C ขาว、D เข้า，正确项 B。实际 PDF 必须保留题干、四个词语及其字母/元音/声调；缺失字形 ID、单一方框字形或四词相同的渲染像素均失败。检查预览与 PDF 的页数、主要文字行数及位置偏差；预览逐字字形和声调位置仍应结合原始页面人工核对。PDF 字形自动断言聚焦泰语，不把阿拉伯语 RTL 文本抽取顺序当作本单的新缺陷，不声明所有语种或学生端已验收。

附件含实际下载模板、实际上传文件、解析数据、正式保存回读、试卷身份、编辑器截图、全部预览原图、实际下载 PDF、PDF 所有页面、泰语词语原像素局部图、字形审计 JSON 和逐页布局比较。字形失败使用软断言继续采集比较证据，整条用例仍为 FAIL；不会标记预期失败。

## 离线验证

```bash
pnpm run typecheck
pnpm run lint
pnpm run test:checks
pnpm run test:bmtk --list --grep CASE-009
```

新增离线检查验证实际 DOCX/XLSX 填写和 PDF 字形读取；反例覆盖缺声调、选项换序、错答案、缺字形、全部同方框及相同词语像素，还会生成保留泰文文本映射但字形全部指向 `.notdef` 的真实 PDF，证明“能抽取泰文”不能冒充输出正常。

2026-10-27 用户在本地环境执行 CASE-009.1、CASE-009.2，最新记录分别为15:30:10通过（20.8秒）、15:30:33通过（19.0秒），覆盖完整导入、保存回读、预览与实际PDF下载及字形检查。该结论仅代表本地环境，不代替39等远端环境验收。离线检查和 `--list` 不单独作为业务通过证据；CASE编号仅属于本工程，不是TAPD测试管理编号。

2026-10-27 导航同步补充：模板接口 E200 后仍等待真实编辑页 URL（含 draftId，最长90秒）及标题填入（最长30秒），避免把默认5秒断言超时当作导入或泰文字形失败。离线回归以6秒路由延迟重现旧失败并验证新等待；没有固定等待、强制跳转或改动产品代码。该修正已包含在上述本地业务回归中；其他环境仍需独立验证。

2026-10-27 复合字形检查补充：`get_texttrace()` 的 `glyphId=-1` 可表示复合字形的零宽延续项，并非 `.notdef`。仅当它与同一 span 的主字形同原点、宽度为零时关联 `clusterGlyphId`；主字形仍须有效。完整四词及声调从使用 ActualText 的词语搜索检查，低层 trace 同时采集词语区域内无独立 Unicode 映射的实际声调字形，不再要求每个声调都独立出现正数 glyphId。字形 0、孤立 -1、四词相同像素及缺词仍失败。新增自给自足的复合 ToUnicode/ActualText 真实 PDF 回归，保留真实方框 PDF 反例。
