import { expect, test, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Actors } from '../support/actors';
import type { BmtkConfig } from '../support/config';
import { businessResponse, parseJson, responseFor } from '../support/api';
import { TaskPage } from '../support/task.page';
import { BankPage } from '../question-bank/bank.page';
import type { MatchingQuestion } from '../question-bank/matching';
import { ProjectPage } from '../project-management/project.page';
import { ActivitiesPage } from '../project-management/activities.page';
import { HorizontalRuleAuthoringPage } from '../authoring/horizontal-rule.page';
import { QuestionReviewPage } from '../question-review/question-review.page';
import { ComposePage } from '../compose/compose.page';
import type { SavedPaper } from '../compose/matching.assertions';
import { PaperReviewPage } from '../paper-review/paper-review.page';
import { PaperMakePage } from '../paper-make/paper-make.page';
import { preparePaperStyle } from '../paper-make/style-fixture';
import { RULE_SAMPLE, inspectHorizontalRuleOutputs, assertHorizontalRuleOutput } from '../paper-make/horizontal-rule.assertions';
import { checkDocumentTools } from '../../../packages/runtime/document-layout';

/** 1007415：同一道含横线与粗体的原题走完整流程，核对实际PDF及DOCX原件。 */
export async function runHorizontalRuleOutput(actors: Actors, config: BmtkConfig, info: TestInfo) {
  test.setTimeout(900_000);
  const sample = RULE_SAMPLE;
  await checkDocumentTools(config.pdfPython);
  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  const projectName = `E2E-1007415-${runId}`;
  const folderName = `E2E-横线学科-${runId}`;
  const paperName = `E2E-横线试卷-${runId}`;
  const admin = await actors.get('admin');
  const leader = await actors.get('leader');
  const author = await actors.get('author');
  const reviewer = await actors.get('questionReviewer');
  const composer = await actors.get('composer');
  const paperReviewer = await actors.get('paperReviewer');
  const project = new ProjectPage(leader.page);
  const activities = new ActivitiesPage(leader.page);
  const style = await test.step('准备独立一栏单面样式，隔离整页分栏和旧样式干扰', () =>
    preparePaperStyle(admin, { label: '一栏-单面', paperSize: 1, printSetup: 1 }, `E2E-横线样式-${runId}`));
  const bankId = await test.step('创建独立学科、无模板项目和一道简答出题任务', async () => {
    const banks = new BankPage(admin.page);
    await banks.createFolder(folderName);
    await banks.setQuestionTypeEnabled(folderName, '简答题');
    const created = await new ProjectPage(admin.page).create({ name: projectName, leader: leader.name, activity: '无模板', folderName });
    await project.enterProject(projectName);
    await activities.createQuestionTask({ name: paperName, author: author.name, quantity: 1 });
    await info.attach('horizontal-rule-fixture', { body: JSON.stringify({ runId, projectName, bankId: created.bankId, paperName, styleId: style.id, sample }), contentType: 'application/json' });
    return created.bankId;
  });
  const confirmed = await test.step('真实工具栏插入水平分割线与粗体，返回保存、重进刷新后确认提交', async () => {
    await new TaskPage(author.page).openNodeTask(projectName, /去出题/);
    return new HorizontalRuleAuthoringPage(author.page).confirmAndSubmit(projectName, sample);
  });
  const source = await test.step('真实审题通过并核对普通题库的保密可见边界', async () => {
    await project.enterProject(projectName);
    await activities.openQuestionReview(reviewer.name);
    const loaded = responseFor(reviewer.page, 'POST', '/question-review/question-tasks');
    await new TaskPage(reviewer.page).openNodeTask(projectName, /去审题/);
    const data = await businessResponse<{ questions: { records: MatchingQuestion[] } }>(await loaded);
    expect(data.questions.records).toHaveLength(1);
    const reviewed = data.questions.records[0];
    expect(reviewed.id).toBe(confirmed.id);
    expect(reviewed.question).toBe(confirmed.question);
    expect(reviewed.answer).toBe(confirmed.answer);
    const content = reviewer.page.getByTestId('review-content')
      .locator('[data-confidential-content="readonly"][data-confidential-target-name="审题题目"]');
    for (const text of [sample.before, sample.bold]) await expect(content).toContainText(text);
    await expect(content.getByRole('separator')).toHaveCount(1);
    const review = new QuestionReviewPage(reviewer.page);
    await review.approveCurrentQuestion(confirmed.id);
    await review.submitTask();
    await project.enterProject(projectName);
    await activities.finishQuestionReview();
    const bankRead = admin.page.waitForResponse(response => {
      const url = new URL(response.url());
      return (response.request().method() === 'POST' && url.pathname.endsWith('/qrQuestionEntity/getByCatalog')
        && response.request().postDataJSON()?.bankId === bankId) ||
        (response.request().method() === 'GET' && url.pathname.endsWith('/bankFolder/subject-questions') && url.searchParams.get('bankId') === bankId);
    });
    await admin.page.goto(`/question/course/manage/${bankId}`, { waitUntil: 'domcontentloaded' });
    const bank = await businessResponse<{ records: MatchingQuestion[] }>(await bankRead);
    // R10 / PD-03：审题后以保密态入库，解密前普通题库可见计数为0。
    expect(bank.records, '保密题不能提前出现在普通题库列表').toHaveLength(0);
    await expect(admin.page.locator(`[data-confidential-target-type="QUESTION"][data-confidential-target-id="${confirmed.id}"]`)).toHaveCount(0);
    await info.attach('horizontal-rule-confidential-bank-visibility', {
      body: JSON.stringify({ bankId, questionId: confirmed.id, visibleRecords: bank.records }), contentType: 'application/json',
    });
    return reviewed;
  });
  const saved = await test.step('选入原题组卷，暂存重进后正式提交', async () => {
    await project.enterProject(projectName);
    await activities.createComposeTask({ name: paperName, composer: composer.name, total: 100 });
    await new TaskPage(composer.page).openNodeTask(projectName, /去组卷/);
    const compose = new ComposePage(composer.page);
    await compose.setTitle(paperName);
    // 正向入库证据来自当前受派组卷任务；不通过管理员或解密绕过保密边界。
    const available = responseFor(composer.page, 'POST', '/qrQuestionEntity/getByCatalogForProject');
    void available.catch(() => undefined);
    await compose.addQuestion(source, sample.before);
    const response = await available;
    const sent = parseJson<{ bankId: string; projectId: string; taskId: string }>(response.request().postData()!);
    expect(sent.bankId).toBe(bankId);
    expect(typeof sent.projectId).toBe('string');
    expect(typeof sent.taskId).toBe('string');
    const records = await businessResponse<{ records: MatchingQuestion[] }>(response);
    expect(records.records).toHaveLength(1);
    const published = records.records[0];
    expect(published).toMatchObject({ id: source.id, question: source.question, answer: source.answer });
    expect(typeof published.id).toBe('string');
    await info.attach('horizontal-rule-published-question', {
      body: JSON.stringify({ scope: 'active-compose-task', ...sent, question: published }), contentType: 'application/json',
    });
    await compose.setChildScores([100]);
    await compose.expectTotal(1, 100);
    const assertPaper = (paper: SavedPaper) => {
      expect(paper.qrPaperQuestionDTOList).toHaveLength(1);
      expect(paper.qrPaperQuestionDTOList[0].originalQuestionId).toBe(source.id);
      const question = parseJson<MatchingQuestion>(paper.qrPaperQuestionDTOList[0].questionContent);
      expect(question.question).toBe(source.question);
      expect(question.answer).toBe(source.answer);
      expect(Number(paper.paperScore)).toBe(100);
    };
    const paper = await compose.saveDraft();
    assertPaper(paper);
    const reloaded = await compose.reopen(projectName, paper.paperId);
    expect(reloaded.paperId).toBe(paper.paperId);
    assertPaper(reloaded);
    await compose.submit(paper.paperId);
    await info.attach('horizontal-rule-paper', { body: JSON.stringify({ projectName, paperId: paper.paperId, questionId: source.id }), contentType: 'application/json' });
    return paper;
  });
  const make = new PaperMakePage(leader.page);
  await test.step('审卷通过、关联本轮独立样式并结束制卷定稿', async () => {
    await project.enterProject(projectName);
    await activities.openPaperReview(paperReviewer.name);
    await new TaskPage(paperReviewer.page).openNodeTask(projectName, /去审卷/);
    await new PaperReviewPage(paperReviewer.page).approveAndSubmit();
    await project.enterProject(projectName);
    await activities.finishPaperReview();
    await make.associateStyle(style, saved.paperId);
    await make.finishProject(projectName);
  });
  await test.step('下载真实PDF与仅题目Word并先保留全部原件与核验证据', async () => {
    const pdf = await make.downloadPdf('试卷');
    await info.attach('horizontal-rule-paper.pdf', { body: pdf, contentType: 'application/pdf' });
    const docx = await make.downloadDocx('仅题目');
    await info.attach('horizontal-rule-paper.docx', { body: docx,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const evidence = await inspectHorizontalRuleOutputs(config.pdfPython, pdf, docx,
      info.outputPath('horizontal-rule-pages'), sample);
    await info.attach('horizontal-rule-output-evidence', { body: JSON.stringify(evidence), contentType: 'application/json' });
    for (const [index, page] of evidence.pdf.pages.entries())
      await info.attach(`horizontal-rule-pdf-page-${index + 1}`, { path: page.image, contentType: 'image/png' });
    // 产品缺陷保持普通FAIL；先采集两种文件，再分别报告检查结果。
    for (const format of ['pdf', 'docx'] as const) {
      await test.step(`核对${format}题干、横线相对位置与完整结论加粗`, async () => {
        expect.soft(() => assertHorizontalRuleOutput(evidence[format], sample, format), `${format}实际文件`).not.toThrow();
      });
    }
  });
}
