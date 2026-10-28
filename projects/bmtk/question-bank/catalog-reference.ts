import { expect } from '@playwright/test';
import { runPython } from '../../../packages/runtime/python';

export interface CatalogNode { id: string; name: string; children: CatalogNode[] }
export interface CatalogQuestion {
  id: string; question: string; catalogs: Array<{ id: string; name: string }>;
  subQuestions: Array<{ id?: string; question: string; answer: string; [key: string]: unknown }>;
  [key: string]: unknown;
}
export interface CatalogSnapshot { tree: CatalogNode[]; questions: CatalogQuestion[]; tasks: unknown[] }

export const flattenCatalog = (nodes: CatalogNode[]): CatalogNode[] =>
  nodes.flatMap(node => [node, ...flattenCatalog(node.children)]);

export function assertCatalogQuestionTransition(
  source: Pick<CatalogQuestion, 'id' | 'question' | 'subQuestions'>, current: CatalogQuestion,
): void {
  expect(current.id).toBe(source.id);
  expect(current.question).toBe(source.question);
  const options = (question: typeof source) => question.subQuestions.map(q => ({ question: q.question, answer: q.answer }));
  expect(options(current)).toEqual(options(source));
  const ids = current.subQuestions.map(q => q.id);
  for (const id of ids) expect(id, '审题及入库选项必须有正式字符串ID').toMatch(/^\d+$/);
  expect(new Set(ids).size, '同一道题的选项ID不能重复').toBe(ids.length);
  for (const [index, option] of source.subQuestions.entries()) {
    // 出题确认回执可能不返回选项ID；正式审题ID一旦取得，后续阶段必须保持。
    if (option.id !== undefined) expect(current.subQuestions[index].id).toBe(option.id);
  }
}

export function assertCatalogChange(before: CatalogSnapshot, after: CatalogSnapshot,
  remainingIds: string[], links: Record<string, string[]>): void {
  const shape = (nodes: CatalogNode[], parentId: string | null = null): Array<{ id: string; name: string; parentId: string | null }> =>
    nodes.flatMap(node => [{ id: node.id, name: node.name, parentId }, ...shape(node.children, node.id)])
      .filter(node => remainingIds.includes(node.id));
  expect(flattenCatalog(after.tree).map(n => n.id).sort(), '仅移除目标子树，保留根和对照节点ID')
    .toEqual([...remainingIds].sort());
  expect(shape(after.tree), '保留节点名称及父子结构不变').toEqual(shape(before.tree));
  const bodies = (questions: CatalogQuestion[]) => questions.map(q => {
    const { id, rootId, bankId, qrProjectId, qrTaskId, qrApproveTaskId, qrApprovalInstanceId,
      question, answer, analysis, level, questionTypeId, options, subQuestions } = q;
    return { id, rootId, bankId, qrProjectId, qrTaskId, qrApproveTaskId, qrApprovalInstanceId,
      question, answer, analysis, level, questionTypeId, options, subQuestions };
  }).sort((a, b) => a.id.localeCompare(b.id));
  expect(bodies(after.questions), '全部原题身份、正文、选项、答案、解析和难度保持').toEqual(bodies(before.questions));
  expect(after.tasks, '知识点操作不得删除或改写原出题任务').toEqual(before.tasks);
  expect(Object.keys(links).sort()).toEqual(after.questions.map(q => q.id).sort());
  for (const question of after.questions) {
    expect(typeof question.id).toBe('string');
    expect(question.catalogs.map(c => c.id).sort(), `题目 ${question.id} 的知识点关联`)
      .toEqual([...links[question.id]].sort());
  }
}

export function assertCatalogAssociation(before: CatalogSnapshot, after: CatalogSnapshot,
  questionId: string, links: Record<string, string[]>): void {
  const expected = structuredClone(before);
  const root = expected.questions.find(q => q.id === questionId)!;
  expect(root).toBeTruthy();
  expect(root.qrApprovalInstanceId, '已完成审题的原根题必须有审批实例').toMatch(/^[1-9]\d*$/);
  // 管理员更新会向本题选项继承根审批ID；仅在准备关联时允许 null → 原根ID。
  for (const option of root.subQuestions) {
    if (option.qrApprovalInstanceId === null) option.qrApprovalInstanceId = root.qrApprovalInstanceId;
  }
  assertCatalogChange(expected, after, flattenCatalog(before.tree).map(n => n.id), links);
}

// 使用工程已有Python/openpyxl生成实际xlsx，不引入新的Node依赖。
export async function catalogWorkbook(python: string, paths: string[][]): Promise<Buffer> {
  if (!paths.length || paths.some(path => !path.length || path.length > 6 || path.some(name => !name.trim())))
    throw new Error('知识点输入必须为1至6级非空路径');
  return runPython(python, [
    'import sys,json,io,openpyxl',
    'book=openpyxl.Workbook();sheet=book.active;sheet.title="知识点"',
    'sheet.append(["序号"]+[str(i)+"级知识点名称" for i in range(1,7)])',
    'for i,path in enumerate(json.load(sys.stdin),1): sheet.append([str(i)]+path)',
    'output=io.BytesIO();book.save(output);sys.stdout.buffer.write(output.getvalue())',
  ].join('\n'), [], Buffer.from(JSON.stringify(paths)));
}
