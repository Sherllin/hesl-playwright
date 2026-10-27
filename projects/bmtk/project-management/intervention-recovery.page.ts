import { expect, type Locator, type Page } from '@playwright/test';
import { businessResponse, readApi, responseFor } from '../support/api';

export interface InterventionRecord {
  id: string;
  projectId: string;
  projectName: string;
  reason: string;
  status: number;
  remark: string | null;
}

/** 本场景只通过真实UI申请、接受、结束任务及结束介入；API只读交叉验证。 */
export class InterventionRecoveryPage {
  constructor(private readonly page: Page, private readonly token: string) { }

  async records(projectId: string) {
    return readApi<InterventionRecord[]>(this.page.request, this.token,
      `/qrProject/intervention/list?projectId=${projectId}&stage=1`);
  }

  async apply(projectId: string, reason: string): Promise<InterventionRecord> {
    await this.page.getByRole('button', { name: /申请(?:系统)?管理员介入/ }).click();
    const dialog = this.page.getByRole('dialog', { name: '申请管理员介入', exact: true });
    await dialog.getByPlaceholder(/请填写申请系统管理员介入/).fill(reason);
    const applied = responseFor(this.page, 'POST', '/qrProject/intervention/apply');
    await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
    await businessResponse(await applied);
    const history = this.page.getByRole('dialog', { name: /提交记录/ });
    await expect(history.getByText(reason, { exact: true })).toBeVisible();
    await history.getByRole('button', { name: /close|关闭/i }).click();
    await expect(history).toBeHidden();
    const records = (await this.records(projectId)).filter(record => record.reason === reason);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ projectId, reason, status: 1 });
    expect(typeof records[0].id).toBe('string');
    return records[0];
  }

  private async recordRow(card: Locator, id: string) {
    const row = card.locator(`tr[data-row-key="${id}"]`);
    const first = card.getByTitle('1', { exact: true });
    if (await first.isVisible()) await first.click();
    await expect(card.locator('.ant-spin-spinning')).toHaveCount(0);
    while (!(await row.count())) {
      const next = card.locator('.ant-pagination-next:not(.ant-pagination-disabled)');
      await expect(next, `待介入列表必须包含本次申请${id}`).toHaveCount(1);
      const ids = () => card.locator('tr.ant-table-row').evaluateAll(rows => rows.map(r => r.getAttribute('data-row-key')));
      const before = await ids();
      await next.getByRole('button').click();
      await expect.poll(ids).not.toEqual(before);
    }
    return row;
  }

  async acknowledge(record: InterventionRecord) {
    await this.page.goto('/project/manage', { waitUntil: 'domcontentloaded' });
    const loaded = responseFor(this.page, 'GET', '/qrProject/intervention/list');
    await this.page.getByRole('tab', { name: '介入请求', exact: true }).click();
    await businessResponse(await loaded);
    const row = await this.recordRow(this.page.getByTestId('intervention-pending-card'), record.id);
    await expect(row).toContainText(record.projectName);
    await expect(row.getByText(record.reason, { exact: true })).toBeVisible();
    await row.getByText('处理', { exact: true }).click();
    const gateway = this.page.getByRole('dialog', { name: '处理介入请求', exact: true });
    await expect(gateway.getByText(record.reason, { exact: true })).toBeVisible();
    const acknowledged = responseFor(this.page, 'POST', '/qrProject/intervention/acknowledge');
    await gateway.getByRole('button', { name: '确定介入', exact: true }).click();
    await businessResponse(await acknowledged);
    await expect(gateway).toBeHidden();
  }

  async voidTask(taskId: string) {
    const row = this.page.locator(`tr[data-row-key="${taskId}"]`);
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: /^结\s*束$/ }).click();
    const dialog = this.page.getByRole('dialog').filter({ hasText: '确认结束任务' });
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    const voided = responseFor(this.page, 'POST', `/question-creation/void/${taskId}`);
    await dialog.getByRole('button', { name: '确认结束', exact: true }).click();
    await businessResponse(await voided);
    await expect(dialog).toBeHidden();
    await expect(row).toHaveCount(0);
  }

  async finishWithoutReplacement(record: InterventionRecord, remark: string) {
    await this.page.getByRole('button', { name: '确认修改', exact: true }).click();
    const dialog = this.page.getByRole('dialog', { name: '确认修改', exact: true });
    await dialog.getByPlaceholder('请输入备注').fill(remark);
    const finished = responseFor(this.page, 'POST', '/qrProject/intervention/continue');
    await dialog.getByRole('button', { name: '确认修改', exact: true }).click();
    await businessResponse(await finished);
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await this.records(record.projectId))
      .find(item => item.id === record.id)).toMatchObject({ status: 3, remark });
  }
}
