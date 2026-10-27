import { test, expect } from '@playwright/test';
import {
  assertCustomSectionPaper, assertCustomSectionOutput, sectionSamples, sectionTypes,
  type SectionPaper, type SectionQuestion,
} from './custom-sections.assertions';

const types = sectionTypes.map((type, index) => ({ ...type, id: `90071992547420${index + 1}` }));
const sources: SectionQuestion[] = sectionSamples().map((sample, index) => ({
  id: `90071992547430${String(index).padStart(2, '0')}`,
  questionType: 5, questionTypeId: types.find(type => type.name === sample.typeName)!.id,
  questionTypeName: sample.typeName, question: `<p>${sample.stem}</p>`, answer: `<p>${sample.answer}</p>`,
}));
function paper(): SectionPaper {
  return {
    paperId: '9007199254740993', paperScore: 52,
    qrPaperStemDTOList: types.map((type, index) => ({
      stemsNo: index + 1, questionType: 5, questionTypeId: type.id,
      questionStem: `${['一', '二', '三', '四'][index]}、${type.name}`,
    })),
    qrPaperQuestionDTOList: sources.map(source => ({
      originalQuestionId: source.id, questionContent: JSON.stringify(source), questionScore: 2,
      questionStemNo: types.findIndex(type => type.id === source.questionTypeId) + 1,
    })),
  };
}
const output = (content: 'question' | 'answer' | 'combined') => types.map(type =>
  `${type.name}\n${sectionSamples().filter(sample => sample.typeName === type.name).map(sample =>
    content === 'question' ? sample.stem : content === 'answer' ? sample.answer : `${sample.stem} 答案：${sample.answer}`,
  ).join('\n')}`,
).join('\n');

test('1007401：7/9/8/2四个独立大题和26题原身份、正文及答案通过', () => {
  expect(sectionSamples()).toHaveLength(26);
  assertCustomSectionPaper(paper(), sources, types);
  for (const content of ['question', 'answer', 'combined'] as const)
    assertCustomSectionOutput(output(content), content);
});
test('1007401：旧版四种结构相同题型被合并为一大题必须失败', () => {
  const broken = paper();
  broken.qrPaperStemDTOList = [broken.qrPaperStemDTOList[3]];
  broken.qrPaperQuestionDTOList.forEach(question => { question.questionStemNo = 4; });
  expect(() => assertCustomSectionPaper(broken, sources, types)).toThrow();
});
test('1007401：只保留四个名字但题型身份串组、分组题量错误必须失败', () => {
  const wrongIdentity = paper();
  wrongIdentity.qrPaperStemDTOList[1].questionTypeId = types[0].id;
  expect(() => assertCustomSectionPaper(wrongIdentity, sources, types)).toThrow();
  const wrongGroup = paper();
  wrongGroup.qrPaperQuestionDTOList[0].questionStemNo = 2;
  expect(() => assertCustomSectionPaper(wrongGroup, sources, types)).toThrow();
});
test('1007401：原题ID丢精度、重复选题、正文或答案丢失必须失败', () => {
  for (const change of [
    (value: SectionPaper) => { value.qrPaperQuestionDTOList[0].originalQuestionId = '9007199254740992'; },
    (value: SectionPaper) => { value.qrPaperQuestionDTOList[0] = value.qrPaperQuestionDTOList[1]; },
    (value: SectionPaper) => { value.qrPaperQuestionDTOList[0].questionContent = JSON.stringify({ ...sources[0], question: '' }); },
    (value: SectionPaper) => { value.qrPaperQuestionDTOList[0].questionContent = JSON.stringify({ ...sources[0], answer: '' }); },
  ]) {
    const value = paper(); change(value);
    expect(() => assertCustomSectionPaper(value, sources, types)).toThrow();
  }
});
test('1007401：导出题目齐全但自定义标题消失或重复仍必须失败', () => {
  for (const title of ['物化简答', '物化问答', '物化论述', '简答题']) {
    expect(() => assertCustomSectionOutput(output('question').replace(title, ''), 'question')).toThrow();
    expect(() => assertCustomSectionOutput(`${output('question')} ${title}`, 'question')).toThrow();
  }
});
test('1007401：仅题目文件混入原题答案必须失败', () => {
  expect(() => assertCustomSectionOutput(output('combined'), 'question')).toThrow(/仅题目不得混入答案/);
  const sample = sectionSamples()[0];
  expect(() => assertCustomSectionOutput(`${output('question')} ${sample.answer}`, 'question')).toThrow(/仅题目不得混入答案/);
});
test('1007401：导出标题齐全但题目跨大题、答案串题或缺题不能通过', () => {
  const samples = sectionSamples();
  const text = output('combined');
  expect(() => assertCustomSectionOutput(text.replace(samples[0].stem, ''), 'combined')).toThrow();
  expect(() => assertCustomSectionOutput(text.replace(samples[0].answer, ''), 'combined')).toThrow();
  const moved = output('question').replace(samples[0].stem, '') + samples[0].stem;
  expect(() => assertCustomSectionOutput(moved, 'question')).toThrow();
  const swapped = text.replace(samples[0].answer, '__TEMP__').replace(samples[1].answer, samples[0].answer).replace('__TEMP__', samples[1].answer);
  expect(() => assertCustomSectionOutput(swapped, 'combined')).toThrow();
  const answer = output('answer').replace(samples[0].answer, '__TEMP__').replace(samples[1].answer, samples[0].answer).replace('__TEMP__', samples[1].answer);
  expect(() => assertCustomSectionOutput(answer, 'answer')).toThrow();
});
