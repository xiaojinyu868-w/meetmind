'use client';

/**
 * /console /teacher /learn 三端共用的前端 API client
 *
 * - 自动从 useAuth 的 accessToken 注入 Authorization 头
 * - 统一错误处理：后端返回 { ok: false, error: { code, message } } 时抛 AcademicClientError
 * - 统一 JSON content-type
 */

export class AcademicClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = 'AcademicClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

interface RequestOptions {
  accessToken: string | null;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  query?: Record<string, string | undefined>;
}

export async function academicFetch<T>(path: string, opts: RequestOptions): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.accessToken) {
    headers.Authorization = `Bearer ${opts.accessToken}`;
  }

  const res = await fetch(url.toString(), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const json = await safeParseJson(res);
  if (!res.ok || (json && json.ok === false)) {
    const err = json?.error ?? { code: 'INTERNAL', message: `HTTP ${res.status}` };
    throw new AcademicClientError(err.message || 'Request failed', err.code || 'INTERNAL', res.status, err.details);
  }
  // 后端成功返回形如 { ok: true, data: ... }；把 data 剥出来
  return (json?.data ?? json) as T;
}

async function safeParseJson(res: Response): Promise<{ ok?: boolean; data?: unknown; error?: { code: string; message: string; details?: unknown } } | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
