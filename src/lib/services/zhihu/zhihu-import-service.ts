/**
 * 收藏夹 → 收集流（server-only）。
 *
 * 一条收藏 = 一个 WorkspaceCapture（sourceType 'zhihu-favorite'）。两条原则来自产品论点 §4：
 * - 同一个 canonical URL 不因 utm / 换设备重复生成 capture：sourceKey = zhihu:<userId>:<sha1(canonicalUrl)>，
 *   而 upsertCaptureForUser 自己还会按 canonical URL 合并（用户以前手动贴过同一条回答也只留一行）。
 * - 正文状态诚实：导入时只有 API 给的摘要 → provenance.contentState 'partial'、metadata.zhihu.body 'summary'；
 *   开课 / 情报真用到某条时才 materialize（Firecrawl ≈1 credit / 页）→ 去杂质 → 'complete'；抽不到就留摘要并记失败时间，不装满。
 *
 * 身份：优先该用户绑定的知乎 OAuth token；过期（3600 s 无 refresh）就报 reconnect，不静默降级；
 * 只有配置里点名的「本人模式」用户才允许不带 token 读 Access Secret 所属账号——演示与 smoke 的兜底。
 */

import { createHash } from 'node:crypto';
import prisma from '@/lib/prisma';
import { workspaceContextService } from '@/lib/services/workspace-context-service';
import { extractWebArticle } from '@/lib/services/web-article-extract-service';
import { buildSourceProvenance, canonicalizeSourceUrl } from '@/lib/capture/source-provenance';
import { getZhihuConfig, type ZhihuConfig } from '@/lib/config/zhihu.config';
import { createLogger } from '@/lib/logger';
import { getZhihuIdentityForUser } from './zhihu-auth-service';
import { getZhihuOpenClient, type ZhihuCollectionItem, type ZhihuFavlist, type ZhihuIdentity, type ZhihuOpenClient } from './zhihu-open-client';
import { cleanZhihuPage, detectZhihuPageKind, type ZhihuPageKind } from './zhihu-page-clean';

const log = createLogger('zhihu-import');

export const ZHIHU_CAPTURE_SOURCE_TYPE = 'zhihu-favorite';
const MAX_IMPORT_ITEMS = 100;
const PAGE_SIZE = 50;
const MIN_FULL_BODY_CHARS = 200;

export type ZhihuImportErrorCode = 'zhihu_not_connected' | 'zhihu_reconnect' | 'zhihu_disabled' | 'favlist_not_found' | 'capture_not_found';

export class ZhihuImportError extends Error {
  readonly code: ZhihuImportErrorCode;
  constructor(code: ZhihuImportErrorCode, message: string) {
    super(message);
    this.name = 'ZhihuImportError';
    this.code = code;
  }
}

/** metadata.zhihu —— 一条知乎收藏在 capture 上留下的事实（v1） */
export interface ZhihuCaptureMeta {
  v: 1;
  kind: ZhihuPageKind;
  url: string;
  title: string;
  author: string | null;
  authorUrl: string | null;
  voteUpCount: number;
  commentCount: number;
  favoriteCount: number;
  /** 内容创建时间（秒） */
  createdAt: number;
  /** 收藏时间（秒） */
  favTime: number;
  favlists: Array<{ urlToken: string; title: string }>;
  /** 正文状态：导入只有摘要；materialize 成功后为 full */
  body: 'summary' | 'full';
  /** 去杂质是否找到了全部结构标记（false = 正文可能仍含页面杂质） */
  cleanConfident?: boolean;
  /** 页面上的编辑 / 发布时间 */
  editedAt?: string | null;
  extractedAt?: string;
  extractFailedAt?: string;
  extractError?: string;
}

export interface ZhihuCaptureRecord {
  id: string;
  sourceKey: string;
  title: string;
  previewText: string | null;
  normalizedText: string | null;
  sourceUrl: string | null;
  occurredAt: Date | null;
  zhihu: ZhihuCaptureMeta;
}

export type ZhihuIdentityMode = 'oauth' | 'self';

export interface ResolvedZhihuIdentity {
  mode: ZhihuIdentityMode;
  identity: ZhihuIdentity;
  /** OAuth 模式下的过期时刻；本人模式为 null */
  expiresAt: Date | null;
}

export interface ZhihuImportDeps {
  client: ZhihuOpenClient;
  config: ZhihuConfig;
  now: () => number;
  getIdentity: typeof getZhihuIdentityForUser;
  upsertCapture: typeof workspaceContextService.upsertCaptureForUser;
  extract: typeof extractWebArticle;
}

function defaultDeps(): ZhihuImportDeps {
  return {
    client: getZhihuOpenClient(),
    config: getZhihuConfig(),
    now: () => Date.now(),
    getIdentity: getZhihuIdentityForUser,
    upsertCapture: (userId, input) => workspaceContextService.upsertCaptureForUser(userId, input),
    extract: extractWebArticle,
  };
}

function mergeDeps(deps: Partial<ZhihuImportDeps>): ZhihuImportDeps {
  return { ...defaultDeps(), ...deps };
}

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

export function zhihuSourceKey(userId: string, url: string): string {
  const canonical = canonicalizeSourceUrl(url) ?? url.trim();
  return `zhihu:${userId}:${createHash('sha1').update(canonical).digest('hex').slice(0, 16)}`;
}

export function parseZhihuMeta(metadataJson: string | null | undefined): ZhihuCaptureMeta | null {
  if (!metadataJson) return null;
  try {
    const parsed = JSON.parse(metadataJson) as { zhihu?: unknown };
    const meta = parsed?.zhihu;
    if (!meta || typeof meta !== 'object' || (meta as ZhihuCaptureMeta).v !== 1) return null;
    return meta as ZhihuCaptureMeta;
  } catch {
    return null;
  }
}

function compact(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

/** 收藏条目 → capture 输入（只有摘要那一版） */
export function captureInputFromCollectionItem(userId: string, item: ZhihuCollectionItem, favlist: ZhihuFavlist | null) {
  const canonical = canonicalizeSourceUrl(item.url) ?? item.url;
  const kind = detectZhihuPageKind(canonical);
  const summary = item.summary.trim();
  const favlists = item.favlists.length
    ? item.favlists.map((f) => ({ urlToken: f.urlToken, title: f.title }))
    : favlist
      ? [{ urlToken: favlist.urlToken, title: favlist.title }]
      : [];
  const zhihu: ZhihuCaptureMeta = {
    v: 1,
    kind,
    url: canonical,
    title: item.title,
    author: item.author?.name ?? null,
    authorUrl: item.author?.url ?? null,
    voteUpCount: item.likeCount,
    commentCount: item.commentCount,
    favoriteCount: item.favoriteCount,
    createdAt: item.createdAt,
    favTime: item.favTime,
    favlists,
    body: 'summary',
  };
  return {
    sourceType: ZHIHU_CAPTURE_SOURCE_TYPE,
    sourceKey: zhihuSourceKey(userId, canonical),
    role: 'support',
    contentType: 'text',
    title: item.title || compact(summary, 60) || '知乎收藏',
    previewText: compact(summary, 180),
    normalizedText: summary,
    sourceUrl: canonical,
    occurredAt: item.favTime ? new Date(item.favTime * 1000).toISOString() : undefined,
    metadata: {
      zhihu,
      provenance: buildSourceProvenance({
        ingressChannel: 'system',
        sourceUrl: canonical,
        normalizedText: summary,
        platformId: 'zhihu',
        platformLabel: '知乎',
        author: item.author?.name ?? undefined,
        publishedAt: item.createdAt ? new Date(item.createdAt * 1000).toISOString() : undefined,
        extractionMethod: 'zhihu-api-summary',
        contentState: 'partial', // 摘要不是正文，如实标 partial
        completeness: 0.2,
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// 身份
// ---------------------------------------------------------------------------

export async function resolveZhihuIdentity(userId: string, deps: Partial<ZhihuImportDeps> = {}): Promise<ResolvedZhihuIdentity> {
  const d = mergeDeps(deps);
  if (!d.config.enabled) throw new ZhihuImportError('zhihu_disabled', '知乎接入未开启');
  const linked = await d.getIdentity(userId, d.now());
  if (linked) {
    if (linked.expired) throw new ZhihuImportError('zhihu_reconnect', '知乎授权已过期，请重新连接知乎');
    return { mode: 'oauth', identity: { oauthToken: linked.oauthToken }, expiresAt: linked.expiresAt };
  }
  if (d.config.selfModeUserIds.includes(userId)) {
    return { mode: 'self', identity: {}, expiresAt: null };
  }
  throw new ZhihuImportError('zhihu_not_connected', '还没有连接知乎账号');
}

export async function getZhihuConnection(userId: string, deps: Partial<ZhihuImportDeps> = {}): Promise<{ connected: boolean; mode: ZhihuIdentityMode | null; expired: boolean; expiresAt: string | null }> {
  const d = mergeDeps(deps);
  const linked = await d.getIdentity(userId, d.now());
  if (linked) return { connected: !linked.expired, mode: 'oauth', expired: linked.expired, expiresAt: linked.expiresAt?.toISOString() ?? null };
  if (d.config.enabled && d.config.selfModeUserIds.includes(userId)) return { connected: true, mode: 'self', expired: false, expiresAt: null };
  return { connected: false, mode: null, expired: false, expiresAt: null };
}

// ---------------------------------------------------------------------------
// 收藏夹
// ---------------------------------------------------------------------------

export async function listFavlistsForUser(userId: string, deps: Partial<ZhihuImportDeps> = {}): Promise<{ mode: ZhihuIdentityMode; favlists: ZhihuFavlist[] }> {
  const d = mergeDeps(deps);
  const resolved = await resolveZhihuIdentity(userId, d);
  const { items } = await d.client.userFavlists({ limit: 50 }, resolved.identity);
  return { mode: resolved.mode, favlists: items };
}

export interface ImportFavlistResult {
  mode: ZhihuIdentityMode;
  favlist: ZhihuFavlist | null;
  fetched: number;
  imported: number;
  /** 视频 / 想法等没有可讲正文的内容类型，导入了但开课时会跳过 */
  captures: ZhihuCaptureRecord[];
}

export async function importFavlist(
  userId: string,
  favlistUrlToken: string,
  opts: { limit?: number } = {},
  deps: Partial<ZhihuImportDeps> = {},
): Promise<ImportFavlistResult> {
  const d = mergeDeps(deps);
  const resolved = await resolveZhihuIdentity(userId, d);
  const limit = Math.min(MAX_IMPORT_ITEMS, Math.max(1, opts.limit ?? MAX_IMPORT_ITEMS));

  const { items: favlists } = await d.client.userFavlists({ limit: 50 }, resolved.identity);
  const favlist = favlists.find((f) => f.urlToken === String(favlistUrlToken)) ?? null;

  const collected: ZhihuCollectionItem[] = [];
  let offset: string | number = 0;
  while (collected.length < limit) {
    const page = await d.client.favlistContents(
      { favlistUrlToken, offset, limit: Math.min(PAGE_SIZE, limit - collected.length) },
      resolved.identity,
    );
    collected.push(...page.items);
    if (page.paging.isEnd || !page.paging.nextOffset || page.items.length === 0) break;
    offset = page.paging.nextOffset;
  }

  const captures: ZhihuCaptureRecord[] = [];
  for (const item of collected) {
    if (!item.url) continue;
    const input = captureInputFromCollectionItem(userId, item, favlist);
    const { capture } = await d.upsertCapture(userId, input);
    captures.push({
      id: capture.id,
      sourceKey: capture.sourceKey,
      title: capture.title,
      previewText: capture.previewText ?? null,
      normalizedText: capture.normalizedText ?? null,
      sourceUrl: capture.sourceUrl ?? null,
      occurredAt: capture.occurredAt ? new Date(capture.occurredAt) : null,
      zhihu: (input.metadata.zhihu as ZhihuCaptureMeta),
    });
  }
  log.info('zhihu-import: favlist imported', { userId, favlistUrlToken, fetched: collected.length, imported: captures.length, mode: resolved.mode });
  return { mode: resolved.mode, favlist, fetched: collected.length, imported: captures.length, captures };
}

// ---------------------------------------------------------------------------
// 最近收藏自动同步（零动作入口：在知乎点了收藏，回到 MeetMind 就已经在）
// ---------------------------------------------------------------------------

export interface SyncRecentResult {
  mode: 'oauth' | 'self';
  scanned: number;
  added: number;
  skipped: 'throttled' | null;
  /** 给同一请求里的后续步骤（画像观察）复用，路由不要把它原样返回给客户端 */
  identity: ZhihuIdentity;
  items: ZhihuCollectionItem[];
}

/** 同一用户两次同步之间的最短间隔：知乎 /user/collections 额度有限，第一屏每次打开都会调 */
export const SYNC_MIN_INTERVAL_MS = 15 * 60 * 1000;
const lastSyncAt = new Map<string, number>();

/** 测试 / 手动触发用 */
export function resetSyncThrottle(userId?: string): void {
  if (userId) lastSyncAt.delete(userId);
  else lastSyncAt.clear();
}

/**
 * 拉最近 50 条收藏（跨收藏夹），只新增本地没有的（已有的可能已物化全文，不覆盖）。
 * 只写摘要级 capture，不抓全文——这是入口不是开课；开课时再按需物化。
 */
export async function syncRecentCollections(
  userId: string,
  opts: { limit?: number; force?: boolean; now?: () => number } = {},
  deps: Partial<ZhihuImportDeps> = {},
): Promise<SyncRecentResult> {
  const d = mergeDeps(deps);
  const now = opts.now ?? Date.now;
  const resolved = await resolveZhihuIdentity(userId, d);
  const last = lastSyncAt.get(userId) ?? 0;
  if (!opts.force && now() - last < SYNC_MIN_INTERVAL_MS) return { mode: resolved.mode, scanned: 0, added: 0, skipped: 'throttled', identity: resolved.identity, items: [] };
  lastSyncAt.set(userId, now());

  const { items } = await d.client.recentCollections({ limit: Math.min(50, Math.max(1, opts.limit ?? 50)) }, resolved.identity);
  const withUrl = items.filter((item) => item.url);
  const keys = withUrl.map((item) => zhihuSourceKey(userId, canonicalizeSourceUrl(item.url) ?? item.url));
  const existing = keys.length
    ? await prisma.workspaceCapture.findMany({ where: { userId, sourceKey: { in: keys } }, select: { sourceKey: true } })
    : [];
  const known = new Set(existing.map((row) => row.sourceKey));

  let added = 0;
  for (let i = 0; i < withUrl.length; i += 1) {
    if (known.has(keys[i])) continue;
    const input = captureInputFromCollectionItem(userId, withUrl[i], null);
    await d.upsertCapture(userId, input);
    added += 1;
  }
  if (added > 0) log.info('zhihu-import: recent collections synced', { userId, scanned: withUrl.length, added, mode: resolved.mode });
  return { mode: resolved.mode, scanned: withUrl.length, added, skipped: null, identity: resolved.identity, items: withUrl };
}

// ---------------------------------------------------------------------------
// 读取与正文物化
// ---------------------------------------------------------------------------

export async function listZhihuCaptures(userId: string, opts: { favlistUrlToken?: string; ids?: string[] } = {}): Promise<ZhihuCaptureRecord[]> {
  const rows = await prisma.workspaceCapture.findMany({
    where: {
      userId,
      sourceType: ZHIHU_CAPTURE_SOURCE_TYPE,
      status: { not: 'deleted' },
      ...(opts.ids?.length ? { id: { in: opts.ids } } : {}),
    },
    orderBy: { occurredAt: 'desc' },
    select: { id: true, sourceKey: true, title: true, previewText: true, normalizedText: true, sourceUrl: true, occurredAt: true, metadataJson: true },
  });
  const records: ZhihuCaptureRecord[] = [];
  for (const row of rows) {
    const zhihu = parseZhihuMeta(row.metadataJson);
    if (!zhihu) continue;
    if (opts.favlistUrlToken && !zhihu.favlists.some((f) => f.urlToken === String(opts.favlistUrlToken))) continue;
    records.push({ ...row, zhihu });
  }
  return records;
}

export type MaterializeStatus = 'full' | 'already-full' | 'unsupported' | 'failed';

export interface MaterializeResult {
  captureId: string;
  status: MaterializeStatus;
  bodyChars: number;
  cleanConfident?: boolean;
  error?: string;
}

/** 视频 / 想法 / 未知页面没有可讲正文，不浪费 credit */
function isExtractableKind(kind: ZhihuPageKind): boolean {
  return kind === 'answer' || kind === 'article' || kind === 'question';
}

async function materializeOne(userId: string, record: ZhihuCaptureRecord, d: ZhihuImportDeps, force: boolean): Promise<MaterializeResult> {
  const meta = record.zhihu;
  if (meta.body === 'full' && !force) return { captureId: record.id, status: 'already-full', bodyChars: record.normalizedText?.length ?? 0, cleanConfident: meta.cleanConfident };
  if (!isExtractableKind(meta.kind)) return { captureId: record.id, status: 'unsupported', bodyChars: 0 };

  const nowIso = new Date(d.now()).toISOString();
  try {
    const article = await d.extract(meta.url, 'zhihu', '知乎');
    const cleaned = cleanZhihuPage(article.content, { url: meta.url, title: article.title });
    if (cleaned.body.length < MIN_FULL_BODY_CHARS) {
      throw new Error(`正文过短（${cleaned.body.length} 字）`);
    }
    const nextMeta: ZhihuCaptureMeta = {
      ...meta,
      body: 'full',
      cleanConfident: cleaned.confident,
      editedAt: cleaned.editedAt,
      author: meta.author ?? cleaned.author,
      authorUrl: meta.authorUrl ?? cleaned.authorUrl,
      voteUpCount: cleaned.voteUpCount ?? meta.voteUpCount,
      commentCount: cleaned.commentCount ?? meta.commentCount,
      extractedAt: nowIso,
      extractFailedAt: undefined,
      extractError: undefined,
    };
    await d.upsertCapture(userId, {
      sourceType: ZHIHU_CAPTURE_SOURCE_TYPE,
      sourceKey: record.sourceKey,
      role: 'support',
      contentType: 'text',
      title: record.title || cleaned.title,
      previewText: compact(cleaned.body, 180),
      normalizedText: cleaned.body,
      sourceUrl: meta.url,
      occurredAt: record.occurredAt?.toISOString(),
      metadata: {
        zhihu: nextMeta,
        provenance: buildSourceProvenance({
          ingressChannel: 'system',
          sourceUrl: meta.url,
          normalizedText: cleaned.body,
          platformId: 'zhihu',
          platformLabel: '知乎',
          author: nextMeta.author ?? undefined,
          publishedAt: meta.createdAt ? new Date(meta.createdAt * 1000).toISOString() : undefined,
          extractionMethod: `${article.extractMethod}+zhihu-page-clean`,
          contentState: 'complete',
          completeness: cleaned.confident ? 1 : 0.7,
        }),
      },
    });
    return { captureId: record.id, status: 'full', bodyChars: cleaned.body.length, cleanConfident: cleaned.confident };
  } catch (error) {
    const message = String((error as Error)?.message ?? error).slice(0, 200);
    log.warn('zhihu-import: materialize failed', { captureId: record.id, kind: meta.kind, message });
    // 抽不到就留摘要，把失败如实记在 metadata.zhihu 上（其余 metadata 原样保留）；provenance 仍是 partial
    const row = await prisma.workspaceCapture.findUnique({ where: { id: record.id }, select: { metadataJson: true } });
    let existing: Record<string, unknown> = {};
    try {
      existing = row?.metadataJson ? (JSON.parse(row.metadataJson) as Record<string, unknown>) : {};
    } catch {
      existing = {};
    }
    await prisma.workspaceCapture.update({
      where: { id: record.id },
      data: { metadataJson: JSON.stringify({ ...existing, zhihu: { ...meta, extractFailedAt: nowIso, extractError: message } }) },
    });
    return { captureId: record.id, status: 'failed', bodyChars: record.normalizedText?.length ?? 0, error: message };
  }
}

export async function materializeCaptures(
  userId: string,
  captureIds: string[],
  opts: { concurrency?: number; force?: boolean } = {},
  deps: Partial<ZhihuImportDeps> = {},
): Promise<MaterializeResult[]> {
  const d = mergeDeps(deps);
  const records = await listZhihuCaptures(userId, { ids: captureIds });
  const byId = new Map(records.map((r) => [r.id, r]));
  const missing = captureIds.filter((id) => !byId.has(id));
  if (missing.length) throw new ZhihuImportError('capture_not_found', `找不到这些收藏：${missing.join(', ')}`);

  const concurrency = Math.max(1, Math.min(5, opts.concurrency ?? 3));
  const queue = [...records];
  const results: MaterializeResult[] = [];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const record = queue.shift()!;
      results.push(await materializeOne(userId, record, d, Boolean(opts.force)));
    }
  });
  await Promise.all(workers);
  return captureIds.map((id) => results.find((r) => r.captureId === id)!).filter(Boolean);
}
