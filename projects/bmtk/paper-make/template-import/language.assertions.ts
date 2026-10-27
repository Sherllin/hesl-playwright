import { expect } from '@playwright/test';
export interface LanguageQuestion {
  type: string; typeId: number; stem: string; analysis: string; level: number;
  answer: string | string[]; options?: string[];
}
export interface SavedQuestion { questionContent: string; questionScore?: number }
export interface ScriptGlyphAudit {
  observations: Array<{ character: string; glyphId: number; font: string; clusterGlyphId?: number }>;
  words: Array<{ word: string; count: number; rasterHashes: string[] }>;
}
// Imported HTML and fixture text use the same visible whitespace/entity convention.
const normalize = (value: string) => value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&quot;/g, '"').replace(/&#(?:39|x27);/gi, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export function assertLanguageQuestions(items: SavedQuestion[], expected: readonly LanguageQuestion[]): void {
  expect(items, '八道原题必须完整保存，不能遗漏或重复').toHaveLength(expected.length);
  const questions = items.map(item => JSON.parse(item.questionContent) as {
    questionType: number; question: string; analysis: string; level: number;
    answer: string; subQuestions?: Array<{ question: string; answer: string }>;
  });
  for (const original of expected) {
    const matches = questions.filter(question => normalize(question.question) === normalize(original.stem));
    expect(matches, '每道原题干必须唯一保留').toHaveLength(1);
    const actual = matches[0];
    expect(actual.questionType).toBe(original.typeId);
    expect(normalize(actual.analysis)).toBe(normalize(original.analysis));
    expect(Number(actual.level)).toBe(original.level);
    if (original.options) {
      expect(actual.subQuestions).toHaveLength(original.options.length);
      for (const [index, option] of original.options.entries()) {
        expect(normalize(actual.subQuestions![index].question), '选项字母、声调、顺序必须保持').toBe(normalize(option));
        expect(actual.subQuestions![index].answer, '正确标记必须对应原选项').toBe(
          (original.answer as string).includes('ABCDEFGH'[index]) ? 'true' : 'false');
      }
    } else if (original.typeId === 3) {
      const answers = Object.fromEntries(Object.entries(JSON.parse(actual.answer) as Record<string, string>)
        .map(([key, value]) => [key, normalize(value)]));
      expect(answers).toEqual(Object.fromEntries((original.answer as string[]).map((answer, index) => [String(index + 1), normalize(answer)])));
    } else expect(normalize(actual.answer)).toBe(normalize(original.answer as string));
  }
}

export function assertThaiGlyphs(audit: ScriptGlyphAudit): void {
  expect(audit.observations.length, '实际PDF必须含有泰文字形记录').toBeGreaterThan(0);
  // TextPage/search_for honors ActualText. The low-level trace instead exposes
  // ToUnicode clusters: -1 is a zero-width continuation, not a .notdef glyph.
  // Validate all painted glyphs, including U+FFFD tone glyphs without a CMap.
  for (const item of audit.observations) {
    const paintedId = item.glyphId === -1 ? item.clusterGlyphId : item.glyphId;
    expect(paintedId, '泰文实际绘制字形不能为.notdef或无有效主字形的占位项').toBeGreaterThan(0);
  }
  expect(new Set(audit.observations.filter(item => item.glyphId > 0)
    .map(item => `${item.font}:${item.glyphId}`)).size,
    '不同泰文字母不能全部使用同一个方框字形').toBeGreaterThan(3);
  const hashes: string[] = [];
  for (const word of ['ข่าว', 'ข้าว', 'ขาว', 'เข้า']) {
    const matches = audit.words.filter(item => item.word === word);
    expect(matches).toHaveLength(1);
    expect(matches[0].count, '四个完整泰语词语都必须进入实际PDF').toBeGreaterThan(0);
    expect(matches[0].rasterHashes.length).toBeGreaterThan(0);
    hashes.push(matches[0].rasterHashes[0]);
  }
  expect(new Set(hashes).size, '四个词语的实际渲染像素不能相同').toBe(4);
}
