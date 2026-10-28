import { expect, type Page } from '@playwright/test';
import { businessResponse, parseJson, responseFor } from '../support/api';
import { TaskPage } from '../support/task.page';
import type { MatchingQuestion } from '../question-bank/matching';
import type { SavedPaper } from './matching.assertions';

// 每个公开方法对应可独立组合的一项组卷业务操作，不包含跨角色流程。
export class ComposePage {
  constructor(private readonly page: Page) { }

  async setTitle(title: string) {
    await this.page.getByPlaceholder('请输入试卷标题').fill(title);
  }

  async addQuestion(source: MatchingQuestion, stem: string) {
    const sourceRead = responseFor(this.page, 'POST', /\/qrQuestionEntity\/getByCatalog(?:ForProject)?$/);
    await this.page.getByText('添加题目', { exact: true }).click();
    const data = await businessResponse<{ records: MatchingQuestion[] }>(await sourceRead);
    const observed = data.records.find(q => q.id === source.id);
    expect(observed, '选题列表必须包含本次审核入库的原题').toBeTruthy();
    expect(observed!.question).toBe(source.question);
    const drawer = this.page.locator('.ant-drawer-content').filter({ hasText: '添加题目' });
    const card = drawer.locator(`[data-confidential-target-type="QUESTION"][data-confidential-target-id="${source.id}"]`);
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(stem);
    // 题目正文与操作区同属直接父题卡；按钮文案变化后仍定位同一原题。
    const question = card.locator('..');
    await question.getByRole('button', { name: '加入试卷', exact: true }).click();
    await expect(question.getByRole('button', { name: '取消添加', exact: true })).toBeVisible();
    await drawer.getByRole('button', { name: /close|关闭/i }).click();
    await expect(drawer).toBeHidden();
  }

  private async scoreDrawer() {
    await this.page.getByText('设置分值', { exact: true }).click();
    return this.page.locator('.ant-drawer-content').filter({ hasText: '设置分值' });
  }

  async setChildScores(scores: readonly number[]) {
    const drawer = await this.scoreDrawer();
    const inputs = drawer.locator('.score-table tbody .ant-input-number-input');
    await expect(inputs).toHaveCount(scores.length);
    for (const [index, score] of scores.entries()) {
      await inputs.nth(index).fill(String(score));
      await inputs.nth(index).blur();
    }
    await drawer.getByRole('button', { name: /确\s*定/ }).click();
    await expect(drawer).toBeHidden();
  }

  async readChildScores(): Promise<number[]> {
    const drawer = await this.scoreDrawer();
    const inputs = drawer.locator('.score-table tbody .ant-input-number-input');
    const result = await Promise.all((await inputs.all()).map(async input => Number(await input.inputValue())));
    await drawer.getByRole('button', { name: /确\s*定/ }).click();
    await expect(drawer).toBeHidden();
    return result;
  }

  async moveChildDown(stem: string, oneBasedIndex: number) {
    const root = this.page.locator('[id^="question-"][data-ai-review-numbering-path]').filter({
      has: this.page.locator('[data-confidential-target-type="QUESTION"]').filter({ hasText: stem }),
    });
    await expect(root).toHaveCount(1);
    await root.hover();
    await root.getByText('编辑', { exact: true }).click();
    const drawer = this.page.locator('.ant-drawer-content').filter({ hasText: '编辑题目' });
    await drawer.getByRole('button', { name: `下移第${oneBasedIndex}小题`, exact: true }).click();
    await drawer.getByRole('button', { name: /保\s*存/, exact: true }).click();
    await expect(drawer).toBeHidden();
  }

  async expectTotal(questionCount: number, total: number) {
    await expect(this.page.getByText(new RegExp(`总共\\s*${questionCount}\\s*题[，,]\\s*${total}\\s*分`))).toBeVisible();
  }

  async saveDraft(): Promise<SavedPaper> {
    const saved = responseFor(this.page, 'POST', '/paper-compose/save-draft');
    await this.page.getByRole('button', { name: '暂存草稿', exact: true }).click();
    const response = await saved;
    const result = await businessResponse<{ paperId: string }>(response);
    const sent = parseJson<SavedPaper>(response.request().postData()!);
    const paperId = result.paperId ?? sent.paperId;
    expect(typeof paperId, '暂存必须返回真实试卷ID').toBe('string');
    await this.page.waitForURL(url => url.pathname === '/project/task');
    return { ...sent, paperId };
  }

  async reopen(projectName: string, paperId: string): Promise<SavedPaper> {
    const read = responseFor(this.page, 'GET', new RegExp(`/paper/project/${paperId}$`));
    await new TaskPage(this.page).openNodeTask(projectName, /去组卷|继续组卷/);
    return businessResponse<SavedPaper>(await read);
  }

  async submit(paperId: string) {
    const submit = this.page.getByRole('button', { name: /^提交任务$/ });
    const submitted = responseFor(this.page, 'POST', '/paper-compose/save');
    await submit.click();
    const result = await businessResponse<{ paperId: string }>(await submitted);
    expect(result.paperId, '正式提交保持原卷身份').toBe(paperId);
    await expect(submit).toBeHidden();
  }
}
