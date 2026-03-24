/**
 * 历史全局检索服务
 *
 * 一步 LLM 检索方案：
 * 1. 从数据库查询用户所有 active captures 的轻量字段
 * 2. 构建索引清单（title + previewText）
 * 3. 一次性送给 LLM，流式返回带引用的回答
 */

import prisma from '@/lib/prisma';
import workspaceService from '@/lib/services/workspace-service';
import { chatStream, type ChatMessage, type StreamChunk } from '@/lib/services/llm-service';

// ─── 类型定义 ─────────────────────────────────────────────

export interface SearchSource {
  id: string;
  contentType: string;
  title: string;
  previewText: string;
  occurredAt: string | null;
  createdAt: string;
}

export interface SearchResult {
  sources: SearchSource[];
  answerStream: AsyncGenerator<StreamChunk>;
}

// ─── 内容类型中文标签 ──────────────────────────────────────

const CONTENT_TYPE_LABELS: Record<string, string> = {
  text: '文字',
  audio: '录音',
  video: '视频',
  image: '图片',
  link: '链接',
  document: '文档',
};

function contentTypeLabel(type: string): string {
  return CONTENT_TYPE_LABELS[type] || type;
}

function formatDate(date: Date | string | null): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}/${day}`;
}

// ─── 索引清单构建 ──────────────────────────────────────────

function buildIndexEntry(
  index: number,
  capture: {
    id: string;
    contentType: string;
    title: string;
    previewText: string | null;
    occurredAt: Date | null;
    createdAt: Date;
  }
): string {
  const label = contentTypeLabel(capture.contentType);
  const date = formatDate(capture.occurredAt || capture.createdAt);
  const title = (capture.title || '').trim();
  const preview = (capture.previewText || '').trim();

  // 如果 previewText 和 title 内容重复（previewText 以 title 开头），只保留 previewText
  const content =
    preview && preview.startsWith(title) ? preview : [title, preview].filter(Boolean).join(' | ');

  return `[${index + 1}] ${label} | ${date} | ${content}`;
}

// ─── System Prompt ────────────────────────────────────────

const SEARCH_SYSTEM_PROMPT = `你是一个学习资料检索助手。用户会提供一个问题，以及他们过去收集的所有学习资料的索引清单。

你的任务：
1. 根据用户的问题，在索引清单中找到最相关的资料
2. 基于找到的资料内容，给出简洁、准确的回答
3. 在回答正文中用 [编号] 标注引用来源，如 [3]、[7]

回答要求：
- 直接回答问题，不要说"根据你的资料"之类的开场白
- 使用 Markdown 格式组织回答：用 **粗体** 突出关键词，用列表整理要点，如有公式可用 LaTeX
- 在正文中自然地穿插引用编号，如"强化学习的奖励函数 [3] 需要考虑..."
- 不要在末尾单独列出"引用来源"清单，引用编号只在正文中标注即可（系统会自动展示来源卡片）
- 如果没有找到相关内容，直接说"在你的学习资料中没有找到相关内容"
- 回答语言跟随用户问题的语言
- 保持简洁，有条理，不要过度展开

回答格式示例：
强化学习中**奖励函数**的设计需要考虑两个核心维度：

1. **稀疏性**：奖励信号不能太稀疏，否则智能体难以学习 [3]
2. **形状设计**：需要通过 reward shaping 引导探索方向 [7]

此外，在实际应用中还需要注意奖励黑客（reward hacking）问题 [3]。`;

// ─── 主方法 ───────────────────────────────────────────────

const MAX_CAPTURES = 500;

export async function searchCaptures(
  userId: string,
  query: string
): Promise<SearchResult> {
  // 1. 获取用户的默认工作区
  const workspace = await workspaceService.getDefaultWorkspace(userId);
  if (!workspace) {
    throw new Error('未找到工作区');
  }

  // 2. 查询所有 active captures（只取轻量字段，不加载 normalizedText）
  const captures = await prisma.workspaceCapture.findMany({
    where: {
      workspaceId: workspace.id,
      status: 'active',
    },
    select: {
      id: true,
      contentType: true,
      title: true,
      previewText: true,
      occurredAt: true,
      createdAt: true,
    },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    take: MAX_CAPTURES,
  });

  if (captures.length === 0) {
    throw new Error('还没有收集任何学习资料，去收集一些内容后再来检索吧');
  }

  // 3. 构建索引清单
  const indexEntries = captures.map((c, i) => buildIndexEntry(i, c));
  const indexText = indexEntries.join('\n');

  // 4. 构建 sources 元数据（供前端渲染来源卡片）
  const sources: SearchSource[] = captures.map((c) => ({
    id: c.id,
    contentType: c.contentType,
    title: c.title,
    previewText: c.previewText || '',
    occurredAt: c.occurredAt?.toISOString() || null,
    createdAt: c.createdAt.toISOString(),
  }));

  // 5. 构建 LLM 消息
  const messages: ChatMessage[] = [
    { role: 'system', content: SEARCH_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `我的问题：${query}\n\n以下是我的学习资料索引（共${captures.length}条）：\n\n${indexText}`,
    },
  ];

  // 6. 调用 LLM 流式生成
  const stream = chatStream(messages, undefined, {
    temperature: 0.3,
  });

  return {
    sources,
    answerStream: stream,
  };
}

export default { searchCaptures };
