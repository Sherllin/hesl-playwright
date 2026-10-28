import { expect, test } from '@playwright/test';
import { assertFormulaDraftSlots, assertFormulaLabels, assertStoredFormulaQuestions, formulaSamples } from './formula-options.assertions';

test('公式选项：每道题自己的ABCD必须完整且有内容，其他题或答案字母不能补齐标签', () => {
  const samples = formulaSamples('OFFLINE').slice(0, 2);
  const good = samples.map(q => `${q.stem} A.34 B.14 C.43 D.1 答案：${q.answer}`).join('\n');
  expect(() => assertFormulaLabels(good, samples, true)).not.toThrow();
  for (const bad of [
    good.replace('A.34 B.14 C.43', '34 14 43'),
    good.replace('A.34', 'B.34'),
    good.replace('A.34', 'A.'),
    good.replace('D.1', 'D.2'),
    good.replace('答案：A', '答案：D'),
    good.replace(samples[1].stem, samples[0].stem),
    good.replace('D.1', 'D.1 A.extra'),
  ]) expect(() => assertFormulaLabels(bad, samples, true)).toThrow();
});

test('公式选项：没有答案的试卷也必须检查标签；纯答案输出不能冒充试卷', () => {
  const samples = formulaSamples('OFFLINE').slice(0, 1);
  const good = `${samples[0].stem} A.34 B.14 C.43 D.1`;
  expect(() => assertFormulaLabels(good, samples, false)).not.toThrow();
  expect(() => assertFormulaLabels(`${samples[0].stem} 答案：A`, samples, false)).toThrow();
});

test('公式选项：入库公式与答案必须保持，KaTeX显示文字不能掩盖源码被改', () => {
  const samples = formulaSamples('OFFLINE').slice(0, 1);
  const equation = (source: string) => `<span data-lexical-equation="${Buffer.from(source).toString('base64')}"><span>34</span></span>`;
  const question = { id: '2113136590538018816', question: samples[0].stem, questionType: 1,
    subQuestions: [equation('\\frac{3}{4}'), equation('\\frac{1}{4}'), equation('\\frac{4}{3}'), '1']
      .map((question, index) => ({ question, answer: index === 0 ? 'true' : 'false' })) };
  expect(() => assertStoredFormulaQuestions([question], samples)).not.toThrow();
  for (const mutation of [
    { ...question, subQuestions: question.subQuestions.slice(1) },
    { ...question, subQuestions: question.subQuestions.map(o => ({ ...o, answer: 'false' })) },
    { ...question, subQuestions: [{ question: equation('\\frac{4}{3}'), answer: 'true' }, ...question.subQuestions.slice(1)] },
  ]) expect(() => assertStoredFormulaQuestions([mutation], samples)).toThrow();
});

test('导入草稿用唯一题位定位，确认前questionId全为null合法；正式题ID仍须唯一', () => {
  const samples = formulaSamples('DRAFT').slice(0, 3);
  const slots = samples.map((sample, index) => ({ slotId: `21152626319220654${index.toString().padStart(2, '0')}`,
    questionId: null, confirmed: false, draftPayload: { id: `__template_offline_${index}`, question: sample.stem,
      questionType: 1, subQuestions: sample.options.map((option, i) => ({
        question: typeof option === 'string' ? option : `<span data-lexical-equation="${Buffer.from(`\\frac{${option.numerator}}{${option.denominator}}`).toString('base64')}"></span>`,
        answer: 'ABCD'[i] === sample.answer ? 'true' : 'false',
      })) } }));
  expect(() => assertFormulaDraftSlots(slots, samples)).not.toThrow();
  for (const invalid of [
    [slots[0], { ...slots[1], slotId: slots[0].slotId }, slots[2]],
    slots.map(slot => ({ ...slot, slotId: '' })),
    [slots[0], { ...slots[1], draftPayload: slots[0].draftPayload }, slots[2]],
    [slots[0], { ...slots[1], draftPayload: { ...slots[1].draftPayload, subQuestions: [] } }, slots[2]],
    [slots[0], { ...slots[1], draftPayload: { ...slots[1].draftPayload,
      subQuestions: slots[1].draftPayload.subQuestions.map(o => ({ ...o, answer: 'false' })) } }, slots[2]],
  ]) expect(() => assertFormulaDraftSlots(invalid, samples)).toThrow();
  const stored = slots.map(slot => ({ ...slot.draftPayload, id: slot.slotId }));
  expect(() => assertStoredFormulaQuestions(stored, samples)).not.toThrow();
  expect(() => assertStoredFormulaQuestions(stored.map(q => ({ ...q, id: stored[0].id })), samples)).toThrow();
});
