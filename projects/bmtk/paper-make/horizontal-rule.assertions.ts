import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { runPython } from '../../../packages/runtime/python';

export interface RuleSample { before: string; bold: string; answer: string }
export const RULE_SAMPLE: RuleSample = {
  before: 'RULE_BEFORE 比较相同浓度下不同温度的实验结果。',
  bold: 'RULE_CONCLUSION 实验结论：温度升高，反应速率加快。',
  answer: '保持浓度相同，比较各温度下的反应速率。',
};
interface RuleOutput { text: string; boldText: string; ruleBetween: boolean }
export interface RuleEvidence {
  docx: RuleOutput;
  pdf: RuleOutput & { pages: Array<{ image: string }> };
}

export async function inspectHorizontalRuleOutputs(python: string, pdf: Buffer, docx: Buffer,
  output: string, sample: RuleSample): Promise<RuleEvidence> {
  if (pdf.subarray(0, 5).toString() !== '%PDF-' || docx.subarray(0, 2).toString() !== 'PK')
    throw new Error('需要实际下载的 PDF 和 DOCX 原件');
  const code = await readFile(new URL('./python/inspect-horizontal-rule.py', import.meta.url), 'utf8');
  const input = Buffer.from(JSON.stringify({ pdf: pdf.toString('base64'), docx: docx.toString('base64'), output, sample }));
  return JSON.parse((await runPython(python, code, [], input)).toString()) as RuleEvidence;
}

export function assertHorizontalRuleOutput(result: RuleOutput, sample: RuleSample, format: string): void {
  const compact = (text: string) => text.replace(/\s+/g, '');
  for (const text of [sample.before, sample.bold]) {
    expect(compact(result.text).split(compact(text)).length - 1, `${format}必须完整且唯一保留题干正文`).toBe(1);
  }
  expect(result.ruleBetween, `${format}分割线必须位于实验条件与结论之间，不能以页眉或其他横线代替`).toBe(true);
  expect(compact(result.boldText), `${format}实验结论必须保持加粗`).toContain(compact(sample.bold));
}
