/**
 * mindmap-tree — 思维导图的纯数据结构与 Markdown 互转（客户端/服务端共用）。
 *
 * 从 mindmap.plugin.ts 拆出（2026-08-20 生产构建根修）：MindmapWindow /
 * ShareMindmapGraph / mindmap-layout 等客户端模块只需要这些纯函数，原来
 * 从 mindmap.plugin 导入会把 llm-service（→ undici → node:crypto）静态
 * 打进浏览器包，生产构建直接失败。客户端一律从这里导入。
 */

export interface MindmapNode {
  title: string;
  children?: MindmapNode[];
  startMs?: number;
  endMs?: number;
}

/** 将嵌套树结构递归转为 Markdown 大纲（markmap 直接消费） */
export function treeToMarkdown(root: string, children: MindmapNode[], depth: number = 1): string {
  const lines: string[] = [`# ${root}`];
  const walk = (nodes: MindmapNode[], level: number) => {
    for (const node of nodes) {
      const indent = '  '.repeat(level - 1);
      lines.push(`${indent}- ${node.title}`);
      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children, level + 1);
      }
    }
  };
  walk(children, depth);
  return lines.join('\n');
}

/**
 * 去掉节点文本里的 inline markdown 标记（**粗体** / *斜体* / `代码` / [链接](url) / 前导 # - 等）。
 * SVG <text> 不渲染 markdown，节点标题必须是干净纯文本，否则会显示成字面量 `**xxx**`。
 */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*+/g, '')
    .trim();
}

/** 从 Markdown 层级大纲解析出树形结构（兼容 LLM 直接输出 Markdown） */
export function markdownToTree(markdown: string): { root: string; children: MindmapNode[] } {
  const lines = markdown.split('\n').filter((line) => line.trim());
  let root = '课堂知识结构';

  const rootMatch = lines[0]?.match(/^#{1,2}\s+(.+)/);
  if (rootMatch) {
    root = stripInlineMarkdown(rootMatch[1]);
    lines.shift();
  }

  const stack: { node: MindmapNode; depth: number }[] = [];
  const topChildren: MindmapNode[] = [];

  for (const line of lines) {
    const match = line.match(/^(\s*)-\s+(.+)/);
    if (!match) continue;
    const depth = Math.floor(match[1].length / 2);
    const title = stripInlineMarkdown(match[2]);
    if (!title) continue;
    const node: MindmapNode = { title, children: [] };

    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      topChildren.push(node);
    } else {
      const parent = stack[stack.length - 1].node;
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    }
    stack.push({ node, depth });
  }

  return { root, children: topChildren };
}
