import { expect } from '@playwright/test';

export interface HeaderRect { x: number; y: number; width: number; height: number }
export interface HeaderGeometry { width: number; progress: HeaderRect; submit: HeaderRect }

/** TAPD 1007314：不重叠不代表通过；进度和提交按钮还必须完整落在视口内。 */
export function expectHeaderLayout({ width, progress, submit }: HeaderGeometry) {
  for (const [name, box] of [['任务进度', progress], ['提交任务', submit]] as const) {
    for (const value of Object.values(box)) expect(Number.isFinite(value)).toBe(true);
    expect(box.width, `${name}必须有实际宽度`).toBeGreaterThan(0);
    expect(box.height, `${name}必须有实际高度`).toBeGreaterThan(0);
    expect(box.x, `${width}px ${name}左界不能超出视口`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${width}px ${name}右界不能超出视口`).toBeLessThanOrEqual(width);
  }
  const overlapX = Math.min(progress.x + progress.width, submit.x + submit.width) - Math.max(progress.x, submit.x);
  const overlapY = Math.min(progress.y + progress.height, submit.y + submit.height) - Math.max(progress.y, submit.y);
  expect(overlapX > 1 && overlapY > 1, `${width}px任务进度整组与提交按钮不能重叠`).toBe(false);
}
