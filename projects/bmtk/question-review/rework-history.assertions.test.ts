import { test, expect } from '@playwright/test';
import { expectOldHistoryPreserved, expectReworkOptionContinuity, type ReviewHistory } from './rework-history.assertions';

const original: ReviewHistory = { total: 1, records: [{ id: '2112093123503722496',
  question: '<p>大学物理运动学样题</p>', approvalRound: 1, approvalResult: 2,
  approvalComment: '请补充正方向约定，避免速度正负号产生歧义。' }] };
const final = (): ReviewHistory => ({ total: '2', records: [structuredClone(original.records[0]),
  { ...original.records[0], question: '<p>规定加速度方向为正方向。</p>',
    approvalRound: 2, approvalResult: 1, approvalComment: null }] });

test('复审新增通过记录时，允许新轮次理由为空且保留首轮驳回理由', () => {
  expectOldHistoryPreserved(original, final());
});
for (const [field, value] of [
  ['approvalComment', null], ['approvalComment', ''], ['approvalComment', '其他理由'],
  ['question', '<p>被覆盖的正文</p>'], ['approvalResult', 1], ['approvalRound', 2],
  ['id', '2112093123503722497'],
] as const) {
  test(`首轮历史的 ${field} 被改为 ${JSON.stringify(value)} 必须失败`, () => {
    const changed = final();
    Object.assign(changed.records[0], { [field]: value });
    expect(() => expectOldHistoryPreserved(original, changed)).toThrow();
  });
}
test('首轮历史消失或重复不能误通过', () => {
  const missing = final();
  missing.records.shift(); missing.total = 1;
  expect(() => expectOldHistoryPreserved(original, missing)).toThrow();
  const duplicate = final();
  duplicate.records.push(structuredClone(original.records[0])); duplicate.total = 3;
  expect(() => expectOldHistoryPreserved(original, duplicate)).toThrow();
});
test('没有首轮基线时拒绝验收', () => {
  expect(() => expectOldHistoryPreserved({ records: [], total: 0 }, final())).toThrow();
});

const options = [
  { id: '2114648283699994624', question: '<p>华北</p>', answer: 'false' },
  { id: '2114648283699994625', question: '<p>华东</p>', answer: 'true' },
];
const recreatedOptions = () => options.map((option, index) => ({ ...option,
  id: ['2114648343485603840', '2114648343485603841'][index] }));

test('返工保存重建选项ID时，原选项顺序、全文和答案保持即可建立复审基线', () => {
  expectReworkOptionContinuity(options, recreatedOptions(), true);
});
test('未返工题的正式选项ID仍必须保持', () => {
  expectReworkOptionContinuity(options, structuredClone(options), false);
  expect(() => expectReworkOptionContinuity(options, recreatedOptions(), false)).toThrow();
});
test('返工题不能借重建ID改变正文、答案或选项顺序', () => {
  const text = recreatedOptions(); text[0].question = '<p>华南</p>';
  expect(() => expectReworkOptionContinuity(options, text, true)).toThrow();
  const answer = recreatedOptions(); answer[0].answer = 'true';
  expect(() => expectReworkOptionContinuity(options, answer, true)).toThrow();
  expect(() => expectReworkOptionContinuity(options, recreatedOptions().reverse(), true)).toThrow();
});
test('新的复审选项必须有完整、互不重复的字符串ID', () => {
  const absent = recreatedOptions(); absent[0].id = '';
  expect(() => expectReworkOptionContinuity(options, absent, true)).toThrow();
  const duplicate = recreatedOptions(); duplicate[1].id = duplicate[0].id;
  expect(() => expectReworkOptionContinuity(options, duplicate, true)).toThrow();
});
