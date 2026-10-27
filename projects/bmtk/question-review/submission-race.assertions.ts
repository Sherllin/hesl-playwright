import { expect } from '@playwright/test';

// 只允许需求约定的两种顺序结果；HTTP 200 或任意一方成功都不足以判通过。
export function assertRaceOutcome(submitCode: string, rejectCode: string): 'submit-first' | 'decision-first' {
  if (submitCode === 'E200') {
    expect(rejectCode, '正式提交先完成后，改判必须拒绝').toBe('USER_NOT_INSTANCE_LOCKER');
    return 'submit-first';
  }
  expect(rejectCode, '改判先完成则必须真实成功').toBe('E200');
  expect(submitCode, '提交的旧决定版本必须整体冲突').toBe('OPTIMISTIC_LOCK_CONFLICT');
  return 'decision-first';
}
