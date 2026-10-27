import { expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Actor } from '../support/actors';
import { businessResponse, parseJson, readApi, responseFor, type Envelope } from '../support/api';
import type { CreationSnapshot, CreationWorkspace, ExpectedCreationTask, RaceCreationTask } from './task-start-race.assertions';

const BASE = '/qrProject/question-creation';
export type LaunchOrder = 'create-first' | 'start-first';
export interface CreationRequest {
  clientRequestId: string; projectId: string; taskName: string;
  questionCreators: Array<{ memberId: string; name: string; role?: string }>;
  questionTypeLimited: boolean; quantityLimited: boolean; totalQuestionsReq: number;
  questionRequirements: Array<{ questionTypeId: string; questionTypeName: string; quantity: number }>;
  [key: string]: unknown;
}
interface WriteEvidence {
  method: string; path: string; request: unknown; issuedAt: string; finishedAt?: string;
  status?: number; response?: Envelope<unknown>; transportFailed?: boolean;
}

/** UI准备真实项目及原任务；并发写请求通过同一负责人会话发往真实后端。 */
export class TaskStartRacePage {
  readonly evidence: WriteEvidence[] = [];
  constructor(private readonly leader: Actor, private readonly author: Actor, readonly projectId: string) { }

  async createInitialTask(taskName: string): Promise<{ request: CreationRequest; task: RaceCreationTask }> {
    const page = this.leader.page;
    await page.getByRole('button', { name: /新建出题任务/ }).hover();
    await page.getByRole('menuitem', { name: /单个(?:创建|出题任务)/ }).click();
    const drawer = page.getByRole('dialog').filter({ hasText: '新建单个出题任务' });
    await drawer.getByPlaceholder('任务名称', { exact: true }).fill(taskName);
    await drawer.locator('.ant-select-selector').filter({ hasText: '出题专家' }).click();
    await page.locator('.ant-select-dropdown:visible').getByText(this.author.name, { exact: true }).click();
    await drawer.locator('.ant-select-selector').filter({ hasText: '题型' }).click();
    await page.locator('.ant-select-dropdown:visible').getByText('单选题', { exact: true }).click();
    await drawer.getByPlaceholder('数量不限', { exact: true }).fill('1');
    const created = responseFor(page, 'POST', `${BASE}/addBatch`);
    await drawer.getByRole('button', { name: /确\s*认/ }).click();
    const response = await created;
    const tasks = await businessResponse<RaceCreationTask[]>(response);
    const sent = parseJson<CreationRequest[]>(response.request().postData()!);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ projectId: this.projectId, taskName,
      questionTypeLimited: true, quantityLimited: true, totalQuestionsReq: 1 });
    expect(sent[0].questionCreators.map(member => member.memberId)).toEqual([this.author.id]);
    expect(sent[0].questionRequirements).toHaveLength(1);
    expect(sent[0].questionRequirements[0]).toMatchObject({ questionTypeName: '单选题', quantity: 1 });
    expect(typeof sent[0].questionRequirements[0].questionTypeId).toBe('string');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].taskName).toBe(taskName);
    await expect(drawer).toBeHidden();
    return { request: sent[0], task: tasks[0] };
  }

  cloneRequest(template: CreationRequest, taskName: string): CreationRequest {
    return { ...structuredClone(template), clientRequestId: randomUUID(), taskName };
  }

  expected(task: RaceCreationTask, request: CreationRequest): ExpectedCreationTask {
    expect(typeof task.taskId).toBe('string');
    expect(task.taskName, '创建响应顺序必须与请求相符').toBe(request.taskName);
    return { taskId: task.taskId, taskName: request.taskName, expertId: this.author.id,
      questionTypeId: request.questionRequirements[0].questionTypeId };
  }

  private async write<T>(method: 'POST' | 'PUT', path: string, data?: unknown): Promise<Envelope<T>> {
    const item: WriteEvidence = { method, path, request: data ?? null, issuedAt: new Date().toISOString() };
    this.evidence.push(item);
    try {
      const response = await this.leader.page.request.fetch(`/api${path}`, {
        method, headers: { Authorization: this.leader.token }, data, timeout: 90_000,
      });
      item.status = response.status();
      const body = parseJson<Envelope<T>>(await response.text());
      item.response = body;
      expect(response.ok(), `${method} ${path} 的HTTP状态`).toBe(true);
      return body;
    } catch {
      item.transportFailed = true;
      throw new Error(`${method} ${path} 请求未能读取有效响应，见 task-start-race-responses 附件`);
    } finally {
      item.finishedAt = new Date().toISOString();
    }
  }

  async startAndCreate(requests: CreationRequest[], order: LaunchOrder): Promise<RaceCreationTask[]> {
    // 只控制客户端发起顺序；两项都发出后再等待，不推断事务取锁顺序。
    const create = () => this.write<RaceCreationTask[]>('POST', `${BASE}/addBatch`, requests);
    const start = () => this.write<boolean>('POST', `${BASE}/start/${this.projectId}`);
    const pending = order === 'create-first' ? [create(), start()] : [start(), create()];
    // 即便一项传输失败，也等待另一项收尾，避免跨用例留下仍在写入的请求。
    const results = await Promise.allSettled(pending);
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
    }
    const bodies = results.map(result => (result as PromiseFulfilledResult<Envelope<unknown>>).value);
    const created = bodies[order === 'create-first' ? 0 : 1] as Envelope<RaceCreationTask[]>;
    const started = bodies[order === 'create-first' ? 1 : 0] as Envelope<boolean>;
    expect(created.code, '并发批量新增必须业务成功，不能把500当作预期').toBe('E200');
    expect(started.code, '出题活动必须真实开启').toBe('E200');
    expect(started.data).toBe(true);
    expect(created.data).toHaveLength(requests.length);
    return created.data;
  }

  async createBatch(requests: CreationRequest[]): Promise<RaceCreationTask[]> {
    const body = await this.write<RaceCreationTask[]>('POST', `${BASE}/addBatch`, requests);
    expect(body.code, '新增/重放必须业务成功').toBe('E200');
    expect(body.data).toHaveLength(requests.length);
    return body.data;
  }

  async snapshot(): Promise<CreationSnapshot> {
    const request: APIRequestContext = this.leader.page.request;
    const stage = await readApi<CreationSnapshot['stage']>(request, this.leader.token,
      `/qrProject/get-project-stage-status?projectId=${this.projectId}`);
    const tasks = (await readApi<RaceCreationTask[]>(request, this.leader.token,
      `${BASE}/list?projectId=${this.projectId}`)).sort((a, b) => a.taskId.localeCompare(b.taskId));
    const workspaces: CreationWorkspace[] = [];
    for (const task of tasks) {
      workspaces.push(await readApi<CreationWorkspace>(this.author.page.request, this.author.token,
        `${BASE}/workspace?taskId=${task.taskId}`));
    }
    return { stage, tasks, workspaces };
  }

  async rejectRepeatStartAndOldEdit(template: CreationRequest, taskId: string) {
    const started = await this.write('POST', `${BASE}/start/${this.projectId}`);
    expect(started.code, '重复开启必须明确拒绝').toBe('13003');
    expect(started.data).toBeNull();
    const { clientRequestId: _creationId, ...oldRequest } = template;
    const edited = await this.write('PUT', `${BASE}/update`, { ...oldRequest, taskId, taskName: `${template.taskName}-旧编辑` });
    expect(edited.code, '活动开始前的旧编辑不得再改任务配置').toBe('13016');
    expect(edited.data).toBeNull();
  }

  async showOwnerTasks(tasks: readonly ExpectedCreationTask[], status: 0 | 1) {
    const page = this.leader.page;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '出题专家', exact: true })).toBeVisible({ timeout: 60_000 });
    for (const task of tasks) {
      const row = page.locator(`tr[data-row-key="${task.taskId}"]`);
      await expect(row.getByText(task.taskName, { exact: true })).toBeVisible();
      await expect(row.getByText(status === 1 ? '进行中' : '未开始', { exact: true })).toBeVisible();
      if (status === 1) {
        await expect(row.getByRole('button', { name: '编辑', exact: true })).toBeDisabled();
        await expect(row.getByRole('button', { name: '删除', exact: true })).toBeDisabled();
      }
    }
  }
}
