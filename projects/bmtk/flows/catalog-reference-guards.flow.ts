import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Actors, Actor } from '../support/actors';
import { businessResponse, parseJson, readApi, responseFor, type Envelope } from '../support/api';
import { TaskPage } from '../support/task.page';
import { BankPage } from '../question-bank/bank.page';
import { ProjectPage } from '../project-management/project.page';
import { ActivitiesPage } from '../project-management/activities.page';
import { SingleChoiceAuthoringPage } from '../authoring/single-choice.page';
import { QuestionReviewPage } from '../question-review/question-review.page';
import { assertCatalogAssociation, assertCatalogChange, assertCatalogQuestionTransition, catalogWorkbook, flattenCatalog,
  type CatalogNode, type CatalogQuestion, type CatalogSnapshot } from '../question-bank/catalog-reference';

const base = '/qrepo/bankFolder/subject-catalog';
type FullImpact = { deletedCatalogCount: number; affectedQuestionCount: number;
  affectedTemplatePaperCount: number; affectedQuestionTaskCount: number; affectedReviewTaskCount: number };

async function writeApi<T>(actor: Actor, method: 'POST' | 'PUT', path: string, data: unknown): Promise<T> {
  const response = await actor.page.request.fetch(`/api${path}`, { method, data, headers: { Authorization: actor.token } });
  expect(response.ok()).toBe(true);
  const body = parseJson<Envelope<T>>(await response.text());
  expect(body.code, `${path}: ${body.message ?? ''}`).toBe('E200');
  return body.data;
}

async function openSettings(page: Page, folderName: string) {
  await new BankPage(page).openFolder(folderName);
  await page.getByRole('tab', { name: '题目', exact: true }).click();
  await page.getByRole('link', { name: '知识点管理', exact: true }).click();
  await expect(page.getByRole('tree').getByText(folderName, { exact: true })).toBeVisible();
}

async function addPath(page: Page, rootName: string, names: string[]) {
  for (const [index, name] of names.entries()) {
    await page.getByRole('tree').getByText(index ? names[index - 1] : rootName, { exact: true }).click();
    await page.getByRole('button', { name: '添加子级知识点', exact: true }).click();
    const editor = page.getByRole('textbox', { name: '知识点名称', exact: true });
    await expect(editor).toHaveCount(1);
    await editor.fill(name);
    const saved = responseFor(page, 'POST', `${base}/add`);
    await editor.press('Enter');
    await businessResponse(await saved);
    await expect(page.getByRole('tree').getByText(name, { exact: true })).toBeVisible();
  }
}

/** TAPD1007399：真实出题审题入库，接口准备关联；删除与全量确认走真实UI。 */
export async function runCatalogReferenceGuards(actors: Actors, python: string, operation: 'full' | 'delete') {
  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  const folderName = `E2E-引用学科-${runId}`;
  const bankName = `E2E-引用题库-${runId}`;
  const projectName = `E2E-引用征题-${runId}`;
  const path = [`E2E-删除父-${runId}`, `E2E-删除子-${runId}`];
  const keep = [`E2E-保留父-${runId}`, `E2E-保留子-${runId}`];
  // 在登录和远端写入前验证Excel生成前置。
  const workbook = operation === 'full' ? await catalogWorkbook(python, [keep]) : undefined;
  const admin = await actors.get('admin');
  const leader = await actors.get('leader');
  const author = await actors.get('author');
  const reviewer = await actors.get('questionReviewer');
  const page = admin.page;
  const banks = new BankPage(page);
  const project = new ProjectPage(leader.page);
  const activities = new ActivitiesPage(leader.page);
  const scene = await test.step('新建独立学科、引用及保留父子分支、开放式征题和两题任务', async () => {
    await banks.createFolder(folderName);
    await banks.setQuestionTypeEnabled(folderName, '单选题');
    await banks.createProjectBank(folderName, bankName);
    await banks.openProjectBank(bankName);
    const bankId = new URL(page.url()).pathname.match(/\/manage\/(\d+)$/)?.[1];
    expect(bankId).toBeTruthy();
    await openSettings(page, folderName);
    await addPath(page, folderName, path);
    await addPath(page, folderName, keep);
    const created = await new ProjectPage(page).create({ name: projectName, leader: leader.name, activity: '开放式征题', bankName });
    expect(created.bankId).toBe(bankId);
    await project.enterProject(projectName);
    const projectId = new URL(leader.page.url()).searchParams.get('projectId');
    expect(projectId).toBeTruthy();
    await activities.createQuestionTask({ name: `E2E-引用出题-${runId}`, author: author.name, quantity: 2 });
    const folders = await readApi<Array<{ id: string; name: string }>>(page.request, admin.token, '/qrepo/bankFolder/list');
    const matches = folders.filter(folder => folder.name === folderName);
    expect(matches).toHaveLength(1);
    return { bankId: bankId!, projectId: projectId!, folderId: matches[0].id };
  });
  const confirmed = await test.step('出题专家完成两道独立单选题', async () => {
    await new TaskPage(author.page).openNodeTask(projectName, /去出题/);
    return new SingleChoiceAuthoringPage(author.page).confirmAndSubmit([
      { stem: `E2E-${runId}-引用题北京位于哪个地区`, options: ['华北', '华东', '华南', '西南'], answer: 'A' },
      { stem: `E2E-${runId}-对照题上海位于哪个地区`, options: ['华北', '华东', '华南', '西南'], answer: 'B' },
    ]);
  });
  const reviewed = await test.step('审题通过，结束项目，两道原题完整入库', async () => {
    await project.enterProject(projectName);
    await activities.openQuestionReview(reviewer.name);
    const loaded = responseFor(reviewer.page, 'POST', '/question-review/question-tasks');
    await new TaskPage(reviewer.page).openNodeTask(projectName, /去审题/);
    const data = await businessResponse<{ questions: { records: CatalogQuestion[] } }>(await loaded);
    expect(data.questions.records.map(q => q.id).sort()).toEqual(confirmed.map(q => q.id).sort());
    for (const source of confirmed) {
      const current = data.questions.records.find(q => q.id === source.id)!;
      assertCatalogQuestionTransition(source, current);
    }
    const review = new QuestionReviewPage(reviewer.page);
    const content = reviewer.page.getByTestId('review-content')
      .locator('[data-confidential-content="readonly"][data-confidential-target-name="审题题目"]');
    const remaining = new Set(confirmed.map(q => q.id));
    while (remaining.size) {
      await expect.poll(async () => remaining.has(await content.getAttribute('data-confidential-target-id') ?? ''), { timeout: 90_000 }).toBe(true);
      const id = (await content.getAttribute('data-confidential-target-id'))!;
      await review.approveCurrentQuestion(id);
      remaining.delete(id);
    }
    await review.submitTask();
    await project.enterProject(projectName);
    await activities.finishQuestionReview();
    await project.expectCompleted(projectName);
    return data.questions.records;
  });
  const read = <T>(url: string) => readApi<T>(page.request, admin.token, url);
  const tree = () => read<CatalogNode[]>(`${base}?folderId=${scene.folderId}`);
  const questions = async () => (await writeApi<{ records: CatalogQuestion[] }>(admin, 'POST',
    '/qrepo/qrQuestionEntity/getByCatalog', { bankId: scene.bankId, catalogId: null, pageNo: 1, count: 50 })).records;
  const snapshot = async (): Promise<CatalogSnapshot> => ({ tree: await tree(), questions: await questions(),
    tasks: await read<unknown[]>(`/qrProject/question-creation/list?projectId=${scene.projectId}`) });
  const originalTree = await tree();
  const findNode = (name: string) => {
    const found = flattenCatalog(originalTree).filter(n => n.name === name);
    expect(found).toHaveLength(1);
    return found[0];
  };
  const leaf = findNode(path[1]);
  const associate = async (id: string) => {
    const matches = (await questions()).filter(q => q.id === id);
    expect(matches).toHaveLength(1);
    await writeApi(admin, 'PUT', '/qrepo/qrQuestionEntity/update', { ...matches[0], bankId: scene.bankId,
      catalogs: [{ id: leaf.id, name: leaf.name }] });
    const current = (await questions()).find(q => q.id === id)!;
    expect(current.catalogs.map(c => c.id)).toEqual([leaf.id]);
  };
  const unlinked = await snapshot();
  const initial = unlinked.questions;
  expect(initial.map(q => q.id).sort()).toEqual(confirmed.map(q => q.id).sort());
  for (const source of reviewed) {
    const current = initial.find(q => q.id === source.id)!;
    assertCatalogQuestionTransition(source, current);
  }
  for (const question of initial) expect(question.catalogs).toEqual([]);
  await test.step('仅给第一道真实入库题关联删除分支，第二题保持无关联', () => associate(confirmed[0].id));
  const before = await snapshot();
  expect(before.tasks.length, '需要真实出题任务作为保留对照').toBeGreaterThan(0);
  expect(before.questions.find(q => q.id === confirmed[1].id)!.catalogs).toEqual([]);
  const allIds = flattenCatalog(before.tree).map(n => n.id);
  assertCatalogAssociation(unlinked, before, confirmed[0].id,
    { [confirmed[0].id]: [leaf.id], [confirmed[1].id]: [] });
  const removedIds = path.map(name => findNode(name).id);
  const remainingIds = allIds.filter(id => !removedIds.includes(id));
  expect(allIds).toHaveLength(5);
  const emptyLinks = Object.fromEntries(before.questions.map(q => [q.id, []]));
  await test.info().attach('catalog-reference-scene', { body: JSON.stringify({ operation, runId, folderName, projectName,
    ...scene, path, keep, removedIds, remainingIds, questionIds: confirmed.map(q => q.id) }), contentType: 'application/json' });
  let writes = 0;
  const countWrite = (request: import('@playwright/test').Request) => {
    if (request.method() === 'POST' && /\/subject-catalog\/(delete|batch-import)$/.test(new URL(request.url()).pathname)) writes++;
  };
  page.on('request', countWrite);
  const capture = async (name: string) => test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  try {
    if (operation === 'delete') {
      await openSettings(page, folderName);
      const openDelete = async () => {
        const item = page.getByRole('tree').getByText(path[0], { exact: true });
        await expect(item).toBeVisible();
        const preview = responseFor(page, 'GET', `${base}/delete-impact`);
        await item.click();
        await page.keyboard.press('Delete');
        expect(await businessResponse(await preview)).toMatchObject({ affectedCatalogCount: 2, affectedQuestionCount: 1,
          affectedTemplatePaperCount: 0, affectedTaskCount: 0 });
        const dialog = page.getByRole('dialog').filter({ hasText: '删除知识点' });
        await expect(dialog).toContainText('题目和试卷不会删除');
        await expect(dialog).toContainText('1 道题目');
        return dialog;
      };
      await test.step('删除预检后取消：无删除请求，节点、题目和任务零写入', async () => {
        const count = writes;
        const dialog = await openDelete();
        await capture('delete-cancel-impact');
        await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
        await expect(dialog).toBeHidden();
        expect(writes).toBe(count);
        expect(await snapshot()).toEqual(before);
      });
      await test.step('再次确认删除：仅移除引用父子节点并解除关联，题目和任务保持', async () => {
        const dialog = await openDelete();
        const saved = responseFor(page, 'POST', `${base}/delete`);
        await dialog.getByRole('button', { name: /^删\s*除$/ }).click();
        await businessResponse(await saved);
        await expect(dialog).toBeHidden();
        await page.reload({ waitUntil: 'domcontentloaded' });
        assertCatalogChange(before, await snapshot(), remainingIds, emptyLinks);
        for (const name of keep) await expect(page.getByRole('tree').getByText(name, { exact: true })).toBeVisible();
        for (const name of path) await expect(page.getByRole('tree').getByText(name, { exact: true })).toHaveCount(0);
        await capture('delete-reference-result');
      });
      return;
    }
    await test.info().attach('full-import.xlsx', { body: workbook!, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const openImport = async () => {
      await openSettings(page, folderName);
      await page.getByRole('button', { name: /Excel导入$/ }).click();
      const parsed = responseFor(page, 'POST', `${base}/check-import`);
      await page.locator('input[type=file]').setInputFiles({ name: 'E2E-仅保留对照分支.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: workbook! });
      const result = await businessResponse<{ detailList: unknown[] }>(await parsed);
      expect(result.detailList).toEqual([expect.objectContaining({ level1Name: keep[0], level2Name: keep[1] })]);
      const row = page.getByRole('row').filter({ hasText: keep[1] });
      await expect(row).toContainText('通过');
      await row.getByRole('checkbox').check();
      await page.getByRole('radio', { name: '全量覆盖', exact: true }).check();
    };
    const dialog = page.getByRole('dialog').filter({ has: page.getByText('确认全量覆盖导入', { exact: true }) });
    const preview = async (count: number) => {
      const impact = responseFor(page, 'POST', `${base}/full-import-impact`);
      await page.getByRole('button', { name: '导入数据', exact: true }).click();
      const result = await businessResponse<FullImpact>(await impact);
      expect(result).toMatchObject({ deletedCatalogCount: 2, affectedQuestionCount: count,
        affectedTemplatePaperCount: 0, affectedQuestionTaskCount: 0, affectedReviewTaskCount: 0 });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(`${count} 道`);
      await expect(dialog).toContainText('不删除题目、试卷和任务');
      return result;
    };
    await test.step('全量覆盖预检后取消：无写请求且整棵树、引用、题目和任务保持', async () => {
      for (const [name, paths, count] of [['preserve-all', [path, keep], 0], ['remove-unreferenced', [path], 2]] as const) {
        const control = await writeApi<FullImpact>(admin, 'POST', `${base}/full-import-impact`, {
          folderId: scene.folderId, importMode: 'full', detailList: paths.map((p, i) => ({
            seqNo: i + 1, level1Name: p[0], level2Name: p[1], pass: true,
          })),
        });
        expect(control).toMatchObject({ deletedCatalogCount: count, affectedQuestionCount: 0 });
        await test.info().attach(name, { body: JSON.stringify(control), contentType: 'application/json' });
      }
      await openImport();
      const count = writes;
      await preview(1);
      await capture('full-cancel-impact');
      await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
      await expect(dialog).toBeHidden();
      expect(writes).toBe(count);
      expect(await snapshot()).toEqual(before);
    });
    const beforeFinalImport = await test.step('打开确认后增加第二题引用，旧确认被拒绝且树、题目、任务零写入', async () => {
      await openImport();
      const oldImpact = await preview(1);
      await associate(confirmed[1].id);
      const changed = await snapshot();
      assertCatalogAssociation(before, changed, confirmed[1].id, Object.fromEntries(confirmed.map(q => [q.id, [leaf.id]])));
      const saved = responseFor(page, 'POST', `${base}/batch-import`);
      await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
      const response = await saved;
      expect(parseJson<{ fullImportImpact: FullImpact }>(response.request().postData()!).fullImportImpact).toEqual(oldImpact);
      expect(response.ok()).toBe(true);
      const result = parseJson<Envelope<unknown>>(await response.text());
      expect(result.code, '陈旧确认必须因关联数据变化被拒绝').toBe('10333');
      expect(result.message).toContain('知识点关联数据已变化，请重新确认影响范围');
      expect(await snapshot()).toEqual(changed);
      await capture('stale-confirmation-rejected');
      await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
      await expect(dialog).toBeHidden();
      return changed;
    });
    await test.step('重新预检显示两道引用，确认后只删除目标子树并解除两题引用', async () => {
      await preview(2);
      const saved = responseFor(page, 'POST', `${base}/batch-import`);
      await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
      await businessResponse(await saved);
      await expect(dialog).toBeHidden();
      await openSettings(page, folderName);
      await page.reload({ waitUntil: 'domcontentloaded' });
      assertCatalogChange(beforeFinalImport, await snapshot(), remainingIds, emptyLinks);
      for (const name of keep) await expect(page.getByRole('tree').getByText(name, { exact: true })).toBeVisible();
      for (const name of path) await expect(page.getByRole('tree').getByText(name, { exact: true })).toHaveCount(0);
      await capture('full-reference-result');
    });
  } finally { page.off('request', countWrite); }
}
