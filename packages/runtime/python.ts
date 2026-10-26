import { spawn } from 'node:child_process';

/** 文本/文件只经 stdin 或独立参数传递，不拼 shell，不输出凭据或题目正文。 */
export function runPython(python: string, code: string, args: string[] = [], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-c', code, ...args], { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error('Python 文件分析超过60秒')); }, 60_000);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64 * 1024 * 1024) { child.kill(); reject(new Error('Python 文件分析结果超过64MB')); }
      else chunks.push(chunk);
    });
    child.on('error', () => { clearTimeout(timer); reject(new Error('无法启动 Python，请检查 BMTK_PDF_PYTHON')); });
    child.stdin.on('error', () => { /* 通过进程结果报告，不打印正文。 */ });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error('Python 文件分析失败，请检查文件及 PyMuPDF、Pillow、pypdf 依赖'));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(input);
  });
}
