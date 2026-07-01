/**
 * OpenBiliClaw API 客户端 — M15 Phase 2
 *
 * 通过 MeetMind 代理 route (/api/openbiliclaw/*) 调用本地 OpenBiliClaw 后端。
 * 所有请求同源，无 CORS 问题。
 *
 * M15 起 B站 cookie 由 OpenBiliClaw 浏览器扩展自动同步——MeetMind 不再代理
 * 手填 cookie 入口（submitBilibiliCookie / triggerInit 等已删除）。
 */

import { readStoredAccessToken } from '@/lib/hooks/useAuth';

// ─── 类型定义 ────────────────────────────────────────────────

/** OpenBiliClaw 推荐条目（B站视频/小红书帖子等） */
export interface OBRecommendation {
  id: number;
  bvid: string;
  title: string;
  up_name: string;
  cover_url: string;
  /** 推荐理由（"有温度的推荐"） */
  expression: string;
  topic_label: string;
  source_platform: string;
  content_type: string;
  content_url: string;
  body_text: string;
}

// ─── 基础请求 ────────────────────────────────────────────────

async function obFetch(path: string, options?: RequestInit): Promise<Response> {
  let authHeader: Record<string, string> = {};
  try {
    const token = readStoredAccessToken();
    if (token) authHeader = { Authorization: `Bearer ${token}` };
  } catch { /* SSR / 无 window */ }
  return fetch(`/api/openbiliclaw/${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...authHeader,
      ...options?.headers as Record<string, string> | undefined,
    },
  });
}

// ─── API 函数 ────────────────────────────────────────────────

/** 健康检查 */
export async function checkHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await obFetch('health', { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = await res.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

/** 拉取推荐列表 */
export async function getRecommendations(limit = 5): Promise<OBRecommendation[]> {
  try {
    const res = await obFetch(`recommendations?limit=${limit}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}