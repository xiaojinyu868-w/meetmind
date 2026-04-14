/**
 * Tutor Agent Tools — Pi Agent 格式
 *
 * 5 个 AgentTool，使用 TypeBox schema 定义参数，Pi 框架自动做参数校验。
 * 1. list_subjects        → 目录级：有哪些科目
 * 2. list_captures        → 摘要级：某科目下有哪些课
 * 3. get_personal_context → 个人级：某节课的个人学习痕迹
 * 4. read_transcript      → 全文级：某节课的转录内容
 * 5. web_search           → 联网搜索：查找课堂内容之外的知识
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import prisma from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import { webSearch as executeWebSearch } from '@/lib/services/web-search-service';

const log = createLogger('tutor-agent-tools');

// ── Tool: list_subjects ──

export const listSubjectsTool: AgentTool<typeof ListSubjectsParams> = {
  name: 'list_subjects',
  label: '查看学过哪些科目',
  description: '查看学生学过哪些科目/主题，每个科目有几节课。这是最粗粒度的浏览——先调用这个了解全貌。',
  parameters: Type.Object({}),
  async execute(_toolCallId, _params, _signal) {
    const text = await listSubjectsImpl();
    return { content: [{ type: 'text', text }], details: undefined };
  },
};

const ListSubjectsParams = Type.Object({});

// ── Tool: list_captures ──

const ListCapturesParams = Type.Object({
  subject: Type.String({ description: '科目或主题名称（来自 list_subjects 的结果）' }),
});

export const listCapturesTool: AgentTool<typeof ListCapturesParams> = {
  name: 'list_captures',
  label: '查看课堂记录',
  description: '查看某个科目/主题下所有课堂记录的摘要（标题、时间、简介）。用于定位具体哪节课与当前问题相关。',
  parameters: ListCapturesParams,
  async execute(_toolCallId, params, _signal) {
    const text = await listCapturesImpl(params.subject);
    return { content: [{ type: 'text', text }], details: undefined };
  },
};

// ── Tool: get_personal_context ──

const PersonalContextParams = Type.Object({
  captureId: Type.String({ description: '课堂记录的 ID（来自 list_captures 的结果）' }),
});

export const getPersonalContextTool: AgentTool<typeof PersonalContextParams> = {
  name: 'get_personal_context',
  label: '查看学习痕迹',
  description: '查看学生在某节课上的个人学习痕迹：打过的锚点（困惑/重点标记）、和 Tutor 的对话历史摘要、随堂检验结果。',
  parameters: PersonalContextParams,
  async execute(_toolCallId, params, _signal) {
    const text = await getPersonalContextImpl(params.captureId);
    return { content: [{ type: 'text', text }], details: undefined };
  },
};

// ── Tool: read_transcript ──

const ReadTranscriptParams = Type.Object({
  captureId: Type.String({ description: '课堂记录的 ID' }),
  startMs: Type.Optional(Type.Number({ description: '开始时间（毫秒），不传则从头开始' })),
  endMs: Type.Optional(Type.Number({ description: '结束时间（毫秒），不传则到结尾' })),
});

export const readTranscriptTool: AgentTool<typeof ReadTranscriptParams> = {
  name: 'read_transcript',
  label: '阅读课堂转录',
  description: '读取某节课的转录内容。可以读全文，也可以指定时间段只读一部分。只有在需要引用课堂原话时才调用。',
  parameters: ReadTranscriptParams,
  async execute(_toolCallId, params, _signal) {
    const text = await readTranscriptImpl(params.captureId, params.startMs, params.endMs);
    return { content: [{ type: 'text', text }], details: undefined };
  },
};

// ── Tool: web_search ──

const WebSearchParams = Type.Object({
  query: Type.String({ description: '搜索关键词或问题（中英文均可）' }),
});

export const webSearchTool: AgentTool<typeof WebSearchParams> = {
  name: 'web_search',
  label: '联网搜索',
  description: '联网搜索——当学生的问题超出已有课堂内容的范围，或者需要查找最新资料、公式推导、术语解释、扩展知识时使用。',
  parameters: WebSearchParams,
  async execute(_toolCallId, params, _signal) {
    const text = await webSearchImpl(params.query);
    return { content: [{ type: 'text', text }], details: undefined };
  },
};

/** 所有工具的数组——传给 Agent */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TUTOR_AGENT_TOOLS: AgentTool<any>[] = [
  listSubjectsTool,
  listCapturesTool,
  getPersonalContextTool,
  readTranscriptTool,
  webSearchTool,
];

// ── 实现（和之前逻辑完全一致）──

// workspaceId 通过闭包注入，见 createTutorTools()
let _workspaceId = '';
export function setWorkspaceId(id: string) { _workspaceId = id; }

async function listSubjectsImpl(): Promise<string> {
  const captures = await prisma.workspaceCapture.findMany({
    where: { workspaceId: _workspaceId, status: 'active' },
    select: { id: true, title: true, contentType: true, createdAt: true, metadataJson: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  if (captures.length === 0) return '学生还没有任何学习记录。';

  const subjectMap = new Map<string, { count: number; latest: Date }>();
  for (const cap of captures) {
    let subject = '其他';
    try {
      const meta = cap.metadataJson ? JSON.parse(cap.metadataJson) : {};
      if (meta.subject) subject = meta.subject;
      else if (meta.topic) subject = meta.topic;
      else subject = cap.title.slice(0, 20);
    } catch { /* */ }

    const existing = subjectMap.get(subject);
    if (existing) {
      existing.count++;
      if (cap.createdAt > existing.latest) existing.latest = cap.createdAt;
    } else {
      subjectMap.set(subject, { count: 1, latest: cap.createdAt });
    }
  }

  const lines: string[] = [`共 ${captures.length} 条学习记录，按主题分组：`];
  for (const [subject, info] of subjectMap) {
    lines.push(`- ${subject}（${info.count} 条，最近: ${info.latest.toLocaleDateString('zh-CN')}）`);
  }
  return lines.join('\n');
}

async function listCapturesImpl(subject: string): Promise<string> {
  const captures = await prisma.workspaceCapture.findMany({
    where: { workspaceId: _workspaceId, status: 'active' },
    select: { id: true, title: true, previewText: true, contentType: true, createdAt: true, metadataJson: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const subjectLower = subject.toLowerCase();
  const matched = captures.filter((cap) => {
    const titleMatch = cap.title.toLowerCase().includes(subjectLower);
    let metaMatch = false;
    try {
      const meta = cap.metadataJson ? JSON.parse(cap.metadataJson) : {};
      metaMatch = JSON.stringify(meta).toLowerCase().includes(subjectLower);
    } catch { /* */ }
    return titleMatch || metaMatch;
  });

  const list = matched.length > 0 ? matched : captures.slice(0, 10);
  if (list.length === 0) return `没有找到与"${subject}"相关的学习记录。`;

  const lines: string[] = [`与"${subject}"相关的学习记录：`];
  for (const cap of list) {
    const preview = cap.previewText ? cap.previewText.slice(0, 80) + '...' : '无摘要';
    lines.push(`\n[${cap.id}] ${cap.title}`);
    lines.push(`  类型: ${cap.contentType} | 时间: ${cap.createdAt.toLocaleDateString('zh-CN')}`);
    lines.push(`  摘要: ${preview}`);
  }
  return lines.join('\n');
}

async function getPersonalContextImpl(captureId: string): Promise<string> {
  const capture = await prisma.workspaceCapture.findUnique({
    where: { id: captureId },
    select: { id: true, title: true, tutorContext: true },
  });

  if (!capture) return `未找到 ID 为 ${captureId} 的学习记录。`;

  const lines: string[] = [`"${capture.title}" 的个人学习痕迹：`];
  if (capture.tutorContext) {
    lines.push(capture.tutorContext.slice(0, 3000));
  } else {
    lines.push('暂无个人学习痕迹（没有打过锚点、没有和 Tutor 对话过）。');
  }
  return lines.join('\n');
}

async function readTranscriptImpl(captureId: string, startMs?: number, endMs?: number): Promise<string> {
  const capture = await prisma.workspaceCapture.findUnique({
    where: { id: captureId },
    select: { id: true, title: true, normalizedText: true },
  });

  if (!capture) return `未找到 ID 为 ${captureId} 的学习记录。`;
  if (!capture.normalizedText) return `"${capture.title}" 没有转录文本。`;

  let text = capture.normalizedText;
  if (startMs !== undefined || endMs !== undefined) {
    const totalLen = text.length;
    const startRatio = startMs ? Math.min(1, startMs / (3600 * 1000)) : 0;
    const endRatio = endMs ? Math.min(1, endMs / (3600 * 1000)) : 1;
    text = text.slice(Math.floor(totalLen * startRatio), Math.floor(totalLen * endRatio));
  }

  if (text.length > 4000) {
    text = text.slice(0, 4000) + '\n\n[转录内容过长，已截断。可以指定 startMs/endMs 读取特定时间段。]';
  }
  return `"${capture.title}" 的转录内容：\n\n${text}`;
}

async function webSearchImpl(query: string): Promise<string> {
  try {
    const citations = await executeWebSearch(query, { maxResults: 5 });
    if (citations.length === 0) return `联网搜索"${query}"没有找到相关结果。`;

    const lines: string[] = [`搜索"${query}"找到 ${citations.length} 条结果：`];
    for (const c of citations) {
      lines.push(`\n[${c.title}]`);
      if (c.url) lines.push(`  链接: ${c.url}`);
      if (c.snippet) lines.push(`  摘要: ${c.snippet}`);
    }
    return lines.join('\n');
  } catch (error) {
    log.error('Web search tool error:', error);
    return `联网搜索出错: ${error instanceof Error ? error.message : '未知错误'}`;
  }
}
