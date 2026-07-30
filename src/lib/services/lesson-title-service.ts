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
import { createLogger } from '@/lib/logger';

const log = createLogger('lesson-title');

/** 零信息词：命中即不合格（这些词不能提供任何检索价值） */
const BANNED_GENERIC_WORDS = [
  '录音', '课堂', '课程', '上课', '笔记', '学习', '内容', '音频', '视频',
  '讲座', '讲课', '复习', '总结', '材料', '资料', '文件', '记录', '整理',
];

const TOPIC_MAX_CHARS = 12;
const SAMPLE_MAX_CHARS = 3200;

const LESSON_TOPIC_PROMPT = `你在为一节课的转录内容起一个可检索的主题词。
要求：
- 只输出主题词本身，12 个字以内，不要书名号、引号、句号
- 必须是内容里的具体知识点或主题（如：条件概率与贝叶斯公式、HTTP 缓存协商、闭包与原型链）
- 禁止泛泛的词：录音、课堂、课程、笔记、学习、内容、复习、总结
- 读出来要能回答"这节课讲了什么"

直接输出主题词，不要任何解释。`;

/** 纯函数：主题词质量门（可单测） */
export function passesTopicQualityGate(raw: string): boolean {
  const topic = raw.trim().replace(/[《》「」'""。.，,；;：:！!？?]/g, '');
  if (!topic) return false;
  if ([...topic].length > TOPIC_MAX_CHARS) return false;
  if (BANNED_GENERIC_WORDS.some((word) => topic.includes(word))) return false;
  // 至少包含一个中日韩字符或字母（防纯数字/纯符号）
  if (!/[\u4e00-\u9fff a-zA-Z]/.test(topic)) return false;
  return true;
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
  if (courseTitle?.trim()) parts.push(courseTitle.trim());
  parts.push(dateLabel);
  return parts.join(' · ');
}

/** 纯函数：判断一个标题是否是零信息默认标题（可单测，用于决定是否值得重命名） */
export function isGenericLessonTitle(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) return true;
  if (/^录音\s*\d{1,2}:\d{2}/.test(trimmed)) return true;
  if (/^屏幕截图/.test(trimmed)) return true;
  // 纯数字长串：时间戳文件名（如 1785177988742）或 ID 被误当标题
  if (/^\d{6,}$/.test(trimmed)) return true;
  return BANNED_GENERIC_WORDS.includes(trimmed);
}

/** 从转录样本生成主题词；失败/不达标返回 null（调用方保留旧标题） */
export async function generateLessonTopic(params: {
  transcriptSample: string;
  courseTitle?: string | null;
}): Promise<string | null> {
  const sample = params.transcriptSample.trim().slice(0, SAMPLE_MAX_CHARS);
  if (sample.length < 80) return null;

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
      { temperature: 0.2, maxTokens: 40 },
    );
    const topic = response.content.trim().split('\n')[0].trim();
    return passesTopicQualityGate(topic) ? topic : null;
  } catch (error) {
    log.warn('generate lesson topic failed', { error: String(error) });
    return null;
  }
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

/** 存量回填：把零信息默认标题（录音 HH:MM / 屏幕截图…）静默重命名，单次最多 limit 条 */
export async function backfillGenericLessonTitles(params: {
  userId: string;
  limit?: number;
}): Promise<{ scanned: number; retitled: number; skipped: number }> {
  const limit = params.limit ?? 10;
  const candidates = await prisma.workspaceCapture.findMany({
    where: {
      userId: params.userId,
      status: { not: 'deleted' },
      normalizedText: { not: null },
      // 失败过的候选打标排除：不对同一批坏候选无限重试 LLM
      NOT: { metadataJson: { contains: '"titleBackfillFailedAt"' } },
    },
    select: { id: true, title: true, normalizedText: true, occurredAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: limit * 6, // 多取一些：零信息判断在 JS 侧做（录音/截图/纯数字文件名…），刷掉后仍能凑满 limit
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
    const topic = await generateLessonTopic({ transcriptSample: sample });
    if (!topic) {
      skipped += 1;
      // 质量门不过/LLM 失败：打标，避免每次进应用都对同一候选重复打 LLM
      await markBackfillFailed(capture.id);
      continue;
    }
    const title = composeLessonTitle({
      topic,
      date: capture.occurredAt || capture.createdAt,
    });
    const result = await retitleCaptureIfUnlocked({
      userId: params.userId,
      captureId: capture.id,
      newTitle: title,
    });
    if (result === 'retitled') retitled += 1;
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
          titleBackfillFailedAt: new Date().toISOString(),
        }),
      },
    });
  } catch {
    // 打标失败不阻塞主流程
  }
}
