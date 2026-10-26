import { expect, test, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { Actors } from '../support/actors';
import type { BmtkConfig } from '../support/config';
import { BankPage } from '../question-bank/bank.page';
import { ProjectPage } from '../project-management/project.page';
import { ActivitiesPage } from '../project-management/activities.page';
import { TaskPage } from '../support/task.page';
import { StyleExamAuthoringPage } from '../authoring/style-exam.page';
import { QuestionReviewPage } from '../question-review/question-review.page';
import { ComposePage } from '../compose/compose.page';
import { StyleExamComposePage } from '../compose/style-exam.page';
import { PaperReviewPage } from '../paper-review/paper-review.page';
import { PaperMakePage } from '../paper-make/paper-make.page';
import { preparePaperStyle } from '../paper-make/style-fixture';
import { paperStyleExam } from '../paper-make/style-exam';
import type { PaperStyleLayout } from '../paper-make/style-layouts';
import { assertPaperStylePdf } from '../paper-make/style.assertions';
import { assertExamQuestions, assertExamAnswers, questionOrder } from '../paper-make/style-output.assertions';
import { checkDocumentTools, inspectPdf, inspectDocx, inspectPdfImage, compareRenderedLayout, readPdfContent, type PdfReadingLayout } from '../../../packages/runtime/document-layout';

/** REMOTE-19.3 / TAPD1007305：原37题、四组合、六种真实输出，保留独立数据供回看。 */
export async function runPaperStyleOutput(actors: Actors, config: BmtkConfig, info: TestInfo, layout: PaperStyleLayout) {
  test.setTimeout(1_200_000);
  // 本机工具检查在任何远端写入前完成；不借用原仓库Python或账号池。
  await checkDocumentTools(config.pdfPython);
  const readingLayout: PdfReadingLayout = {
    columns: layout.paperSize === 0 ? 2 : 1, leftMarginCm: 3.2, rightMarginCm: 1.2,
    mirrorMargins: layout.printSetup === 2,
  };
  const { sources, questions, markers } = paperStyleExam();
  expect(questions).toHaveLength(37);
  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  const projectName = `E2E-样式-${runId}`;
  const folderName = `E2E-排版-${runId}`;
  const paperName = `E2E-药学-${runId}`;
  const admin = await actors.get('admin');
  const leader = await actors.get('leader');
  const author = await actors.get('author');
  const questionReviewer = await actors.get('questionReviewer');
  const composer = await actors.get('composer');
  const paperReviewer = await actors.get('paperReviewer');
  const style = await test.step('准备独立准确样式并回读，隔离7304保存缺陷', () =>
    preparePaperStyle(admin, layout, `E2E-${layout.label}-${runId}`));
  await info.attach('exam-source', { body: JSON.stringify({
    sources: sources.map(s => ({ file: s.source, sha256: s.sourceSha256, answerOrigin: s.answerOrigin })),
    questionCount: questions.length, note: '原卷各15题；另7题为科学/语言扩展；答案为测试补充值。',
  }), contentType: 'application/json' });
  const project = new ProjectPage(leader.page);
  const activities = new ActivitiesPage(leader.page);
  await test.step('新建无模板项目和独立学科题库', async () => {
    const bank = new BankPage(admin.page);
    await bank.createFolder(folderName);
    await bank.setQuestionTypeEnabled(folderName, '单选题');
    await bank.setQuestionTypeEnabled(folderName, '简答题');
    await new ProjectPage(admin.page).create({ name: projectName, leader: leader.name, activity: '无模板', folderName });
    await project.enterProject(projectName);
    await activities.createQuestionTask({ name: paperName, author: author.name, quantity: questions.length });
  });
  const confirmed = await test.step('实际填写并确认37道题，含公式、科学图和多语言', async () => {
    await new TaskPage(author.page).openNodeTask(projectName, /去出题/);
    return new StyleExamAuthoringPage(author.page).confirmAndSubmit(questions);
  });
  await test.step('逐题实际审核并提交，推进到组卷', async () => {
    await project.enterProject(projectName);
    await activities.openQuestionReview(questionReviewer.name);
    await new TaskPage(questionReviewer.page).openNodeTask(projectName, /去审题/);
    const remaining = new Set(confirmed.map(q => q.id));
    const content = questionReviewer.page.getByTestId('review-content')
      .locator('[data-confidential-content="readonly"][data-confidential-target-name="审题题目"]');
    const review = new QuestionReviewPage(questionReviewer.page);
    for (let index = 0; index < confirmed.length; index++) {
      await expect.poll(async () => remaining.has(await content.getAttribute('data-confidential-target-id') ?? ''),
        { timeout: 90_000, message: '当前待审必须是本轮实际确认且未审过的题目' }).toBe(true);
      const id = (await content.getAttribute('data-confidential-target-id'))!;
      const source = confirmed.find(q => q.id === id)!;
      await expect(content).toContainText(questions.find(q => source.question.includes(q.stem))!.stem);
      await review.approveCurrentQuestion(id);
      remaining.delete(id);
    }
    expect(remaining.size).toBe(0);
    await review.submitTask();
    await project.enterProject(projectName);
    await activities.finishQuestionReview();
  });
  const saved = await test.step('真实选入37题并设置100分，暂存重进后提交', async () => {
    await project.enterProject(projectName);
    await activities.createComposeTask({ name: paperName, composer: composer.name, total: 100 });
    await new TaskPage(composer.page).openNodeTask(projectName, /去组卷/);
    const compose = new ComposePage(composer.page);
    await compose.setTitle(paperName);
    await new StyleExamComposePage(composer.page).addAndScore(confirmed.map(q => q.id));
    const paper = await compose.saveDraft();
    expect(paper.qrPaperQuestionDTOList).toHaveLength(37);
    expect(Number(paper.paperScore)).toBe(100);
    expect(paper.qrPaperQuestionDTOList.map(q => q.originalQuestionId).sort()).toEqual(confirmed.map(q => q.id).sort());
    const reloaded = await compose.reopen(projectName, paper.paperId);
    expect(reloaded.paperId).toBe(paper.paperId);
    expect(reloaded.qrPaperQuestionDTOList).toHaveLength(37);
    await compose.submit(paper.paperId);
    return paper;
  });
  const make = new PaperMakePage(leader.page);
  await test.step('实际审卷后按完整名称关联本轮新样式', async () => {
    await project.enterProject(projectName);
    await activities.openPaperReview(paperReviewer.name);
    await new TaskPage(paperReviewer.page).openNodeTask(projectName, /去审卷/);
    await new PaperReviewPage(paperReviewer.page).approveAndSubmit();
    await project.enterProject(projectName);
    await activities.finishPaperReview();
    const binding = await make.associateStyle(style, saved.paperId);
    await info.attach('style-application', { body: JSON.stringify({ ...binding, projectName, layout, style }), contentType: 'application/json' });
  });
  const previews: string[] = [];
  await test.step('保留真实后端渲染预览的全部页面', async () => {
    await leader.page.getByRole('button', { name: '预览试卷', exact: true }).click();
    const images = leader.page.getByRole('img', { name: /^试卷第 \d+ 页$/ });
    await expect(images.first()).toBeVisible({ timeout: 120_000 });
    for (const [index, image] of (await images.all()).entries()) {
      await expect.poll(() => image.evaluate(node => {
        const image = node as HTMLImageElement;
        return image.complete && image.naturalWidth > 0;
      })).toBe(true);
      const src = await image.getAttribute('src');
      expect(src).toMatch(/^data:image\/png;base64,/);
      const file = info.outputPath(`preview-${index + 1}.png`);
      await writeFile(file, Buffer.from(src!.split(',')[1], 'base64'));
      previews.push(file);
      await info.attach(`preview-${index + 1}`, { path: file, contentType: 'image/png' });
    }
    await leader.page.getByRole('button', { name: '退出预览', exact: true }).click();
    await expect(leader.page).toHaveURL(url => url.pathname === '/project/my/makePaper');
    await make.finishProject(projectName);
  });
  const outputs = await test.step('实际下载同一份定稿的六种PDF和DOCX文件', async () => {
    const paper = await make.downloadPdf('试卷');
    const answer = await make.downloadPdf('答案');
    const combined = await make.downloadPdf('答案', { includeQuestion: true });
    const word = await make.downloadDocx('仅题目');
    const wordAnswer = await make.downloadDocx('仅答案');
    const wordCombined = await make.downloadDocx('题目加答案');
    for (const [name, bytes] of Object.entries({ 'paper.pdf': paper, 'answer.pdf': answer, 'combined.pdf': combined,
      'paper.docx': word, 'answer.docx': wordAnswer, 'combined.docx': wordCombined }))
      await info.attach(name, { body: bytes, contentType: name.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    return { paper, answer, combined, word, wordAnswer, wordCombined };
  });
  await test.step('核对全部题干、选项和答案与原题对应，保留全部实际输出证据', async () => {
    const word = await inspectDocx(config.pdfPython, outputs.word);
    const wordAnswer = await inspectDocx(config.pdfPython, outputs.wordAnswer);
    const wordCombined = await inspectDocx(config.pdfPython, outputs.wordCombined);
    const paper = await readPdfContent(config.pdfPython, outputs.paper, readingLayout);
    const answer = await readPdfContent(config.pdfPython, outputs.answer, readingLayout);
    const combined = await readPdfContent(config.pdfPython, outputs.combined, readingLayout);
    expect.soft(() => assertExamQuestions(paper.text, questions)).not.toThrow();
    expect.soft(() => assertExamQuestions(word.text, questions)).not.toThrow();
    // 按实际带题干文件建立题序，再逐题核对仅答案输出，避免答案集合对但配错题。
    const order = questionOrder(word.text, questions);
    expect.soft(() => assertExamAnswers(answer.text, order, false)).not.toThrow();
    expect.soft(() => assertExamAnswers(combined.text, order, true)).not.toThrow();
    expect.soft(() => assertExamAnswers(wordAnswer.text, order, false)).not.toThrow();
    expect.soft(() => assertExamAnswers(wordCombined.text, order, true)).not.toThrow();
    expect.soft(word.mediaCount, 'DOCX必须包含真实嵌入媒体').toBeGreaterThan(0);
    expect.soft(word.xml, 'DOCX公式必须有原生数学结构或嵌入图形').toMatch(/<m:oMath|<w:drawing/);
    await info.attach('word-document.xml', { body: word.xml, contentType: 'application/xml' });
  });
  const pdf = await inspectPdf(config.pdfPython, outputs.paper, info.outputPath('pdf-render'), readingLayout);
  for (const [index, page] of pdf.pages.entries())
    await info.attach(`pdf-page-${index + 1}`, { path: page.image, contentType: 'image/png' });
  await test.step('实际PDF字体字号颜色、栏数、正文中缝与单双面边距', async () => {
    expect.soft(() => {
      const evidence = assertPaperStylePdf(pdf, layout, markers);
      // 附件在下方统一写入，断言不以HTML或styleId代替真实文件。
      return evidence;
    }).not.toThrow();
    await info.attach('pdf-layout-geometry', { body: JSON.stringify(pdf.pages.map(p => ({ width: p.width, height: p.height, characters: p.chars }))), contentType: 'application/json' });
    const image = await inspectPdfImage(config.pdfPython, outputs.paper, questions.find(q => q.image)!.image!);
    await info.attach('pdf-scientific-image', { body: JSON.stringify(image), contentType: 'application/json' });
    expect.soft(image.matches, '最终PDF必须包含本轮科学题图').toHaveLength(1);
    for (const match of image.matches) {
      expect.soft(match.insidePage, '科学题图不能越界').toBe(true);
      expect.soft(match.aspectError, '科学题图必须保持原始宽高比').toBeLessThan(0.03);
    }
  });
  await test.step('真实预览与实际PDF逐页比较，蓝色正文也参与取样', async () => {
    expect.soft(pdf.pages.length).toBe(previews.length);
    for (const [index, page] of pdf.pages.entries()) {
      if (!previews[index]) continue; // 页数差异已明确失败，不用不存在的文件掩盖差异。
      const result = await compareRenderedLayout(config.pdfPython, previews[index], page.image);
      await info.attach(`preview-pdf-comparison-${index + 1}`, { body: JSON.stringify(result), contentType: 'application/json' });
      expect.soft(result.previewBands.length, `第${index + 1}页真实预览必须有正文`).toBeGreaterThan(0);
      expect.soft(result.pdfBands, `第${index + 1}页文字行数应一致`).toHaveLength(result.previewBands.length);
      expect.soft(result.maxDelta, `第${index + 1}页位置误差不得超过1.5%`).toBeLessThanOrEqual(0.015);
    }
  });
}
