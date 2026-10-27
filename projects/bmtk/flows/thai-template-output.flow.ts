import { randomUUID } from 'node:crypto';
import { expect, test, type TestInfo } from '@playwright/test';
import { checkDocumentTools, compareRenderedLayout, inspectPdf } from '../../../packages/runtime/document-layout';
import { BankPage } from '../question-bank/bank.page';
import { readApi } from '../support/api';
import type { Actors } from '../support/actors';
import type { BmtkConfig } from '../support/config';
import { HistoryImportPage, type LanguagePaper } from '../paper-make/template-import/history-import.page';
import { assertLanguageQuestions, assertThaiGlyphs } from '../paper-make/template-import/language.assertions';
import { checkLanguageTools, fillLanguageTemplate, inspectThaiPdf, languageSample, type TemplateFormat } from '../paper-make/template-import/template-tools';

export async function runThaiTemplateOutput(actors: Actors, config: BmtkConfig, info: TestInfo, format: TemplateFormat): Promise<void> {
  // Fail locally before any remote data is created if a document dependency is missing.
  await checkDocumentTools(config.pdfPython);
  await checkLanguageTools(config.pdfPython);
  const admin = await actors.get('admin');
  const { page } = admin;
  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  const name = `E2E-泰语${format}-${runId}`;
  const bank = new BankPage(page);
  const library = new HistoryImportPage(page);
  await test.step('新建本轮独立学科，不复用原现场数据', async () => {
    await bank.createFolder(name);
    await bank.openFolder(name);
  });
  const folderId = new URL(page.url()).searchParams.get('folderId');
  expect(folderId).toMatch(/^\d+$/);
  const extension = format === 'excel' ? 'xlsx' : 'docx';
  const original = info.outputPath(`downloaded-template.${extension}`);
  // Upload basename determines the default paper title, so use the same exact name.
  const fixture = info.outputPath(`${name}.${extension}`);
  const mime = format === 'excel'
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  await test.step('下载官方模板并填入原八题外语语料', async () => {
    await library.downloadTemplate(format, original);
    await fillLanguageTemplate(config.pdfPython, format, original, fixture);
    await info.attach('downloaded-template', { path: original, contentType: mime });
    await info.attach('actual-uploaded-template', { path: fixture, contentType: mime });
  });
  const aiRequests: string[] = [];
  const onRequest = (request: import('@playwright/test').Request) => {
    if (request.method() === 'POST' && /\/external-paper-parse\/|\/ai-review\//.test(new URL(request.url()).pathname))
      aiRequests.push(new URL(request.url()).pathname);
  };
  page.on('request', onRequest);
  try {
    await test.step('通过模板入口导入，核对全部题干、选项、声调及答案', async () => {
      const draft = await library.importTemplate(fixture, name);
      await info.attach('template-parsed-data', { body: JSON.stringify(draft), contentType: 'application/json' });
      assertLanguageQuestions(draft.qrPaperQuestionDTOList, languageSample.questions);
      await expect(page.getByText(languageSample.questions[0].stem, { exact: false })).toBeVisible();
      await info.attach('imported-editor', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    });
    const paperId = await test.step('每题设2分并正式保存，重新读取核对8题16分', async () => {
      const id = await library.scoreAndSave(name, languageSample.questions.length, info);
      const saved = await readApi<LanguagePaper>(page.request, admin.token, `/qrepo/paper/${id}`);
      await info.attach('saved-paper-data', { body: JSON.stringify(saved), contentType: 'application/json' });
      assertLanguageQuestions(saved.qrPaperQuestionDTOList, languageSample.questions);
      expect(saved.paperName).toBe(name);
      expect(String(saved.paperYear)).toBe('2026');
      expect(saved.qrPaperQuestionDTOList.every(item => Number(item.questionScore) === 2)).toBe(true);
      expect(saved.qrPaperQuestionDTOList.reduce((sum, item) => sum + Number(item.questionScore), 0)).toBe(16);
      await info.attach('template-fixture-identity', { body: JSON.stringify({ folderId, paperId: id, paperName: name,
        format, source: languageSample.source, pageURL: page.url() }), contentType: 'application/json' });
      return id;
    });
    const previews = await test.step('真实列表预览并保留所有原始页面', () => library.preview(name, paperId, info));
    await test.step('下载真实PDF，核对实际泰文字形、词语像素及预览一致性', async () => {
      const bytes = await library.download(name, info);
      const pdf = await inspectPdf(config.pdfPython, bytes, info.outputPath('actual-pdf-pages'));
      const audit = await inspectThaiPdf(config.pdfPython, bytes, info.outputPath('thai-word-crops'));
      await info.attach('actual-pdf-glyphs', { body: JSON.stringify(audit), contentType: 'application/json' });
      for (const [index, word] of audit.words.entries()) {
        for (const [occurrence, image] of word.images.entries())
          await info.attach(`thai-option-${index + 1}-${occurrence + 1}`, { path: image, contentType: 'image/png' });
      }
      for (const [index, rendered] of pdf.pages.entries())
        await info.attach(`actual-pdf-page-${index + 1}`, { path: rendered.image, contentType: 'image/png' });
      // Keep collecting preview evidence even when glyphs fail. A soft assertion still fails the case.
      await test.step('实际字形不能是方框，四个词语必须可区分', async () => {
        expect.soft(() => assertThaiGlyphs(audit)).not.toThrow();
      });
      expect(pdf.pages).toHaveLength(previews.length);
      for (const [index, rendered] of pdf.pages.entries()) {
        const comparison = await compareRenderedLayout(config.pdfPython, previews[index], rendered.image);
        await info.attach(`preview-pdf-comparison-${index + 1}`, { body: JSON.stringify(comparison), contentType: 'application/json' });
        expect.soft(comparison.previewBands.length, '预览不能为空白').toBeGreaterThan(0);
        expect.soft(comparison.pdfBands, '预览与PDF主要文字行数必须一致').toHaveLength(comparison.previewBands.length);
        expect.soft(comparison.maxDelta, '预览与PDF文字位置误差不超过1.5%').toBeLessThanOrEqual(0.015);
      }
      const text = pdf.pages.flatMap(p => p.chars.map(c => c.text)).join('').replace(/\s+/g, '');
      // This regression concerns Thai glyphs. Arabic RTL extraction order is not a new product defect.
      expect.soft(text, '泰语题干必须进入实际PDF').toContain('泰语词义练习：请选择与“米饭”对应的词语。');
    });
    expect(aiRequests, '模板入口不得调用AI解析或AI审校').toEqual([]);
  } finally { page.off('request', onRequest); }
}
