import { expect } from '@playwright/test';
import type { Actor } from '../support/actors';
import { readApi, parseJson, type Envelope } from '../support/api';
import type { PaperStyleLayout } from './style-layouts';

interface Style { id: string; name: string; style: Record<string, unknown>; defaulted: boolean | number }

export function assertPreparedStyle(actual: Record<string, unknown>, expected: Record<string, unknown>) {
  const normalize = (value: unknown) => String(value ?? '').replace(/^"+|"+$/g, '');
  expect({ ...actual, fontStyle: normalize(actual.fontStyle) }, '回读配置必须与准备值一致，不能继承冲突的旧CSS')
    .toMatchObject(expected);
}

/** API 只准备独立正确样式以隔离7304保存缺陷，实际关联/预览/下载必须走UI。 */
export async function preparePaperStyle(admin: Actor, layout: PaperStyleLayout, name: string) {
  expect(name).toMatch(/^E2E-/);
  const before = await readApi<Style[]>(admin.page.request, admin.token, '/qrepo/paperStyle/list');
  expect(before.length, '需要既有样式作为字段完整的结构模板').toBeGreaterThan(0);
  const seed = await readApi<Style>(admin.page.request, admin.token, `/qrepo/paperStyle/${before[0].id}`);
  const style: Record<string, unknown> = { ...structuredClone(seed.style),
    paperSize: layout.paperSize, printSetup: layout.printSetup,
    topMargin: 1.2, bottomMargin: 1.2, leftMargin: 3.2, rightMargin: 1.2,
    showBindingLine: false,
    body: { fontName: 'Arial', fontSize: 18, fontColor: [22, 119, 255], type: 2, lineSpace: 0 },
    fontStyle: 'line-height:1.5;font-size:18px;font-family:Arial;color:rgb(22,119,255);',
    textBoxes: [{ type: 0, index: 0, content: `<p>药学综合模拟试卷（满分100分） · ${name}</p>`, isRichText: true }],
    bindingLine: { type: 0, paperSecret: [] },
  };
  const response = await admin.page.request.post('/api/qrepo/paperStyle/add', {
    headers: { Authorization: admin.token }, data: { name, style, defaulted: false },
  });
  expect(response.ok()).toBe(true);
  expect(parseJson<Envelope<unknown>>(await response.text()).code).toBe('E200');
  const after = await readApi<Style[]>(admin.page.request, admin.token, '/qrepo/paperStyle/list');
  for (const old of before) expect(after.find(s => s.id === old.id), '不能改共享样式和默认配置').toEqual(old);
  const own = after.filter(s => s.name === name);
  expect(own).toHaveLength(1);
  expect(typeof own[0].id).toBe('string');
  const saved = await readApi<Style>(admin.page.request, admin.token, `/qrepo/paperStyle/${own[0].id}`);
  assertPreparedStyle(saved.style, style);
  expect(() => assertPreparedStyle({ ...saved.style,
    fontStyle: 'line-height:2;font-size:14px;font-family:SimSun;color:rgb(0,0,0);',
  }, style), '真实准备阶段也要验证冲突CSS反例被拒绝').toThrow();
  return { id: own[0].id, name, style };
}
