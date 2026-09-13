/**
 * /api/zhihu/* 与 /api/auth/zhihu/* 的浏览器端调用（纯 fetch 封装，零 UI）。
 * 错误统一成 ZhihuClientError { code, message, status }，组件按 code 分流、按 message 展示。
 */

import type { ZhihuFavlist } from '@/lib/services/zhihu/zhihu-open-client';
import type { LiveMaterialPack } from '@/lib/services/teach-live/live-materials';
import type { ContinueReadingGroup } from '@/lib/services/zhihu/zhihu-discovery-service';
import type { AppExecutionResult } from '@/lib/ai-native/types';

export class ZhihuClientError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ZhihuClientError';
    this.code = code;
    this.status = status;
  }
}

function headers(token: string | null, json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as (T & { success?: boolean; error?: string; message?: string }) | null;
  if (!response.ok || !data || data.success === false) {
    throw new ZhihuClientError(data?.error ?? `http_${response.status}`, data?.message ?? '出了点问题，稍后再试', response.status);
  }
  return data;
}

export interface ZhihuStatus {
  enabled: boolean;
  connected: boolean;
  mode: 'oauth' | 'self' | null;
  expired: boolean;
  expiresAt: string | null;
}

/** 公开状态（不需登录）：这条线开了没、知乎登录能不能用 */
export async function fetchZhihuPublicStatus(): Promise<{ enabled: boolean; oauthReady: boolean }> {
  return readJson(await fetch('/api/auth/zhihu/status', { cache: 'no-store' }));
}

export async function fetchZhihuStatus(token: string): Promise<ZhihuStatus> {
  return readJson<ZhihuStatus>(await fetch('/api/zhihu/status', { headers: headers(token) }));
}

/** 返回授权页地址；带 token = 绑定当前账号，不带 = 用知乎登录 */
export async function startZhihuOAuth(token: string | null, next = '/apps/zhihu'): Promise<string> {
  const data = await readJson<{ url: string }>(await fetch(`/api/auth/zhihu/start?next=${encodeURIComponent(next)}`, { headers: headers(token) }));
  return data.url;
}

export async function fetchFavlists(token: string): Promise<{ mode: 'oauth' | 'self'; favlists: ZhihuFavlist[] }> {
  return readJson(await fetch('/api/zhihu/favlists', { headers: headers(token) }));
}

/** 最近收藏同步进收集流（服务端 15 分钟节流） */
export async function syncRecentCollections(token: string): Promise<{ added: number; scanned: number; skipped: 'throttled' | null }> {
  return readJson(await fetch('/api/zhihu/sync', { method: 'POST', headers: headers(token, true), body: '{}' }));
}

export interface ZhihuFavlistItemDto {
  id: string;
  title: string;
  summary: string;
  url: string;
  kind: string;
  author: string | null;
  voteUpCount: number;
  commentCount: number;
  favTime: number;
  body: 'summary' | 'full';
  bodyChars: number;
  lessons: Array<{ threadId: string; title: string; mode: string; updatedAt: string }>;
}

export interface ZhihuFavlistDetailDto {
  mode: 'oauth' | 'self';
  favlist: ZhihuFavlist;
  imported: number;
  items: ZhihuFavlistItemDto[];
}

export interface ZhihuFavlistThemesDto {
  themes: Array<{ id: string; title: string; why: string; itemIds: string[] }>;
  misc: string[];
  start: { itemId: string; why: string } | null;
  source: 'model' | 'fallback' | 'trivial';
}

/** 收藏夹页：条目（第一次打开会先收进来） */
export async function fetchFavlistDetail(token: string, urlToken: string, opts: { refresh?: boolean } = {}): Promise<ZhihuFavlistDetailDto> {
  return readJson(await fetch(`/api/zhihu/favlists/${encodeURIComponent(urlToken)}${opts.refresh ? '?refresh=1' : ''}`, { headers: headers(token), signal: AbortSignal.timeout(60_000) }));
}

/** 收藏夹页：同学读出来的几条线（慢，一次模型调用，服务端缓存） */
export async function fetchFavlistThemes(token: string, urlToken: string): Promise<ZhihuFavlistThemesDto> {
  return readJson(await fetch(`/api/zhihu/favlists/${encodeURIComponent(urlToken)}/themes`, { headers: headers(token), signal: AbortSignal.timeout(90_000) }));
}

export async function importFavlist(token: string, favlistUrlToken: string): Promise<{ fetched: number; imported: number }> {
  return readJson(
    await fetch('/api/zhihu/import', { method: 'POST', headers: headers(token, true), body: JSON.stringify({ favlistUrlToken }) }),
  );
}

export type CreateLessonInput =
  | { kind: 'single'; captureId: string; favlistUrlToken?: string }
  | { kind: 'theme'; captureIds: string[]; topic: string; favlistUrlToken?: string }
  | { kind: 'auto'; favlistUrlToken: string }
  | { kind: 'favlist'; favlistUrlToken: string };

/** 开课：一篇 / 一条线 / 随手（同学挑）/ 整个收藏夹（旧） */
export async function createLesson(token: string, input: CreateLessonInput | string): Promise<{ thread: { id: string; title: string; topic: string }; pack: LiveMaterialPack }> {
  const req = typeof input === 'string' ? { kind: 'favlist' as const, favlistUrlToken: input } : input;
  const body =
    req.kind === 'single'
      ? { captureIds: [req.captureId], favlistUrlToken: req.favlistUrlToken, mode: 'single' }
      : req.kind === 'theme'
        ? { captureIds: req.captureIds, topic: req.topic, favlistUrlToken: req.favlistUrlToken, mode: 'theme' }
        : req.kind === 'auto'
          ? { favlistUrlToken: req.favlistUrlToken, auto: true }
          : { favlistUrlToken: req.favlistUrlToken };
  return readJson(
    await fetch('/api/zhihu/lesson', { method: 'POST', headers: headers(token, true), body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) }),
  );
}

export interface ZhihuLessonSummaryDto {
  threadId: string;
  title: string;
  topic: string;
  materialsTitle: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export async function fetchLessons(token: string): Promise<ZhihuLessonSummaryDto[]> {
  const data = await readJson<{ lessons: ZhihuLessonSummaryDto[] }>(await fetch('/api/zhihu/lessons', { headers: headers(token) }));
  return data.lessons;
}

export interface ZhihuCaptureDto {
  id: string;
  title: string;
  previewText: string | null;
  sourceUrl: string | null;
  occurredAt: string | null;
  bodyChars: number;
  zhihu: { kind: string; body: 'summary' | 'full'; favlists: Array<{ urlToken: string; title: string }>; voteUpCount: number; author: string | null };
}

export async function fetchCaptures(token: string): Promise<ZhihuCaptureDto[]> {
  const data = await readJson<{ captures: ZhihuCaptureDto[] }>(await fetch('/api/zhihu/captures', { headers: headers(token) }));
  return data.captures;
}

export async function fetchLessonPack(token: string, threadId: string): Promise<{ thread: { id: string; title: string; topic: string }; pack: LiveMaterialPack }> {
  // 老师正在讲时共享 SQLite 可能被事件写入占着，这一读偶发很慢：20 s 不回来就当失败，让页面给「再试一次」而不是一直「稍等」
  return readJson(await fetch(`/api/zhihu/lesson/${encodeURIComponent(threadId)}`, { headers: headers(token), signal: AbortSignal.timeout(20_000) }));
}

export async function fetchContinueReading(token: string, input: { concepts: string[]; threadId: string }): Promise<{ groups: ContinueReadingGroup[]; exhausted: boolean }> {
  const data = await readJson<{ groups: ContinueReadingGroup[]; exhausted?: boolean }>(
    await fetch('/api/zhihu/continue', { method: 'POST', headers: headers(token, true), body: JSON.stringify(input) }),
  );
  return { groups: data.groups, exhausted: data.exhausted === true };
}

/** 既有应用矩阵执行入口；材料不足是 200 + ok:false（CONTENT_NOT_READY），不是协议错误 */
export async function executeApp(token: string | null, payload: unknown): Promise<{ ok: true; result: AppExecutionResult } | { ok: false; error: string }> {
  const response = await fetch('/api/apps/execute', { method: 'POST', headers: headers(token, true), body: JSON.stringify(payload) });
  const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; result?: AppExecutionResult } | null;
  if (data?.ok && data.result) return { ok: true, result: data.result };
  return { ok: false, error: data?.error ?? `http_${response.status}` };
}
