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

export async function importFavlist(token: string, favlistUrlToken: string): Promise<{ fetched: number; imported: number }> {
  return readJson(
    await fetch('/api/zhihu/import', { method: 'POST', headers: headers(token, true), body: JSON.stringify({ favlistUrlToken }) }),
  );
}

export async function createLesson(token: string, favlistUrlToken: string): Promise<{ thread: { id: string; title: string; topic: string }; pack: LiveMaterialPack }> {
  return readJson(
    await fetch('/api/zhihu/lesson', { method: 'POST', headers: headers(token, true), body: JSON.stringify({ favlistUrlToken }) }),
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
  return readJson(await fetch(`/api/zhihu/lesson/${encodeURIComponent(threadId)}`, { headers: headers(token) }));
}

export async function fetchContinueReading(token: string, input: { concepts: string[]; threadId: string }): Promise<ContinueReadingGroup[]> {
  const data = await readJson<{ groups: ContinueReadingGroup[] }>(
    await fetch('/api/zhihu/continue', { method: 'POST', headers: headers(token, true), body: JSON.stringify(input) }),
  );
  return data.groups;
}

/** 既有应用矩阵执行入口；材料不足是 200 + ok:false（CONTENT_NOT_READY），不是协议错误 */
export async function executeApp(token: string | null, payload: unknown): Promise<{ ok: true; result: AppExecutionResult } | { ok: false; error: string }> {
  const response = await fetch('/api/apps/execute', { method: 'POST', headers: headers(token, true), body: JSON.stringify(payload) });
  const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; result?: AppExecutionResult } | null;
  if (data?.ok && data.result) return { ok: true, result: data.result };
  return { ok: false, error: data?.error ?? `http_${response.status}` };
}
