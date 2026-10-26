import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runPython } from './python';

export interface PdfCharacter { text: string; box: [number, number, number, number]; font: string; size: number; color: number }
export interface LayoutPdf { pages: Array<{ width: number; height: number; chars: PdfCharacter[]; image: string }> }
export interface RenderedLayout { previewBands: number[][]; pdfBands: number[][]; maxDelta: number }
export interface DocxContents { text: string; xml: string; mediaCount: number }
export interface PdfReadingLayout { columns?: 1 | 2; leftMarginCm?: number; rightMarginCm?: number; mirrorMargins?: boolean }

async function script<T>(python: string, name: string, args: string[], input?: Buffer): Promise<T> {
  const source = await readFile(fileURLToPath(new URL(`./python/${name}.py`, import.meta.url)), 'utf8');
  return JSON.parse((await runPython(python, source, args, input)).toString('utf8')) as T;
}

export async function checkDocumentTools(python: string): Promise<void> {
  await runPython(python, 'import pymupdf; from PIL import Image; import pypdf; assert 5 <= int(pypdf.__version__.split(".")[0]) < 7');
}

export async function inspectPdf(python: string, bytes: Buffer, output: string, layout: PdfReadingLayout = {}): Promise<LayoutPdf> {
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('下载内容不是PDF');
  return script(python, 'inspect-layout-pdf', [output, '--layout', JSON.stringify(layout)], bytes);
}

export async function readPdfContent(python: string, bytes: Buffer, layout: PdfReadingLayout = {}): Promise<{ pages: number; text: string }> {
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('下载内容不是PDF');
  return script(python, 'inspect-layout-pdf', ['--text-only', '--layout', JSON.stringify(layout)], bytes);
}

export async function inspectDocx(python: string, bytes: Buffer): Promise<DocxContents> {
  if (bytes.subarray(0, 2).toString() !== 'PK') throw new Error('下载内容不是DOCX');
  return JSON.parse((await runPython(python, [
    'import io,json,sys,zipfile,xml.etree.ElementTree as ET',
    'with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:',
    ' xml=z.read("word/document.xml").decode("utf8")',
    ' root=ET.fromstring(xml)',
    ' ns={"w":"http://schemas.openxmlformats.org/wordprocessingml/2006/main"}',
    ' text="\\n".join("".join(p.itertext()) for p in root.findall(".//w:p",ns))',
    ' media=sum(1 for p in z.namelist() if p.startswith("word/media/") and not p.endswith("/"))',
    ' print(json.dumps({"text":text,"xml":xml,"mediaCount":media}))',
  ].join('\n'), [], bytes)).toString('utf8')) as DocxContents;
}

export async function compareRenderedLayout(python: string, preview: string, pdf: string): Promise<RenderedLayout> {
  return script(python, 'compare-rendered-layout', [preview, pdf, '--colored-text']);
}

export async function inspectPdfImage(python: string, bytes: Buffer, expectedImage: string): Promise<{
  matches: Array<{ insidePage: boolean; aspectError: number }>;
}> {
  return script(python, 'inspect-exam-pdf-image', [expectedImage], bytes);
}
