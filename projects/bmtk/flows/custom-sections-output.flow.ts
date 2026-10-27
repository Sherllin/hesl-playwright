import { randomUUID } from 'node:crypto';
import { expect, test, type TestInfo } from '@playwright/test';
import { checkDocumentTools, inspectDocx, inspectPdf, readPdfContent } from '../../../packages/runtime/document-layout';
import type { Actors } from '../support/actors';
import type { BmtkConfig } from '../support/config';
import { businessResponse, responseFor } from '../support/api';
import { TaskPage } from '../support/task.page';
import { ProjectPage } from '../project-management/project.page';
import { ActivitiesPage } from '../project-management/activities.page';
import { CustomSectionTypesPage } from '../question-bank/custom-sections.page';
import { CustomSectionsAuthoringPage } from '../authoring/custom-sections.page';
import { QuestionReviewPage } from '../question-review/question-review.page';
import { ComposePage } from '../compose/compose.page';
import { CustomSectionsComposePage, type SectionSelection } from '../compose/custom-sections.page';
import { assertCustomSectionPaper, assertCustomSectionOutput, sectionSamples,
  type SectionPaper, type SectionQuestion } from '../compose/custom-sections.assertions';
import { PaperReviewPage } from '../paper-review/paper-review.page';
import { PaperMakePage } from '../paper-make/paper-make.page';
import { preparePaperStyle } from '../paper-make/style-fixture';

/** 1007401专项重建：四种题型共用简答结构；不依赖原仓、旧现场或模板导入。 */
export async function runCustomSectionsOutput(actors: Actors, config: BmtkConfig, info: TestInfo, selection: SectionSelection) {
  await checkDocumentTools(config.pdfPython);
  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  const folderName = `E2E-自定义题型-${runId}`;
  const projectName = `E2E-1007401-${selection}-${runId}`;
  const paperName = `E2E-四题型试卷-${runId}`;
  const admin = await actors.get('admin');
  const leader = await actors.get('leader');
  const author = await actors.get('author');
  const reviewer = await actors.get('questionReviewer');
  const composer = await actors.get('composer');
  const paperReviewer = await actors.get('paperReviewer');
  const project = new ProjectPage(leader.page);
  const activities = new ActivitiesPage(leader.page);
  const bankTypes = new CustomSectionTypesPage(admin.page);
  const style = await test.step('新建独立一栏单面样式并回读配置', () =>
    preparePaperStyle(admin, { label: '一栏-单面', paperSize: 1, printSetup: 1 }, `E2E-四题型样式-${runId}`));
  const types = await test.step('创建独立学科及三种自定义题型，新建无模板项目', async () => {
    await bankTypes.prepare(folderName);
    const created = await new ProjectPage(admin.page).create({ name: projectName, leader: leader.name, activity: '无模板', folderName });
    const types = await bankTypes.readBankTypes(admin.token, created.bankId);
    await project.enterProject(projectName);
    await activities.createQuestionTask({ name: paperName, author: author.name, quantity: 26 });
    await info.attach('custom-sections-fixture', { body: JSON.stringify({ runId, folderName, projectName,
      bankId: created.bankId, paperName, styleId: style.id, selection, types }), contentType: 'application/json' });
    return types;
  });
  const sources = await test.step('真实UI出题：物化简答7、物化问答9、物化论述8、基础简答2', async () => {
    await new TaskPage(author.page).openNodeTask(projectName, /去出题/);
    const sources = await new CustomSectionsAuthoringPage(author.page).confirmAndSubmit(types);
    await info.attach('custom-sections-confirmed-questions', { body: JSON.stringify(sources), contentType: 'application/json' });
    return sources;
  });
  await test.step('实际逐题审核通过，题型身份、原题干和答案保持', async () => {
    await project.enterProject(projectName);
    await activities.openQuestionReview(reviewer.name);
    const loaded = responseFor(reviewer.page, 'POST', '/question-review/question-tasks');
    await new TaskPage(reviewer.page).openNodeTask(projectName, /去审题/);
    const reviewed = await businessResponse<{ questions: { records: SectionQuestion[] } }>(await loaded);
    expect(reviewed.questions.records.map(question => question.id).sort()).toEqual(sources.map(source => source.id).sort());
    for (const source of sources) {
      const actual = reviewed.questions.records.find(question => question.id === source.id)!;
      expect(actual).toMatchObject({ id: source.id, questionType: 5,
        questionTypeId: source.questionTypeId, questionTypeName: source.questionTypeName,
        question: source.question, answer: source.answer });
    }
    const remaining = new Set(sources.map(source => source.id));
    const content = reviewer.page.getByTestId('review-content')
      .locator('[data-confidential-content="readonly"][data-confidential-target-name="审题题目"]');
    const review = new QuestionReviewPage(reviewer.page);
    for (let index = 0; index < sources.length; index++) {
      await expect.poll(async () => remaining.has(await content.getAttribute('data-confidential-target-id') ?? ''),
        { timeout: 90_000, message: '每次只审核本轮未审过的原题' }).toBe(true);
      const id = (await content.getAttribute('data-confidential-target-id'))!;
      const source = sources.find(source => source.id === id)!;
      const sample = sectionSamples().find(sample => source.question.includes(sample.stem))!;
      await expect(content).toContainText(sample.stem);
      await review.approveCurrentQuestion(id);
      remaining.delete(id);
    }
    expect(remaining.size).toBe(0);
    await review.submitTask();
    await project.enterProject(projectName);
    await activities.finishQuestionReview();
  });
  const saved = await test.step('四种题型选入组卷，暂存、返回重进、正式提交均保持四个大题', async () => {
    await project.enterProject(projectName);
    await activities.createComposeTask({ name: paperName, composer: composer.name, total: 52 });
    await new TaskPage(composer.page).openNodeTask(projectName, /去组卷/);
    const compose = new ComposePage(composer.page);
    const sections = new CustomSectionsComposePage(composer.page);
    await compose.setTitle(paperName);
    await sections.addQuestions(sources, types, selection);
    await info.attach('custom-sections-before-save', { body: await composer.page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await sections.expectTitles(types);
    await compose.setChildScores(sources.map(() => 2));
    await compose.expectTotal(26, 52);
    const saved = await compose.saveDraft() as SectionPaper;
    await info.attach('custom-sections-save-request', { body: JSON.stringify(saved), contentType: 'application/json' });
    assertCustomSectionPaper(saved, sources, types);
    const reloaded = await compose.reopen(projectName, saved.paperId) as SectionPaper;
    await info.attach('custom-sections-reloaded-paper', { body: JSON.stringify(reloaded), contentType: 'application/json' });
    expect(reloaded.paperId).toBe(saved.paperId);
    assertCustomSectionPaper(reloaded, sources, types);
    await sections.expectTitles(types);
    await info.attach('custom-sections-after-reopen', { body: await composer.page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await compose.submit(saved.paperId);
    return saved;
  });
  const make = new PaperMakePage(leader.page);
  await test.step('审卷核对四题型数据，关联样式并结束制卷定稿', async () => {
    await project.enterProject(projectName);
    await activities.openPaperReview(paperReviewer.name);
    await new TaskPage(paperReviewer.page).openNodeTask(projectName, /去审卷/);
    const review = new PaperReviewPage(paperReviewer.page);
    const paper = await review.readPaper(paperReviewer.token, saved.paperId) as SectionPaper;
    await info.attach('custom-sections-review-paper', { body: JSON.stringify(paper), contentType: 'application/json' });
    assertCustomSectionPaper(paper, sources, types);
    await review.approveAndSubmit();
    await project.enterProject(projectName);
    await activities.finishPaperReview();
    await make.associateStyle(style, saved.paperId);
    await make.finishProject(projectName);
    await info.attach('custom-sections-final-identity', { body: JSON.stringify({ projectName, paperId: saved.paperId,
      pageURL: leader.page.url(), types }), contentType: 'application/json' });
  });
  const outputs = await test.step('真实UI下载试卷、纯答案、题干加答案三组PDF及Word', async () => {
    const outputs = [
      { name: 'paper.pdf', content: 'question' as const, bytes: await make.downloadPdf('试卷') },
      { name: 'answer.pdf', content: 'answer' as const, bytes: await make.downloadPdf('答案') },
      { name: 'combined.pdf', content: 'combined' as const, bytes: await make.downloadPdf('答案', { includeQuestion: true }) },
      { name: 'paper.docx', content: 'question' as const, bytes: await make.downloadDocx('仅题目') },
      { name: 'answer.docx', content: 'answer' as const, bytes: await make.downloadDocx('仅答案') },
      { name: 'combined.docx', content: 'combined' as const, bytes: await make.downloadDocx('题目加答案') },
    ];
    for (const output of outputs) await info.attach(output.name, { body: output.bytes,
      contentType: output.name.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    return outputs;
  });
  await test.step('解析真实文件：四标题各一次、7/9/8/2归组、26题正文及对应答案完整', async () => {
    for (const output of outputs) {
      const result = output.name.endsWith('.pdf')
        ? await readPdfContent(config.pdfPython, output.bytes)
        : await inspectDocx(config.pdfPython, output.bytes);
      await info.attach(`${output.name}-text`, { body: result.text, contentType: 'text/plain' });
      expect.soft(() => assertCustomSectionOutput(result.text, output.content), output.name).not.toThrow();
    }
    const pdf = await inspectPdf(config.pdfPython, outputs[0].bytes, info.outputPath('custom-sections-paper-pages'));
    for (const [index, page] of pdf.pages.entries())
      await info.attach(`paper-page-${index + 1}`, { path: page.image, contentType: 'image/png' });
  });
}
