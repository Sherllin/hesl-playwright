import { expect, test } from '@playwright/test';
import { runPython } from '../../../packages/runtime/python';
import { assertCatalogAssociation, assertCatalogChange, assertCatalogQuestionTransition, catalogWorkbook,
  type CatalogQuestion, type CatalogSnapshot } from './catalog-reference';

const before: CatalogSnapshot = {
  tree: [{ id: '9007199254740993', name: '根', children: [
    { id: '9007199254740994', name: '删除父', children: [{ id: '9007199254740995', name: '删除子', children: [] }] },
    { id: '9007199254740996', name: '保留父', children: [{ id: '9007199254740997', name: '保留子', children: [] }] },
  ] }],
  questions: [
    { id: '9007199254740998', question: '关联题', answer: 'A', analysis: '解析', level: 2,
      questionTypeId: '9007199254740990', subQuestions: [{ id: '9007199254740989', question: '选项', answer: 'true' }],
      catalogs: [{ id: '9007199254740995', name: '删除子' }] },
    { id: '9007199254740999', question: '对照题', catalogs: [], subQuestions: [] },
  ],
  tasks: [{ id: '9007199254741000', taskName: '原任务', status: 2 }],
};
const ids = ['9007199254740993', '9007199254740996', '9007199254740997'];
const links = Object.fromEntries(before.questions.map(q => [q.id, []]));
function deleted(): CatalogSnapshot {
  const after = structuredClone(before);
  after.tree[0].children.shift();
  after.questions[0].catalogs = [];
  return after;
}
test('知识点删除只解除引用，保留大ID、根、对照分支、全部题目内容和任务', () => {
  assertCatalogChange(before, deleted(), ids, links);
  const unchangedLinks = Object.fromEntries(before.questions.map(q => [q.id, q.catalogs.map(c => c.id)]));
  assertCatalogChange(before, structuredClone(before), [...ids, '9007199254740994', '9007199254740995'], unchangedLinks);
});

test('出题回执未返回选项ID，审题阶段分配正式ID不应误报；入库继续核对正式ID', () => {
  const draft = { id: '9007199254740998', question: '北京位于哪个地区',
    subQuestions: ['华北', '华东', '华南', '西南'].map((question, i) => ({ question, answer: String(i === 0) })) };
  const reviewed: CatalogQuestion = { ...draft, catalogs: [], subQuestions: draft.subQuestions.map((q, i) =>
    ({ ...q, id: String(9007199254741000n + BigInt(i)) })) };
  assertCatalogQuestionTransition(draft, reviewed);
  assertCatalogQuestionTransition(reviewed, structuredClone(reviewed));
  for (const mutate of [
    (q: CatalogQuestion) => { q.subQuestions[0].id = undefined; },
    (q: CatalogQuestion) => { q.subQuestions[0].id = '9007199254741001'; },
    (q: CatalogQuestion) => { q.subQuestions[0].question = '被篡改'; },
    (q: CatalogQuestion) => { q.subQuestions[0].answer = 'false'; },
    (q: CatalogQuestion) => { q.subQuestions.reverse(); },
    (q: CatalogQuestion) => { q.subQuestions.pop(); },
  ]) {
    const invalid = structuredClone(reviewed); mutate(invalid);
    expect(() => assertCatalogQuestionTransition(draft, invalid)).toThrow();
  }
  const changedIdentity = structuredClone(reviewed);
  changedIdentity.subQuestions[0].id = '9007199254741999';
  expect(() => assertCatalogQuestionTransition(reviewed, changedIdentity)).toThrow();
});
test('删除校验不能把丢题、改正文、换大ID、丢根或保留分支重建当作成功', () => {
  for (const mutate of [
    (s: CatalogSnapshot) => { s.questions.pop(); },
    (s: CatalogSnapshot) => { s.questions[0].question = '被篡改'; },
    (s: CatalogSnapshot) => { s.questions[0].answer = 'B'; },
    (s: CatalogSnapshot) => { s.questions[0].analysis = '被篡改'; },
    (s: CatalogSnapshot) => { s.questions[0].bankId = '9007199254741999'; },
    (s: CatalogSnapshot) => { s.questions[0].qrTaskId = '9007199254741999'; },
    (s: CatalogSnapshot) => { s.questions[0].qrApprovalInstanceId = '9007199254741999'; },
    (s: CatalogSnapshot) => { s.questions[0].subQuestions = []; },
    (s: CatalogSnapshot) => { s.questions[0].id = '9007199254740999'; },
    (s: CatalogSnapshot) => { s.tree[0].id = '9007199254740992'; },
    (s: CatalogSnapshot) => { s.tree[0].children[0].id = '9007199254740994'; },
    (s: CatalogSnapshot) => { s.tree[0].children[0].children[0].name = '被篡改'; },
  ]) {
    const after = deleted(); mutate(after);
    expect(() => assertCatalogChange(before, after, ids, links)).toThrow();
  }
});

test('真实Excel保留中文和XML特殊字符、六级路径与仅保留分支，拒绝空或超深路径', async () => {
  const python = process.env.BMTK_PDF_PYTHON || 'python3';
  const paths = [['E2E-保留父&<>', 'E2E-保留子'], ['另一路径', '二', '三', '四', '五', '六']];
  const workbook = await catalogWorkbook(python, paths);
  const rows = JSON.parse((await runPython(python, [
    'import sys,io,json,openpyxl',
    'book=openpyxl.load_workbook(io.BytesIO(sys.stdin.buffer.read()))',
    'assert book.sheetnames==["知识点"]',
    'print(json.dumps(list(book.active.values),ensure_ascii=False))',
  ].join('\n'), [], workbook)).toString()) as Array<Array<string | null>>;
  expect(rows).toEqual([
    ['序号', '1级知识点名称', '2级知识点名称', '3级知识点名称', '4级知识点名称', '5级知识点名称', '6级知识点名称'],
    ['1', ...paths[0], null, null, null, null], ['2', ...paths[1]],
  ]);
  for (const invalid of [[], [[]], [['  ']], [Array<string>(7).fill('超深')]])
    await expect(catalogWorkbook(python, invalid)).rejects.toThrow('1至6级非空路径');
});
test('任务丢失或改写、悬挂引用、对照题意外关联均必须转红', () => {
  for (const mutate of [
    (s: CatalogSnapshot) => { s.tasks = []; },
    (s: CatalogSnapshot) => { s.tasks = [{ id: '9007199254741000', status: 0 }]; },
    (s: CatalogSnapshot) => { s.questions[0].catalogs = before.questions[0].catalogs; },
    (s: CatalogSnapshot) => { s.questions[1].catalogs = [{ id: ids[1], name: '保留父' }]; },
  ]) {
    const after = deleted(); mutate(after);
    expect(() => assertCatalogChange(before, after, ids, links)).toThrow();
  }
});

test('准备关联仅允许空选项审批ID补成原根题ID，覆盖或删除仍必须保持原始快照', () => {
  const unlinked = structuredClone(before);
  const root = unlinked.questions[0];
  root.catalogs = [];
  Object.assign(root, { rootId: root.id, bankId: '9007199254741100', qrProjectId: '9007199254741101',
    qrTaskId: '9007199254741102', qrApproveTaskId: '9007199254741103', qrApprovalInstanceId: '9007199254741104' });
  Object.assign(root.subQuestions[0], { qrApprovalInstanceId: null, qrTaskId: root.qrTaskId });
  const linked = structuredClone(unlinked);
  linked.questions[0].catalogs = before.questions[0].catalogs;
  linked.questions[0].subQuestions[0].qrApprovalInstanceId = root.qrApprovalInstanceId;
  const expectedLinks = { [root.id]: ['9007199254740995'], [unlinked.questions[1].id]: [] };
  assertCatalogAssociation(unlinked, linked, root.id, expectedLinks);
  for (const mutate of [
    (s: CatalogSnapshot) => { s.questions[0].qrApprovalInstanceId = '9007199254741200'; },
    (s: CatalogSnapshot) => { s.questions[0].qrProjectId = '9007199254741200'; },
    (s: CatalogSnapshot) => { s.questions[0].subQuestions[0].qrApprovalInstanceId = '9007199254741200'; },
    (s: CatalogSnapshot) => { s.questions[0].subQuestions[0].qrApprovalInstanceId = null; },
    (s: CatalogSnapshot) => { s.questions[0].subQuestions[0].qrTaskId = '9007199254741200'; },
    (s: CatalogSnapshot) => { s.questions[0].subQuestions[0].id = '9007199254741200'; },
    (s: CatalogSnapshot) => { s.questions[0].subQuestions[0].answer = 'false'; },
    (s: CatalogSnapshot) => { s.questions[1].question = '误改对照题'; },
  ]) {
    const invalid = structuredClone(linked); mutate(invalid);
    expect(() => assertCatalogAssociation(unlinked, invalid, root.id, expectedLinks)).toThrow();
  }
  const differentPrior = structuredClone(unlinked);
  differentPrior.questions[0].subQuestions[0].qrApprovalInstanceId = '9007199254741300';
  expect(() => assertCatalogAssociation(differentPrior, linked, root.id, expectedLinks)).toThrow();
  expect(root.subQuestions[0].qrApprovalInstanceId, '校验不能改写原始证据').toBeNull();
  const wronglyCleared = structuredClone(linked);
  wronglyCleared.questions[0].subQuestions[0].qrApprovalInstanceId = null;
  expect(() => assertCatalogChange(linked, wronglyCleared,
    ['9007199254740993', '9007199254740994', '9007199254740995', '9007199254740996', '9007199254740997'], expectedLinks)).toThrow();
});
