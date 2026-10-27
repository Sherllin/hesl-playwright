import { expect } from '@playwright/test';

export interface CreationTask {
  taskId: string;
  taskName: string;
  taskStatus: number;
  questionCreators: Array<{ memberId: string; name: string }>;
  [key: string]: unknown;
}

export function expectRecoveryTasks(tasks: CreationTask[], input: {
  voidedTaskId: string;
  retained: readonly CreationTask[];
  replacementName: string;
  replacementExpertId: string;
}): CreationTask {
  expect(tasks.map(task => task.taskId)).not.toContain(input.voidedTaskId);
  expect(tasks).toHaveLength(input.retained.length + 1);
  for (const baseline of input.retained) {
    expect(baseline.taskStatus, '保留任务的初始基线必须确为进行中').toBe(1);
    expect(tasks.find(task => task.taskId === baseline.taskId), '其他任务配置和归属必须保持').toEqual(baseline);
  }
  const replacements = tasks.filter(task => task.taskName === input.replacementName);
  expect(replacements, '本轮必须只新建一条指定名称的替代任务').toHaveLength(1);
  const task = replacements[0];
  expect(typeof task.taskId).toBe('string');
  expect(task.taskId).toMatch(/^\d+$/);
  expect(task.taskStatus, '活动未重开，新任务应直接进行中').toBe(1);
  expect(task.questionCreators.map(expert => expert.memberId)).toEqual([input.replacementExpertId]);
  return task;
}
