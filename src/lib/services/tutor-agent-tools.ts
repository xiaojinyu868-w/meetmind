/**
 * Tutor Agent Tools — 学习上下文渐进式检索 + 联网搜索
 *
 * 5 个工具，供 Agent 自主决定调用顺序和深度：
 * 1. list_subjects        → 目录级：有哪些科目
 * 2. list_captures        → 摘要级：某科目下有哪些课
 * 3. get_personal_context → 个人级：某节课的个人学习痕迹
 * 4. read_transcript      → 全文级：某节课的转录内容
 * 5. web_search           → 联网搜索：查找课堂内容之外的知识
 */

import prisma from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import { webSearch as executeWebSearch } from '@/lib/services/web-search-service';

const log = createLogger('tutor-agent-tools');

// ── 工具定义（OpenAI function calling 格式）──

export const TUTOR_AGENT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_subjects',
      description: '查看学生学过哪些科目/主题，每个科目有几节课。这是最粗粒度的浏览——先调用这个了解全貌。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_captures',
      description: '查看某个科目/主题下所有课堂记录的摘要（标题、时间、简介）。用于定位具体哪节课与当前问题相关。',
      parameters: {
        type: 'object',
        properties: {
          subject: {
            type: 'string',
            description: '科目或主题名称（来自 list_subjects 的结果）',
          },
        },
        required: ['subject'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_personal_context',
      description: '查看学生在某节课上的个人学习痕迹：打过的锚点（困惑/重点标记）、和 Tutor 的对话历史摘要、随堂检验结果。这是理解"这个学生在这个知识点上卡在哪"的关键。',
      parameters: {
        type: 'object',
        properties: {
          captureId: {
            type: 'string',
            description: '课堂记录的 ID（来自 list_captures 的结果）',
          },
        },
        required: ['captureId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_transcript',
      description: '读取某节课的转录内容。可以读全文，也可以指定时间段只读一部分。只有在需要引用课堂原话时才调用。',
      parameters: {
        type: 'object',
        properties: {
          captureId: {
            type: 'string',
            description: '课堂记录的 ID',
          },
          startMs: {
            type: 'number',
            description: '开始时间（毫秒），不传则从头开始',
          },
          endMs: {
            type: 'number',
            description: '结束时间（毫秒），不传则到结尾',
          },
        },
        required: ['captureId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description: '联网搜索——当学生的问题超出已有课堂内容的范围，或者需要查找最新资料、公式推导、术语解释、扩展知识时使用。传入搜索关键词，返回网页摘要和链接。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词或问题（中英文均可）',
          },
        },
        required: ['query'],
      },
    },
  },
];

// ── 工具执行函数 ──

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  workspaceId: string,
): Promise<string> {
  try {
    switch (toolName) {
      case 'list_subjects':
        return await listSubjects(workspaceId);
      case 'list_captures':
        return await listCaptures(workspaceId, String(args.subject || ''));
      case 'get_personal_context':
        return await getPersonalContext(String(args.captureId || ''));
      case 'read_transcript':
        return await readTranscript(
          String(args.captureId || ''),
          typeof args.startMs === 'number' ? args.startMs : undefined,
          typeof args.endMs === 'number' ? args.endMs : undefined,
        );
      case 'web_search':
        return await searchWeb(String(args.query || ''));
      default:
        return `未知工具: ${toolName}`;
    }
  } catch (error) {
    log.error(`Tool ${toolName} execution error:`, error);
    return `工具执行出错: ${error instanceof Error ? error.message : '未知错误'}`;
  }
}

// ── 具体实现 ──

async function listSubjects(workspaceId: string): Promise<string> {
  const captures = await prisma.workspaceCapture.findMany({
    where: { workspaceId, status: 'active' },
    select: { id: true, title: true, contentType: true, createdAt: true, metadataJson: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  if (captures.length === 0) {
    return '学生还没有任何学习记录。';
  }

  // 按标题关键词粗粒度聚类（不做 AI 分类，用简单规则）
  const subjectMap = new Map<string, { count: number; latest: Date; ids: string[] }>();

  for (const cap of captures) {
    // 尝试从 metadata 中提取 subject，否则用标题前几个字
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
      existing.ids.push(cap.id);
      if (cap.createdAt > existing.latest) existing.latest = cap.createdAt;
    } else {
      subjectMap.set(subject, { count: 1, latest: cap.createdAt, ids: [cap.id] });
    }
  }

  const lines: string[] = [`共 ${captures.length} 条学习记录，按主题分组：`];
  for (const [subject, info] of subjectMap) {
    lines.push(`- ${subject}（${info.count} 条，最近: ${info.latest.toLocaleDateString('zh-CN')}）`);
  }

  return lines.join('\n');
}

async function listCaptures(workspaceId: string, subject: string): Promise<string> {
  const captures = await prisma.workspaceCapture.findMany({
    where: { workspaceId, status: 'active' },
    select: { id: true, title: true, previewText: true, contentType: true, createdAt: true, metadataJson: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  // 简单过滤：标题或 metadata 包含 subject 关键词
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

  const list = matched.length > 0 ? matched : captures.slice(0, 10); // 没匹配到就返回最近的

  if (list.length === 0) {
    return `没有找到与"${subject}"相关的学习记录。`;
  }

  const lines: string[] = [`与"${subject}"相关的学习记录：`];
  for (const cap of list) {
    const preview = cap.previewText ? cap.previewText.slice(0, 80) + '...' : '无摘要';
    lines.push(`\n[${cap.id}] ${cap.title}`);
    lines.push(`  类型: ${cap.contentType} | 时间: ${cap.createdAt.toLocaleDateString('zh-CN')}`);
    lines.push(`  摘要: ${preview}`);
  }

  return lines.join('\n');
}

async function getPersonalContext(captureId: string): Promise<string> {
  const capture = await prisma.workspaceCapture.findUnique({
    where: { id: captureId },
    select: { id: true, title: true, tutorContext: true, metadataJson: true },
  });

  if (!capture) {
    return `未找到 ID 为 ${captureId} 的学习记录。`;
  }

  const lines: string[] = [`"${capture.title}" 的个人学习痕迹：`];

  // tutorContext 包含了摘要、困惑锚点、笔记、对话等
  if (capture.tutorContext) {
    lines.push(capture.tutorContext.slice(0, 3000));
  } else {
    lines.push('暂无个人学习痕迹（没有打过锚点、没有和 Tutor 对话过）。');
  }

  return lines.join('\n');
}

async function readTranscript(
  captureId: string,
  startMs?: number,
  endMs?: number,
): Promise<string> {
  const capture = await prisma.workspaceCapture.findUnique({
    where: { id: captureId },
    select: { id: true, title: true, normalizedText: true },
  });

  if (!capture) {
    return `未找到 ID 为 ${captureId} 的学习记录。`;
  }

  if (!capture.normalizedText) {
    return `"${capture.title}" 没有转录文本。`;
  }

  // normalizedText 是完整转录，如果指定了时间段则尝试截取
  // 由于 normalizedText 不带时间戳，这里直接返回全文或截断
  let text = capture.normalizedText;

  if (startMs !== undefined || endMs !== undefined) {
    // 粗略截取：按字符比例估算
    const totalLen = text.length;
    const startRatio = startMs ? Math.min(1, startMs / (3600 * 1000)) : 0;
    const endRatio = endMs ? Math.min(1, endMs / (3600 * 1000)) : 1;
    const startIdx = Math.floor(totalLen * startRatio);
    const endIdx = Math.floor(totalLen * endRatio);
    text = text.slice(startIdx, endIdx);
  }

  // 限制返回长度，避免塞爆 context
  if (text.length > 4000) {
    text = text.slice(0, 4000) + '\n\n[转录内容过长，已截断。可以指定 startMs/endMs 读取特定时间段。]';
  }

  return `"${capture.title}" 的转录内容：\n\n${text}`;
}

async function searchWeb(query: string): Promise<string> {
  try {
    const citations = await executeWebSearch(query, { maxResults: 5 });

    if (citations.length === 0) {
      return `联网搜索"${query}"没有找到相关结果。`;
    }

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
