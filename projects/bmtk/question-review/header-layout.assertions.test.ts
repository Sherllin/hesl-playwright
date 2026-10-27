import { expect, test } from '@playwright/test';
import { expectHeaderLayout } from './header-layout.assertions';

const progress = { x: 32, y: 100, width: 300, height: 24 };
const submit = { x: 600, y: 24, width: 136, height: 40 };

test('窄屏页头换行后进度与提交按钮完整可见且不重叠', () => {
  expect(() => expectHeaderLayout({ width: 768, progress, submit })).not.toThrow();
});

test('原始重叠反例必须转红', () => {
  expect(() => expectHeaderLayout({ width: 768, progress, submit: { ...progress } })).toThrow(/重叠/);
});

for (const width of [1024, 768]) {
  test(`${width}px复现10月15日按钮右界1168的现场必须转红`, () => {
    expect(() => expectHeaderLayout({ width, progress, submit: { ...submit, x: 1032 } })).toThrow(/右界/);
  });
}

test('进度左侧被裁切也不能通过', () => {
  expect(() => expectHeaderLayout({ width: 768, progress: { ...progress, x: -10 }, submit })).toThrow(/左界/);
});
