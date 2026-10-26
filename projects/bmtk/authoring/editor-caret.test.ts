import { test, expect } from '@playwright/test';
import { focusEditorEnd } from './editor-caret';

test('插入公式图片前光标必须在完整长题干末尾，不能插进句子中间', async ({ page }) => {
  const stem = '需要完整保留的药学题干，'.repeat(15);
  await page.setContent('<div role="textbox" contenteditable="true" style="width:250px;font-size:16px"></div>');
  const editor = page.getByRole('textbox');
  await editor.fill(stem);
  // 确保错误实现没有因原来恰好在末尾而假通过。
  await editor.press('Home');
  await focusEditorEnd(editor);
  await page.keyboard.insertText('【公式或图片占位】');
  await expect(editor).toHaveText(stem + '【公式或图片占位】');
});
