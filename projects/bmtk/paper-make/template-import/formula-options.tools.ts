import { readFile, writeFile } from 'node:fs/promises';
import { runPython } from '../../../../packages/runtime/python';
import type { FormulaSample } from './formula-options.assertions';
import { inspectPdf } from '../../../../packages/runtime/document-layout';
import type { FormulaPdf } from './formula-options.assertions';

export async function inspectFormulaPdf(python: string, bytes: Buffer, output: string): Promise<FormulaPdf> {
  const pdf = await inspectPdf(python, bytes, output);
  const source = await readFile(new URL('./python/inspect-formula-images.py', import.meta.url), 'utf8');
  const formulaImages = JSON.parse((await runPython(python, source, [], bytes)).toString()) as FormulaPdf['formulaImages'];
  return { ...pdf, formulaImages };
}

export async function fillFormulaTemplate(python: string, template: string, output: string, samples: FormulaSample[]): Promise<void> {
  const sampleFile = `${output}.json`;
  await writeFile(sampleFile, JSON.stringify(samples));
  const source = await readFile(new URL('./python/fill-formula-options.py', import.meta.url), 'utf8');
  await runPython(python, source, [template, output, sampleFile]);
}

/** Preserve drawing/OMML positions as object characters rather than making a formula-only option look empty. */
export async function readFormulaDocx(python: string, bytes: Buffer): Promise<{ text: string; fractions: number }> {
  if (bytes.subarray(0, 2).toString() !== 'PK') throw new Error('需要实际DOCX文件');
  return JSON.parse((await runPython(python, [
    'import io,json,sys,zipfile,xml.etree.ElementTree as ET',
    'with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z: root=ET.fromstring(z.read("word/document.xml"))',
    'W="{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"',
    'M="{http://schemas.openxmlformats.org/officeDocument/2006/math}"',
    'def visible(node):',
    ' if node.tag in (W+"drawing",W+"pict",M+"oMath"): return "\\ufffc"',
    ' if node.tag==W+"t": return node.text or ""',
    ' if node.tag==W+"p": return "".join(visible(c) for c in node)+"\\n"',
    ' return "".join(visible(c) for c in node)',
    'print(json.dumps({"text":visible(root),"fractions":len(root.findall(".//"+M+"f"))}))',
  ].join('\n'), [], bytes)).toString()) as { text: string; fractions: number };
}
