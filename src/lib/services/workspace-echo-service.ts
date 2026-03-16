import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import prisma from '@/lib/prisma';
import { generateCommonstackEcho, isCommonstackEchoConfigured } from '@/lib/services/commonstack-echo-service';
import workspaceService from '@/lib/services/workspace-service';

export const DAILY_ECHO_KIND = 'daily_return_reason';
export const DAILY_ECHO_PROMPT_VERSION = 'echo-v1';

const ECHO_TIMEZONE = 'Asia/Shanghai';
const LOOKBACK_DAYS = 7;
const LOOKBACK_FETCH_LIMIT = 80;
const LOOKBACK_CONTEXT_LIMIT = 24;
const MAX_TODAY_CAPTURES = 6;
const MAX_RECENT_CAPTURES = 8;
const MAX_RECENT_ECHOES = 3;

type CaptureLike = {
  id: string;
  sourceKey: string;
  role: string;
  contentType: string;
  title: string;
  previewText: string | null;
  normalizedText: string | null;
  tutorContext: string | null;
  occurredAt: Date | null;
  createdAt: Date;
};

type EchoLike = {
  id: string;
  title: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
};

const DAILY_ECHO_SELECT = {
  id: true,
  sourceKey: true,
  kind: true,
  generatedDateKey: true,
  title: true,
  body: true,
  chipsJson: true,
  metadataJson: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WorkspaceEchoSelect;

type DailyEchoRecord = Prisma.WorkspaceEchoGetPayload<{
  select: typeof DAILY_ECHO_SELECT;
}>;

export interface EchoPromptCaptureItem {
  id: string;
  sourceKey: string;
  type: string;
  role: string;
  title: string;
  text: string;
  occurredAt: string;
}

export interface EchoPromptPackage {
  todayCaptures: EchoPromptCaptureItem[];
  recentCaptures: EchoPromptCaptureItem[];
  recentEchoes: Array<{ title: string; body: string }>;
  activityHints: {
    streakDays: number;
    topContentTypes: string[];
    hasQuestionLikeCapture: boolean;
    hasPrimaryAudio: boolean;
    hasSupportMaterial: boolean;
    captureCountToday: number;
  };
}

export interface EchoRecommendation {
  title: string;
  body: string;
}

export interface EchoMemorySummary {
  sourceCaptureCount: number;
  todayCaptureCount: number;
  recentCaptureCount: number;
}

interface EchoMemorySnapshot extends EchoMemorySummary {
  snapshotAt: string;
  sourceCaptureIds: string[];
  sourceKeys: string[];
  todayCaptureIds: string[];
  recentCaptureIds: string[];
  todayCaptures: EchoPromptCaptureItem[];
  recentCaptures: EchoPromptCaptureItem[];
  activityHints: EchoPromptPackage['activityHints'];
}

interface EchoMetadataPayload {
  trigger?: string;
  forced?: boolean;
  promptVersion?: string;
  todayCaptureCount?: number;
  recentCaptureCount?: number;
  recentEchoCount?: number;
  similarityToRecent?: number;
  error?: string;
  qualityWarning?: string;
  recommendations?: EchoRecommendation[];
  memory?: EchoMemorySnapshot;
  promptPackage?: EchoPromptPackage;
  prompt?: string;
  rawResponse?: string;
  parseResult?: {
    title: string;
    body: string;
    recommendations?: EchoRecommendation[];
  } | null;
}

export interface DailyEchoRefreshResult {
  success: boolean;
  skipped?: boolean;
  forced?: boolean;
  reason?: string;
  echo?: {
    id: string;
    sourceKey: string;
    kind: string;
    generatedDateKey: string | null;
    title: string;
    body: string;
    chips: string[];
    recommendations: EchoRecommendation[];
    memory: EchoMemorySummary | null;
    sourceCaptureIds: string[];
    sourceKeys: string[];
    createdAt: string;
    updatedAt: string;
  };
  debug?: {
    model?: string;
    promptVersion: string;
    todayCaptureCount: number;
    recentCaptureCount: number;
    recentEchoCount: number;
    similarityToRecent: number;
    prompt?: string;
    promptPackage?: EchoPromptPackage;
    rawResponse?: string;
    parseResult?: { title: string; body: string; recommendations?: EchoRecommendation[] } | null;
  };
}

function compactText(value: string, limit: number): string {
  const normalized = String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) return '';
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

function normalizeEchoText(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s，。！？、；：“”"'‘’（）()\[\]{}<>《》\-_.!?;:,/\\|]/g, '');
}

function longestCommonSubstringRatio(left: string, right: string): number {
  const a = normalizeEchoText(left);
  const b = normalizeEchoText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  const dp = new Array(shorter.length + 1).fill(0);
  let maxLength = 0;

  for (let i = 1; i <= longer.length; i += 1) {
    for (let j = shorter.length; j >= 1; j -= 1) {
      if (longer[i - 1] === shorter[j - 1]) {
        dp[j] = dp[j - 1] + 1;
        if (dp[j] > maxLength) {
          maxLength = dp[j];
        }
      } else {
        dp[j] = 0;
      }
    }
  }

  return maxLength / shorter.length;
}

function getShanghaiParts(date: Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: ECHO_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
}

export function getUtc8DateKey(date: Date = new Date()): string {
  const parts = getShanghaiParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getUtc8DayStart(date: Date = new Date()): Date {
  return new Date(`${getUtc8DateKey(date)}T00:00:00+08:00`);
}

function getLookbackStart(date: Date = new Date()): Date {
  return new Date(getUtc8DayStart(date).getTime() - (LOOKBACK_DAYS - 1) * 24 * 60 * 60 * 1000);
}

export function buildDailyEchoSourceKey(workspaceId: string, dateKey: string): string {
  return `daily:${workspaceId}:${dateKey}`;
}

function resolveCaptureTimestamp(item: CaptureLike): Date {
  return item.occurredAt || item.createdAt;
}

export function selectRecentPromptCaptures<T extends CaptureLike>(captures: T[], limit: number = LOOKBACK_CONTEXT_LIMIT): T[] {
  return [...captures]
    .sort((left, right) => resolveCaptureTimestamp(right).getTime() - resolveCaptureTimestamp(left).getTime())
    .slice(0, limit);
}

function buildCaptureText(item: CaptureLike): string {
  return compactText(item.tutorContext || item.normalizedText || item.previewText || item.title, 420);
}

function isQuestionLikeText(value: string): boolean {
  return /(为什么|怎么|不会|困惑|卡住|没懂|不懂|疑问|\?)/.test(value || '');
}

function getContentTypeLabel(type: string): string {
  if (type === 'audio') return '课堂原声';
  if (type === 'video') return '视频材料';
  if (type === 'document') return '文档材料';
  if (type === 'image') return '图片线索';
  if (type === 'link') return '外部链接';
  return '随手记录';
}

function summarizeTopContentTypes(captures: EchoPromptCaptureItem[]): string[] {
  const counts = new Map<string, number>();
  for (const item of captures) {
    counts.set(item.type, (counts.get(item.type) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type]) => getContentTypeLabel(type));
}

function computeCaptureStreak(captures: CaptureLike[], now: Date): number {
  const dayKeys = new Set(captures.map((item) => getUtc8DateKey(resolveCaptureTimestamp(item))));
  const cursor = getUtc8DayStart(now);
  let streak = 0;

  while (dayKeys.has(getUtc8DateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

export function buildEchoPromptPackage(params: {
  captures: CaptureLike[];
  recentEchoes: EchoLike[];
  now?: Date;
}): EchoPromptPackage {
  const now = params.now || new Date();
  const todayKey = getUtc8DateKey(now);
  const sortedCaptures = [...params.captures].sort(
    (a, b) => resolveCaptureTimestamp(a).getTime() - resolveCaptureTimestamp(b).getTime()
  );

  const mappedCaptures = sortedCaptures.map((item) => ({
    id: item.id,
    sourceKey: item.sourceKey,
    type: item.contentType,
    role: item.role,
    title: compactText(item.title, 80),
    text: buildCaptureText(item),
    occurredAt: resolveCaptureTimestamp(item).toISOString(),
  }));

  const todayCaptures = mappedCaptures
    .filter((item) => getUtc8DateKey(new Date(item.occurredAt)) === todayKey)
    .slice(-MAX_TODAY_CAPTURES);

  const todayIds = new Set(todayCaptures.map((item) => item.id));
  const recentCaptures = mappedCaptures
    .filter((item) => !todayIds.has(item.id))
    .slice(-MAX_RECENT_CAPTURES);

  const recentEchoes = [...params.recentEchoes]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, MAX_RECENT_ECHOES)
    .map((item) => ({
      title: compactText(item.title, 80),
      body: compactText(item.body, 220),
    }));

  const visibleCaptures = [...todayCaptures, ...recentCaptures];

  return {
    todayCaptures,
    recentCaptures,
    recentEchoes,
    activityHints: {
      streakDays: computeCaptureStreak(params.captures, now),
      topContentTypes: summarizeTopContentTypes(visibleCaptures),
      hasQuestionLikeCapture: isQuestionLikeText(todayCaptures.map((item) => item.text).join('\n')),
      hasPrimaryAudio: todayCaptures.some((item) => item.role === 'primary' && item.type === 'audio'),
      hasSupportMaterial: todayCaptures.some(
        (item) => item.role === 'support' && ['document', 'image', 'link', 'video'].includes(item.type)
      ),
      captureCountToday: todayCaptures.length,
    },
  };
}

export function shouldSkipEchoGeneration(promptPackage: EchoPromptPackage): boolean {
  const totalCaptureCount = promptPackage.todayCaptures.length + promptPackage.recentCaptures.length;
  const totalTextLength = [...promptPackage.todayCaptures, ...promptPackage.recentCaptures]
    .map((item) => item.text)
    .join('\n')
    .trim().length;

  return promptPackage.todayCaptures.length === 0 || (totalCaptureCount < 2 && totalTextLength < 80);
}

function renderCaptureBlock(title: string, captures: EchoPromptCaptureItem[]): string {
  if (captures.length === 0) {
    return `${title}\n- 无`;
  }

  return [
    title,
    ...captures.map((item, index) =>
      [
        `- [线索${index + 1}] 类型：${getContentTypeLabel(item.type)}；角色：${item.role === 'primary' ? '主线' : '补充'}`,
        `  标题：${item.title}`,
        `  内容：${item.text || '（无正文，仅标题或来源）'}`,
      ].join('\n')
    ),
  ].join('\n');
}

export function buildEchoPrompt(promptPackage: EchoPromptPackage): string {
  const activityLine = [
    promptPackage.activityHints.streakDays > 0 ? `最近已连续收集 ${promptPackage.activityHints.streakDays} 天` : '',
    promptPackage.activityHints.topContentTypes.length > 0
      ? `最近常收：${promptPackage.activityHints.topContentTypes.join('、')}`
      : '',
    promptPackage.activityHints.hasPrimaryAudio ? '今天包含课堂原声' : '',
    promptPackage.activityHints.hasSupportMaterial ? '今天也补了材料或线索' : '',
    promptPackage.activityHints.hasQuestionLikeCapture ? '今天带着明确问题感' : '',
  ]
    .filter(Boolean)
    .join('；');

  const recentEchoBlock =
    promptPackage.recentEchoes.length > 0
      ? [
          '最近几天的回声（只用于避免重复措辞和角度，不要照着改写）：',
          ...promptPackage.recentEchoes.map((item, index) => `- [回声${index + 1}] ${item.title}｜${item.body}`),
        ].join('\n')
      : '最近几天的回声：\n- 无';

  return [
    '输出纯 JSON：{"title": string, "body": string, "recommendations": Array<{ "title": string, "body": string }>}',
    '',
    '你是一位敏锐但克制的学习回声编辑。',
    '一个学习者正在用聊天式收集流记录课堂原话、困惑、材料和零碎线索。',
    '你的任务不是总结内容，也不是讲解知识；你要从真实学习痕迹里听出一条正在发酵的线索，把它写成一条轻轻的“回来理由”，让用户今天愿意继续往里加一点。',
    '你判断输出好坏的标准不是“像不像一段完整文案”，而是：它是否真的激发了继续收集的欲望，是否帮助用户看见自己此刻更需要什么。',
    '同时，如果有合适的外延方向，请给 1 到 2 条生成式推荐：它们应该贴着当前线索稍微外扩半步，帮助用户看见自己暂时没注意到、但可能真正需要的下一步。',
    '',
    '请把重点放在：',
    '- 今天最值得继续收下去的那条线索，让用户看见自己正在形成什么理解路径，或反复靠近什么问题',
    '- 用户此刻可能在意的理解方向、卡住的感觉、真正想推进的意图',
    '- 推荐必须服务于个人成长和整体意图，不是给更多信息，而是给更值得补收的方向',
    '- 推荐可以是更进一步的问题、互补视角、反例、邻近领域、现实场景、跳出信息茧房的方向，但都必须贴着当前线索',
    '- 轻、贴近、克制的语气',
    '',
    '避免：',
    '- 把它写成课堂摘要、知识讲解或复习清单',
    '- 系统播报、运营 push、画像判断',
    '- 复述大段原文',
    '- 推荐完全无关、像信息流推送、热点分发或硬塞资源名',
    '- 只满足表面主题，不去判断用户现在真正缺什么反馈',
    '',
    '如果线索更像科研灵感、内容选题、产品思考或职业观察，不要机械分类；请顺着它的潜在意图，判断用户更需要推进、补全、对比、验证、连接现实，还是跳出原有视角。',
    '',
    activityLine ? `活跃信号：${activityLine}` : '',
    renderCaptureBlock('今天新增的收集：', promptPackage.todayCaptures),
    '',
    renderCaptureBlock('近 7 天里更早的相关上下文：', promptPackage.recentCaptures),
    '',
    recentEchoBlock,
    '',
    '没有合适推荐时，recommendations 返回空数组。只返回 JSON，不要 markdown，不要额外解释。',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildEchoChips(promptPackage: EchoPromptPackage): string[] {
  const chips: string[] = [];
  const visibleCaptures = [...promptPackage.todayCaptures, ...promptPackage.recentCaptures];

  if (visibleCaptures.some((item) => item.type === 'audio')) chips.push('课堂原声');
  if (visibleCaptures.some((item) => item.type === 'document')) chips.push('文档材料');
  if (visibleCaptures.some((item) => item.type === 'video')) chips.push('视频材料');
  if (visibleCaptures.some((item) => item.type === 'image')) chips.push('图片线索');
  if (visibleCaptures.some((item) => item.type === 'link')) chips.push('外部链接');
  if (promptPackage.activityHints.hasQuestionLikeCapture) chips.push('带着问题');
  if (promptPackage.activityHints.hasPrimaryAudio && promptPackage.activityHints.hasSupportMaterial) {
    chips.push('同一条线索');
  }

  return Array.from(new Set(chips)).slice(0, 3);
}

export function normalizeEchoOutput(input: {
  title: string;
  body: string;
  recommendations?: Array<Partial<EchoRecommendation>>;
}) {
  const clean = (value: string) =>
    String(value || '')
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  return {
    title: clean(input.title),
    body: clean(input.body),
    recommendations: normalizeEchoRecommendations(input.recommendations),
  };
}

function looksLikeSummary(text: string): boolean {
  return /(本节课|这节课|主要讲了|围绕|总结来看|概括来说|重点介绍|内容主要)/.test(text);
}

function looksLikeSystemText(text: string): boolean {
  return /(系统|正在|已接入|已收下|已进入|可继续用于|后续会参与)/.test(text);
}

export function evaluateEchoQuality(params: {
  candidate: { title: string; body: string };
  recentEchoes: Array<{ title: string; body: string }>;
}) {
  const title = params.candidate.title.trim();
  const body = params.candidate.body.trim();
  const combined = `${title} ${body}`.trim();

  let maxSimilarity = 0;
  for (const echo of params.recentEchoes) {
    maxSimilarity = Math.max(
      maxSimilarity,
      longestCommonSubstringRatio(combined, `${echo.title} ${echo.body}`.trim())
    );
  }

  const tooShort = title.length < 4 || body.length < 12;
  const tooSimilar = maxSimilarity >= 0.72;
  const lowSignal = looksLikeSummary(body) || looksLikeSystemText(body);

  return {
    valid: !tooShort && !tooSimilar && !lowSignal,
    maxSimilarity,
    reason: tooShort ? 'too-short' : tooSimilar ? 'too-similar' : lowSignal ? 'low-signal' : '',
  };
}

function parseChips(value?: string | null): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((chip) => String(chip)).filter(Boolean).slice(0, 4);
  } catch {
    return [];
  }
}

function normalizeEchoRecommendation(item: Partial<EchoRecommendation>): EchoRecommendation | null {
  const title = String(item.title || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const body = String(item.body || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!title || !body) return null;
  return { title, body };
}

function normalizeEchoRecommendations(input?: Array<Partial<EchoRecommendation>> | null): EchoRecommendation[] {
  if (!Array.isArray(input)) return [];

  const unique: EchoRecommendation[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const normalized = normalizeEchoRecommendation(item);
    if (!normalized) continue;
    const key = `${normalized.title}::${normalized.body}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
    if (unique.length >= 2) break;
  }
  return unique;
}

function buildEchoMemorySnapshot(promptPackage: EchoPromptPackage): EchoMemorySnapshot {
  const sourceItems = [...promptPackage.todayCaptures, ...promptPackage.recentCaptures];

  return {
    sourceCaptureCount: sourceItems.length,
    todayCaptureCount: promptPackage.todayCaptures.length,
    recentCaptureCount: promptPackage.recentCaptures.length,
    snapshotAt: new Date().toISOString(),
    sourceCaptureIds: sourceItems.map((item) => item.id),
    sourceKeys: sourceItems.map((item) => item.sourceKey),
    todayCaptureIds: promptPackage.todayCaptures.map((item) => item.id),
    recentCaptureIds: promptPackage.recentCaptures.map((item) => item.id),
    todayCaptures: promptPackage.todayCaptures,
    recentCaptures: promptPackage.recentCaptures,
    activityHints: promptPackage.activityHints,
  };
}

function normalizeEchoMemorySummary(value?: Partial<EchoMemorySummary> | null): EchoMemorySummary | null {
  if (!value) return null;

  const sourceCaptureCount = Number(value.sourceCaptureCount);
  const todayCaptureCount = Number(value.todayCaptureCount);
  const recentCaptureCount = Number(value.recentCaptureCount);

  if (!Number.isFinite(sourceCaptureCount) || sourceCaptureCount <= 0) {
    return null;
  }

  return {
    sourceCaptureCount,
    todayCaptureCount: Number.isFinite(todayCaptureCount) ? Math.max(0, todayCaptureCount) : 0,
    recentCaptureCount: Number.isFinite(recentCaptureCount) ? Math.max(0, recentCaptureCount) : 0,
  };
}

export function parseEchoMetadata(value?: string | null): EchoMetadataPayload | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const payload = parsed as EchoMetadataPayload;
    const normalizedMemory = normalizeEchoMemorySummary(payload.memory);
    return {
      ...payload,
      recommendations: normalizeEchoRecommendations(payload.recommendations),
      memory: payload.memory && normalizedMemory ? { ...payload.memory, ...normalizedMemory } : undefined,
      parseResult: payload.parseResult
        ? {
            title: String(payload.parseResult.title || ''),
            body: String(payload.parseResult.body || ''),
            recommendations: normalizeEchoRecommendations(payload.parseResult.recommendations),
          }
        : null,
    };
  } catch {
    return null;
  }
}

export function getEchoSummaryMetadata(value?: string | null): {
  recommendations: EchoRecommendation[];
  memory: EchoMemorySummary | null;
} {
  const metadata = parseEchoMetadata(value);
  return {
    recommendations: normalizeEchoRecommendations(metadata?.recommendations),
    memory: normalizeEchoMemorySummary(metadata?.memory),
  };
}

function toEchoSummary(item: {
  id: string;
  sourceKey: string;
  kind: string | null;
  generatedDateKey: string | null;
  title: string;
  body: string;
  chipsJson: string | null;
  metadataJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const parsedMetadata = parseEchoMetadata(item.metadataJson);
  const metadata = getEchoSummaryMetadata(item.metadataJson);

  return {
    id: item.id,
    sourceKey: item.sourceKey,
    kind: item.kind || DAILY_ECHO_KIND,
    generatedDateKey: item.generatedDateKey,
    title: item.title,
    body: item.body,
    chips: parseChips(item.chipsJson),
    recommendations: metadata.recommendations,
    memory: metadata.memory,
    sourceCaptureIds: Array.isArray(parsedMetadata?.memory?.sourceCaptureIds)
      ? parsedMetadata!.memory!.sourceCaptureIds.filter((value): value is string => typeof value === 'string' && Boolean(value))
      : [],
    sourceKeys: Array.isArray(parsedMetadata?.memory?.sourceKeys)
      ? parsedMetadata!.memory!.sourceKeys.filter((value): value is string => typeof value === 'string' && Boolean(value))
      : [],
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function buildAutoMetadata(params: {
  trigger: string;
  forced: boolean;
  promptPackage: EchoPromptPackage;
  similarityToRecent?: number;
  error?: string;
  qualityWarning?: string;
  recommendations?: EchoRecommendation[];
}) {
  return {
    trigger: params.trigger,
    forced: params.forced,
    promptVersion: DAILY_ECHO_PROMPT_VERSION,
    todayCaptureCount: params.promptPackage.todayCaptures.length,
    recentCaptureCount: params.promptPackage.recentCaptures.length,
    recentEchoCount: params.promptPackage.recentEchoes.length,
    similarityToRecent: params.similarityToRecent ?? 0,
    error: params.error,
    qualityWarning: params.qualityWarning,
    recommendations: normalizeEchoRecommendations(params.recommendations),
    memory: buildEchoMemorySnapshot(params.promptPackage),
  };
}

function buildPendingEchoMetadata(params: {
  trigger: string;
  promptPackage: EchoPromptPackage;
}) {
  return JSON.stringify(
    buildAutoMetadata({
      trigger: params.trigger,
      forced: false,
      promptPackage: params.promptPackage,
    })
  );
}

async function getDailyEchoRecord(sourceKey: string): Promise<DailyEchoRecord | null> {
  return prisma.workspaceEcho.findUnique({
    where: { sourceKey },
    select: DAILY_ECHO_SELECT,
  });
}

async function claimAutoEchoGenerationSlot(params: {
  existing: DailyEchoRecord | null;
  workspaceId: string;
  sourceKey: string;
  generatedDateKey: string;
  model: string | null;
  trigger: string;
  promptPackage: EchoPromptPackage;
  chips: string[];
}): Promise<{
  acquired: boolean;
  current: DailyEchoRecord | null;
}> {
  const metadataJson = buildPendingEchoMetadata({
    trigger: params.trigger,
    promptPackage: params.promptPackage,
  });

  if (params.existing?.status === 'active' || params.existing?.status === 'pending') {
    return {
      acquired: false,
      current: params.existing,
    };
  }

  if (params.existing?.status === 'failed') {
    const result = await prisma.workspaceEcho.updateMany({
      where: {
        sourceKey: params.sourceKey,
        status: 'failed',
      },
      data: {
        workspaceId: params.workspaceId,
        kind: DAILY_ECHO_KIND,
        generatedDateKey: params.generatedDateKey,
        model: params.model,
        promptVersion: DAILY_ECHO_PROMPT_VERSION,
        title: '今日回声',
        body: '正在听今天的线索。',
        chipsJson: JSON.stringify(params.chips),
        metadataJson,
        status: 'pending',
      },
    });

    if (result.count > 0) {
      return {
        acquired: true,
        current: await getDailyEchoRecord(params.sourceKey),
      };
    }

    return {
      acquired: false,
      current: await getDailyEchoRecord(params.sourceKey),
    };
  }

  try {
    const now = new Date();
    const inserted = await prisma.$executeRaw`
      INSERT OR IGNORE INTO "WorkspaceEcho" (
        "id",
        "workspaceId",
        "sourceKey",
        "kind",
        "generatedDateKey",
        "model",
        "promptVersion",
        "title",
        "body",
        "chipsJson",
        "metadataJson",
        "status",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${randomUUID()},
        ${params.workspaceId},
        ${params.sourceKey},
        ${DAILY_ECHO_KIND},
        ${params.generatedDateKey},
        ${params.model},
        ${DAILY_ECHO_PROMPT_VERSION},
        ${'今日回声'},
        ${'正在听今天的线索。'},
        ${JSON.stringify(params.chips)},
        ${metadataJson},
        ${'pending'},
        ${now},
        ${now}
      )
    `;

    if (!inserted) {
      return {
        acquired: false,
        current: await getDailyEchoRecord(params.sourceKey),
      };
    }

    return {
      acquired: true,
      current: await getDailyEchoRecord(params.sourceKey),
    };
  } catch (error) {
    throw error;
  }
}

export const workspaceEchoService = {
  async getDailyEchoStatusForWorkspace(workspaceId: string, now: Date = new Date()) {
    const generatedDateKey = getUtc8DateKey(now);
    const sourceKey = buildDailyEchoSourceKey(workspaceId, generatedDateKey);
    const existing = await prisma.workspaceEcho.findUnique({
      where: { sourceKey },
      select: {
        status: true,
      },
    });

    return {
      sourceKey,
      generatedDateKey,
      status: existing?.status || 'missing',
    };
  },

  async refreshDailyEchoForUser(
    userId: string,
    options: {
      force?: boolean;
      includeDebug?: boolean;
      trigger?: string;
      now?: Date;
    } = {}
  ): Promise<DailyEchoRefreshResult> {
    const workspace = await workspaceService.ensureDefaultWorkspace(userId);
    if (!workspace) {
      return {
        success: false,
        skipped: true,
        forced: Boolean(options.force),
        reason: 'workspace-missing',
      };
    }

    return this.refreshDailyEchoForWorkspace(workspace.id, options);
  },

  async refreshDailyEchoForWorkspace(
    workspaceId: string,
    options: {
      force?: boolean;
      includeDebug?: boolean;
      trigger?: string;
      now?: Date;
    } = {}
  ): Promise<DailyEchoRefreshResult> {
    const now = options.now || new Date();
    const force = Boolean(options.force);
    const includeDebug = Boolean(options.includeDebug);
    const generatedDateKey = getUtc8DateKey(now);
    const sourceKey = buildDailyEchoSourceKey(workspaceId, generatedDateKey);
    const trigger = options.trigger || 'capture';

    if (!isCommonstackEchoConfigured()) {
      return {
        success: false,
        skipped: true,
        forced: force,
        reason: 'config-missing',
      };
    }

    const existing = await getDailyEchoRecord(sourceKey);

    if (!force && (existing?.status === 'active' || existing?.status === 'pending')) {
      return {
        success: true,
        skipped: true,
        forced: false,
        reason: existing.status,
        echo: existing.status === 'active' ? toEchoSummary(existing) : undefined,
      };
    }

    const lookbackStart = getLookbackStart(now);
    const recentCaptureRows = await prisma.workspaceCapture.findMany({
      where: {
        workspaceId,
        status: 'active',
        OR: [{ occurredAt: { gte: lookbackStart } }, { occurredAt: null, createdAt: { gte: lookbackStart } }],
      },
      orderBy: [{ createdAt: 'desc' }],
      take: LOOKBACK_FETCH_LIMIT,
    });
    const captures = selectRecentPromptCaptures(recentCaptureRows, LOOKBACK_CONTEXT_LIMIT);

    const recentEchoes = await prisma.workspaceEcho.findMany({
      where: {
        workspaceId,
        kind: DAILY_ECHO_KIND,
        status: 'active',
        generatedDateKey: { not: generatedDateKey },
      },
      orderBy: { updatedAt: 'desc' },
      take: MAX_RECENT_ECHOES,
    });

    const promptPackage = buildEchoPromptPackage({ captures, recentEchoes, now });
    if (shouldSkipEchoGeneration(promptPackage)) {
      return {
        success: true,
        skipped: true,
        forced: force,
        reason: 'context-too-thin',
        debug: includeDebug
          ? {
              promptVersion: DAILY_ECHO_PROMPT_VERSION,
              todayCaptureCount: promptPackage.todayCaptures.length,
              recentCaptureCount: promptPackage.recentCaptures.length,
              recentEchoCount: promptPackage.recentEchoes.length,
              similarityToRecent: 0,
              promptPackage,
            }
          : undefined,
      };
    }

    const prompt = buildEchoPrompt(promptPackage);
    const chips = buildEchoChips(promptPackage);
    const model = process.env.COMMONSTACK_ECHO_MODEL || null;

    if (!force) {
      const claim = await claimAutoEchoGenerationSlot({
        existing,
        workspaceId,
        sourceKey,
        generatedDateKey,
        model,
        trigger,
        promptPackage,
        chips,
      });

      if (!claim.acquired) {
        return {
          success: true,
          skipped: true,
          forced: false,
          reason: claim.current?.status || 'pending',
          echo: claim.current?.status === 'active' ? toEchoSummary(claim.current) : undefined,
        };
      }
    }

    try {
      const completion = await generateCommonstackEcho({ prompt });
      const normalized = normalizeEchoOutput(completion.content);
      const recommendations = normalized.recommendations;
      const quality = evaluateEchoQuality({
        candidate: normalized,
        recentEchoes: promptPackage.recentEchoes,
      });
      const qualityWarning = quality.valid ? undefined : quality.reason;

      if (!quality.valid) {
        if (!force) {
          await prisma.workspaceEcho.upsert({
            where: { sourceKey },
            update: {
              workspaceId,
              kind: DAILY_ECHO_KIND,
              generatedDateKey,
              model: completion.model,
              promptVersion: DAILY_ECHO_PROMPT_VERSION,
              status: 'failed',
              metadataJson: JSON.stringify(
                buildAutoMetadata({
                  trigger,
                  forced: force,
                  promptPackage,
                  similarityToRecent: quality.maxSimilarity,
                  error: quality.reason,
                  recommendations,
                })
              ),
            },
            create: {
              workspaceId,
              sourceKey,
              kind: DAILY_ECHO_KIND,
              generatedDateKey,
              model: completion.model,
              promptVersion: DAILY_ECHO_PROMPT_VERSION,
              title: '今日回声',
              body: '这条线索还在发酵。',
              chipsJson: JSON.stringify(chips),
              metadataJson: JSON.stringify(
                buildAutoMetadata({
                  trigger,
                  forced: force,
                  promptPackage,
                  similarityToRecent: quality.maxSimilarity,
                  error: quality.reason,
                  recommendations,
                })
              ),
              status: 'failed',
            },
          });

          return {
            success: true,
            skipped: true,
            forced: force,
            reason: quality.reason,
            debug: includeDebug
              ? {
                  model: completion.model,
                  promptVersion: DAILY_ECHO_PROMPT_VERSION,
                  todayCaptureCount: promptPackage.todayCaptures.length,
                  recentCaptureCount: promptPackage.recentCaptures.length,
                  recentEchoCount: promptPackage.recentEchoes.length,
                  similarityToRecent: quality.maxSimilarity,
                  prompt,
                  promptPackage,
                  rawResponse: completion.rawContent,
                  parseResult: { ...normalized, recommendations },
                }
              : undefined,
          };
        }
      }

      const metadata = includeDebug
        ? {
            ...buildAutoMetadata({
              trigger,
              forced: force,
              promptPackage,
              similarityToRecent: quality.maxSimilarity,
              qualityWarning,
              recommendations,
            }),
            promptPackage,
            prompt,
            rawResponse: completion.rawContent,
            parseResult: { ...normalized, recommendations },
          }
        : buildAutoMetadata({
            trigger,
            forced: force,
            promptPackage,
            similarityToRecent: quality.maxSimilarity,
            qualityWarning,
            recommendations,
          });

      const echo = await prisma.workspaceEcho.upsert({
        where: { sourceKey },
        update: {
          workspaceId,
          kind: DAILY_ECHO_KIND,
          generatedDateKey,
          model: completion.model,
          promptVersion: DAILY_ECHO_PROMPT_VERSION,
          title: normalized.title,
          body: normalized.body,
          chipsJson: JSON.stringify(chips),
          metadataJson: JSON.stringify(metadata),
          status: 'active',
        },
        create: {
          workspaceId,
          sourceKey,
          kind: DAILY_ECHO_KIND,
          generatedDateKey,
          model: completion.model,
          promptVersion: DAILY_ECHO_PROMPT_VERSION,
          title: normalized.title,
          body: normalized.body,
          chipsJson: JSON.stringify(chips),
          metadataJson: JSON.stringify(metadata),
          status: 'active',
        },
      });

      return {
        success: true,
        skipped: false,
        forced: force,
        reason: qualityWarning,
        echo: toEchoSummary(echo),
        debug: {
          model: completion.model,
          promptVersion: DAILY_ECHO_PROMPT_VERSION,
          todayCaptureCount: promptPackage.todayCaptures.length,
          recentCaptureCount: promptPackage.recentCaptures.length,
          recentEchoCount: promptPackage.recentEchoes.length,
          similarityToRecent: quality.maxSimilarity,
          ...(includeDebug
            ? {
                prompt,
                promptPackage,
                rawResponse: completion.rawContent,
                parseResult: { ...normalized, recommendations },
              }
            : {}),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!force || existing?.status !== 'active') {
        await prisma.workspaceEcho.upsert({
          where: { sourceKey },
          update: {
            workspaceId,
            kind: DAILY_ECHO_KIND,
            generatedDateKey,
            model,
            promptVersion: DAILY_ECHO_PROMPT_VERSION,
            status: 'failed',
            metadataJson: JSON.stringify(
              buildAutoMetadata({
                trigger,
                forced: force,
                promptPackage,
                error: message,
                recommendations: [],
              })
            ),
          },
          create: {
            workspaceId,
            sourceKey,
            kind: DAILY_ECHO_KIND,
            generatedDateKey,
            model,
            promptVersion: DAILY_ECHO_PROMPT_VERSION,
            title: '今日回声',
            body: '这条线索还在发酵。',
            chipsJson: JSON.stringify(chips),
            metadataJson: JSON.stringify(
              buildAutoMetadata({
                trigger,
                forced: force,
                promptPackage,
                error: message,
                recommendations: [],
              })
            ),
            status: 'failed',
          },
        });
      }

      return {
        success: false,
        skipped: true,
        forced: force,
        reason: message,
        echo: existing?.status === 'active' ? toEchoSummary(existing) : undefined,
        debug: includeDebug
          ? {
              model: process.env.COMMONSTACK_ECHO_MODEL || undefined,
              promptVersion: DAILY_ECHO_PROMPT_VERSION,
              todayCaptureCount: promptPackage.todayCaptures.length,
              recentCaptureCount: promptPackage.recentCaptures.length,
              recentEchoCount: promptPackage.recentEchoes.length,
              similarityToRecent: 0,
              prompt,
              promptPackage,
              parseResult: null,
            }
          : undefined,
      };
    }
  },
};

export default workspaceEchoService;
