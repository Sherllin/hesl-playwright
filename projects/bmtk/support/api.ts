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

export async function readApi<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const response = await request.get(`/api${path}`, { headers: { Authorization: token } });
  expect(response.ok()).toBe(true);
  const body = parseJson<Envelope<T>>(await response.text());
  expect(body.code, '读取真实业务数据').toBe('E200');
  return body.data;
}
