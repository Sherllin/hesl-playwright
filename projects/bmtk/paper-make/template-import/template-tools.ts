import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runPython } from '../../../../packages/runtime/python';
import type { LanguageQuestion, ScriptGlyphAudit } from './language.assertions';

export type TemplateFormat = 'excel' | 'word';
export const fixturePath = fileURLToPath(new URL('./fixtures/diverse-faculty-languages.json', import.meta.url));
export const languageSample = JSON.parse(await readFile(fixturePath, 'utf8')) as {
  source: string; questions: LanguageQuestion[]; wordExtras: LanguageQuestion[];
};
async function source(name: string): Promise<string> {
  return readFile(fileURLToPath(new URL(`./python/${name}.py`, import.meta.url)), 'utf8');
}
export async function checkLanguageTools(python: string): Promise<void> {
  await runPython(python, 'import openpyxl,pymupdf,pypdf; from PIL import Image');
}
export async function fillLanguageTemplate(python: string, format: TemplateFormat, template: string, output: string): Promise<void> {
  await runPython(python, await source(`fill-mixed-${format}-template`), [template, output, fixturePath]);
}
export async function inspectThaiPdf(python: string, bytes: Buffer, output: string): Promise<Omit<ScriptGlyphAudit, 'words'> & {
  words: Array<ScriptGlyphAudit['words'][number] & { images: string[] }>;
}> {
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('下载内容不是PDF');
  return JSON.parse((await runPython(python, await source('inspect-thai-pdf'), [output], bytes)).toString('utf8'));
}
