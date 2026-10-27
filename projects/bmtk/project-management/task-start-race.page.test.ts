import { expect, test, type Page } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { TaskStartRacePage, type CreationRequest, type LaunchOrder } from './task-start-race.page';

const projectId = '9007199254740993';
const input: CreationRequest[] = ['并发甲', '并发乙'].map((name, index) => ({
  projectId, taskName: name, clientRequestId: `00000000-0000-4000-8000-00000000000${index}`,
  questionCreators: [{ memberId: '9007199254741001', name: '离线专家' }],
  questionTypeLimited: true, quantityLimited: true, totalQuestionsReq: 1,
  questionRequirements: [{ questionTypeId: '9007199254741011', questionTypeName: '单选题', quantity: 1 }],
}));

for (const order of ['create-first', 'start-first'] as const satisfies readonly LaunchOrder[]) {
  test(`开启竞争请求${order}：两个真实HTTP请求均到达后才返回，保持大ID和原始Authorization`, async ({ playwright }) => {
    const received: Array<{ path: string; method: string; authorization: string | undefined; body: string; response: ServerResponse }> = [];
    const server = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      received.push({ path: request.url!, method: request.method!, authorization: request.headers.authorization, body, response });
      // 第一请求保持未返回，直到另一请求也已到达；串行await实现会在请求超时处失败。
      if (received.length === 2) {
        for (const item of received) {
          item.response.setHeader('Content-Type', 'application/json');
          item.response.end(JSON.stringify({ code: 'E200', data: item.path.endsWith('/addBatch')
            ? [{ taskId: '9007199254741031', taskName: '并发甲' }, { taskId: '9007199254741033', taskName: '并发乙' }]
            : true }));
        }
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const request = await playwright.request.newContext({ baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    const actor = { page: { request } as Page, token: 'offline-test-token', id: '9007199254741001', name: '离线专家' };
    const race = new TaskStartRacePage(actor, actor, projectId);
    try {
      expect((await race.startAndCreate(structuredClone(input), order)).map(task => task.taskId))
        .toEqual(['9007199254741031', '9007199254741033']);
      expect(received).toHaveLength(2);
      for (const item of received) {
        expect(item.method).toBe('POST');
        expect(item.authorization).toBe('offline-test-token');
      }
      const create = received.find(item => item.path === '/api/qrProject/question-creation/addBatch')!;
      expect(JSON.parse(create.body)).toEqual(input);
      expect(received.some(item => item.path === `/api/qrProject/question-creation/start/${projectId}`)).toBe(true);
      expect(race.evidence.map(item => item.path)).toEqual(order === 'create-first'
        ? ['/qrProject/question-creation/addBatch', `/qrProject/question-creation/start/${projectId}`]
        : [`/qrProject/question-creation/start/${projectId}`, '/qrProject/question-creation/addBatch']);
      expect(JSON.stringify(race.evidence), '可分享响应附件不得携带Authorization').not.toContain('offline-test-token');
    } finally {
      await request.dispose();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
}
