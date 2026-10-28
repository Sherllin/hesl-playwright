import { readFile, writeFile } from 'node:fs/promises';
import { runPython } from '../../../packages/runtime/python';
import type { ImagePdf } from './image-layout.assertions';

export interface FixtureImage { role: string; width: number; height: number; path: string; src: string }
export interface ImageSample { type: number; marker: string; payload: Record<string, unknown> }

export async function createImageFixtures(python: string, directory: string): Promise<{ images: FixtureImage[]; manifest: string }> {
  const script = await readFile(new URL('./python/create-image-layout-fixture.py', import.meta.url), 'utf8');
  const images = JSON.parse((await runPython(python, script, [directory])).toString()) as FixtureImage[];
  const manifest = `${directory}/images.json`;
  await writeFile(manifest, JSON.stringify(images));
  return { images, manifest };
}

export function imageSamples(images: FixtureImage[], runId: string, shortTypeId: string): ImageSample[] {
  const block = (role: string, label: string) => {
    const image = images.find(image => image.role === role)!;
    return `<p>I14${label}BEFORE<br><img src="${image.src}" width="${image.width}" height="${image.height}"><br>I14${label}AFTER</p>`;
  };
  const common = { level: 0.5, language: '', catalogs: [], options: [], subQuestions: [], answer: null, questionScore: 2 };
  return [
    { type: 1, marker: 'I14CHOICEBEFORE', payload: { ...common, questionType: 1,
      question: `<p>${runId} CHOICE</p>${block('choice', 'CHOICE')}`,
      subQuestions: [
        { question: block('option', 'OPTION'), answer: 'true', sort: 1 },
        { question: '<p>OTHER OPTION</p>', answer: 'false', sort: 2 },
      ],
    } },
    { type: 6, marker: 'I14PARENTBEFORE', payload: { ...common, questionType: 6,
      question: `<p>${runId} MATERIAL</p>` + Array.from({ length: 36 }, (_, i) =>
        `<p>I14MATERIAL${String(i).padStart(2, '0')} Long experimental material continues with full original text.</p>`).join('') + block('parent', 'PARENT'),
      subQuestions: [{ ...common, questionType: 5, questionTypeId: shortTypeId, questionTypeName: '简答题',
        question: block('child', 'CHILD'), answer: block('answer', 'ANSWER') }],
    } },
    { type: 5, marker: 'I14TALLBEFORE', payload: { ...common, questionType: 5,
      question: `<p>${runId} TALL</p>${block('tall', 'TALL')}`, answer: block('tall', 'TALLRESPONSE'),
    } },
  ];
}

export async function inspectImagePdf(python: string, bytes: Buffer, manifest: string, output: string): Promise<ImagePdf> {
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('下载内容不是PDF');
  const script = await readFile(new URL('./python/inspect-image-layout.py', import.meta.url), 'utf8');
  return JSON.parse((await runPython(python, script, [manifest, output], bytes)).toString()) as ImagePdf;
}
