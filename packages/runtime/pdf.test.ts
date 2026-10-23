import { test, expect } from '@playwright/test';
import { readPdf } from './pdf';

function textPdf(): Buffer {
  const stream = 'BT /F1 12 Tf 20 100 Td (MATCH-09 PDF reader) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test('从真实PDF字节读取页数和正文，不生成项目文件', async () => {
  const result = await readPdf(process.env.BMTK_PDF_PYTHON || 'python3', textPdf());
  expect(result.pages).toBe(1);
  expect(result.text).toContain('MATCH-09 PDF reader');
});
test('错误页不能冒充PDF进入正文核对', async () => {
  await expect(readPdf('python3', Buffer.from('<html>error</html>'))).rejects.toThrow(/不是PDF/);
});
