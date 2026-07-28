/**
 * lesson-understanding-service — 课后理解（一次 LLM 调用，多个产物）
 *
 * 背景（2026-07-28 审计）：定稿后同一份转录曾被全文级读取最多 4 次
 * （digest / legacy summary / generate-summary / generate-topics），
 * 标题和 Echo 再各读一次开头。本服务把"这节课讲了什么"合并为一趟：
 * 一次调用输出 { topic, overview, takeaways, highlights }，
 * 标题（质量门 + 用户锁）、课堂摘要、精选片段三个产物一次落齐。
 *
 * 原则：宁缺毋滥——任一部分不达标就只落达标的，全不达标就什么都不写；
 * 用户手动改过的标题（titleSource='user'）永远不被覆盖。
 */

import prisma from '@/lib/prisma';
import { chat } from '@/lib/services/llm-service';
import { ModelDefaults } from '@/lib/config/app.config';
import {
  passesTopicQualityGate,
  composeLessonTitle,
  retitleCaptureIfUnlocked,
} from '@/lib/services/lesson-title-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('lesson-understanding');

const SAMPLE_MAX_CHARS = 48_000;
const OVERVIEW_MAX_CHARS = 80;
const TAKEAWAY_MAX = 5;
const HIGHLIGHT_MAX = 6;

const UNDERSTANDING_PROMPT = `你在为一节课的转录做一次课后理解。转录带 [MM:SS] 时间锚点。
只输出 JSON，不要任何解释：
{
  "topic": "12 字以内的主题词，必须是内容里的具体知识点（禁止：录音、课堂、笔记、学习、内容、总结这类泛词）",
  "overview": "80 字以内，这节课到底讲了什么，具体到知识点，不空泛",
  "takeaways": ["最多 5 条要点，每条 30 字以内，每条都具体"],
  "highlights": ["最多 6 个值得回看的片段，每个含 title（10 字内）、startSec（数字，从时间锚点换算成秒）、quote（40 字内原话）"]
}`;

export interface LessonUnderstanding {
  topic: string | null;
  overview: string | null;
  takeaways: string[];
  highlights: Array<{ title: string; startSec: number; quote: string }>;
}

/** 解析并校验模型输出（纯函数，可单测）；全不达标返回 null */
export function parseUnderstandingResponse(raw: string): LessonUnderstanding | null {
  let parsed: Record<string, unknown>;
  try {
    // 模型偶尔包一层 ```json，剥掉
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }

  const topic = typeof parsed.topic === 'string' && passesTopicQualityGate(parsed.topic)
    ? parsed.topic.trim()
    : null;
  const overview = typeof parsed.overview === 'string' && parsed.overview.trim().length >= 10
    ? parsed.overview.trim().slice(0, OVERVIEW_MAX_CHARS * 2)
    : null;
  const takeaways = Array.isArray(parsed.takeaways)
    ? parsed.takeaways
        .filter((item): item is string => typeof item === 'string' && item.trim().length >= 6)
        .slice(0, TAKEAWAY_MAX)
        .map((item) => item.trim().slice(0, 60))
    : [];
  const highlights = Array.isArray(parsed.highlights)
    ? parsed.highlights
        .map((item) => {
          const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
          if (!record) return null;
          const startSec = Number(record.startSec);
          if (typeof record.title !== 'string' || !record.title.trim()) return null;
          if (!Number.isFinite(startSec) || startSec < 0) return null;
          return {
            title: record.title.trim().slice(0, 20),
            startSec: Math.round(startSec),
            quote: typeof record.quote === 'string' ? record.quote.trim().slice(0, 80) : '',
          };
        })
        .filter((item): item is { title: string; startSec: number; quote: string } => item !== null)
        .slice(0, HIGHLIGHT_MAX)
    : [];

  if (!topic && !overview && takeaways.length === 0 && highlights.length === 0) return null;
  return { topic, overview, takeaways, highlights };
}

/** 一次 LLM 调用生成课后理解；失败返回 null（调用方保留现状） */
export async function generateLessonUnderstanding(params: {
  transcriptSample: string;
  courseTitle?: string | null;
}): Promise<LessonUnderstanding | null> {
  const sample = params.transcriptSample.trim().slice(0, SAMPLE_MAX_CHARS);
  if (sample.length < 200) return null;

  try {
    const response = await chat(
      [
        { role: 'system', content: UNDERSTANDING_PROMPT },
        {
          role: 'user',
          content: `${params.courseTitle ? `课程：${params.courseTitle}\n` : ''}转录：\n${sample}`,
        },
      ],
      ModelDefaults.workshop,
      { temperature: 0.3, maxTokens: 1200, responseFormat: 'json_object' },
    );
    return parseUnderstandingResponse(response.content);
  } catch (error) {
    log.warn('generate lesson understanding failed', { error: String(error) });
    return null;
  }
}

/**
 * 把课后理解落成产物：标题（用户锁保护）+ summary/highlight artifacts。
 * 返回各产物落库结果，供客户端决定要不要更新本地标题。
 */
export async function applyLessonUnderstanding(params: {
  userId: string;
  captureId: string;
  sessionId: string;
  understanding: LessonUnderstanding;
  courseTitle?: string | null;
  occurredAt: Date;
}): Promise<{ title?: string; summaryWritten: boolean; highlightCount: number }> {
  const { userId, captureId, sessionId, understanding } = params;
  const result = { title: undefined as string | undefined, summaryWritten: false, highlightCount: 0 };

  // 标题：质量门已在解析层过过；写 capture 时再过用户锁
  if (understanding.topic) {
    const title = composeLessonTitle({
      topic: understanding.topic,
      courseTitle: params.courseTitle,
      date: params.occurredAt,
    });
    const retitled = await retitleCaptureIfUnlocked({ userId, captureId, newTitle: title });
    if (retitled === 'retitled') result.title = title;
  }

  // summary artifact：overview + takeaways 至少有一个才算有内容
  if (understanding.overview || understanding.takeaways.length > 0) {
    const payloadJson = JSON.stringify({
      summaryId: 'lesson-understanding',
      overview: understanding.overview,
      takeaways: understanding.takeaways,
      generatedAt: params.occurredAt.toISOString(),
    });
    await prisma.workspaceCaptureArtifact.upsert({
      where: { captureId_kind_artifactKey: { captureId, kind: 'summary', artifactKey: 'lesson-understanding' } },
      create: { captureId, sessionId, kind: 'summary', artifactKey: 'lesson-understanding', payloadJson },
      update: { sessionId, payloadJson },
    });
    result.summaryWritten = true;
  }

  // highlight artifacts：精选片段（带时间锚点）
  for (const [index, highlight] of understanding.highlights.entries()) {
    await prisma.workspaceCaptureArtifact.upsert({
      where: {
        captureId_kind_artifactKey: { captureId, kind: 'highlight', artifactKey: `lu-${index}` },
      },
      create: {
        captureId,
        sessionId,
        kind: 'highlight',
        artifactKey: `lu-${index}`,
        payloadJson: JSON.stringify({ topicId: `lu-${index}`, ...highlight }),
      },
      update: { sessionId, payloadJson: JSON.stringify({ topicId: `lu-${index}`, ...highlight }) },
    });
    result.highlightCount += 1;
  }

  return result;
}
