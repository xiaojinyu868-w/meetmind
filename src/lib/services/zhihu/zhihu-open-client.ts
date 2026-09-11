/**
 * 知乎开放平台 HTTP 客户端（server-only）。
 *
 * 覆盖官方 zhihu skill v0.2.1 记录的全部只读契约：
 * - 内容：站内搜索 / 全网搜索 / 热榜 / 直答（Chat Completions 兼容）
 * - 用户数据：创作 / 关注 / 收藏夹 / 收藏夹内容 / 近期收藏（本人 或 X-OAuth-Token 授权用户）
 * - OAuth：授权页 URL / 回调取码 / 换 token / 取资料
 *
 * 设计取舍：
 * - 直接打 HTTP，不依赖官方 CLI（CLI 只有 macOS / Windows 包，服务器是 Linux）
 * - 字段归一成 camelCase 并把 "2" 这类字符串数字转成数字；原始字段名见文件头引用的契约文档
 * - 业务错误常包在 HTTP 200 里（Code≠0），一律抛 ZhihuApiError，调用方不用再看 Code
 * - fetch / now 可注入，便于夹具测试；日志只记 endpoint 与错误码，不记 query、凭证或响应正文
 */

import { createLogger } from '@/lib/logger';
import { getZhihuConfig, type ZhihuConfig } from '@/lib/config/zhihu.config';

const log = createLogger('zhihu-open');

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

export type ZhihuErrorKind =
  | 'param' // 10001 / HTTP 400
  | 'auth' // 20001 / HTTP 401 403
  | 'rate_limit' // 30001 / HTTP 429：停止重试
  | 'quota' // 30002：当日额度耗尽，该能力全账号不可用
  | 'server' // 90001 / HTTP 5xx
  | 'network'
  | 'timeout'
  | 'protocol' // 响应不是约定形状
  | 'oauth'; // 换 token 失败

export class ZhihuApiError extends Error {
  readonly kind: ZhihuErrorKind;
  readonly endpoint: string;
  readonly code?: number | string;
  readonly status?: number;

  constructor(kind: ZhihuErrorKind, endpoint: string, message: string, extra: { code?: number | string; status?: number } = {}) {
    super(message);
    this.name = 'ZhihuApiError';
    this.kind = kind;
    this.endpoint = endpoint;
    this.code = extra.code;
    this.status = extra.status;
  }

  /** 幂等读请求遇到 network / timeout / server 才值得有限重试；rate_limit 与 quota 绝不重试 */
  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'server';
  }
}

function kindFromCode(code: number): ZhihuErrorKind {
  switch (code) {
    case 10001:
      return 'param';
    case 20001:
      return 'auth';
    case 30001:
      return 'rate_limit';
    case 30002:
      return 'quota';
    default:
      return 'server';
  }
}

function kindFromStatus(status: number): ZhihuErrorKind {
  if (status === 400) return 'param';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  return 'server';
}

// ---------------------------------------------------------------------------
// 归一后的类型
// ---------------------------------------------------------------------------

export interface ZhihuSearchItem {
  title: string;
  /** 搜索接口里首字母大写：Answer / Article … */
  contentType: string;
  contentId: string;
  /** 摘要，不是正文；高亮用 <em> 包着 */
  summary: string;
  url: string;
  commentCount: number;
  voteUpCount: number;
  authorName: string;
  authorAvatar: string;
  authorBadgeText: string;
  /** 秒级时间戳 */
  editTime: number;
  /** 精选评论正文 */
  featuredComments: string[];
  /** 1 低 / 2 中 / 3 高 / 4 超高；解析不出为 null */
  authorityLevel: 1 | 2 | 3 | 4 | null;
  rankingScore: number | null;
}

export interface ZhihuSearchResult {
  items: ZhihuSearchItem[];
  hasMore: boolean;
  searchHashId?: string;
  emptyReason?: string;
}

export interface ZhihuHotItem {
  title: string;
  url: string;
  thumbnailUrl: string;
  summary: string;
}

export interface ZhihuPaging {
  isEnd: boolean;
  /** 原样回传给下一次请求的 Offset；到末页为 null */
  nextOffset: string | null;
  totals: number;
}

export type ZhihuUserContentType = 'all' | 'answer' | 'article' | 'zvideo' | 'pin' | 'question';

export interface ZhihuUserContentItem {
  /** 用户接口里是小写：answer / article / zvideo / pin / question */
  contentType: string;
  url: string;
  createdAt: number;
  likeCount: number;
  commentCount: number;
  favoriteCount: number;
  title: string;
  /** 摘要，不是正文 */
  summary: string;
}

export interface ZhihuFollowee {
  fullname: string;
  urlToken: string;
  url: string;
  avatarUrl: string;
  headline: string;
  /** 0 未知或保密 / 1 女 / 2 男 */
  gender: number;
  followerCount: number;
}

export interface ZhihuFavlist {
  /** 收藏夹标识，查内容时回传 */
  urlToken: string;
  url: string;
  title: string;
  description: string;
  isPublic: boolean;
}

export interface ZhihuCollectionItem extends ZhihuUserContentItem {
  favTime: number;
  favlists: Array<{ urlToken: string; title: string; url: string }>;
  author: { name: string; urlToken: string; url: string; gender: number; headline: string } | null;
}

export type ZhidaModel = 'zhida-fast-1p5' | 'zhida-thinking-1p5' | 'zhida-agent';

export interface ZhidaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ZhidaAnswer {
  content: string;
  reasoning: string | null;
  model: string;
  id: string;
}

export interface ZhihuOAuthToken {
  accessToken: string;
  tokenType: string;
  /** 秒；文档值 3600，无 refresh token，过期只能重新授权 */
  expiresIn: number;
  /** 本地计算的过期时刻（ms） */
  expiresAt: number;
}

export interface ZhihuOAuthProfile {
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
  url: string | null;
}

/** 用户数据接口的身份：不传 oauthToken = Access Secret 所属账号本人 */
export interface ZhihuIdentity {
  oauthToken?: string;
}

// ---------------------------------------------------------------------------
// 原始响应形状（只列用到的字段；未知字段不裁剪但也不承诺）
// ---------------------------------------------------------------------------

interface Envelope<T> {
  Code?: number;
  Message?: string;
  Data?: T;
}

interface RawPaging {
  IsEnd?: boolean;
  NextOffset?: string | number;
  Totals?: number;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ZhihuOpenClientOptions {
  config?: ZhihuConfig;
  fetchImpl?: FetchLike;
  /** 毫秒时间源，可注入以固定 X-Request-Timestamp */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 与服务端语义一致：缺省 / 非法 / ≤0 回退默认值，超上限截到上限（文档：Count<=0 → 默认，>max → max） */
function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < min) return fallback;
  return Math.min(max, Math.trunc(value));
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function authorityLevel(value: unknown): ZhihuSearchItem['authorityLevel'] {
  const n = num(value, NaN);
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : null;
}

/** NextOffset 文档标 String、请求 Offset 标 Int64：这里只接受十进制数字串，别的算协议错误（不静默截断） */
export function parsePaging(raw: RawPaging | undefined, endpoint: string): ZhihuPaging {
  if (!raw) return { isEnd: true, nextOffset: null, totals: 0 };
  const isEnd = raw.IsEnd !== false;
  let nextOffset: string | null = null;
  if (!isEnd) {
    const candidate = raw.NextOffset === undefined ? '' : String(raw.NextOffset).trim();
    if (!/^\d+$/.test(candidate)) {
      throw new ZhihuApiError('protocol', endpoint, `Paging.NextOffset 不是合法偏移量: ${candidate || '(空)'}`);
    }
    nextOffset = candidate;
  }
  return { isEnd, nextOffset, totals: num(raw.Totals) };
}

function mapSearchItem(raw: Record<string, unknown>): ZhihuSearchItem {
  const comments = Array.isArray(raw.CommentInfoList)
    ? (raw.CommentInfoList as Array<Record<string, unknown>>).map((c) => str(c?.Content)).filter(Boolean)
    : [];
  return {
    title: str(raw.Title),
    contentType: str(raw.ContentType),
    contentId: str(raw.ContentID),
    summary: str(raw.ContentText),
    url: str(raw.Url),
    commentCount: num(raw.CommentCount),
    voteUpCount: num(raw.VoteUpCount),
    authorName: str(raw.AuthorName),
    authorAvatar: str(raw.AuthorAvatar),
    authorBadgeText: str(raw.AuthorBadgeText),
    editTime: num(raw.EditTime),
    featuredComments: comments,
    authorityLevel: authorityLevel(raw.AuthorityLevel),
    rankingScore: raw.RankingScore === undefined ? null : num(raw.RankingScore, NaN) || null,
  };
}

function mapUserContent(raw: Record<string, unknown>): ZhihuUserContentItem {
  return {
    contentType: str(raw.ContentType),
    url: str(raw.Url),
    createdAt: num(raw.CreatedAt),
    likeCount: num(raw.LikeCount),
    commentCount: num(raw.CommentCount),
    favoriteCount: num(raw.FavoriteCount),
    title: str(raw.Title),
    summary: str(raw.Summary),
  };
}

function mapCollectionItem(raw: Record<string, unknown>): ZhihuCollectionItem {
  const author = raw.Author && typeof raw.Author === 'object' ? (raw.Author as Record<string, unknown>) : null;
  const favlists = Array.isArray(raw.Favlists)
    ? (raw.Favlists as Array<Record<string, unknown>>).map((f) => ({
        urlToken: str(f?.UrlToken),
        title: str(f?.Title),
        url: str(f?.Url),
      }))
    : [];
  return {
    ...mapUserContent(raw),
    favTime: num(raw.FavTime),
    favlists,
    author: author
      ? {
          name: str(author.Name),
          urlToken: str(author.UrlToken),
          url: str(author.Url),
          gender: num(author.Gender),
          headline: str(author.Headline),
        }
      : null,
  };
}

function items<T>(data: unknown, mapper: (raw: Record<string, unknown>) => T): T[] {
  const list = (data as { Items?: unknown } | undefined)?.Items;
  return Array.isArray(list) ? (list as Array<Record<string, unknown>>).map(mapper) : [];
}

// ---------------------------------------------------------------------------
// 客户端
// ---------------------------------------------------------------------------

export function createZhihuOpenClient(options: ZhihuOpenClientOptions = {}) {
  const config = options.config ?? getZhihuConfig();
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => Date.now());

  function requireSecret(endpoint: string): string {
    if (!config.accessSecret) {
      throw new ZhihuApiError('auth', endpoint, 'ZHIHU_ACCESS_SECRET 未配置');
    }
    return config.accessSecret;
  }

  function baseHeaders(endpoint: string, identity?: ZhihuIdentity): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${requireSecret(endpoint)}`,
      'X-Request-Timestamp': String(Math.floor(now() / 1000)),
      'Content-Type': 'application/json',
    };
    if (identity?.oauthToken) headers['X-OAuth-Token'] = identity.oauthToken;
    return headers;
  }

  async function doFetch(url: string, init: RequestInit, endpoint: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      const aborted = (error as { name?: string })?.name === 'AbortError';
      throw new ZhihuApiError(aborted ? 'timeout' : 'network', endpoint, aborted ? `请求超时 ${timeoutMs}ms` : String((error as Error)?.message || error));
    } finally {
      clearTimeout(timer);
    }
  }

  async function readJson<T>(response: Response, endpoint: string): Promise<T> {
    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ZhihuApiError('protocol', endpoint, `响应不是 JSON（HTTP ${response.status}）`, { status: response.status });
    }
  }

  /** developer.zhihu.com 的 {Code, Message, Data} 信封；Code≠0 即失败（哪怕 HTTP 200） */
  async function api<T>(
    path: string,
    query: Record<string, string | number | undefined>,
    identity?: ZhihuIdentity,
  ): Promise<T> {
    const endpoint = path;
    const url = new URL(path, config.apiBaseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    const response = await doFetch(url.toString(), { method: 'GET', headers: baseHeaders(endpoint, identity) }, endpoint, config.timeoutMs);
    if (!response.ok) {
      const kind = kindFromStatus(response.status);
      log.warn('zhihu-open: http error', { endpoint, status: response.status, kind });
      throw new ZhihuApiError(kind, endpoint, `HTTP ${response.status}`, { status: response.status });
    }
    const payload = await readJson<Envelope<T>>(response, endpoint);
    const code = num(payload.Code, NaN);
    if (!Number.isFinite(code)) {
      throw new ZhihuApiError('protocol', endpoint, '响应缺少 Code 字段', { status: response.status });
    }
    if (code !== 0) {
      const kind = kindFromCode(code);
      log.warn('zhihu-open: api error', { endpoint, code, kind });
      throw new ZhihuApiError(kind, endpoint, payload.Message || `知乎开放平台错误 ${code}`, { code, status: response.status });
    }
    return (payload.Data ?? {}) as T;
  }

  // ----- 内容 -----

  async function searchZhihu(query: string, opts: { count?: number } = {}): Promise<ZhihuSearchResult> {
    const endpoint = '/api/v1/content/zhihu_search';
    const q = query.trim();
    if (!q) throw new ZhihuApiError('param', endpoint, 'Query 不能为空');
    const data = await api<{ HasMore?: boolean; SearchHashId?: string; Items?: unknown; EmptyReason?: string }>(endpoint, {
      Query: q,
      Count: clamp(opts.count, 1, 10, 10),
    });
    return {
      items: items(data, mapSearchItem),
      hasMore: Boolean(data.HasMore),
      searchHashId: data.SearchHashId,
      emptyReason: data.EmptyReason,
    };
  }

  async function searchGlobal(
    query: string,
    opts: { count?: number; filter?: string; searchDb?: 'all' | 'realtime' | 'static' } = {},
  ): Promise<ZhihuSearchResult> {
    const endpoint = '/api/v1/content/global_search';
    const q = query.trim();
    if (!q) throw new ZhihuApiError('param', endpoint, 'Query 不能为空');
    const data = await api<{ HasMore?: boolean; Items?: unknown }>(endpoint, {
      Query: q,
      Count: clamp(opts.count, 1, 20, 10),
      Filter: opts.filter,
      SearchDB: opts.searchDb,
    });
    return { items: items(data, mapSearchItem), hasMore: Boolean(data.HasMore) };
  }

  async function hotList(opts: { limit?: number } = {}): Promise<{ total: number; items: ZhihuHotItem[] }> {
    const endpoint = '/api/v1/content/hot_list';
    const data = await api<{ Total?: number; Items?: unknown }>(endpoint, { Limit: clamp(opts.limit, 1, 30, 30) });
    return {
      total: num(data.Total),
      items: items(data, (raw) => ({
        title: str(raw.Title),
        url: str(raw.Url),
        thumbnailUrl: str(raw.ThumbnailUrl),
        summary: str(raw.Summary),
      })),
    };
  }

  /** 非流式直答。多轮 messages 只有 fast / thinking 两档支持；额度 100 次/天，只适合点缀 */
  async function zhida(messages: ZhidaMessage[], opts: { model?: ZhidaModel } = {}): Promise<ZhidaAnswer> {
    const endpoint = '/v1/chat/completions';
    if (!messages.length) throw new ZhihuApiError('param', endpoint, 'messages 不能为空');
    const url = new URL(endpoint, config.apiBaseUrl).toString();
    const response = await doFetch(
      url,
      {
        method: 'POST',
        headers: baseHeaders(endpoint),
        body: JSON.stringify({ model: opts.model ?? 'zhida-fast-1p5', messages, stream: false }),
      },
      endpoint,
      config.zhidaTimeoutMs,
    );
    const payload = await readJson<{
      id?: string;
      model?: string;
      choices?: Array<{ message?: { content?: string; reasoning_content?: string }; finish_reason?: string }>;
      error?: { message?: string; type?: string; code?: string };
    }>(response, endpoint);
    if (!response.ok || payload.error) {
      const kind = response.status === 429 ? 'rate_limit' : kindFromStatus(response.status || 500);
      log.warn('zhihu-open: zhida error', { endpoint, status: response.status, code: payload.error?.code });
      throw new ZhihuApiError(kind, endpoint, payload.error?.message || `HTTP ${response.status}`, {
        status: response.status,
        code: payload.error?.code,
      });
    }
    const choice = payload.choices?.[0];
    if (!choice?.message) throw new ZhihuApiError('protocol', endpoint, '直答响应缺少 choices[0].message');
    return {
      content: str(choice.message.content),
      reasoning: choice.message.reasoning_content ? str(choice.message.reasoning_content) : null,
      model: str(payload.model),
      id: str(payload.id),
    };
  }

  // ----- 用户数据 -----

  async function userContents(
    opts: { contentType: ZhihuUserContentType; sortField?: 'like_count' | 'ts'; sortOrder?: 'asc' | 'desc'; offset?: string | number; limit?: number },
    identity: ZhihuIdentity = {},
  ): Promise<{ items: ZhihuUserContentItem[]; paging: ZhihuPaging }> {
    const endpoint = '/api/v1/user/contents';
    const data = await api<{ Items?: unknown; Paging?: RawPaging }>(
      endpoint,
      {
        ContentType: opts.contentType,
        SortField: opts.sortField,
        SortOrder: opts.sortOrder,
        Offset: opts.offset ?? 0,
        Limit: clamp(opts.limit, 1, 50, 20),
      },
      identity,
    );
    return { items: items(data, mapUserContent), paging: parsePaging(data.Paging, endpoint) };
  }

  async function userFollowees(
    opts: { offset?: string | number; limit?: number } = {},
    identity: ZhihuIdentity = {},
  ): Promise<{ items: ZhihuFollowee[]; paging: ZhihuPaging }> {
    const endpoint = '/api/v1/user/followees';
    const data = await api<{ Items?: unknown; Paging?: RawPaging }>(
      endpoint,
      { Offset: opts.offset ?? 0, Limit: clamp(opts.limit, 1, 50, 20) },
      identity,
    );
    return {
      items: items(data, (raw) => ({
        fullname: str(raw.Fullname),
        urlToken: str(raw.UrlToken),
        url: str(raw.Url),
        avatarUrl: str(raw.AvatarUrl),
        headline: str(raw.Headline),
        gender: num(raw.Gender),
        followerCount: num(raw.FollowerCount),
      })),
      paging: parsePaging(data.Paging, endpoint),
    };
  }

  /** 收藏夹列表没有分页，服务端忽略 Offset；只能拿最多 50 个 */
  async function userFavlists(opts: { limit?: number } = {}, identity: ZhihuIdentity = {}): Promise<{ items: ZhihuFavlist[] }> {
    const endpoint = '/api/v1/user/favlists';
    const data = await api<{ Items?: unknown }>(endpoint, { Limit: clamp(opts.limit, 1, 50, 20) }, identity);
    return {
      items: items(data, (raw) => ({
        urlToken: str(raw.UrlToken),
        url: str(raw.Url),
        title: str(raw.Title),
        description: str(raw.Description),
        isPublic: raw.IsPublic !== false,
      })),
    };
  }

  async function favlistContents(
    opts: { favlistUrlToken: string | number; offset?: string | number; limit?: number },
    identity: ZhihuIdentity = {},
  ): Promise<{ items: ZhihuCollectionItem[]; paging: ZhihuPaging }> {
    const endpoint = '/api/v1/user/favlist_contents';
    const token = String(opts.favlistUrlToken).trim();
    if (!/^\d+$/.test(token)) throw new ZhihuApiError('param', endpoint, 'FavlistUrlToken 必须是正整数');
    const data = await api<{ Items?: unknown; Paging?: RawPaging }>(
      endpoint,
      { FavlistUrlToken: token, Offset: opts.offset ?? 0, Limit: clamp(opts.limit, 1, 50, 20) },
      identity,
    );
    return { items: items(data, mapCollectionItem), paging: parsePaging(data.Paging, endpoint) };
  }

  /** 近期收藏：没有 Offset / Paging，只是最近一批，不等于完整历史 */
  async function recentCollections(opts: { limit?: number } = {}, identity: ZhihuIdentity = {}): Promise<{ items: ZhihuCollectionItem[] }> {
    const endpoint = '/api/v1/user/collections';
    const data = await api<{ Items?: unknown }>(endpoint, { Limit: clamp(opts.limit, 1, 50, 20) }, identity);
    return { items: items(data, mapCollectionItem) };
  }

  // ----- OAuth -----

  /** 授权页。state 会带上，但实测回调可能不回传——CSRF 要靠我们自己的会话绑定，不能只指望它 */
  function buildAuthorizeUrl(opts: { state?: string } = {}): string {
    if (!config.oauth.appId || !config.oauth.redirectUri) {
      throw new ZhihuApiError('oauth', '/authorize', 'ZHIHU_OAUTH_APP_ID / ZHIHU_OAUTH_REDIRECT_URI 未配置');
    }
    const url = new URL('/authorize', config.oauthBaseUrl);
    url.searchParams.set('redirect_uri', config.oauth.redirectUri);
    url.searchParams.set('app_id', config.oauth.appId);
    url.searchParams.set('response_type', 'code');
    if (opts.state) url.searchParams.set('state', opts.state);
    return url.toString();
  }

  /** 回调参数实测叫 authorization_code；兼容旧文档的 code */
  function extractAuthorizationCode(params: URLSearchParams | Record<string, string | undefined>): string | null {
    const get = (key: string) => (params instanceof URLSearchParams ? params.get(key) : params[key]) ?? null;
    const code = get('authorization_code') || get('code');
    return code && code.trim() ? code.trim() : null;
  }

  async function exchangeAuthorizationCode(code: string): Promise<ZhihuOAuthToken> {
    const endpoint = '/access_token';
    if (!config.oauth.appId || !config.oauth.appKey || !config.oauth.redirectUri) {
      throw new ZhihuApiError('oauth', endpoint, 'OAuth 三件套未配齐（app_id / app_key / redirect_uri）');
    }
    const form = new URLSearchParams({
      app_id: config.oauth.appId,
      app_key: config.oauth.appKey,
      grant_type: 'authorization_code', // 固定枚举值，不是从回调读的
      redirect_uri: config.oauth.redirectUri,
      code, // 承载回调里的 authorization_code
    });
    const response = await doFetch(
      new URL(endpoint, config.oauthBaseUrl).toString(),
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() },
      endpoint,
      config.timeoutMs,
    );
    const payload = await readJson<Record<string, unknown>>(response, endpoint);
    // 实测 access_token 可能在顶层，也可能包在 data / Data 里；业务码 20000 表示成功
    const nested = (payload.data ?? payload.Data) as Record<string, unknown> | undefined;
    const source = nested && typeof nested === 'object' ? nested : payload;
    const accessToken = str(source.access_token);
    if (!response.ok || !accessToken) {
      log.warn('zhihu-open: oauth exchange failed', { endpoint, status: response.status, code: payload.code ?? payload.Code });
      throw new ZhihuApiError('oauth', endpoint, str(payload.message ?? payload.Message) || '未获得 OAuth access token', {
        status: response.status,
        code: (payload.code ?? payload.Code) as number | string | undefined,
      });
    }
    const expiresIn = num(source.expires_in, 3600);
    return {
      accessToken,
      tokenType: str(source.token_type) || 'Bearer',
      expiresIn,
      expiresAt: now() + expiresIn * 1000,
    };
  }

  /** /user 没有正式 schema：尽力取昵称头像，拿不到返回 null，不抛错也不伪造字段 */
  async function fetchOAuthProfile(oauthToken: string): Promise<ZhihuOAuthProfile | null> {
    const endpoint = '/user';
    try {
      const response = await doFetch(
        new URL(endpoint, config.oauthBaseUrl).toString(),
        { method: 'GET', headers: baseHeaders(endpoint, { oauthToken }) },
        endpoint,
        config.timeoutMs,
      );
      if (!response.ok) return null;
      const payload = await readJson<Record<string, unknown>>(response, endpoint);
      const source = (payload.data ?? payload.Data ?? payload.user ?? payload) as Record<string, unknown>;
      if (!source || typeof source !== 'object') return null;
      const profile: ZhihuOAuthProfile = {
        name: str(source.name ?? source.Fullname ?? source.fullname) || null,
        avatarUrl: str(source.avatar_url ?? source.AvatarUrl) || null,
        headline: str(source.headline ?? source.Headline) || null,
        url: str(source.url ?? source.Url) || null,
      };
      return profile.name || profile.url ? profile : null;
    } catch (error) {
      log.warn('zhihu-open: profile fetch failed', { endpoint, kind: (error as ZhihuApiError)?.kind });
      return null;
    }
  }

  return {
    config,
    searchZhihu,
    searchGlobal,
    hotList,
    zhida,
    userContents,
    userFollowees,
    userFavlists,
    favlistContents,
    recentCollections,
    buildAuthorizeUrl,
    extractAuthorizationCode,
    exchangeAuthorizationCode,
    fetchOAuthProfile,
  };
}

export type ZhihuOpenClient = ReturnType<typeof createZhihuOpenClient>;

let defaultClient: ZhihuOpenClient | null = null;

/** 进程内单例（读 process.env）；测试请用 createZhihuOpenClient 注入 */
export function getZhihuOpenClient(): ZhihuOpenClient {
  if (!defaultClient) defaultClient = createZhihuOpenClient();
  return defaultClient;
}
