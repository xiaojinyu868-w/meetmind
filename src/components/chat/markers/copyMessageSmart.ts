/**
 * copyMessageSmart —— 复制富文本 + 纯文本双格式（M12）
 *
 * 行为：
 *   1. 优先尝试 ClipboardItem 写入 text/html + text/plain 双 mimetype
 *      → 粘贴到富文本编辑器（Notion / Word / 飞书 / 邮件）保留格式
 *      → 粘贴到纯文本编辑器（VSCode / 终端）保留 markdown 文字
 *   2. 不支持 ClipboardItem 或抛错时，降级到 writeText
 *
 * htmlText 优先从 DOM 拿 —— caller 给 messageId，从 [data-msg-id="..."] 取 innerHTML，
 * 这样真正的"所见即所粘"。
 */

export async function copyMessageSmart(
  plainText: string,
  options?: { messageId?: string; htmlText?: string },
): Promise<boolean> {
  if (typeof window === 'undefined' || !navigator?.clipboard) return false;

  let html = options?.htmlText;
  // 没显式给 html，尝试从 DOM 抓 messageId 对应节点的 innerHTML
  if (!html && options?.messageId) {
    const node = document.querySelector<HTMLElement>(
      `[data-msg-id="${options.messageId}"]`,
    );
    if (node) html = node.innerHTML;
  }

  // 优先双格式（modern browser）
  if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    try {
      const blobHtml = new Blob([html], { type: 'text/html' });
      const blobText = new Blob([plainText], { type: 'text/plain' });
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText }),
      ]);
      return true;
    } catch {
      /* fallthrough to writeText */
    }
  }

  // 单格式 fallback
  try {
    await navigator.clipboard.writeText(plainText);
    return true;
  } catch {
    return false;
  }
}
