import { test, expect } from '@playwright/test';
import { assertRaceOutcome } from './submission-race.assertions';

test('改判先完成时，提交必须返回版本冲突', () => {
  expect(assertRaceOutcome('OPTIMISTIC_LOCK_CONFLICT', 'E200')).toBe('decision-first');
});

test('提交先完成时，改判必须被业务拒绝', () => {
  expect(assertRaceOutcome('E200', 'USER_NOT_INSTANCE_LOCKER')).toBe('submit-first');
});

for (const [submit, reject] of [
  ['500', 'E200'], ['E200', '500'], ['E200', 'E200'],
  ['OPTIMISTIC_LOCK_CONFLICT', 'USER_NOT_INSTANCE_LOCKER'],
]) {
  test(`并发提交=${submit}、改判=${reject}不能被当作正确收敛`, () => {
    expect(() => assertRaceOutcome(submit, reject)).toThrow();
  });
}
