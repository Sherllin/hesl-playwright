### playwright多项目测试
| 目录 | 放什么 |
|---|---|
| `packages/runtime/` | 各项目共用的工具：浏览器配置、PDF 读取 |
| `projects/bmtk/` | 保密题库自己的测试代码 |

进入 `projects/bmtk/`，再按业务分：

| 目录 | 对应业务 |
|---|---|
| `question-bank/` | 题库管理 |
| `authoring/` | 出题 |
| `question-review/` | 审题 |
| `compose/` | 组卷 |
| `paper-review/` | 审卷 |
| `paper-make/` | 制卷 |
| `project-management/` | 创建项目、分配任务、推进活动 |
| `support/` | 登录、账号、成员选择等公共准备 |
| `flows/` | 跨多个业务模块的组合流程 |
| `journeys/` | 所有业务用例 `.spec.ts` 的统一入口 |

新增业务用例时，先在 `projects/bmtk/journeys/` 创建 `.spec.ts`，再调用对应业务目录里的 page、flow 和断言，或 `flows/` 里的跨业务组合。`journeys/` 只保留业务用例入口，单业务和跨业务用例都从这里进入。

业务目录中的 `.page.ts` 封装页面操作，`.flow.ts` 组合本业务操作，`.assertions.ts` 检查结果。跨业务的 `.flow.ts` 放在 `flows/`，例如出题、审题并入库。工具和规则的离线检查使用 `.test.ts`，保留在被检查代码旁。

运行指定用例：

```bash
pnpm run test:bmtk --grep CASE-001 --headed
```

业务用例清单：`pnpm run cases` 会把 `playwright test --list` 的结果渲染成 `docs/业务用例清单.md`，只收 `journeys/` 下的业务用例（project `bmtk`），离线检查不进清单。用例名取自 `test('…')` 里 `编号 + 中文描述` 的写法，不用手工维护。

在 PyCharm 中打开 `package.json`，点击 `scripts` 中 `test:ui` 左侧的运行按钮，再选 Run，打开 Playwright 测试面板。面板会自动发现 `journeys/` 的业务用例，在用例名称旁点击三角按钮即可单独运行。

PyCharm 需启用 Node.js 支持，并将项目包管理器设为 pnpm。若已识别 pnpm，可直接运行。环境、账号和 PDF Python 仍按 `.env.example` 配置。

以后新增用例只需在 `journeys/` 写 `.spec.ts`，无需逐条维护清单或修改运行命令。命令行也可打开面板：

```bash
pnpm run test:ui
```

命令行和 UI 面板每次实际执行用例后，都会自动写入 `docs/测试运行记录.md`，记录编号、北京时间、项目、环境名称、站点地址、用例、结果、耗时和重试次数。最多保留最新 100 条，最新记录在最上方，编号从上到下由大到小，并在后续运行中持续递增；地址未配置时显示 `-`。旧版记录会在下次执行用例后自动补编号并转换顺序。UI 中重跑也会记录；只打开面板或列举用例不会写记录。文件只保存在本机，已加入 Git 忽略。

在 `.env` 中可选配置 `BMTK_ENV_NAME=39 测试环境`，地址取自 `BMTK_BASE_URL`；切换环境后重启 UI 面板以读取新配置。`checks` 项目记录为“本地离线检查”。

### 试卷样式导出回归（CASE-002 / TAPD 1007305）

原 `REMOTE-19.3` 已迁入本工程，入口为 `projects/bmtk/journeys/paper-style-output.spec.ts`。
四条用例分别覆盖一栏单面、一栏双面、两栏单面、两栏双面，可在现有 UI 面板独立运行：

```bash
pnpm run test:bmtk --grep CASE-002
# 先只跑一个组合；如需观察操作，加 --headed。
pnpm run test:bmtk --grep CASE-002.1 --headed
```

每条都会用 `.env` 的六个独立角色新建保留的 E2E 学科、样式和无模板项目，实际出题37道、审题、组卷、审卷，再由负责人关联样式、预览、结束制卷并下载六份 PDF/DOCX。运行前确认这些账号窗口未被其他任务占用；`workers=1` 只约束当前进程，不要同时启动另一轮 CLI/UI。不会清库，也不复用旧项目或默认样式。样式仅通过 API 准备并回读以隔离保存缺陷，关联和输出仍走真实 UI。

检查包括全部原题干和120选项、答案与实际题序对应、字体字号颜色、实际分栏、奇偶页边距、科学图比例，以及预览/PDF所有页面的行数和位置。下载原件、页面图及几何信息进入 Playwright 附件。DOCX检查正文和OOXML，不将其声明为原生Word视觉验收。新工程编号不是 TAPD 测试管理编号。

Python 使用 `BMTK_PDF_PYTHON` 指定的解释器；请在该解释器所属环境安装依赖：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install 'pypdf>=5,<7' PyMuPDF Pillow
# Windows：使用 .venv\Scripts\python.exe；把该路径填入本机 .env 的 BMTK_PDF_PYTHON。
```

所有工具与37题语料、科学图片都在本工程内，不需要产品源码仓或原来的 `uv --project backend`。药学原题的答案是明确标注的测试补充值，语料说明见 `projects/bmtk/paper-make/fixtures/README.md`。
