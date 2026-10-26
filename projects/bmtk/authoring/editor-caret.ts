import type { Locator } from '@playwright/test';
export async function focusEditorEnd(editor: Locator): Promise<void> {
  await editor.click();
  // macOS 的 Meta+End 只滚动而不移动光标；选中编辑区全文再向右收起选区跨平台一致。
  await editor.press('ControlOrMeta+A');
  await editor.press('ArrowRight');
}
