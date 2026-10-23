import { expect, type Page } from '@playwright/test';
import { businessResponse, readApi, responseFor } from '../support/api';
import type { SavedPaper } from '../compose/matching.assertions';

export class PaperReviewPage {
  constructor(private readonly page: Page) { }

  async readPaper(token: string, paperId: string): Promise<SavedPaper> {
    const url = new URL(this.page.url());
    const projectId = url.searchParams.get('projectId');
    const taskId = url.searchParams.get('taskId');
    expect(projectId).toMatch(/^\d+$/);
    expect(taskId).toMatch(/^\d+$/);
    return readApi(this.page.request, token, `/qrepo/paper/project/${paperId}?${new URLSearchParams({ projectId: projectId!, taskId: taskId! })}`);
  }

  async approveAndSubmit() {
    const approve = this.page.getByRole('button', { name: /^通\s*过$/ });
    await expect(approve).toHaveCount(1);
    await expect(approve).toBeEnabled({ timeout: 90_000 });
    await approve.click();
    const submit = this.page.getByRole('button', { name: /^提交任务$/ });
    await expect(submit).toBeEnabled();
    const approved = responseFor(this.page, 'POST', '/qrProject/paper-review/approve');
    await submit.click();
    await businessResponse(await approved);
  }
}
