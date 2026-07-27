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
 *
 * stripTimestamps（复习态一键复制）：[MM:SS] 是界面里的回跳资产，粘贴出去
 * 只是一串看不懂的数字——纯文本走 stripTimestamps 抹掉标记；富文本克隆 DOM
 * 后移除可点的时间戳按钮（title="跳到 ..."），格式其余部分原样保留。
 */

import { stripTimestamps } from '@/components/tutor/timestamp-parsing';

export async function copyMessageSmart(
  plainText: string,
  options?: { messageId?: string; htmlText?: string; stripTimestamps?: boolean },
): Promise<boolean> {
  if (typeof window === 'undefined' || !navigator?.clipboard) return false;

  const strip = options?.stripTimestamps ?? false;
  const plain = strip ? stripTimestamps(plainText) : plainText;

  let html = options?.htmlText;
  // 没显式给 html，尝试从 DOM 抓 messageId 对应节点的 innerHTML
  if (!html && options?.messageId) {
    const node = document.querySelector<HTMLElement>(
      `[data-msg-id="${options.messageId}"]`,
    );
    if (node) {
      if (strip) {
        const clone = node.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('button[title^="跳到 "]').forEach((el) => el.remove());
        html = clone.innerHTML;
      } else {
        html = node.innerHTML;
      }
    }
  }

  // 优先双格式（modern browser）
  if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    try {
      const blobHtml = new Blob([html], { type: 'text/html' });
      const blobText = new Blob([plain], { type: 'text/plain' });
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
    await navigator.clipboard.writeText(plain);
    return true;
  } catch {
    return false;
  }
}
