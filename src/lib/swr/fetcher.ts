/**
 * SWR Fetcher 统一封装
 * 
 * 遵循 vercel-react-best-practices 规则：
 * - client-swr-dedup: 使用 SWR 自动请求去重
 * - async-parallel: 支持并行请求
 * 
 * @see https://swr.vercel.app/docs/getting-started
 */

// ==================== 类型定义 ====================

export interface FetcherError extends Error {
  status?: number;
  info?: unknown;
}

export interface FetcherOptions extends RequestInit {
  /** 是否需要认证 */
  requireAuth?: boolean;
}

// ==================== Token 管理 ====================

const TOKEN_KEY = 'meetmind_access_token';

function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

// ==================== Fetcher 实现 ====================

/**
 * 基础 fetcher - 用于无需认证的请求
 */
export async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url);
  
  if (!response.ok) {
    const error = new Error('请求失败') as FetcherError;
    error.status = response.status;
    try {
      error.info = await response.json();
    } catch {
      // 忽略 JSON 解析错误
    }
    throw error;
  }
  
  return response.json();
}

/**
 * 带认证的 fetcher - 自动附加 Authorization header
 */
export async function authFetcher<T>(url: string): Promise<T> {
  const token = getStoredToken();
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(url, { headers });
  
  if (!response.ok) {
    const error = new Error('请求失败') as FetcherError;
    error.status = response.status;
    try {
      error.info = await response.json();
    } catch {
      // 忽略 JSON 解析错误
    }
    throw error;
  }
  
  return response.json();
}

/**
 * POST 请求 fetcher - 用于 useSWRMutation
 * 
 * @example
 * const { trigger } = useSWRMutation('/api/generate-topics', postFetcher);
 * const result = await trigger({ sessionId, transcript, mode });
 */
export async function postFetcher<T, A = unknown>(
  url: string,
  { arg }: { arg: A }
): Promise<T> {
  const token = getStoredToken();
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(arg),
  });
  
  if (!response.ok) {
    const error = new Error('请求失败') as FetcherError;
    error.status = response.status;
    try {
      error.info = await response.json();
    } catch {
      // 忽略 JSON 解析错误
    }
    throw error;
  }
  
  return response.json();
}

/**
 * 多请求并行 fetcher - 用于 Promise.all 场景
 * 
 * 遵循 async-parallel 规则：使用 Promise.all() 并行独立请求
 * 
 * @example
 * const [topics, summary] = await parallelFetcher([
 *   '/api/generate-topics',
 *   '/api/generate-summary'
 * ]);
 */
export async function parallelFetcher<T extends unknown[]>(
  urls: string[]
): Promise<T> {
  const results = await Promise.all(urls.map(url => authFetcher(url)));
  return results as T;
}
