import { expect, test, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { checkDocumentTools } from '../../../packages/runtime/document-layout';
import type { Actors } from '../support/actors';
import type { BmtkConfig } from '../support/config';
import { businessResponse, parseJson, responseFor } from '../support/api';
import { TaskPage } from '../support/task.page';
import { BankPage } from '../question-bank/bank.page';
import type { MatchingQuestion } from '../question-bank/matching';
import { ProjectPage } from '../project-management/project.page';
import { ActivitiesPage } from '../project-management/activities.page';
import { FormulaTemplateAuthoringPage } from '../authoring/formula-template.page';
import { QuestionReviewPage } from '../question-review/question-review.page';
import { ComposePage } from '../compose/compose.page';
import type { SavedPaper } from '../compose/matching.assertions';
import { PaperReviewPage } from '../paper-review/paper-review.page';
import { PaperMakePage } from '../paper-make/paper-make.page';
import { preparePaperStyle } from '../paper-make/style-fixture';
import { formulaSamples, assertStoredFormulaQuestions, assertFormulaLabels, assertFormulaPdf } from '../paper-make/template-import/formula-options.assertions';
import { readFormulaDocx, inspectFormulaPdf } from '../paper-make/template-import/formula-options.tools';

/** 1007409专项：原工作区两轮原生Word分式导入，经真实审题组卷制卷核验产物。 */
export async function runFormulaOptionsOutput(actors: Actors, config: BmtkConfig, info: TestInfo): Promise<void> {
  await checkDocumentTools(config.pdfPython);
  const runId = `${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
  const samples = formulaSamples(runId);
  const projectName = `E2E-1007409-${runId}`;
  const folderName = `E2E-公式标签学科-${runId}`;
  const paperName = `E2E-公式标签试卷-${runId}`;
  const admin = await actors.get('admin');
  const leader = await actors.get('leader');
  const author = await actors.get('author');
  const reviewer = await actors.get('questionReviewer');
  const composer = await actors.get('composer');
  const paperReviewer = await actors.get('paperReviewer');
  const project = new ProjectPage(leader.page);
  const activities = new ActivitiesPage(leader.page);
  const style = await test.step('新建独立一栏单面样式，隔离共享样式影响', () =>
    preparePaperStyle(admin, { label: '一栏-单面', paperSize: 1, printSetup: 1 }, `E2E-公式标签样式-${runId}`));
  await test.step('创建独立学科、无模板项目和六题单选出题任务', async () => {
    await new BankPage(admin.page).createFolder(folderName);
    const created = await new ProjectPage(admin.page).create({ name: projectName, leader: leader.name, activity: '无模板', folderName });
    await project.enterProject(projectName);
    await activities.createQuestionTask({ name: paperName, author: author.name, quantity: 6 });
    await info.attach('formula-fixture', { body: JSON.stringify({ runId, projectName, bankId: created.bankId, paperName, styleId: style.id, samples }), contentType: 'application/json' });
  });
  const sources = await test.step('官方Word模板两轮各三题原生分式导入、取消零写入、刷新并逐题确认提交', async () => {
    await new TaskPage(author.page).openNodeTask(projectName, /去出题/);
    return new FormulaTemplateAuthoringPage(author.page).confirmAndSubmit(samples, config.pdfPython, author.token, info);
  });
  await test.step('审题前逐项核对原题公式与答案，真实逐题通过并结束审题', async () => {
    await project.enterProject(projectName);
    await activities.openQuestionReview(reviewer.name);
    const loaded = responseFor(reviewer.page, 'POST', '/question-review/question-tasks');
    await new TaskPage(reviewer.page).openNodeTask(projectName, /去审题/);
    const data = await businessResponse<{ questions: { records: typeof sources } }>(await loaded);
    assertStoredFormulaQuestions(data.questions.records, samples);
    expect(data.questions.records.map(q => q.id).sort()).toEqual(sources.map(q => q.id).sort());
    const remaining = new Set(sources.map(q => q.id));
    const content = reviewer.page.getByTestId('review-content')
      .locator('[data-confidential-content="readonly"][data-confidential-target-name="审题题目"]');
    const review = new QuestionReviewPage(reviewer.page);
    for (let index = 0; index < samples.length; index++) {
      await expect.poll(async () => remaining.has(await content.getAttribute('data-confidential-target-id') ?? ''), { timeout: 90_000 }).toBe(true);
      const id = (await content.getAttribute('data-confidential-target-id'))!;
      await review.approveCurrentQuestion(id);
      remaining.delete(id);
    }
    expect(remaining.size).toBe(0);
    await review.submitTask();
    await project.enterProject(projectName);
    await activities.finishQuestionReview();
  });
  const checkPaper = (paper: SavedPaper) => {
    expect(paper.qrPaperQuestionDTOList.map(q => q.originalQuestionId).sort()).toEqual(sources.map(q => q.id).sort());
    const questions = paper.qrPaperQuestionDTOList.map(q => ({ ...parseJson<MatchingQuestion>(q.questionContent), id: q.originalQuestionId! }));
    assertStoredFormulaQuestions(questions as typeof sources, samples);
    expect(Number(paper.paperScore)).toBe(12);
  };
  const saved = await test.step('授权组卷选入六道原题，暂存重进核对公式、原题ID及答案再正式提交', async () => {
    await project.enterProject(projectName);
    await activities.createComposeTask({ name: paperName, composer: composer.name, total: 12 });
    await new TaskPage(composer.page).openNodeTask(projectName, /去组卷/);
    const compose = new ComposePage(composer.page);
    await compose.setTitle(paperName);
    for (const sample of samples) {
      const source = sources.find(q => q.question.includes(sample.stem))!;
      await compose.addQuestion(source as unknown as MatchingQuestion, sample.stem);
    }
    await compose.setChildScores(samples.map(() => 2));
    await compose.expectTotal(6, 12);
    const saved = await compose.saveDraft();
    checkPaper(saved);
    const reloaded = await compose.reopen(projectName, saved.paperId);
    expect(reloaded.paperId).toBe(saved.paperId);
    checkPaper(reloaded);
    await info.attach('formula-reloaded-paper', { body: JSON.stringify(reloaded), contentType: 'application/json' });
    await compose.submit(saved.paperId);
    return saved;
  });
  const make = new PaperMakePage(leader.page);
  await test.step('审卷核对原题，通过后关联独立样式并结束制卷定稿', async () => {
    await project.enterProject(projectName);
    await activities.openPaperReview(paperReviewer.name);
    await new TaskPage(paperReviewer.page).openNodeTask(projectName, /去审卷/);
    const review = new PaperReviewPage(paperReviewer.page);
    checkPaper(await review.readPaper(paperReviewer.token, saved.paperId));
    await review.approveAndSubmit();
    await project.enterProject(projectName);
    await activities.finishPaperReview();
    await make.associateStyle(style, saved.paperId);
    await make.finishProject(projectName);
    await info.attach('formula-final-identity', { body: JSON.stringify({ projectName, paperId: saved.paperId, pageURL: leader.page.url() }), contentType: 'application/json' });
  });
  const outputs = await test.step('先下载保留试卷、带题干答案两份PDF及对应两份Word原件', async () => {
    const outputs = [
      { name: 'paper.pdf', answers: false, bytes: await make.downloadPdf('试卷') },
      { name: 'combined.pdf', answers: true, bytes: await make.downloadPdf('答案', { includeQuestion: true }) },
      { name: 'paper.docx', answers: false, bytes: await make.downloadDocx('仅题目') },
      { name: 'combined.docx', answers: true, bytes: await make.downloadDocx('题目加答案') },
    ];
    for (const output of outputs) await info.attach(`formula-${output.name}`, { body: output.bytes,
      contentType: output.name.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    return outputs;
  });
  for (const output of outputs) {
    await test.step(`${output.name}逐题核对独立ABCD标签、公式内容和答案对应`, async () => {
      if (output.name.endsWith('.pdf')) {
        const pdf = await inspectFormulaPdf(config.pdfPython, output.bytes, info.outputPath(output.name));
        await info.attach(`formula-${output.name}-geometry`, { body: JSON.stringify(pdf), contentType: 'application/json' });
        for (const [index, page] of pdf.pages.entries())
          await info.attach(`formula-${output.name}-page-${index + 1}`, { path: page.image, contentType: 'image/png' });
        expect.soft(() => assertFormulaPdf(pdf, samples, output.answers), output.name).not.toThrow();
      } else {
        const docx = await readFormulaDocx(config.pdfPython, output.bytes);
        await info.attach(`formula-${output.name}-content`, { body: JSON.stringify(docx), contentType: 'application/json' });
        expect.soft(() => assertFormulaLabels(docx.text, samples, output.answers, true), output.name).not.toThrow();
      }
    });
  }
}
