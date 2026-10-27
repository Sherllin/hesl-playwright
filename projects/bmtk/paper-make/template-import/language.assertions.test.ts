import { expect, test } from '@playwright/test';
import { assertLanguageQuestions, assertThaiGlyphs, type ScriptGlyphAudit } from './language.assertions';

const expected = [{ type: '单选题', typeId: 1, stem: '泰语词义练习：请选择与“米饭”对应的词语。',
  analysis: 'ข้าว表示米饭。', level: 0.5, answer: 'B', options: ['ข่าว', 'ข้าว', 'ขาว', 'เข้า'] }];
const payload = { questionType: 1, question: '<p>泰语词义练习：请选择与“米饭”对应的词语。</p>',
  analysis: '<p>ข้าว表示米饭。</p>', level: 0.5, subQuestions: [
    { question: '<p>ข่าว</p>', answer: 'false' }, { question: '<p>ข้าว</p>', answer: 'true' },
    { question: '<p>ขาว</p>', answer: 'false' }, { question: '<p>เข้า</p>', answer: 'false' },
  ] };
const check = (value = payload) => assertLanguageQuestions([{ questionContent: JSON.stringify(value) }], expected);
test('泰语四选项、声调和B正确标记完整保存才通过', () => { check(); });
for (const change of ['tone', 'order', 'answer', 'stem', 'type', 'analysis', 'level'] as const) {
  test(`导入或保存丢失${change}不能通过`, () => {
    const wrong = structuredClone(payload);
    if (change === 'tone') wrong.subQuestions[0].question = '<p>ขาว</p>';
    if (change === 'order') wrong.subQuestions.reverse();
    if (change === 'answer') wrong.subQuestions[1].answer = 'false';
    if (change === 'stem') wrong.question = '另一道题';
    if (change === 'type') wrong.questionType = 2;
    if (change === 'analysis') wrong.analysis = '';
    if (change === 'level') wrong.level = 0.8;
    expect(() => check(wrong)).toThrow();
  });
}
test('重复题目和空列表均拒绝', () => {
  expect(() => assertLanguageQuestions([], expected)).toThrow();
  expect(() => assertLanguageQuestions([{ questionContent: JSON.stringify(payload) }, { questionContent: JSON.stringify(payload) }], expected)).toThrow();
});
const good: ScriptGlyphAudit = {
  observations: [
    { character: 'ข', glyphId: 1, font: 'Thai' }, { character: '่', glyphId: 2, font: 'Thai' },
    { character: 'า', glyphId: 3, font: 'Thai' }, { character: 'ว', glyphId: 4, font: 'Thai' },
    { character: '้', glyphId: 5, font: 'Thai' }, { character: 'เ', glyphId: 6, font: 'Thai' },
  ],
  words: [
    { word: 'ข่าว', count: 1, rasterHashes: ['word-a'] }, { word: 'ข้าว', count: 1, rasterHashes: ['word-b'] },
    { word: 'ขาว', count: 1, rasterHashes: ['word-c'] }, { word: 'เข้า', count: 1, rasterHashes: ['word-d'] },
  ],
};
test('四个词语具有完整字母声调、真实字形及不同原像素才通过', () => { assertThaiGlyphs(good); });
for (const change of ['empty', 'same-box', 'notdef', 'missing-tone', 'missing-word', 'identical-raster'] as const) {
  test(`字形检查拒绝${change}，文本存在不能掩盖方框`, () => {
    const wrong = structuredClone(good);
    if (change === 'empty') wrong.observations = [];
    if (change === 'same-box') wrong.observations.forEach(char => { char.glyphId = 73; });
    if (change === 'notdef') wrong.observations[0].glyphId = 0;
    if (change === 'missing-tone') wrong.words[0].word = 'ขาว';
    if (change === 'missing-word') wrong.words[0].count = 0;
    if (change === 'identical-raster') wrong.words.forEach(word => { word.rasterHashes = ['same-boxes']; });
    expect(() => assertThaiGlyphs(wrong)).toThrow();
  });
}

test('复合字形的零宽-1延续项不等于缺字，未映射声调仍由真实字形与词语检查', () => {
  const audit = structuredClone(good);
  audit.observations = [
    { character: 'ข', glyphId: 1, font: 'Thai' },
    { character: '่', glyphId: -1, font: 'Thai', clusterGlyphId: 1 },
    { character: '\ufffd', glyphId: 2, font: 'Thai' },
    { character: 'า', glyphId: 3, font: 'Thai' }, { character: 'ว', glyphId: 4, font: 'Thai' },
    { character: '\ufffd', glyphId: 5, font: 'Thai' }, { character: 'เ', glyphId: 6, font: 'Thai' },
  ];
  assertThaiGlyphs(audit);
});
test('没有有效主字形的-1、声调绘制丢失及未映射的.notdef字形仍拒绝', () => {
  const orphan = structuredClone(good);
  orphan.observations[1].glyphId = -1;
  expect(() => assertThaiGlyphs(orphan)).toThrow();
  const missing = structuredClone(good);
  missing.observations.push({ character: '\ufffd', glyphId: 0, font: 'Thai' });
  expect(() => assertThaiGlyphs(missing)).toThrow();
  const tone = structuredClone(good);
  tone.words[0].rasterHashes = [...tone.words[2].rasterHashes];
  expect(() => assertThaiGlyphs(tone)).toThrow();
});
