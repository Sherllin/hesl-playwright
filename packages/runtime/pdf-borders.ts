import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runPython } from './python';

/** 坐标/线宽为PDF pt；ink来自实际渲染像素，兼容虚线路径和分散填充的dash。 */
export interface PdfBorderLine {
  axis: 'h' | 'v'; coordinate: number; start: number; end: number;
  width: number; color: [number, number, number];
  ink: Array<[number, number]>;
}
export interface PdfBorders { pages: Array<{ width: number; height: number; lines: PdfBorderLine[] }> }

export async function inspectPdfBorders(python: string, bytes: Buffer): Promise<PdfBorders> {
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('下载内容不是PDF');
  const source = await readFile(fileURLToPath(new URL('./python/inspect-pdf-borders.py', import.meta.url)), 'utf8');
  return JSON.parse((await runPython(python, source, [], bytes)).toString('utf8')) as PdfBorders;
}
