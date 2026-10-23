import { randomUUID } from 'node:crypto';
import { test } from '../support/fixtures';
import { TaskPage } from '../support/task.page';
import { ProjectPage } from '../project-management/project.page';
import { ActivitiesPage } from '../project-management/activities.page';
import { publishMatchingQuestion } from './publish-matching.flow';
import { scoreAndSwapMatching } from '../compose/reorder-matching.flow';
import { ComposePage } from '../compose/compose.page';
import { PaperReviewPage } from '../paper-review/paper-review.page';
import { PaperMakePage } from '../paper-make/paper-make.page';
import { assertMatchingPaper, assertPaperPreserved, assertMatchingDeliveryText } from '../compose/matching.assertions';
import { readPdf } from '../../../packages/runtime/pdf';
import type { MatchingSample } from '../question-bank/matching';

// 迁移来源：原 e2e/specs/remote-smoke/02-project/my-task/matching-compose-child-score-reorder.spec.ts。
// 保留真实出题审核入库、组卷暂存重进、审卷及最终试卷/答案 PDF 核对。
test('CASE-001 匹配题2/5分换序后分值、答案、来源身份和最终PDF保持', async ({ actors, bmtkConfig }) => {
  test.setTimeout(1_200_000);
  // 缩短时间戳，确保题库等名称不超过30字符；保留随机后缀隔离每次运行。
  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const sample: MatchingSample = {
    stem: `E2E-匹配分值主干-${runId}`,
    options: ['华北', '华东', '华南', '西南'].map(text => `E2E-${runId}-${text}`),
    children: [`E2E-${runId}-北京华北`, `E2E-${runId}-上海华东`], answers: ['A', 'B'],
  };
  const { bank, source } = await test.step('真实出题、审题并入库', () => publishMatchingQuestion(actors, sample, runId));
  const admin = await actors.get('admin');
  const leader = await actors.get('leader');
  const composer = await actors.get('composer');
  const reviewer = await actors.get('paperReviewer');
  const projectName = `E2E-匹配分值组卷-${runId}`;
  const project = new ProjectPage(leader.page);
  await test.step('创建独立7分组卷任务', async () => {
    await new ProjectPage(admin.page).create({ name: projectName, leader: leader.name, activity: '只制卷', bankName: bank.name });
    await project.enterProject(projectName);
    await new ActivitiesPage(leader.page).createComposeTask({ name: `E2E-匹配7分卷-${runId}`, composer: composer.name, total: 7 });
  });
  const saved = await test.step('设置2/5分、交换小题、暂存重进核对', async () => {
    await new TaskPage(composer.page).openNodeTask(projectName, /去组卷/);
    return scoreAndSwapMatching(composer.page, {
      projectName, title: `E2E-匹配分值-${runId}`,
      stem: sample.stem, source, scores: [2, 5]
    });
  });
  await test.step('正式提交并审卷，核对同一份卷面', async () => {
    await new ComposePage(composer.page).submit(saved.paperId);
    await project.enterProject(projectName);
    await new ActivitiesPage(leader.page).openPaperReview(reviewer.name);
    await new TaskPage(reviewer.page).openNodeTask(projectName, /去审卷/);
    const review = new PaperReviewPage(reviewer.page);
    const paper = await review.readPaper(reviewer.token, saved.paperId);
    assertMatchingPaper(paper, source, { scores: [2, 5], order: [1, 0] });
    assertPaperPreserved(saved, paper);
    await review.approveAndSubmit();
  });
  await test.step('制卷结项并核对最终试卷和答案PDF', async () => {
    await project.enterProject(projectName);
    await new ActivitiesPage(leader.page).finishPaperReview();
    const make = new PaperMakePage(leader.page);
    await make.associateStyle();
    await make.finishProject(projectName);
    const paper = await readPdf(bmtkConfig.pdfPython, await make.downloadPdf('试卷'));
    const answer = await readPdf(bmtkConfig.pdfPython, await make.downloadPdf('答案'));
    assertMatchingDeliveryText(paper.text, answer.text, sample);
  });
});
