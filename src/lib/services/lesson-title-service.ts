/**
 * lesson-title-service — 课堂/收集条目标题生成（服务端）
 *
 * 背景：满列表的「录音 14:32」让检索、Agent 上下文、未来的学习线索
 * 全部建立在零信息标题上（YouNavi 的结论：标题质量直接决定智能选文件准确率）。
 *
 * 标题契约：`主题 · 课程 · M-D`
 *   - 主题必须是内容里的具体名词，≤12 字，能回答"这节课讲了什么"
 *   - 零信息词（录音/课堂/笔记/学习/内容…）直接判不合格
 *   - 宁缺毋滥：不达标宁可保留旧标题（错误比平庸更伤信任）
 *
 * 用户编辑权高于一切自动行为：metadata.titleSource === 'user' 的 capture
 * 自动系统永远不再碰（lock 由 /api/titles/lock 在用户手动改名时写入）。
 */

import prisma from '@/lib/prisma';
import { chat } from '@/lib/services/llm-service';
import { ModelDefaults } from '@/lib/config/app.config';
import { isPlaceholderLessonTitle } from '@/lib/learning/lesson-title-generic';
import { createLogger } from '@/lib/logger';

const log = createLogger('lesson-title');

/**
 * 零信息词。质量门只拒绝**完全由这些词（和虚词）拼成**的主题——
 * 「课堂笔记」「内容总结」「学习」不合格；「机器学习入门」「课程设计」「内容分发网络」
 * 里虽然含有这些字，但剥掉它们之后还剩下具体所指，就是合格的标题。
 * 之前用 includes 一刀切，把「机器学习」这种最常见的课名整个打回，是硬规则替模型判断。
 */
const GENERIC_WORDS = [
  '录音', '课堂', '课程', '上课', '笔记', '学习', '内容', '音频', '视频',
  '讲座', '讲课', '复习', '总结', '材料', '资料', '文件', '记录', '整理',
  '知识点', '要点', '概述', '介绍', '讨论', '讲解', '分享', '汇报',
];
const FUNCTION_CHARS = /[的与和及或之中里这那本次节课堂关于对相关有关以及其]/gu;

/**
 * 提示词要求 12 字以内；门槛放到 16 个**显示宽度**（CJK 记 1，ASCII 记 0.5）——
 * 「AI for AI与Auto Research」按字符数是 24，按宽度只有 13，不该因为混了英文被打回。
 * 模型多写两三个字的具体主题，比退回「课堂录音」好得多。
 */
const TOPIC_MAX_WIDTH = 16;

/** 纯函数：显示宽度（CJK / 全角 1，其余 0.5） */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/u.test(ch) ? 1 : 0.5;
  }
  return width;
}
/** 长课只看开头 3200 字会把「哈喽大家好」的寒暄当成主题；头 / 中 / 尾各取一段 */
const SAMPLE_MAX_CHARS = 12_000;
/** 模型判断这段转录没有可命名的主题时的约定输出 */
const NO_TOPIC_TOKEN = '无';

const LESSON_TOPIC_PROMPT = `你在为一节课的转录内容起一个可检索的主题词。
要求：
- 只输出主题词本身，12 个字以内，不要书名号、引号、句号
- 必须是内容里的具体知识点或主题（如：条件概率与贝叶斯公式、HTTP 缓存协商、闭包与原型链）
- 禁止泛泛的词：录音、课堂、课程、笔记、学习、内容、复习、总结
- 读出来要能回答"这节课讲了什么"
- 给你的转录可能是从课的开头、中段、结尾各取的一段（以 […] 分隔），主题以整节课为准，不要只看开场
- 如果这段转录只是寒暄、闲聊、测试麦克风、环境噪音，或者根本听不出在讲什么，只输出一个字：无。不要硬编一个主题

直接输出主题词，不要任何解释。`;

/** 纯函数：主题词质量门（可单测） */
export function passesTopicQualityGate(raw: string): boolean {
  const topic = raw.trim().replace(/[《》「」'""。.，,；;：:！!？?]/g, '').trim();
  if (!topic) return false;
  if (displayWidth(topic) > TOPIC_MAX_WIDTH) return false;
  // 至少包含一个中日韩字符或字母（防纯数字/纯符号）
  if (!/[\u4e00-\u9fff a-zA-Z]/.test(topic)) return false;
  if (isPlaceholderLessonTitle(topic)) return false;
  // 剥掉零信息词和虚词后还剩东西，才算有具体所指
  let residue = topic;
  for (const word of GENERIC_WORDS) residue = residue.split(word).join('');
  residue = residue.replace(FUNCTION_CHARS, '').replace(/\s+/g, '');
  return residue.length > 0;
}

/**
 * 纯函数：给标题模型的转录样本。短文本原样；长文本取头 / 中 / 尾三段，
 * 让模型看到整节课的走向而不是只看开场白。
 */
export function sampleTranscriptForTopic(text: string, maxChars = SAMPLE_MAX_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const head = Math.floor(maxChars * 0.4);
  const tail = Math.floor(maxChars * 0.3);
  const middle = maxChars - head - tail;
  const midStart = Math.floor((trimmed.length - middle) / 2);
  return [
    trimmed.slice(0, head),
    trimmed.slice(midStart, midStart + middle),
    trimmed.slice(trimmed.length - tail),
  ].join('\n[…]\n');
}

/** 纯函数：组合最终标题（可单测） */
export function composeLessonTitle(params: {
  topic: string;
  courseTitle?: string | null;
  date: Date;
}): string {
  const { topic, courseTitle, date } = params;
  const dateLabel = `${date.getMonth() + 1}-${date.getDate()}`;
  const parts = [topic.trim()];
  // 课程名本身是占位（「课堂录音」）时不拼进标题——否则会得到「主题 · 课堂录音 · 9-5」
  if (courseTitle?.trim() && !isPlaceholderLessonTitle(courseTitle)) parts.push(courseTitle.trim());
  parts.push(dateLabel);
  return parts.join(' · ');
}

/**
 * 判断一个标题是否是零信息默认标题（用于决定是否值得重命名）。
 * 单一判定在 `lib/learning/lesson-title-generic`，这里只是服务端的别名。
 */
export function isGenericLessonTitle(title: string): boolean {
  return isPlaceholderLessonTitle(title);
}

export type LessonTopicResult =
  | { topic: string; reason?: undefined }
  /** 转录太短，是客观状态，下次内容变长再试 */
  | { topic: null; reason: 'short' }
  /** 模型给了主题但不过质量门——是内容本身出不来具体主题，可以打标不再重试 */
  | { topic: null; reason: 'gate'; rejected: string }
  /** 模型调用失败——瞬时故障，不该因此永久放弃这条课 */
  | { topic: null; reason: 'error' };

/** 从转录样本生成主题词，带失败原因（回填据此决定要不要打标） */
export async function generateLessonTopicDetailed(params: {
  transcriptSample: string;
  courseTitle?: string | null;
}): Promise<LessonTopicResult> {
  const sample = sampleTranscriptForTopic(params.transcriptSample);
  if (sample.length < 80) return { topic: null, reason: 'short' };

  try {
    const response = await chat(
      [
        { role: 'system', content: LESSON_TOPIC_PROMPT },
        {
          role: 'user',
          content: `${params.courseTitle ? `课程：${params.courseTitle}\n` : ''}转录内容：\n${sample}`,
        },
      ],
      ModelDefaults.tutorQuick,
      // 标题生成是轻活：显式关思考（V4 默认带思维链，白付延迟和 token）
      { temperature: 0.2, maxTokens: 40, thinking: false },
    );
    const topic = response.content.trim().split('\n')[0].trim().replace(/[。.]$/, '');
    if (topic === NO_TOPIC_TOKEN) {
      log.info('lesson topic: model judged no nameable topic');
      return { topic: null, reason: 'gate', rejected: topic };
    }
    if (passesTopicQualityGate(topic)) return { topic };
    log.info('lesson topic rejected by quality gate', { rejected: topic.slice(0, 40) });
    return { topic: null, reason: 'gate', rejected: topic };
  } catch (error) {
    log.warn('generate lesson topic failed', { error: String(error) });
    return { topic: null, reason: 'error' };
  }
}

/** 从转录样本生成主题词；失败/不达标返回 null（调用方保留旧标题） */
export async function generateLessonTopic(params: {
  transcriptSample: string;
  courseTitle?: string | null;
}): Promise<string | null> {
  return (await generateLessonTopicDetailed(params)).topic;
}

// ── capture 标题读写（含用户锁保护）──────────────────────────────

function readTitleSource(metadataJson: string | null): string | null {
  try {
    const metadata = JSON.parse(metadataJson || '{}') as Record<string, unknown>;
    return typeof metadata.titleSource === 'string' ? metadata.titleSource : null;
  } catch {
    return null;
  }
}

/** 自动重命名：仅当标题未被用户锁定。返回是否写入 */
export async function retitleCaptureIfUnlocked(params: {
  userId: string;
  captureId: string;
  newTitle: string;
}): Promise<'retitled' | 'locked' | 'not_found'> {
  const capture = await prisma.workspaceCapture.findFirst({
    where: { id: params.captureId, userId: params.userId, status: { not: 'deleted' } },
    select: { id: true, metadataJson: true },
  });
  if (!capture) return 'not_found';
  if (readTitleSource(capture.metadataJson) === 'user') return 'locked';

  const metadata = JSON.parse(capture.metadataJson || '{}') as Record<string, unknown>;
  await prisma.workspaceCapture.update({
    where: { id: capture.id },
    data: {
      title: params.newTitle,
      metadataJson: JSON.stringify({ ...metadata, titleSource: 'auto' }),
    },
  });
  return 'retitled';
}

/** 用户手动改名：写标题并加锁，自动系统从此不再碰这条 capture */
export async function lockCaptureTitleByUser(params: {
  userId: string;
  sessionId: string;
  title: string;
}): Promise<boolean> {
  // sessionId → capture：live 录课的 sessionId 存在 metadataJson 里（SQLite LIKE 匹配）
  const capture = await prisma.workspaceCapture.findFirst({
    where: {
      userId: params.userId,
      status: { not: 'deleted' },
      metadataJson: { contains: `"sessionId":"${params.sessionId}"` },
    },
    select: { id: true, metadataJson: true },
  });
  if (!capture) return false;

  const metadata = JSON.parse(capture.metadataJson || '{}') as Record<string, unknown>;
  await prisma.workspaceCapture.update({
    where: { id: capture.id },
    data: {
      title: params.title,
      metadataJson: JSON.stringify({ ...metadata, titleSource: 'user' }),
    },
  });
  return true;
}

/**
 * 回填失败打标的 key。带版本：质量门放宽（v2，2026-09）之前被 includes 黑名单误杀的
 * 候选（`titleBackfillFailedAt`）不再被排除，这一轮会重新拿到机会。
 */
const BACKFILL_FAILED_KEY = 'titleBackfillGateV2FailedAt';

/** 存量回填：把零信息默认标题（课堂录音 / 录音 HH:MM / 屏幕截图…）静默重命名，单次最多 limit 条 */
export async function backfillGenericLessonTitles(params: {
  userId: string;
  limit?: number;
  /** 扫描窗口（按 createdAt 倒序取多少条来筛零信息标题）。API 路径默认 limit×6；全量脚本传大值 */
  scanLimit?: number;
}): Promise<{ scanned: number; retitled: number; skipped: number }> {
  const limit = params.limit ?? 10;
  const candidates = await prisma.workspaceCapture.findMany({
    where: {
      userId: params.userId,
      status: { not: 'deleted' },
      normalizedText: { not: null },
      // 内容本身出不来主题的候选打标排除：不对同一批坏候选无限重试 LLM
      NOT: { metadataJson: { contains: `"${BACKFILL_FAILED_KEY}"` } },
    },
    select: { id: true, title: true, normalizedText: true, occurredAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    // 多取一些：零信息判断在 JS 侧做（录音/截图/纯数字文件名…），刷掉后仍能凑满 limit
    take: params.scanLimit ?? limit * 6,
  });

  let retitled = 0;
  let skipped = 0;
  for (const capture of candidates) {
    if (retitled >= limit) break;
    if (!isGenericLessonTitle(capture.title)) continue;
    const sample = (capture.normalizedText || '').trim();
    if (sample.length < 80) {
      skipped += 1;
      continue; // 文本太短是客观状态，下节课内容变长后再试，不打标
    }
    const result = await generateLessonTopicDetailed({ transcriptSample: sample });
    if (!result.topic) {
      skipped += 1;
      // 只有"模型看了内容也出不来具体主题"才打标；模型调用失败是瞬时的，下次再试
      if (result.reason === 'gate') await markBackfillFailed(capture.id);
      continue;
    }
    const title = composeLessonTitle({
      topic: result.topic,
      date: capture.occurredAt || capture.createdAt,
    });
    const outcome = await retitleCaptureIfUnlocked({
      userId: params.userId,
      captureId: capture.id,
      newTitle: title,
    });
    if (outcome === 'retitled') retitled += 1;
    else skipped += 1;
  }
  return { scanned: candidates.length, retitled, skipped };
}

/** 回填失败打标（下次扫描排除，防无限重试） */
async function markBackfillFailed(captureId: string): Promise<void> {
  try {
    const capture = await prisma.workspaceCapture.findUnique({
      where: { id: captureId },
      select: { metadataJson: true },
    });
    const metadata = JSON.parse(capture?.metadataJson || '{}') as Record<string, unknown>;
    await prisma.workspaceCapture.update({
      where: { id: captureId },
      data: {
        metadataJson: JSON.stringify({
          ...metadata,
          [BACKFILL_FAILED_KEY]: new Date().toISOString(),
        }),
      },
    });
  } catch {
    // 打标失败不阻塞主流程
  }
}
