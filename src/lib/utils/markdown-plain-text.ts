/**
 * markdown-plain-text — Markdown → 纯文本（纯函数，零依赖）。
 *
 * 原来住在 web-article-extract-service.ts 里；收集卡片（CollectionCard → capture-source-utils）只要这一个函数，
 * 却把整个抽取服务（Firecrawl / OpenClaw 配置、logger、HTML 解析，≈20 KB 源码）静态拖进 /app 首屏 JS。
 * 服务端仍从服务文件 re-export，调用方不变。
 */

/**
 * Markdown → 纯文本（移除 Markdown 语法 + HTML/SVG 残留 + data URI）。
 *
 * 微信公众号等平台的 Firecrawl 提取结果常混入 SVG 追踪像素、
 * URL 编码标签、data URI 图片等垃圾，需要在此统一清洗。
 */
export function markdownToPlainText(md: string): string {
  return md
    // 1. Markdown 图片（包括跨行，关键修复：. 默认不匹配换行）
    .replace(/!\[.*?\]\([\s\S]*?\)/g, '')
    // 2. Markdown 链接（包括跨行）
    .replace(/\[([^\]]+)\]\([\s\S]*?\)/g, '$1')
    // 3. HTML/SVG/XML 标签
    .replace(/<[^>]+>/g, '')
    // 4. URL 编码的 HTML/SVG 标签（如 %3Csvg%3E...%3C/svg%3E）
    .replace(/%3C[\s\S]*?%3E/gi, '')
    // 5. data URI（base64 和 raw）
    .replace(/data:[\w/]+;[\w-]+,[\s\S]*?(?=\s|$|\)|"|')/g, '')
    // 6. HTML 实体
    .replace(/&[a-zA-Z0-9#]+;/g, ' ')
    // 7. 孤立的 SVG/XML 属性残留（如 fill='...' width='1'）
    .replace(/\s+(?:fill|stroke|width|height|x|y|rx|ry|cx|cy|r|d|transform|xmlns|viewBox|preserveAspectRatio|class|id|style)\s*=\s*['"][^'"]*['"]/gi, ' ')
    // 8. Markdown 标题
    .replace(/#{1,6}\s+/g, '')
    // 9. 加粗/斜体
    .replace(/[*_]{1,3}(.+?)[*_]{1,3}/g, '$1')
    // 10. 代码
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    // 11. 列表
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    // 12. 引用
    .replace(/^>\s+/gm, '')
    // 13. 分隔线
    .replace(/---+/g, '')
    // 14. 清理水平多余空白（保留换行）
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
