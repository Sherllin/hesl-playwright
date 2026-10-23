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
| `journeys/` | 所有业务用例 `.spec.ts` 的统一入口 |

新增业务用例时，先在 `projects/bmtk/journeys/` 创建 `.spec.ts`，再调用对应业务目录里的 page、flow 和断言。单业务和跨业务用例都从这里进入。

业务目录中的 `.page.ts` 封装页面操作，`.flow.ts` 组合操作，`.assertions.ts` 检查结果。工具和规则的离线检查使用 `.test.ts`，保留在被检查代码旁。

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
