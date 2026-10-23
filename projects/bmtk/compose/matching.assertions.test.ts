import { test, expect } from '@playwright/test';
import { assertMatchingPaper, assertPaperPreserved, assertMatchingDeliveryText } from './matching.assertions';
import type { MatchingQuestion } from '../question-bank/matching';

// 大于 JS 安全整数范围的真实形状 ID：校验器不能靠 Number() 比较身份。
const source = {
  id: '9007199254740993', question: '<p>匹配题主干</p>', questionScore: 0,
  options: [{ id: '9007199254740994', question: '华北' }, { id: '9007199254740995', question: '华东' }],
  subQuestions: [
    { id: '9007199254740996', question: '<p>北京</p>', answer: 'A', questionScore: 0 },
    { id: '9007199254740997', question: '<p>上海</p>', answer: 'B', questionScore: 0 },
  ],
};
const expected = { scores: [2, 5], order: [1, 0] };
function validPaper() {
  return {
    paperId: '9007199254740998', paperScore: 7, qrPaperQuestionDTOList: [{
      originalQuestionId: source.id,
      questionContent: JSON.stringify({
        ...source, questionScore: 7, subQuestions: [
          { ...source.subQuestions[1], questionScore: 5 }, { ...source.subQuestions[0], questionScore: 2 },
        ]
      }),
    }]
  };
}
function changeContent(change: (content: MatchingQuestion & { level?: string }) => void) {
  const paper = validPaper();
  const content = JSON.parse(paper.qrPaperQuestionDTOList[0].questionContent);
  change(content);
  paper.qrPaperQuestionDTOList[0].questionContent = JSON.stringify(content);
  return paper;
}

test('换序后内容、答案、分值及超大字符串ID一起保持', () => {
  expect(() => assertMatchingPaper(validPaper(), source, expected)).not.toThrow();
});
test('拒绝分值仍按位置保留2/5而非随原小题移动', () => {
  const paper = changeContent(c => { c.subQuestions[0].questionScore = 2; c.subQuestions[1].questionScore = 5; });
  expect(() => assertMatchingPaper(paper, source, expected)).toThrow(/分值/);
});
test('拒绝换序后答案仍为A/B', () => {
  const paper = changeContent(c => { c.subQuestions[0].answer = 'A'; c.subQuestions[1].answer = 'B'; });
  expect(() => assertMatchingPaper(paper, source, expected)).toThrow(/答案/);
});
test('拒绝新造或舍入后相邻小题ID', () => {
  const paper = changeContent(c => { c.subQuestions[1].id = '9007199254740997'; });
  expect(() => assertMatchingPaper(paper, source, expected)).toThrow(/身份/);
});
test('拒绝卷总分为0，即使小题分值正确', () => {
  const paper = { ...validPaper(), paperScore: 0 };
  expect(() => assertMatchingPaper(paper, source, expected)).toThrow(/总分/);
});
test('拒绝整题分值未汇总', () => {
  const paper = changeContent(c => { c.questionScore = 0; });
  expect(() => assertMatchingPaper(paper, source, expected)).toThrow(/整题/);
});
test('拒绝共享选项内容或身份变化', () => {
  const paper = changeContent(c => { c.options[0].id = c.options[1].id; });
  expect(() => assertMatchingPaper(paper, source, expected)).toThrow(/选项/);
});
test('拒绝保存到另一道原题', () => {
  const paper = validPaper(); paper.qrPaperQuestionDTOList[0].originalQuestionId = '9007199254740992';
  expect(() => assertMatchingPaper(paper, source, expected)).toThrow(/原题/);
});

test('重进后忽略编辑器定位字段，保持同一份业务卷面', () => {
  const after = changeContent(c => Object.assign(c, { editorKey: 'new-editor-key' }));
  expect(() => assertPaperPreserved(validPaper(), after)).not.toThrow();
});
test('重进后不能丢失或替换题目难度等业务属性', () => {
  const after = changeContent(c => { c.level = 'changed'; });
  expect(() => assertPaperPreserved(validPaper(), after)).toThrow(/业务内容/);
});
const deliverySample = { stem: '匹配题主干', children: ['北京', '上海'], options: ['北方选项', '东方选项'] };
const paperText = '匹配题主干 北方选项 东方选项 第1小题上海5分 第2小题北京2分';
test('最终PDF全文按换序后的5/2分及B/A核对', () => {
  expect(() => assertMatchingDeliveryText(paperText, '答案：1.B；2.A', deliverySample)).not.toThrow();
});
test('最终PDF不能只存在文件却输出原来的A/B答案', () => {
  expect(() => assertMatchingDeliveryText(paperText, '答案：1.A；2.B', deliverySample)).toThrow();
});
test('最终PDF不能把小题又排回原顺序', () => {
  expect(() => assertMatchingDeliveryText('匹配题主干 北方选项 东方选项 北京2分 上海5分',
    '答案：1.B；2.A', deliverySample)).toThrow();
});
