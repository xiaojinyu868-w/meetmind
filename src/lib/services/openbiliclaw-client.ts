/**
 * OpenBiliClaw API 客户端 — M15 Phase 2
 *
 * 通过 MeetMind 代理 route (/api/openbiliclaw/*) 调用本地 OpenBiliClaw 后端。
 * 所有请求同源，无 CORS 问题。
 */

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

/** 画像摘要 */
export interface OBProfileSummary {
  initialized: boolean;
  personality_portrait: string;
  core_traits: string[];
  deep_needs: string[];
}

/** B站 Cookie 设置响应 */
export interface OBCookieResponse {
  ok: boolean;
  authenticated: boolean;
  username: string;
  message: string;
}

// ─── 基础请求 ────────────────────────────────────────────────

async function obFetch(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`/api/openbiliclaw/${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...options?.headers,
    },
  });
}

// ─── API 函数 ────────────────────────────────────────────────

/** 健康检查 */
export async function checkHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('/api/openbiliclaw/health', { signal: controller.signal });
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

/** 设置 B站 Cookie */
export async function submitBilibiliCookie(cookie: string): Promise<OBCookieResponse> {
  const res = await obFetch('bilibili/cookie', {
    method: 'POST',
    body: JSON.stringify({ cookie }),
  });
  return res.json();
}

/** 读取画像摘要 */
export async function getProfileSummary(): Promise<OBProfileSummary | null> {
  try {
    const res = await obFetch('profile-summary');
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/** 提交反馈 */
export async function submitFeedback(
  recommendationId: number,
  feedbackType: 'like' | 'dislike',
): Promise<boolean> {
  try {
    const res = await obFetch('recommendations/refresh', {
      method: 'POST',
      body: JSON.stringify({
        recommendation_id: recommendationId,
        feedback_type: feedbackType,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 触发 init（拉取历史 + 生成画像 + 首轮发现） */
export async function triggerInit(): Promise<boolean> {
  try {
    const res = await obFetch('init', {
      method: 'POST',
      body: JSON.stringify({
        no_xhs: true,
        no_douyin: true,
        no_youtube: true,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 查询 init 状态 */
export async function getInitStatus(): Promise<{ status: string; phase?: string } | null> {
  try {
    const res = await obFetch('init-status');
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
