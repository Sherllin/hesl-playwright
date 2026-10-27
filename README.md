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

### 题干双栏、三栏布局导出 PDF（CASE-005 / TAPD 1007416）

入口为 `projects/bmtk/journeys/column-layout-output.spec.ts`，现有 UI 面板自动发现两条：

| 编号 | 检查内容 |
|---|---|
| CASE-005.1 | 双栏实验条件与结果，保存重进及审题入库制卷后 PDF 仍左右并排，各栏保留灰色虚线框 |
| CASE-005.2 | 三栏建模、消元与验算，保存重进及审题入库制卷后 PDF 仍左右并排，各栏保留灰色虚线框 |

```bash
pnpm run test:bmtk --grep CASE-005.1 --headed
pnpm run test:bmtk --grep CASE-005.2 --headed
# 两条串行：pnpm run test:bmtk --grep CASE-005
```

这两条依据 TAPD 中原 `TASK-EDITOR-TOOLBAR 双栏材料/三栏步骤` 场景重建；原 spec 当前不在源码仓，未直接复制旧脚本。每条使用本工程 `.env` 六个独立角色及 `BMTK_PDF_PYTHON`，运行前确认六角色窗口释放，CLI 和 UI 不要同时运行。Python 依赖与 CASE-002 一致；不依赖产品源码、原仓账号池、数据库直连或清库。

每次新建并保留独立 E2E 学科、无模板项目和非默认样式。通过真实工具栏插入等宽双栏/三栏并逐栏填写，点击返回保存、重新进入、刷新核对，再确认提交；审题结束后核对普通题库仍隐藏保密题，再在已受派的活动组卷任务中核对原题 ID、完整分栏题干及答案，组卷暂存重进，审卷和制卷定稿后下载实际试卷 PDF。整页样式固定为一栏单面，专门检查题干内的分栏；沿用公共样式准备工具通过 API 新建并回读配置，实际关联和下载走 UI。

PDF 检查题干开头的作答要求完整保留，每列首行、正文、结尾各出现一次且完整，位于同页，首行顶部差不超过 1pt，各列按从左到右排列且文字不重叠、不越出纸张。初始编辑、保存重进、刷新三个阶段均检查四侧计算样式为 `1px dashed #ddd`。最终 PDF 每栏必须有包围本栏三个标记的四边灰色虚线，线宽为等价的 0.75pt；同时检查实际渲染像素中的虚线和间隔，支持相邻栏共享边界。缺边、无边、错误颜色/线宽、实线、无关框和只框住整组的外框均判 FAIL。文字齐全但上下堆叠仍判 FAIL，不以下载成功替代布局验收。本组只验试卷 PDF，不声明业务 Word/DOCX 导出已验收。不是原始语料逐字复刻，列内补充了唯一短标记以便直接定位 PDF 字符坐标；保留实验条件/结果及建模/消元/验算的业务场景。

附件包含初始/重进/刷新后的编辑器四侧计算样式、完整列框截图和尺寸、受授权组卷选题接口核实的原题入库数据、普通题库保密隐藏证据、项目与试卷身份、下载 PDF、PDF 全部页面图片和原始字符坐标、边框像素与四边框坐标；即使布局断言失败也可回查文件和坐标，失败保留 trace。未迁入原仓通用系统异常监控器，保留本场景业务成功、内容持久化和 PDF 几何断言。CASE 编号只属于本工程，不是 TAPD 测试管理编号。

2026-10-27 用户在本地环境 UI 面板执行 CASE-005.1、CASE-005.2，均通过完整业务流程及 PDF 布局、边框检查，并核对实际导出截图。该结果仅代表本地环境，不代替远端环境验收。
