import { expect, test, type Page, type Route, type Response } from '@playwright/test';
import JSONbig from 'json-bigint';
import { parseJson, type Envelope } from '../support/api';
import { assertRaceOutcome } from './submission-race.assertions';

// 从 REMOTE-REVIEW-RACE-01 / REMOTE-REVIEW-TABS-01 迁移；独立于原仓库。
async function remoteApi<T>(request: Page['request'], token: string, method: 'GET' | 'POST', path: string, data?: unknown) {
  const response = await request.fetch(`/api${path}`, {
    method, headers: { Authorization: token, 'Content-Type': 'application/json;charset=utf-8' },
    data: method === 'GET' ? undefined : data ?? {},
  });
  expect(response.ok(), `接口 HTTP 状态 ${response.status()}`).toBe(true);
  const body = parseJson<Envelope<T>>(await response.text());
  expect(typeof body.code, '接口必须返回业务封包').toBe('string');
  return body;
}

const parse = JSONbig({ storeAsString: true });
const BASE = '/qrProject/question-review';
interface Decision { decisionId: string; decisionVersion: number; result: number; rejectReason: string | null; submitted: boolean }
interface Question { id: string; question: string; questionFingerprint: string; currentDecision: Decision; [key: string]: unknown }
interface Runtime { taskId: string; taskStatus: number; currentBatchSubmitted: boolean; confidentialContentHidden: boolean; questions: { records: Question[] } }
interface Snapshot { taskId: string; decisions: Array<{ decisionId: string; decisionVersion: number }> }
interface History { total: number | string; records: Array<{ id: string; approvalResult: number; approvalRound: number; approvalComment?: string | null; question: string }> }
interface DecisionRequest { instanceId: string; questionFingerprint: string; decisionId?: string; decisionVersion?: number; comment?: string }

export class ReviewSubmissionRacePage {
  private requests: DecisionRequest[] = [];
  private readonly capture = (response: Response) => {
    if (response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(`${BASE}/approve`))
      this.requests.push(response.request().postDataJSON());
  };
  private writer?: Page;
  private original?: Runtime;
  private targetId = '';
  private raceRequest?: DecisionRequest;
  private finalSnapshot?: Snapshot;
  private oldSnapshot?: Snapshot;
  private taskId = '';
  private raceOutcome = '';
  constructor(private readonly page: Page, private readonly token: string,
    private readonly mode: 'serial' | 'simultaneous' = 'simultaneous') {}

  async read(): Promise<Runtime> {
    const result = await remoteApi<Runtime>(this.page.request, this.token, 'POST', `${BASE}/question-tasks`,
      { taskId: this.taskId, pageNum: 1, pageSize: 100 });
    expect(result.code).toBe('E200');
    expect(result.data?.taskId).toBe(this.taskId);
    return result.data!;
  }
  private snapshot(runtime: Runtime): Snapshot {
    expect(runtime.questions.records).toHaveLength(2);
    return { taskId: this.taskId, decisions: runtime.questions.records.map(question => {
      expect(typeof question.currentDecision.decisionId).toBe('string');
      return { decisionId: question.currentDecision.decisionId, decisionVersion: question.currentDecision.decisionVersion };
    }) };
  }
  private async history(): Promise<History> {
    const result = await remoteApi<History>(this.page.request, this.token, 'GET',
      `${BASE}/approval-history-questions?taskId=${this.taskId}&pageSize=100&pageNum=1`);
    expect(result.code).toBe('E200');
    return result.data!;
  }
  private async emptyHistory(): Promise<void> {
    const history = await this.history();
    expect(Number(history.total), '未正式提交之前不得提前生成审批历史').toBe(0);
    expect(history.records).toEqual([]);
  }
  private async selectWriterQuestion(): Promise<void> {
    const page = this.writer!;
    const before = await this.read();
    const index = before.questions.records.findIndex(question => question.id === this.targetId);
    expect(index).toBeGreaterThanOrEqual(0);
    // 第几题是该工作区明确的业务顺序，认领后再核对真实题目ID。
    const row = page.locator('[data-question-row]').filter({ has: page.locator('[data-question-number-status]')
      .getByText(String(index + 1), { exact: true }) });
    const claimed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`${BASE}/claim`)
      && new URL(response.url()).searchParams.get('questionId') === this.targetId);
    await row.click();
    const body = parse.parse(await (await claimed).text());
    expect(body.code).toBe('E200');
    expect(body.data.questionInfo.id).toBe(this.targetId);
    await expect(page.getByTestId('review-content').locator('[data-confidential-target-name="审题题目"]'))
      .toHaveAttribute('data-confidential-target-id', this.targetId);
    await expect(page.getByTestId('review-action-bar').getByRole('button', { name: '通过', exact: true })).toBeEnabled();
  }
  private async writerAction(action: 'approve' | 'reject'): Promise<DecisionRequest> {
    const page = this.writer!;
    await this.selectWriterQuestion();
    const refreshed = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith(`${BASE}/question-tasks`));
    const saved = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith(`${BASE}/${action}`));
    await page.getByTestId('review-action-bar').getByRole('button', { name: action === 'approve' ? '通过' : '驳回', exact: true }).click();
    if (action === 'reject') {
      const dialog = page.getByRole('dialog', { name: '驳回题目' });
      await dialog.getByPlaceholder(/^请填写驳回题目的理由/).fill('E2E-双页签末次改判');
      await dialog.getByRole('button', { name: '确定驳回', exact: true }).click();
    }
    const response = await saved;
    expect(parse.parse(await response.text()).code).toBe('E200');
    expect(parse.parse(await (await refreshed).text()).code).toBe('E200');
    await expect(page.getByRole('button', { name: '提交任务', exact: true })).toBeEnabled();
    await expect(page.getByRole('heading', { name: '暂无待审题目！', exact: true })).toBeVisible();
    return response.request().postDataJSON();
  }
  private async staleRejected(snapshot: Snapshot, current: Runtime): Promise<void> {
    const result = await remoteApi(this.page.request, this.token, 'POST', `${BASE}/submit`, snapshot);
    expect(result.code, '真实旧页签快照必须整批冲突，不得提交未确认的新版本').toBe('OPTIMISTIC_LOCK_CONFLICT');
    expect(await this.read(), '旧快照被拒绝后全部当前正文、决定及任务状态必须保持').toEqual(current);
    await this.emptyHistory();
  }

  async verifyStaleTabs(): Promise<void> {
    this.taskId = new URL(this.page.url()).searchParams.get('taskId')!;
    this.original = await this.read();
    this.oldSnapshot = this.snapshot(this.original);
    expect(this.original.taskStatus).toBe(1);
    for (const question of this.original.questions.records)
      expect(question.currentDecision).toMatchObject({ result: 1, submitted: false });
    await this.emptyHistory();
    this.writer = await this.page.context().newPage();
    const loaded = this.writer.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith(`${BASE}/question-tasks`));
    await this.writer.goto(this.page.url(), { waitUntil: 'domcontentloaded' });
    const writerLoaded = parse.parse(await (await loaded).text());
    expect(writerLoaded.code).toBe('E200');
    expect(this.snapshot(writerLoaded.data), '两个真实页签起点必须是同一决定快照').toEqual(this.oldSnapshot);
    // 全部判定后新页签展示完成空态，须主动点击原题重新认领。
    this.targetId = this.original.questions.records[0].id;
    const target = this.original.questions.records.find(question => question.id === this.targetId)!;
    expect(target).toBeTruthy();
    await test.step('另一真实页签改判驳回；第一页签原快照整体拒绝', async () => {
      await this.writerAction('reject');
      const changed = await this.read();
      const decision = changed.questions.records.find(question => question.id === this.targetId)!.currentDecision;
      expect(decision).toMatchObject({ decisionId: target.currentDecision.decisionId,
        decisionVersion: target.currentDecision.decisionVersion + 1, result: 2, rejectReason: 'E2E-双页签末次改判', submitted: false });
      for (const question of this.original!.questions.records.filter(question => question.id !== this.targetId))
        expect(changed.questions.records.find(item => item.id === question.id)).toEqual(question);
      await this.staleRejected(this.oldSnapshot!, changed);
    });
    await test.step('恢复通过仍递增版本，旧页签不能因结果相同而绕过冲突', async () => {
      await this.writerAction('approve');
      const restored = await this.read();
      const decision = restored.questions.records.find(question => question.id === this.targetId)!.currentDecision;
      expect(decision).toMatchObject({ decisionId: target.currentDecision.decisionId,
        decisionVersion: target.currentDecision.decisionVersion + 2, result: 1, rejectReason: null, submitted: false });
      await this.staleRejected(this.oldSnapshot!, restored);
      this.raceRequest = { instanceId: this.requests.find(request => request.questionFingerprint === target.questionFingerprint)!.instanceId,
        questionFingerprint: target.questionFingerprint, decisionId: decision.decisionId, decisionVersion: decision.decisionVersion,
        comment: 'E2E-同时改判提交' };
      const refreshed = this.page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname.endsWith(`${BASE}/question-tasks`));
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      expect(parse.parse(await (await refreshed).text()).code).toBe('E200');
      await expect(this.page.getByRole('button', { name: '提交任务', exact: true })).toBeEnabled();
    });
  }

  async run(submit: () => Promise<number>): Promise<number> {
    this.page.on('response', this.capture);
    const pattern = '**/question-review/submit';
    let routeFailure: unknown;
    let rejectRoute!: (error: unknown) => void;
    const failedRoute = new Promise<never>((_, reject) => { rejectRoute = reject; });
    const handler = async (route: Route) => {
      let actualResponse: import('@playwright/test').APIResponse | undefined;
      try {
        const current = await this.read();
        const snapshot = route.request().postDataJSON() as Snapshot;
        expect(snapshot).toEqual(this.snapshot(current));
        if (this.mode === 'serial') {
          this.finalSnapshot = snapshot;
          this.raceOutcome = 'serial-control';
          await route.continue();
          return;
        }
        const claim = await remoteApi<{ instanceId: string; questionInfo: { id: string }; currentDecision: Decision }>(
          this.writer!.request, this.token, 'POST', `${BASE}/claim?taskId=${this.taskId}&questionId=${this.targetId}`);
        expect(claim.code).toBe('E200');
        expect(claim.data?.questionInfo.id).toBe(this.targetId);
        expect(claim.data?.instanceId).toBe(this.raceRequest!.instanceId);
        expect(claim.data?.currentDecision.decisionVersion).toBe(this.raceRequest!.decisionVersion);
        const [submitted, changed] = await Promise.all([
          this.page.request.post(route.request().url(), { headers: { Authorization: this.token }, data: snapshot }),
          this.writer!.request.post(`/api${BASE}/reject`, { headers: { Authorization: this.token }, data: this.raceRequest }),
        ]);
        actualResponse = submitted;
        const submittedBody = parse.parse(await submitted.text()), changedBody = parse.parse(await changed.text());
        await test.info().attach('review-race-response-evidence', { contentType: 'application/json', body: JSON.stringify({
          taskId: this.taskId, questionId: this.targetId, snapshot,
          decisionRequest: this.raceRequest,
          submitResponse: { httpStatus: submitted.status(), body: submittedBody },
          decisionResponse: { httpStatus: changed.status(), body: changedBody },
        }, null, 2) });
        let finalResponse = submitted;
        this.raceOutcome = assertRaceOutcome(submittedBody.code, changedBody.code);
        if (this.raceOutcome === 'submit-first') {
          this.finalSnapshot = snapshot;
        } else {
          await this.emptyHistory();
          const after = await this.read();
          expect(after.taskStatus).toBe(1);
          const target = after.questions.records.find(question => question.id === this.targetId)!;
          expect(target.currentDecision).toMatchObject({ result: 2, submitted: false,
            decisionVersion: this.raceRequest!.decisionVersion! + 1 });
          expect(target.status, '未正式提交驳回不能提前触发返工').toBe(2);
          await this.writer!.reload({ waitUntil: 'domcontentloaded' });
          await this.writerAction('approve');
          this.finalSnapshot = this.snapshot(await this.read());
          finalResponse = await this.page.request.post(route.request().url(), { headers: { Authorization: this.token }, data: this.finalSnapshot });
          expect(parse.parse(await finalResponse.text()).code, '冲突后以重新确认的当前快照恢复提交').toBe('E200');
        }
        await test.info().attach('review-race-codes', { contentType: 'application/json', body: JSON.stringify({
          outcome: this.raceOutcome, submitCode: submittedBody.code, decisionCode: changedBody.code,
          recoverySubmitted: this.raceOutcome === 'decision-first',
        }) });
        // 仅回传真实后端成功响应；若发生冲突，恢复是本测试显式执行的重新确认，不宣称原请求成功。
        await route.fulfill({ response: finalResponse });
      } catch (error) {
        routeFailure = error;
        if (actualResponse) await route.fulfill({ response: actualResponse });
        else await route.abort('failed');
        const current = await this.read();
        const history = await this.history();
        await test.info().attach('review-race-state-after-error', { contentType: 'application/json', body: JSON.stringify({
          taskId: this.taskId, taskStatus: current.taskStatus, currentBatchSubmitted: current.currentBatchSubmitted,
          confidentialContentHidden: current.confidentialContentHidden, historyCount: Number(history.total),
          questions: current.questions.records.map(question => ({ id: question.id, status: question.status,
            decision: question.currentDecision })),
        }, null, 2) });
        await test.info().attach('review-race-failure-page', { contentType: 'image/png',
          body: await this.writer!.screenshot({ fullPage: true }) });
        rejectRoute(error);
      }
    };
    await this.page.route(pattern, handler);
    try {
      const count = await Promise.race([submit(), failedRoute]);
      if (routeFailure) throw routeFailure;
      await test.step('正式历史唯一、提交重放不重复、旧改判拒绝且正文保密', () => this.verifyFinal());
      return count;
    } finally {
      this.page.off('response', this.capture);
      await this.page.unroute(pattern, handler);
      await this.writer?.close();
    }
  }

  private async verifyFinal(): Promise<void> {
    const runtime = await this.read();
    expect(runtime).toMatchObject({ taskStatus: 2, currentBatchSubmitted: true, confidentialContentHidden: true });
    await expect(this.page.getByTestId('review-confidential-state')).toBeVisible();
    const history = await this.history();
    expect(Number(history.total)).toBe(2);
    expect(history.records).toHaveLength(2);
    expect(history.records.map(item => item.id).sort()).toEqual(this.original!.questions.records.map(item => item.id).sort());
    for (const record of history.records) {
      expect(record).toMatchObject({ approvalResult: 1, approvalRound: 1 });
      expect(record.approvalComment ?? null).toBeNull();
      expect(record.question).toBe(this.original!.questions.records.find(question => question.id === record.id)!.question);
    }
    const retry = await remoteApi(this.page.request, this.token, 'POST', `${BASE}/submit`, this.finalSnapshot);
    expect(retry.code).toBe('E200');
    expect(await this.history()).toEqual(history);
    const changed = await remoteApi(this.page.request, this.token, 'POST', `${BASE}/reject`, this.raceRequest);
    expect(changed.code).toBe('USER_NOT_INSTANCE_LOCKER');
    expect(await this.read()).toEqual(runtime);
    expect(await this.history()).toEqual(history);
    await test.info().attach('review-race-final', { contentType: 'image/png', body: await this.page.screenshot({ fullPage: true }) });
    await test.info().attach('review-race-identity-summary', { contentType: 'application/json', body: JSON.stringify({
      taskId: this.taskId, targetQuestionId: this.targetId, questionIds: history.records.map(question => question.id),
      historyTotal: Number(history.total), outcome: this.raceOutcome, submittedSnapshot: this.finalSnapshot,
    }) });
  }
}
