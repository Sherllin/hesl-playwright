import { expect } from '@playwright/test';

export interface CreationRequirement { questionTypeId: string; questionTypeName: string; quantity: number }
export interface RaceCreationTask {
  taskId: string; taskName: string; taskStatus: number; totalQuestionsReq: number;
  questionCreators: Array<{ memberId: string; name: string }>;
  questionRequirements: CreationRequirement[];
}
export interface CreationWorkspace {
  taskId: string; projectId: string; taskStatus: number; totalQuestionsReq: number;
  slots: Array<{ slotId: string; questionTypeId: string; questionTypeName: string;
    editable: boolean; confirmed: boolean; draftPayload: unknown; version: number | string }>;
}
export interface CreationSnapshot {
  stage: { projectStage: number; projectStageStatus: number };
  tasks: RaceCreationTask[];
  workspaces: CreationWorkspace[];
}
export interface ExpectedCreationTask {
  taskId: string; taskName: string; expertId: string; questionTypeId: string;
}

export function expectCreationSnapshot(snapshot: CreationSnapshot, input: {
  projectId: string; tasks: readonly ExpectedCreationTask[]; status: 0 | 1;
}): void {
  expect(snapshot.stage).toMatchObject({ projectStage: 1, projectStageStatus: input.status === 1 ? 2 : 1 });
  expect(snapshot.tasks).toHaveLength(input.tasks.length);
  expect(snapshot.workspaces).toHaveLength(input.tasks.length);
  const identities = input.tasks.map(task => task.taskId).sort();
  expect(new Set(identities).size).toBe(input.tasks.length);
  expect(snapshot.tasks.map(task => task.taskId).sort()).toEqual(identities);
  expect(snapshot.workspaces.map(workspace => workspace.taskId).sort()).toEqual(identities);
  for (const expected of input.tasks) {
    const task = snapshot.tasks.find(task => task.taskId === expected.taskId)!;
    expect(typeof task.taskId).toBe('string');
    expect(task.taskId).toMatch(/^\d+$/);
    expect(task.taskName).toBe(expected.taskName);
    expect(task.taskStatus, `${task.taskName} 应与出题活动状态一致`).toBe(input.status);
    expect(task.totalQuestionsReq).toBe(1);
    expect(task.questionCreators.map(expert => expert.memberId)).toEqual([expected.expertId]);
    expect(task.questionRequirements).toEqual([
      { questionTypeId: expected.questionTypeId, questionTypeName: '单选题', quantity: 1 },
    ]);
    const workspace = snapshot.workspaces.find(workspace => workspace.taskId === task.taskId)!;
    expect(workspace).toMatchObject({ projectId: input.projectId, taskStatus: input.status, totalQuestionsReq: 1 });
    expect(workspace.slots, '固定单选1题必须保留唯一题位').toHaveLength(1);
    const slot = workspace.slots[0];
    expect(typeof slot.slotId).toBe('string');
    expect(slot.slotId).toMatch(/^\d+$/);
    expect(slot).toMatchObject({ questionTypeId: expected.questionTypeId, questionTypeName: '单选题',
      editable: input.status === 1, confirmed: false, draftPayload: null });
  }
  const slotIds = snapshot.workspaces.flatMap(workspace => workspace.slots.map(slot => slot.slotId));
  expect(new Set(slotIds).size, '不同任务不得共用题位').toBe(slotIds.length);
}
