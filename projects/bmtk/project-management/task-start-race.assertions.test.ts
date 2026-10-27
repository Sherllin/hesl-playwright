import { expect, test } from '@playwright/test';
import { expectCreationSnapshot, type CreationSnapshot, type ExpectedCreationTask } from './task-start-race.assertions';

const expected: ExpectedCreationTask[] = [
  { taskId: '9007199254740993', taskName: '原任务', expertId: '9007199254741001', questionTypeId: '9007199254741011' },
  { taskId: '9007199254740995', taskName: '并发甲', expertId: '9007199254741001', questionTypeId: '9007199254741011' },
  { taskId: '9007199254740997', taskName: '并发乙', expertId: '9007199254741001', questionTypeId: '9007199254741011' },
];
const projectId = '9007199254741021';

function snapshot(status: 0 | 1 = 1): CreationSnapshot {
  return {
    stage: { projectStage: 1, projectStageStatus: status === 1 ? 2 : 1 },
    tasks: expected.map(task => ({ taskId: task.taskId, taskName: task.taskName, taskStatus: status,
      questionCreators: [{ memberId: task.expertId, name: '出题专家' }], totalQuestionsReq: 1,
      questionRequirements: [{ questionTypeId: task.questionTypeId, questionTypeName: '单选题', quantity: 1 }] })),
    workspaces: expected.map((task, index) => ({ taskId: task.taskId, projectId, taskStatus: status,
      totalQuestionsReq: 1, slots: [{ slotId: ['9007199254741031', '9007199254741033', '9007199254741035'][index],
        questionTypeId: task.questionTypeId, questionTypeName: '单选题', version: 0,
        editable: status === 1, confirmed: false, draftPayload: null }] })),
  };
}

test('并发新增全部进行中且独立题位可编辑，大ID保持完整', () => {
  expectCreationSnapshot(snapshot(), { projectId, tasks: expected, status: 1 });
});

test('开启前真实基线是未开始，题位已经存在但不可编辑', () => {
  expectCreationSnapshot(snapshot(0), { projectId, tasks: expected, status: 0 });
});

const mutations: Array<[string, (value: CreationSnapshot) => void]> = [
  ['活动已开始但并发任务仍未开始', value => { value.tasks[1].taskStatus = 0; }],
  ['任务列表正常但专家工作区仍未开始', value => { value.workspaces[1].taskStatus = 0; }],
  ['活动没有真正开启', value => { value.stage.projectStageStatus = 1; }],
  ['活动已进入错误阶段', value => { value.stage.projectStage = 2; }],
  ['并发任务丢失', value => { value.tasks.pop(); }],
  ['多创建了一条任务', value => { value.tasks.push({ ...value.tasks[1], taskId: '9007199254741041' }); }],
  ['两任务共用一个ID', value => { value.tasks[1].taskId = value.tasks[0].taskId; }],
  ['误派其他专家', value => { value.tasks[1].questionCreators[0].memberId = '9007199254741043'; }],
  ['任务名称对应错误', value => { value.tasks[1].taskName = '其他任务'; }],
  ['题位丢失', value => { value.workspaces[1].slots = []; }],
  ['不同任务复用题位', value => { value.workspaces[1].slots[0].slotId = value.workspaces[0].slots[0].slotId; }],
  ['题位不可编辑', value => { value.workspaces[1].slots[0].editable = false; }],
  ['题位错配题型', value => { value.workspaces[1].slots[0].questionTypeId = '9007199254741045'; }],
  ['任务要求被改写', value => { value.tasks[1].questionRequirements[0].quantity = 2; }],
  ['工作区属于其他项目', value => { value.workspaces[1].projectId = '9007199254741047'; }],
  ['任务已被意外确认', value => { value.workspaces[1].slots[0].confirmed = true; }],
];
for (const [name, mutate] of mutations) {
  test(`开启竞争反例：${name}不能算通过`, () => {
    const value = snapshot();
    mutate(value);
    expect(() => expectCreationSnapshot(value, { projectId, tasks: expected, status: 1 })).toThrow();
  });
}
