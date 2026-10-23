import { expect, type APIRequestContext, type Page, type Response } from '@playwright/test';
import JSONbig from 'json-bigint';

// 服务端 int64 即使以 JSON 数字返回，也必须在解析时保留全部位数。
const codec = JSONbig({ storeAsString: true, strict: true });
export const parseJson = <T>(text: string): T => codec.parse(text) as T;
export interface Envelope<T> { code: string; message?: string; data: T }

export async function businessResponse<T>(response: Response): Promise<T> {
  expect(response.ok(), `接口 HTTP 状态 ${response.status()}`).toBe(true);
  const body = parseJson<Envelope<T>>(await response.text());
  expect(body.code, `接口业务失败：${body.message ?? body.code}`).toBe('E200');
  return body.data;
}

export function responseFor(page: Page, method: string, path: string | RegExp) {
  return page.waitForResponse(response => {
    const pathname = new URL(response.url()).pathname;
    return response.request().method() === method &&
      (typeof path === 'string' ? pathname.endsWith(path) : path.test(pathname));
  });
}

export interface BusinessCode { code: string; message?: string }

// Playwright 的谓词里不要读响应体：导航取消或重定向的响应，body 可能已被浏览器回收，
// response.json() 会抛 CDP 协议错误（No resource with given identifier found），并被记成一条
// unhandled error。这里只在回调里按 method+url 收候选，body 在回调外读取，读不到就换下一条。
// 调用时先拿到 Promise 再导航，监听在第一个 await 之前就已挂上。
export function waitForBusinessResponse(
  page: Page,
  matches: (response: Response) => boolean,
  { timeout = 90_000, accept = (_body: BusinessCode) => true }:
    { timeout?: number; accept?: (body: BusinessCode) => boolean } = {},
): Promise<{ response: Response; body: BusinessCode }> {
  const candidates: Response[] = [];
  const collect = (candidate: Response) => { if (matches(candidate)) candidates.push(candidate); };
  page.on('response', collect);
  const deadline = Date.now() + timeout;
  let last: BusinessCode | undefined;
  return (async () => {
    try {
      for (;;) {
        const candidate = candidates.shift();
        if (candidate) {
          const body = (await candidate.json().catch(() => undefined)) as BusinessCode | undefined;
          if (body) {
            last = body;
            if (accept(body)) return { response: candidate, body };
          }
          continue;
        }
        if (Date.now() >= deadline) {
          throw new Error(last
            ? `接口响应业务失败：${last.message ?? last.code}`
            : '等待业务接口响应超时');
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    } finally {
      page.off('response', collect);
    }
  })();
}

export async function readApi<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const response = await request.get(`/api${path}`, { headers: { Authorization: token } });
  expect(response.ok()).toBe(true);
  const body = parseJson<Envelope<T>>(await response.text());
  expect(body.code, '读取真实业务数据').toBe('E200');
  return body.data;
}
