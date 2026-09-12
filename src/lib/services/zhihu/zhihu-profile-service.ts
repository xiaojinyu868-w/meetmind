/**
 * 知乎画像 → 个人上下文冷启动。
 *
 * 一个新用户连上知乎那一刻，MeetMind 对他还一无所知；但他的收藏夹叫什么、最近收了什么、关注谁、自己写过什么，
 * 已经是一份很诚实的「我在学什么」。这里把这些整理成**一条**有来源的学习观察，走 recordLearningObservation 双写：
 * LearningEvent（activity，进最近学习现场）+ ContextEvent（原始经历 → Hindsight，供 Tutor / teach / 应用矩阵的 prepare 召回）。
 *
 * 边界：
 * - 只写用户自己的公开 / 授权数据；不写别人的（知乎接口也给不了）；不进分享态
 * - 观察是"事实清单"，不在这里下判断（"他是初学者"这类留给读侧的模型）；≤ 900 字
 * - 24 小时内同一用户只写一次（进程内节流）；幂等键按天，重放不重复
 * - 任一子接口失败只少一段，不整条放弃；全部失败才跳过
 */

import { createLogger } from '@/lib/logger';
import { recordLearningObservation } from '@/lib/services/learning-observation-service';
import type { LearningEventInput } from '@/types/learning-event';
import type { ZhihuCollectionItem, ZhihuFavlist, ZhihuFollowee, ZhihuIdentity, ZhihuOpenClient, ZhihuUserContentItem } from './zhihu-open-client';
import { getZhihuOpenClient } from './zhihu-open-client';

const log = createLogger('zhihu-profile');

export const PROFILE_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const lastProfileAt = new Map<string, number>();

export function resetProfileThrottle(userId?: string): void {
  if (userId) lastProfileAt.delete(userId);
  else lastProfileAt.clear();
}

export interface ZhihuProfileFacts {
  favlists: ZhihuFavlist[];
  recent: ZhihuCollectionItem[];
  followees: ZhihuFollowee[];
  answers: ZhihuUserContentItem[];
  articles: ZhihuUserContentItem[];
}

function kindLabel(contentType: string): string {
  const t = contentType.toLowerCase();
  if (t === 'article') return '文章';
  if (t === 'answer') return '回答';
  if (t === 'zvideo') return '视频';
  if (t === 'pin') return '想法';
  if (t === 'question') return '问题';
  return contentType;
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** 纯函数：事实 → 一段给记忆看的中文（有来源、无判断） */
export function buildZhihuProfileObservation(facts: ZhihuProfileFacts, now: Date = new Date()): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const parts: string[] = [`知乎账号里的学习痕迹（${day} 同步，来源：本人授权的知乎开放平台数据）。`];

  if (facts.favlists.length) {
    const named = facts.favlists.slice(0, 8).map((f) => `「${clip(f.title, 20)}」${f.isPublic ? '' : '（私密）'}${f.description ? `：${clip(f.description, 30)}` : ''}`);
    parts.push(`收藏夹 ${facts.favlists.length} 个：${named.join('、')}。`);
  }
  if (facts.recent.length) {
    const lines = facts.recent.slice(0, 8).map((item) => `《${clip(item.title || item.summary, 28)}》（${kindLabel(item.contentType)}${item.author?.name ? `，${clip(item.author.name, 12)}` : ''}）`);
    parts.push(`最近收藏：${lines.join('；')}。`);
  }
  if (facts.followees.length) {
    const lines = facts.followees.slice(0, 6).map((f) => `${clip(f.fullname, 12)}${f.headline ? `（${clip(f.headline, 18)}）` : ''}`);
    parts.push(`关注的作者：${lines.join('、')}。`);
  }
  const own = [...facts.answers.slice(0, 3), ...facts.articles.slice(0, 3)];
  if (own.length) {
    const lines = own.map((item) => `《${clip(item.title || item.summary, 28)}》（${kindLabel(item.contentType)}，赞同 ${item.likeCount}）`);
    parts.push(`自己写过：${lines.join('；')}。`);
  }
  if (parts.length === 1) return '';
  return clip(parts.join('\n'), 900);
}

/** 拉四类事实；单项失败记日志、当空处理 */
export async function collectZhihuProfileFacts(client: ZhihuOpenClient, identity: ZhihuIdentity, opts: { recent?: ZhihuCollectionItem[]; favlists?: ZhihuFavlist[] } = {}): Promise<ZhihuProfileFacts> {
  const safe = async <T>(label: string, run: () => Promise<T>, empty: T): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      log.warn('zhihu-profile: facts partial', { label, message: (error as Error)?.message });
      return empty;
    }
  };
  const [favlists, recent, followees, answers, articles] = await Promise.all([
    opts.favlists ? Promise.resolve(opts.favlists) : safe('favlists', async () => (await client.userFavlists({ limit: 20 }, identity)).items, []),
    opts.recent ? Promise.resolve(opts.recent) : safe('recent', async () => (await client.recentCollections({ limit: 20 }, identity)).items, []),
    safe('followees', async () => (await client.userFollowees({ limit: 20 }, identity)).items, []),
    safe('answers', async () => (await client.userContents({ contentType: 'answer', sortField: 'like_count', sortOrder: 'desc', limit: 5 }, identity)).items, []),
    safe('articles', async () => (await client.userContents({ contentType: 'article', sortField: 'like_count', sortOrder: 'desc', limit: 5 }, identity)).items, []),
  ]);
  return { favlists, recent, followees, answers, articles };
}

export interface RecordZhihuProfileDeps {
  client?: ZhihuOpenClient;
  record?: (userId: string, input: LearningEventInput) => Promise<unknown>;
  now?: () => number;
}

/**
 * 把这个人的知乎画像写成一条学习观察。返回写没写（节流 / 没有事实 → false）。
 * 调用方（/api/zhihu/sync）fire-and-forget；这里自己兜错误，永不 throw。
 */
export async function recordZhihuProfileObservation(
  userId: string,
  identity: ZhihuIdentity,
  opts: { force?: boolean; recent?: ZhihuCollectionItem[]; favlists?: ZhihuFavlist[] } = {},
  deps: RecordZhihuProfileDeps = {},
): Promise<boolean> {
  const now = deps.now ?? Date.now;
  const last = lastProfileAt.get(userId) ?? 0;
  if (!opts.force && now() - last < PROFILE_MIN_INTERVAL_MS) return false;
  lastProfileAt.set(userId, now());
  try {
    const client = deps.client ?? getZhihuOpenClient();
    const facts = await collectZhihuProfileFacts(client, identity, { recent: opts.recent, favlists: opts.favlists });
    const content = buildZhihuProfileObservation(facts, new Date(now()));
    if (!content) return false;
    const day = content.match(/（(\d{4}-\d{2}-\d{2}) 同步/)?.[1] ?? 'unknown';
    const record = deps.record ?? recordLearningObservation;
    await record(userId, {
      appId: 'zhihu',
      type: 'activity',
      payload: {
        v: 1,
        kind: 'capture',
        title: '连上了知乎：收藏夹、最近收藏、关注与创作同步进了个人上下文',
        detail: `收藏夹 ${facts.favlists.length} 个 · 最近收藏 ${facts.recent.length} 条 · 关注 ${facts.followees.length} 人 · 创作 ${facts.answers.length + facts.articles.length} 篇`,
      },
      sourceId: `zhihu-profile:${userId}`,
      idempotencyKey: `zhihu-profile:${userId}:${day}`,
      observation: { type: 'zhihu.profile', content, locator: 'zhihu://me' },
    });
    log.info('zhihu-profile: observation recorded', { userId, chars: content.length });
    return true;
  } catch (error) {
    log.warn('zhihu-profile: skipped', { userId, message: (error as Error)?.message });
    return false;
  }
}
