import { spawn } from 'node:child_process';

function runPython(python: string, script: string, input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-c', script], { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error('PDF 读取超过60秒')); }, 60_000);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) { child.kill(); reject(new Error('PDF 提取文本超过32MB')); }
      else chunks.push(chunk);
    });
    child.on('error', () => { clearTimeout(timer); reject(new Error('无法启动 PDF Python，请检查传入的可执行文件路径')); });
    child.stdin.on('error', () => { /* 退出码统一报告，不输出保密正文。 */ });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error('PDF 读取失败，请确认指定 Python 安装了 pypdf>=5,<7'));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(input);
  });
}

export async function checkPdfReader(python: string): Promise<void> {
  await runPython(python, "import pypdf; assert 5 <= int(pypdf.__version__.split('.')[0]) < 7");
}

// 通过标准输入传递实际下载的 PDF，不生成副本，也不依赖某个业务仓库的目录。
export async function readPdf(python: string, bytes: Buffer): Promise<{ pages: number; text: string }> {
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('下载内容不是PDF');
  const result = await runPython(python, [
    'import sys, json', 'from io import BytesIO', 'from pypdf import PdfReader',
    'reader = PdfReader(BytesIO(sys.stdin.buffer.read()))',
    'print(json.dumps({"pages": len(reader.pages), "text": "\\n".join(p.extract_text() or "" for p in reader.pages)}))',
  ].join('\n'), bytes);
  return JSON.parse(result.toString('utf8'));
}
