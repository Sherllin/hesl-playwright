import { randomUUID } from 'node:crypto';
import { expect, test, type TestInfo } from '@playwright/test';
import { checkDocumentTools } from '../../../packages/runtime/document-layout';
import type { Actors } from '../support/actors';
import type { BmtkConfig } from '../support/config';
import { businessResponse, parseJson, responseFor } from '../support/api';
import { TaskPage } from '../support/task.page';
import { BankPage } from '../question-bank/bank.page';
import type { MatchingQuestion } from '../question-bank/matching';
import { ProjectPage } from '../project-management/project.page';
import { ActivitiesPage } from '../project-management/activities.page';
import { prepareImageQuestions } from '../authoring/image-layout.fixture';
import { QuestionReviewPage } from '../question-review/question-review.page';
import { ComposePage } from '../compose/compose.page';
import type { SavedPaper } from '../compose/matching.assertions';
import { assertImagePaperSave, assertImagePaperPreserved, assertImagePaperSources } from '../compose/image-layout.assertions';
import { PaperReviewPage } from '../paper-review/paper-review.page';
import { PaperMakePage } from '../paper-make/paper-make.page';
import { preparePaperStyle } from '../paper-make/style-fixture';
import { createImageFixtures, inspectImagePdf } from '../paper-make/image-layout.tools';
import { assertImageLayout, type ImageOutput } from '../paper-make/image-layout.assertions';

export async function runImageLayoutOutput(actors: Actors, config: BmtkConfig, info: TestInfo, columns: 1 | 2) {
  await checkDocumentTools(config.pdfPython);
  const fixture = await createImageFixtures(config.pdfPython, info.outputPath('image-fixtures'));
  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  const projectName = `E2E-1007402-${columns}栏-${runId}`;
  const folderName = `E2E-图片学科-${runId}`;
  const paperName = `E2E-图片试卷-${runId}`;
  const admin = await actors.get('admin');
  const leader = await actors.get('leader');
  const author = await actors.get('author');
  const reviewer = await actors.get('questionReviewer');
  const composer = await actors.get('composer');
  const paperReviewer = await actors.get('paperReviewer');
  const project = new ProjectPage(leader.page);
  const activities = new ActivitiesPage(leader.page);
  const style = await test.step('准备独立单面样式和三道题的无模板项目', async () => {
    const style = await preparePaperStyle(admin, { label: `${columns}栏-单面`, paperSize: columns === 1 ? 1 : 0, printSetup: 1 }, `E2E-图片样式-${runId}`);
    const bank = new BankPage(admin.page);
    await bank.createFolder(folderName);
    for (const type of ['单选题', '简答题', '组合题']) await bank.setQuestionTypeEnabled(folderName, type);
    const created = await new ProjectPage(admin.page).create({ name: projectName, leader: leader.name, activity: '无模板', folderName });
    await project.enterProject(projectName);
    await activities.createQuestionTask({ name: paperName, author: author.name, quantity: 3 });
    await info.attach('image-layout-fixture', { body: JSON.stringify({ projectName, paperName, bankId: created.bankId, style, columns }), contentType: 'application/json' });
    return style;
  });
  const prepared = await test.step('正常工作区接口准备并确认题干/选项/组合子题/答案图及超高图', async () => {
    await new TaskPage(author.page).openNodeTask(projectName, /去出题/);
    const sources = await prepareImageQuestions(author, fixture.images, runId);
    await info.attach('image-layout-confirmed-questions', { body: JSON.stringify(sources), contentType: 'application/json' });
    for (const image of fixture.images) await info.attach(`source-${image.role}`, { path: image.path, contentType: 'image/png' });
    return sources;
  });
  const sources = await test.step('真实逐题审核通过并结束审题', async () => {
    await project.enterProject(projectName);
    await activities.openQuestionReview(reviewer.name);
    const loaded = responseFor(reviewer.page, 'POST', '/question-review/question-tasks');
    await new TaskPage(reviewer.page).openNodeTask(projectName, /去审题/);
    const data = await businessResponse<{ questions: { records: MatchingQuestion[] } }>(await loaded);
    expect(data.questions.records.map(q => q.id).sort()).toEqual(prepared.map(q => q.id).sort());
    for (const source of prepared) expect(data.questions.records.find(q => q.id === source.id)).toMatchObject({ question: source.question, answer: source.answer });
    const content = reviewer.page.getByTestId('review-content')
      .locator('[data-confidential-content="readonly"][data-confidential-target-name="审题题目"]');
    const review = new QuestionReviewPage(reviewer.page);
    const remaining = new Set(prepared.map(q => q.id));
    for (let index = 0; index < prepared.length; index++) {
      await expect.poll(async () => remaining.has(await content.getAttribute('data-confidential-target-id') ?? ''), { timeout: 90_000 }).toBe(true);
      const id = (await content.getAttribute('data-confidential-target-id'))!;
      await review.approveCurrentQuestion(id);
      remaining.delete(id);
    }
    expect(remaining.size).toBe(0);
    await review.submitTask();
    await project.enterProject(projectName);
    await activities.finishQuestionReview();
    // Formal child/option IDs are assigned during confirmation, not copied into slot draftPayload.
    return prepared.map(source => data.questions.records.find(question => question.id === source.id)!);
  });
  const saved = await test.step('原题选入组卷，暂存重进再正式提交', async () => {
    await project.enterProject(projectName);
    await activities.createComposeTask({ name: paperName, composer: composer.name, total: 6 });
    await new TaskPage(composer.page).openNodeTask(projectName, /去组卷/);
    const compose = new ComposePage(composer.page);
    await compose.setTitle(paperName);
    for (const [index, marker] of ['I14CHOICEBEFORE', 'I14PARENTBEFORE', 'I14TALLBEFORE'].entries())
      await compose.addQuestion(sources[index], marker);
    await compose.setChildScores([2, 2, 2]);
    await compose.expectTotal(3, 6);
    const draftResponse = responseFor(composer.page, 'POST', '/paper-compose/save-draft');
    const paper = await compose.saveDraft();
    assertImagePaperSources(paper, sources);
    const stored = await businessResponse<SavedPaper>(await draftResponse);
    assertImagePaperSave(paper, stored);
    const reloaded = await compose.reopen(projectName, paper.paperId);
    assertImagePaperPreserved(stored, reloaded);
    await info.attach('image-layout-reloaded-paper', { body: JSON.stringify(reloaded), contentType: 'application/json' });
    const submitResponse = responseFor(composer.page, 'POST', '/paper-compose/save');
    await compose.submit(paper.paperId);
    const response = await submitResponse;
    const sent = parseJson<SavedPaper>(response.request().postData()!);
    assertImagePaperPreserved(reloaded, sent);
    const submitted = await businessResponse<SavedPaper>(response);
    assertImagePaperSave(sent, submitted);
    return submitted;
  });
  const make = new PaperMakePage(leader.page);
  await test.step('真实审卷并关联样式，结束制卷定稿', async () => {
    await project.enterProject(projectName);
    await activities.openPaperReview(paperReviewer.name);
    await new TaskPage(paperReviewer.page).openNodeTask(projectName, /去审卷/);
    const review = new PaperReviewPage(paperReviewer.page);
    assertImagePaperPreserved(saved, await review.readPaper(paperReviewer.token, saved.paperId));
    await review.approveAndSubmit();
    await project.enterProject(projectName);
    await activities.finishPaperReview();
    await make.associateStyle(style, saved.paperId);
    await make.finishProject(projectName);
    await info.attach('image-layout-final-identity', { body: JSON.stringify({ projectName, paperId: saved.paperId, pageURL: leader.page.url(), columns }), contentType: 'application/json' });
  });
  const outputs: Array<{ kind: ImageOutput; bytes: Buffer }> = await test.step('真实页面下载三种PDF并保留原件', async () => {
    const outputs = [
      { kind: 'paper' as const, bytes: await make.downloadPdf('试卷') },
      { kind: 'combined' as const, bytes: await make.downloadPdf('答案', { includeQuestion: true }) },
      { kind: 'answer' as const, bytes: await make.downloadPdf('答案') },
    ];
    for (const output of outputs) await info.attach(`image-layout-${output.kind}.pdf`, { body: output.bytes, contentType: 'application/pdf' });
    return outputs;
  });
  for (const output of outputs) await test.step(`${output.kind}逐图检查完整像素、比例、跨页正文、遮挡和栏位边界`, async () => {
    const pdf = await inspectImagePdf(config.pdfPython, output.bytes, fixture.manifest, info.outputPath(`image-layout-${output.kind}`));
    await info.attach(`image-layout-${output.kind}-geometry`, { body: JSON.stringify(pdf), contentType: 'application/json' });
    for (const [index, page] of pdf.pages.entries()) await info.attach(`image-layout-${output.kind}-page-${index + 1}`, { path: page.image, contentType: 'image/png' });
    expect.soft(() => assertImageLayout(pdf, output.kind, columns), output.kind).not.toThrow();
  });
}
