/**
 * learner-context-service — LearnerContext 读槽的服务端（renewal plan §6 读侧）。
 *
 * resolveLearnerContext：远端可用就问外部 context 系统（CONTEXT_SYSTEM_URL，按 learnerId），
 * 否则用请求方随身带来的本机切片（local），都没有就是空切片。远端失败静默回落到 local：
 * 读槽是"多知道一点"，不是执行的前提，任何失败都不该让应用做不出来。
 *
 * formatLearnerContextForPrompt：切片 → 一段 prompt（只陈述事实：还没稳 / 刚记住 / 最近学过 / 没过去的困惑），
 * 预算 ≈600 字，空切片返回空串。各插件把它当一段追加进 user prompt，写法由 app-prompts 决定。
 *
 * 外部接口（待与 context 系统对齐，见 docs/plans/2026-09-08-product-renewal-plan.md §6）：
 *   POST {CONTEXT_SYSTEM_URL}/v1/learner-context   body: LearnerContextRequest
 *   Authorization: Bearer {CONTEXT_SYSTEM_API_KEY}
 *   200 → LearnerContext（v 必须等于 LEARNER_CONTEXT_VERSION，否则按不可用处理）
 */

import { z } from 'zod';
import { createLogger } from '@/lib/logger';
import { ContextSystemConfig } from '@/lib/config/app.config';
import { buildLearnerContextFromStore } from '@/lib/services/learner-context-provider';
import {
  LEARNER_CONTEXT_VERSION,
  emptyLearnerContext,
  isLearnerContextEmpty,
  type LearnerContext,
  type LearnerContextRequest,
} from '@/types/learner-context';

const log = createLogger('learner-context');

const PROMPT_BUDGET_CHARS = 600;

// 测试里会改 process.env，所以每次读而不是缓存 ContextSystemConfig（它在模块加载时就定型了）
function remoteConfig(): { url: string; apiKey: string; timeoutMs: number } {
  return {
    url: (process.env.CONTEXT_SYSTEM_URL ?? ContextSystemConfig.url).trim(),
    apiKey: (process.env.CONTEXT_SYSTEM_API_KEY ?? ContextSystemConfig.apiKey).trim(),
    timeoutMs: ContextSystemConfig.timeoutMs,
  };
}

const conceptStateSchema = z.object({
  concept: z.string().min(1).max(200),
  status: z.enum(['unstable', 'improving', 'stable']),
  lastAt: z.string().max(40),
  steps: z.array(z.object({ appId: z.string().max(60), positive: z.boolean(), at: z.string().max(40) })).max(20).optional(),
  evidence: z.object({ sessionId: z.string().max(120).optional(), startMs: z.number().nonnegative(), endMs: z.number().nonnegative().optional() }).optional(),
  evidenceIds: z.array(z.string().max(120)).max(20).optional(),
});

const noteSchema = z.object({
  title: z.string().min(1).max(300),
  detail: z.string().max(600).optional(),
  evidenceIds: z.array(z.string().max(120)).max(20).optional(),
});

/** 请求体里的 learner 切片与远端返回都用它校验；不合法就当没有 */
export const learnerContextSchema = z.object({
  v: z.literal(LEARNER_CONTEXT_VERSION),
  generatedAt: z.string().max(40),
  source: z.enum(['local', 'server', 'remote']),
  learnerId: z.string().max(120).optional(),
  mastery: z.array(conceptStateSchema).max(60),
  recentLessons: z.array(z.object({ title: z.string().max(200), at: z.string().max(40), sessionId: z.string().max(120).optional() })).max(30),
  challenges: z.array(noteSchema).max(30),
  topics: z.array(z.string().max(120)).max(30),
  preferences: z.array(z.string().max(200)).max(30),
  goals: z.array(z.string().max(200)).max(30),
  evidenceIds: z.array(z.string().max(120)).max(200),
});

export function parseLearnerContext(raw: unknown): LearnerContext | null {
  const parsed = learnerContextSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function isRemoteLearnerContextConfigured(): boolean {
  return Boolean(remoteConfig().url);
}

async function fetchRemoteLearnerContext(request: LearnerContextRequest): Promise<LearnerContext | null> {
  const { url: base, apiKey, timeoutMs } = remoteConfig();
  if (!base) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetch(`${base.replace(/\/$/, '')}/v1/learner-context`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) {
      log.warn('learner-context.remote.http_error', { status: response.status, appId: request.appId });
      return null;
    }
    const parsed = parseLearnerContext(await response.json());
    if (!parsed) {
      log.warn('learner-context.remote.invalid_shape', { appId: request.appId });
      return null;
    }
    return { ...parsed, source: 'remote' };
  } catch (error) {
    log.warn('learner-context.remote.failed', { appId: request.appId, error: error instanceof Error ? error.message : String(error) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ResolveLearnerContextOptions {
  request: LearnerContextRequest;
  /** 请求方随身带来的本机切片（已校验或未校验的原始值） */
  local?: unknown;
}

/**
 * 供给顺序：远端（配置了且拿到了）→ 服务端事件表（登录用户）→ 本机切片 → 空。
 * 登录用户才问远端 / 服务端（访客没有 learnerId；访客数据登录后由 context 系统合并）。
 * 服务端切片为空时仍用本机切片：刚做完的一轮可能还没写进事件表（访客态做的、或写入延迟）。
 */
export async function resolveLearnerContext({ request, local }: ResolveLearnerContextOptions): Promise<LearnerContext> {
  const localContext = local ? parseLearnerContext(local) : null;
  if (request.learnerId) {
    if (isRemoteLearnerContextConfigured()) {
      const remote = await fetchRemoteLearnerContext(request);
      if (remote && !isLearnerContextEmpty(remote)) return remote;
    }
    try {
      const server = await buildLearnerContextFromStore(request);
      if (!isLearnerContextEmpty(server)) return server;
    } catch (error) {
      log.warn('learner-context.server.failed', { appId: request.appId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (localContext) return { ...localContext, source: 'local' };
  return emptyLearnerContext('local', request.learnerId);
}

const STATUS_LABEL: Record<LearnerContext['mastery'][number]['status'], string> = {
  unstable: '还没稳',
  improving: '刚记住',
  stable: '已经稳了',
};

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * 切片 → prompt 段落。只写事实，让模型自己决定怎么用（"prompt 永远不为最弱的模型降级设计"）。
 * 顺序：还没稳 → 刚记住 → 没过去的困惑 → 最近学过 → 在学 / 目标；预算内截断，空切片返回 ''。
 */
export function formatLearnerContextForPrompt(context: LearnerContext | null | undefined): string {
  if (!context || isLearnerContextEmpty(context)) return '';
  const lines: string[] = [];
  const unstable = context.mastery.filter((m) => m.status === 'unstable');
  const improving = context.mastery.filter((m) => m.status === 'improving');
  const stable = context.mastery.filter((m) => m.status === 'stable');
  const describe = (m: LearnerContext['mastery'][number]) => {
    const trail = m.steps && m.steps.length > 0
      ? `（${m.steps.slice(-3).map((s) => `${s.appId}${s.positive ? '✓' : '✕'}`).join(' → ')}）`
      : '';
    const where = m.evidence ? `，原话在 ${fmtTime(m.evidence.startMs)}` : '';
    return `${clip(m.concept, 40)}${trail}${where}`;
  };
  if (unstable.length) lines.push(`${STATUS_LABEL.unstable}：${unstable.slice(0, 6).map(describe).join('；')}`);
  if (improving.length) lines.push(`${STATUS_LABEL.improving}：${improving.slice(0, 6).map(describe).join('；')}`);
  if (stable.length) lines.push(`${STATUS_LABEL.stable}：${stable.slice(0, 6).map((m) => clip(m.concept, 30)).join('、')}`);
  if (context.challenges.length) lines.push(`还没过去的困惑：${context.challenges.slice(0, 4).map((c) => clip(c.title, 40)).join('；')}`);
  if (context.recentLessons.length) lines.push(`最近学过：${context.recentLessons.slice(0, 4).map((l) => clip(l.title, 30)).join('、')}`);
  if (context.topics.length) lines.push(`在学：${context.topics.slice(0, 4).map((t) => clip(t, 24)).join('、')}`);
  if (context.goals.length) lines.push(`目标：${context.goals.slice(0, 3).map((g) => clip(g, 40)).join('；')}`);
  if (context.preferences.length) lines.push(`偏好：${context.preferences.slice(0, 3).map((p) => clip(p, 40)).join('；')}`);
  let text = lines.join('\n');
  if (text.length > PROMPT_BUDGET_CHARS) text = `${text.slice(0, PROMPT_BUDGET_CHARS - 1)}…`;
  return text;
}
