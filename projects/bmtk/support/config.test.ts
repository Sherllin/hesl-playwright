import { test, expect } from '@playwright/test';
import { loadBmtkConfig, roles } from './config';
import { parseJson } from './api';

function exampleEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { BMTK_ALLOW_WRITES: '1', BMTK_BASE_URL: 'https://example.test', BMTK_TENANT_NAME: '测试组织' };
  for (const name of ['ADMIN', 'LEADER', 'AUTHOR', 'QUESTION_REVIEWER', 'COMPOSER', 'PAPER_REVIEWER']) {
    env[`BMTK_${name}_USERNAME`] = `fixture-${name}`;
    env[`BMTK_${name}_PASSWORD`] = 'unused-test-fixture';
  }
  return env;
}
test('完整独立配置能加载六个角色', () => {
  const config = loadBmtkConfig(exampleEnv());
  expect(Object.keys(config.accounts)).toEqual([...roles]);
  expect(config.baseURL).toBe('https://example.test');
});
test('未显式开启业务写入时立即拒绝', () => {
  expect(() => loadBmtkConfig({ ...exampleEnv(), BMTK_ALLOW_WRITES: '0' })).toThrow(/BMTK_ALLOW_WRITES/);
});
test('缺少角色配置时明确失败，不跳过用例', () => {
  const env = exampleEnv(); delete env.BMTK_COMPOSER_PASSWORD;
  expect(() => loadBmtkConfig(env)).toThrow(/BMTK_COMPOSER_PASSWORD/);
});
test('禁止多个角色共用同一账号', () => {
  const env = exampleEnv(); env.BMTK_AUTHOR_USERNAME = env.BMTK_LEADER_USERNAME;
  expect(() => loadBmtkConfig(env)).toThrow(/独立/);
});
test('站点地址不能夹带凭据或业务路径', () => {
  expect(() => loadBmtkConfig({ ...exampleEnv(), BMTK_BASE_URL: 'https://user:password@example.test' })).toThrow(/无凭据/);
  expect(() => loadBmtkConfig({ ...exampleEnv(), BMTK_BASE_URL: 'https://example.test/api' })).toThrow(/根地址/);
});
test('服务端数值int64在解析时保留完整位数，分值仍为数值', () => {
  const parsed = parseJson<{ id: string; score: number }>('{"id":9007199254740993,"score":7}');
  expect(parsed).toEqual({ id: '9007199254740993', score: 7 });
});
test('重复JSON字段不能静默覆盖原身份', () => {
  expect(() => parseJson('{"id":"original","id":"other"}')).toThrow();
});
