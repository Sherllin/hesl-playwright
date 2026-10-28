import { expect } from '@playwright/test';
import type { Actor } from '../support/actors';
import { readApi, parseJson, type Envelope } from '../support/api';
import type { MatchingQuestion } from '../question-bank/matching';
import { imageSamples, type FixtureImage } from '../paper-make/image-layout.tools';

interface Slot { slotId: string; version: number; questionId: string; confirmed: boolean; questionTypeId: string; draftPayload: MatchingQuestion }
interface Workspace {
  taskId: string; planVersion: number; slots: Slot[];
  enabledQuestionTypes: Array<{ questionTypeId: string; systemQuestionTypeId: number; questionTypeName: string }>;
}

/** Prepare layout data through the normal versioned workspace, not the editor or template importer. */
export async function prepareImageQuestions(author: Actor, images: FixtureImage[], runId: string): Promise<MatchingQuestion[]> {
  const taskId = new URL(author.page.url()).searchParams.get('taskId');
  expect(taskId).toMatch(/^\d+$/);
  // Unmount the untouched editor before API preparation; it must not autosave a stale empty draft.
  await author.page.goto('/project/task', { waitUntil: 'domcontentloaded' });
  const current = await readApi<Workspace>(author.page.request, author.token, `/qrProject/question-creation/workspace?taskId=${taskId}`);
  const types = [1, 6, 5].map(code => {
    const matches = current.enabledQuestionTypes.filter(type => type.systemQuestionTypeId === code);
    expect(matches, `新题库必须唯一启用基础题型${code}`).toHaveLength(1);
    expect(typeof matches[0].questionTypeId).toBe('string');
    return matches[0];
  });
  const write = async (method: 'PUT' | 'POST', suffix: string, data: unknown) => {
    const response = await author.page.request.fetch(`/api/qrProject/question-creation/workspace${suffix}`, {
      method, headers: { Authorization: author.token }, data,
    });
    expect(response.ok()).toBe(true);
    const body = parseJson<Envelope<Workspace & { submitted?: boolean }>>(await response.text());
    expect(body.code, body.message).toBe('E200');
    return body.data;
  };
  let workspace = await write('PUT', '/plan', { taskId, planVersion: current.planVersion,
    questionRequirements: types.map(type => ({ questionTypeId: type.questionTypeId, quantity: 1 })), discardSlotIds: [] });
  expect(workspace.slots).toHaveLength(3);
  const samples = imageSamples(images, runId, types.find(type => type.systemQuestionTypeId === 5)!.questionTypeId);
  const questions: MatchingQuestion[] = [];
  for (const sample of samples) {
    const type = types.find(type => type.systemQuestionTypeId === sample.type)!;
    const slots = workspace.slots.filter(slot => slot.questionTypeId === type.questionTypeId);
    expect(slots).toHaveLength(1);
    const slot = slots[0];
    workspace = await write('PUT', '/slots', { taskId, mode: 'CONFIRM', activeSlotId: slot.slotId,
      slots: [{ slotId: slot.slotId, version: slot.version, draftPayload: {
        ...sample.payload, questionTypeId: type.questionTypeId, questionTypeName: type.questionTypeName,
      } }] });
    const saved = workspace.slots.find(row => row.slotId === slot.slotId)!;
    expect(saved.confirmed, '准备的原题必须正式确认，不能只保存草稿').toBe(true);
    expect(typeof saved.questionId).toBe('string');
    expect(saved.draftPayload.question).toContain(sample.marker);
    expect(saved.draftPayload.question).toContain('<img');
    questions.push({ ...saved.draftPayload, id: saved.questionId });
  }
  const submitted = await write('POST', '/submit', { taskId, expectedPlanVersion: workspace.planVersion,
    slotVersions: workspace.slots.map(slot => ({ slotId: slot.slotId, version: slot.version })) });
  expect(submitted.submitted).toBe(true);
  return questions;
}
