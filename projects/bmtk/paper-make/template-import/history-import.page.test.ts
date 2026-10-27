import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { HistoryImportPage, type LanguagePaper } from './history-import.page';

// Offline page-object regression only: emulate a slow editor route after E200.
// No real product service, account or question is accessed.
test('模板解析成功后编辑页加载超过5秒，仍等待正确草稿页和标题就绪', async ({ page }, info) => {
  const name = 'E2E-泰语导航检查';
  const folderId = '2114978677263695872';
  const draft: LanguagePaper = { paperName: name, paperYear: '2026', qrPaperQuestionDTOList: [] };
  const route = '/question/course/manage/folder/create/paper?folderId=' + folderId + '&draftId=offline-draft';
  await page.route('http://history-import.test/**', async intercepted => {
    const url = new URL(intercepted.request().url());
    if (url.pathname === '/api/qrepo/paper/import-template') {
      await intercepted.fulfill({ json: { code: 'E200', data: draft } });
    } else if (url.pathname.endsWith('/create/paper')) {
      // This models server latency; the test synchronizes on URL/UI, never a sleep.
      await new Promise(resolve => setTimeout(resolve, 6_000));
      await intercepted.fulfill({ contentType: 'text/html; charset=utf-8', body: `<input aria-label="请输入试卷标题" value="${name}">` });
    } else {
      await intercepted.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        <section role="dialog" aria-label="历史试卷导入"><h2>历史试卷导入</h2>
          <input type="file"><input aria-label="${name}试卷年份">
          <button onclick="fetch('/api/qrepo/paper/import-template',{method:'POST'}).then(r=>r.json()).then(()=>fetch('${route}')).then(r=>r.text()).then(html=>{document.body.innerHTML=html;history.pushState(null,'','${route}')})">导入并编辑</button>
        </section>` });
    }
  });
  await page.goto(`http://history-import.test/question/course/manage?folderId=${folderId}`);
  const file = info.outputPath('offline.docx');
  await writeFile(file, 'offline input: parsing is outside this navigation check');
  expect(await new HistoryImportPage(page).importTemplate(file, name)).toEqual(draft);
  expect(new URL(page.url()).searchParams.get('draftId')).toBe('offline-draft');
});
