import { expect, test } from '@playwright/test';
import { expectRecoveryTasks, type CreationTask } from './intervention-recovery.assertions';

const retained: CreationTask = {
  taskId: '9007199254740993', taskName: '其他任务', taskStatus: 1,
  questionCreators: [{ memberId: '9007199254741001', name: '原出题专家' }],
};
const replacement: CreationTask = {
  taskId: '9007199254740995', taskName: '补建任务', taskStatus: 1,
  questionCreators: [{ memberId: '9007199254741003', name: '替代出题专家' }],
};
const input = {
  voidedTaskId: '9007199254740991', retained: [retained],
  replacementName: '补建任务', replacementExpertId: '9007199254741003',
};

test('恢复检查允许保留其他任务且新任务直接进行中，完整保留大ID', () => {
  expect(expectRecoveryTasks([retained, replacement], input).taskId).toBe('9007199254740995');
});

test('另一任务的初始基线不是进行中时，不能冒充保留进行中任务的场景', () => {
  const pending = { ...retained, taskStatus: 0 };
  expect(() => expectRecoveryTasks([pending, replacement], { ...input, retained: [pending] })).toThrow();
});

for (const [name, tasks] of [
  ['丢掉其他任务', [replacement]],
  ['恢复原作废任务身份', [retained, { ...replacement, taskId: input.voidedTaskId }]],
  ['错误分配原专家', [retained, { ...replacement, questionCreators: retained.questionCreators }]],
  ['新任务仍未开始', [retained, { ...replacement, taskStatus: 0 }]],
  ['悄悄改派其他任务', [{ ...retained, questionCreators: replacement.questionCreators }, replacement]],
  ['重复创建两个任务', [retained, replacement, { ...replacement, taskId: '9007199254740997' }]],
] as const) {
  test(`恢复检查反例：${name}必须失败`, () => {
    expect(() => expectRecoveryTasks([...tasks], input)).toThrow();
  });
}
