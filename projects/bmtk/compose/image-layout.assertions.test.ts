import { expect, test } from '@playwright/test';
import { assertImagePaperSave, assertImagePaperPreserved, assertImagePaperSources } from './image-layout.assertions';
import { assertPaperPreserved, type SavedPaper } from './matching.assertions';
import type { MatchingQuestion } from '../question-bank/matching';
import { parseJson } from '../support/api';

interface TestNode { id: string | number; rootId?: string | number; question: string; answer?: string; questionScore: number | null; subQuestions: TestNode[] }

function papers() {
  const sent: SavedPaper = {
    paperId: '9007199254740901', paperScore: 6,
    qrPaperQuestionDTOList: [1, 6, 5].map((questionType, index) => ({
      originalQuestionId: `900719925474090${index + 3}`,
      questionContent: JSON.stringify({
        id: `900719925474090${index + 3}`, questionType, question: `题干${index}`, answer: null,
        questionScore: 2, options: [],
        subQuestions: questionType === 5 ? [] : [{
          id: `900719925474091${index}`, question: '图片子题或选项', answer: '图片答案',
          questionScore: questionType === 6 ? 2 : null, options: [],
          subQuestions: [{ id: `900719925474099${index}`, question: '更深层身份也必须保持', options: [], subQuestions: [] }],
        }],
      }),
    })),
  };
  const stored = structuredClone(sent);
  edit(stored, 1, root => {
    root.subQuestions[0].id = '9007199254740951';
    root.subQuestions[0].rootId = root.id;
  });
  return { sent, stored };
}

function edit(paper: SavedPaper, index: number, change: (root: TestNode) => void) {
  const item = paper.qrPaperQuestionDTOList[index];
  const root = JSON.parse(item.questionContent);
  change(root);
  item.questionContent = JSON.stringify(root);
}

test('首次保存保持来源身份、选入顺序及三题和组合子题各2分', () => {
  const { sent } = papers();
  const sources = sent.qrPaperQuestionDTOList.map(item => parseJson<MatchingQuestion>(item.questionContent));
  expect(() => assertImagePaperSources(sent, sources)).not.toThrow();
});

for (const [label, change] of [
  ['根题ID变化', (paper: SavedPaper) => edit(paper, 0, root => { root.id = '9007199254740981'; })],
  ['整题顺序变化', (paper: SavedPaper) => { paper.qrPaperQuestionDTOList.reverse(); }],
  ['总分相同但逐题分值变为0/4/2', (paper: SavedPaper) => {
    edit(paper, 0, root => { root.questionScore = 0; });
    edit(paper, 1, root => { root.questionScore = 4; root.subQuestions[0].questionScore = 4; });
  }],
  ['组合直接子题分值清零', (paper: SavedPaper) => edit(paper, 1, root => { root.subQuestions[0].questionScore = 0; })],
] as const) {
  test(`首次保存不得接受${label}`, () => {
    const { sent } = papers();
    const sources = sent.qrPaperQuestionDTOList.map(item => parseJson<MatchingQuestion>(item.questionContent));
    change(sent);
    expect(() => assertImagePaperSources(sent, sources)).toThrow();
  });
}

test('组合直接子题保存时分配卷内ID，读取与再次提交分别使用各次保存基线', () => {
  const { sent, stored } = papers();
  const original = JSON.stringify(sent);
  assertImagePaperSave(sent, stored);
  assertPaperPreserved(stored, structuredClone(stored));
  const submitted = structuredClone(stored);
  edit(submitted, 1, root => { root.subQuestions[0].id = '9007199254740952'; });
  assertImagePaperSave(stored, submitted);
  assertPaperPreserved(submitted, structuredClone(submitted));
  expect(JSON.stringify(sent), '检查不能改写实际发送证据').toBe(original);
  expect(() => assertPaperPreserved(stored, submitted), '只读重载仍禁止擅自换号').toThrow();
});

for (const [label, index, change] of [
  ['单选选项ID变化', 0, (root: TestNode) => { root.subQuestions[0].id = '9007199254740961'; }],
  ['组合根ID变化', 1, (root: TestNode) => { root.id = '9007199254740962'; }],
  ['组合子题rootId错误', 1, (root: TestNode) => { root.subQuestions[0].rootId = '9007199254740963'; }],
  ['组合子题ID不是字符串', 1, (root: TestNode) => { root.subQuestions[0].id = 123; }],
  ['组合子题ID不是十进制ID', 1, (root: TestNode) => { root.subQuestions[0].id = 'temporary-id'; }],
  ['组合子题复用其他根ID', 1, (root: TestNode) => { root.subQuestions[0].id = '9007199254740903'; }],
  ['组合子题复用选项ID', 1, (root: TestNode) => { root.subQuestions[0].id = '9007199254740910'; }],
  ['组合子题复用更深子题ID', 1, (root: TestNode) => { root.subQuestions[0].id = '9007199254740991'; }],
  ['组合子题未分配新ID', 1, (root: TestNode) => { root.subQuestions[0].id = '9007199254740911'; }],
  ['更深子题身份变化', 1, (root: TestNode) => { root.subQuestions[0].subQuestions[0].id = '9007199254740964'; }],
  ['组合子题正文被改', 1, (root: TestNode) => { root.subQuestions[0].question = '错误正文'; }],
  ['组合子题答案被改', 1, (root: TestNode) => { root.subQuestions[0].answer = '错误答案'; }],
  ['组合子题分值被清零', 1, (root: TestNode) => { root.subQuestions[0].questionScore = 0; }],
  ['组合子题丢失', 1, (root: TestNode) => { root.subQuestions = []; }],
] as const) {
  test(`保存规范化不能掩盖${label}`, () => {
    const { sent, stored } = papers();
    edit(stored, index, change);
    expect(() => assertImagePaperSave(sent, stored)).toThrow();
  });
}

test('两个组合子题必须分配不同的卷内ID', () => {
  const { sent, stored } = papers();
  for (const paper of [sent, stored]) edit(paper, 1, root => {
    root.subQuestions[0].questionScore = 1;
    root.subQuestions.push({ ...structuredClone(root.subQuestions[0]), id: '9007199254740921', question: '第二小题' });
  });
  edit(stored, 1, root => { root.subQuestions[1].id = root.subQuestions[0].id; });
  expect(() => assertImagePaperSave(sent, stored)).toThrow(/卷内小题ID不得重复/);
});

test('只读重进或审卷不能改变已保存的组合子题归属', () => {
  const { stored } = papers();
  const loaded = structuredClone(stored);
  assertImagePaperPreserved(stored, loaded);
  edit(loaded, 1, root => { root.subQuestions[0].rootId = '9007199254740903'; });
  expect(() => assertImagePaperPreserved(stored, loaded)).toThrow();
});
