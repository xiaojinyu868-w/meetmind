/**
 * 同学读一个收藏夹：把几十上百条收藏按"适合放在同一节课里一起讲"分成几条线，并挑出最值得先讲的那一篇。
 *
 * 为什么要这一步：真实收藏夹是杂的（暑期工的想法和 dLLM 的回答躺在一起），"一个收藏夹 = 一节课"不成立；
 * 课的单位是一篇或一条线。这里是"机器先理解，再给学生选"——不是让学生填表分类。
 *
 * 一次模型调用（tutorQuick），只看标题 / 类型 / 作者 / 摘要，不抓正文；结果按条目集合的 hash 落盘缓存，条目变了才重算。
 * 模型给不出合法 JSON 时退回"一条线 = 全部可讲的"，页面照样能用。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chat, type ChatMessage } from '@/lib/services/llm-service';
import { ModelDefaults } from '@/lib/config/app.config';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { createLogger } from '@/lib/logger';
import type { ZhihuCaptureRecord } from './zhihu-import-service';

const log = createLogger('zhihu-theme');

export interface ZhihuFavlistTheme {
  id: string;
  /** 像课程名，不像标签 */
  title: string;
  /** 一句话：为什么这几篇是一条线 */
  why: string;
  itemIds: string[];
}

export interface ZhihuFavlistThemes {
  v: 1;
  favlistUrlToken: string;
  hash: string;
  themes: ZhihuFavlistTheme[];
  /** 零散的：不属于任何一条线（含视频 / 想法这类没法讲的） */
  misc: string[];
  /** 最值得先讲的那一篇 + 为什么 */
  start: { itemId: string; why: string } | null;
  source: 'model' | 'fallback' | 'trivial';
  model: string | null;
  createdAt: string;
}

export type ThemeChatFn = (messages: ChatMessage[], modelId: string, options?: { temperature?: number; maxTokens?: number; responseFormat?: 'json_object' | 'text' }) => Promise<{ content: string }>;

const KIND_LABEL: Record<string, string> = { answer: '回答', article: '文章', question: '问题', zvideo: '视频', pin: '想法', unknown: '内容' };
const TEACHABLE = new Set(['answer', 'article', 'question']);
const MAX_ITEMS = 120;

function themesDir(): string {
  return path.join(process.cwd(), process.env.ZHIHU_THEMES_DIR || 'data/zhihu-themes');
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

function cachePath(userId: string, favlistUrlToken: string): string {
  return path.join(themesDir(), safeName(userId), `${safeName(favlistUrlToken)}.json`);
}

/** 条目集合（id + 标题）的指纹：收藏夹加了 / 删了条目就重算 */
export function themesHash(records: ZhihuCaptureRecord[]): string {
  const h = createHash('sha1');
  for (const r of [...records].sort((a, b) => a.id.localeCompare(b.id))) h.update(`${r.id}|${r.title}\n`);
  return h.digest('hex').slice(0, 16);
}

export function buildThemePrompt(favlistTitle: string, records: ZhihuCaptureRecord[]): { messages: ChatMessage[]; alias: Map<string, string> } {
  const alias = new Map<string, string>();
  const lines = records.map((r, i) => {
    const n = String(i + 1);
    alias.set(n, r.id);
    const summary = (r.previewText ?? r.normalizedText ?? '').replace(/\s+/g, ' ').trim().slice(0, 110);
    return `${n}. [${KIND_LABEL[r.zhihu.kind] ?? '内容'}] ${r.title}${r.zhihu.author ? ` — ${r.zhihu.author}` : ''}（赞同 ${r.zhihu.voteUpCount}）${summary ? `：${summary}` : ''}`;
  });
  const system = `你是一位同学，正在翻一位学生的知乎收藏夹「${favlistTitle}」，准备之后一篇一篇讲给 TA 听。
先把这些收藏分成几条"线"：一条线 = 放在同一节课里一起讲得通的几篇（同一个主题、同一条推进路径，或互相补充 / 互相反驳）。
- 线的名字像一门小课的名字（如「词向量：从 One-Hot 到 Word2Vec」），不像标签；why 一句话说清为什么这几篇是一条线
- 每条线 2–6 篇；一篇就能成课但和别的都不搭的，也可以单独成线
- 视频、想法这类没有正文可讲的，以及和别的都不搭、单独也不值得讲的，放 misc
- 再挑出最值得**先**讲的一篇（start）：基础、被其他篇依赖、或讲得最清楚；why 一句话（≤40 字），说给学生听
只输出 JSON：{"themes":[{"title":"…","why":"…","ids":[1,2]}],"misc":[7],"start":{"id":1,"why":"…"}}。ids 用下面的编号。`;
  return { messages: [{ role: 'system', content: system }, { role: 'user', content: lines.join('\n') }], alias };
}

interface RawThemes {
  themes?: Array<{ title?: unknown; why?: unknown; ids?: unknown }>;
  misc?: unknown;
  start?: { id?: unknown; why?: unknown } | null;
}

/** 把模型输出对回真实 id：未知编号丢掉、一篇只能属于一条线、空线丢掉；没归到任何线的补进 misc */
export function normalizeThemes(raw: RawThemes | null, alias: Map<string, string>, records: ZhihuCaptureRecord[]): Pick<ZhihuFavlistThemes, 'themes' | 'misc' | 'start'> | null {
  if (!raw || !Array.isArray(raw.themes)) return null;
  const taken = new Set<string>();
  const resolve = (value: unknown): string | null => {
    const key = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
    const id = alias.get(key);
    return id ?? null;
  };
  const themes: ZhihuFavlistTheme[] = [];
  raw.themes.forEach((t, index) => {
    const ids: string[] = [];
    for (const value of Array.isArray(t?.ids) ? t.ids : []) {
      const id = resolve(value);
      if (id && !taken.has(id)) {
        taken.add(id);
        ids.push(id);
      }
    }
    if (!ids.length) return;
    const title = typeof t.title === 'string' && t.title.trim() ? t.title.trim().slice(0, 40) : `第 ${index + 1} 条线`;
    const why = typeof t.why === 'string' ? t.why.trim().slice(0, 80) : '';
    themes.push({ id: `t${index + 1}`, title, why, itemIds: ids });
  });
  if (!themes.length) return null;
  const misc = records.map((r) => r.id).filter((id) => !taken.has(id));
  const startId = resolve(raw.start?.id);
  const start = startId && TEACHABLE.has(records.find((r) => r.id === startId)?.zhihu.kind ?? '') ? { itemId: startId, why: typeof raw.start?.why === 'string' ? raw.start.why.trim().slice(0, 60) : '' } : null;
  return { themes, misc, start };
}

function fallbackThemes(records: ZhihuCaptureRecord[], favlistTitle: string): Pick<ZhihuFavlistThemes, 'themes' | 'misc' | 'start'> {
  const teachable = records.filter((r) => TEACHABLE.has(r.zhihu.kind) && (r.normalizedText ?? '').trim());
  const misc = records.filter((r) => !teachable.includes(r)).map((r) => r.id);
  const best = [...teachable].sort((a, b) => b.zhihu.voteUpCount - a.zhihu.voteUpCount)[0];
  return {
    themes: teachable.length ? [{ id: 't1', title: favlistTitle, why: '同学这次没能分出线，先按收藏夹整体看', itemIds: teachable.map((r) => r.id) }] : [],
    misc,
    start: best ? { itemId: best.id, why: '这个收藏夹里赞同最多的一篇' } : null,
  };
}

export async function readCachedThemes(userId: string, favlistUrlToken: string): Promise<ZhihuFavlistThemes | null> {
  try {
    const raw = await fs.readFile(cachePath(userId, favlistUrlToken), 'utf8');
    const parsed = JSON.parse(raw) as ZhihuFavlistThemes;
    return parsed?.v === 1 && Array.isArray(parsed.themes) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeCachedThemes(userId: string, favlistUrlToken: string, themes: ZhihuFavlistThemes): Promise<void> {
  const file = cachePath(userId, favlistUrlToken);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(themes, null, 2), 'utf8');
}

/**
 * 读收藏夹分线：缓存命中（hash 一致）直接回；否则叫一次模型；只有 ≤1 篇可讲的不叫模型。
 */
export async function themesForFavlist(
  userId: string,
  favlistUrlToken: string,
  favlistTitle: string,
  records: ZhihuCaptureRecord[],
  opts: { chatFn?: ThemeChatFn; modelId?: string; force?: boolean; now?: () => number } = {},
): Promise<ZhihuFavlistThemes> {
  const now = opts.now ?? Date.now;
  const limited = records.slice(0, MAX_ITEMS);
  const hash = themesHash(limited);
  if (!opts.force) {
    const cached = await readCachedThemes(userId, favlistUrlToken);
    if (cached && cached.hash === hash) return cached;
  }
  const teachable = limited.filter((r) => TEACHABLE.has(r.zhihu.kind) && (r.normalizedText ?? '').trim());
  const base = { v: 1 as const, favlistUrlToken, hash, model: null as string | null, createdAt: new Date(now()).toISOString() };

  if (teachable.length <= 1) {
    const result: ZhihuFavlistThemes = { ...base, ...fallbackThemes(limited, favlistTitle), source: 'trivial' };
    await writeCachedThemes(userId, favlistUrlToken, result).catch(() => undefined);
    return result;
  }

  const chatFn: ThemeChatFn = opts.chatFn ?? ((messages, modelId, options) => chat(messages, modelId, options));
  const modelId = opts.modelId ?? ModelDefaults.tutorQuick ?? ModelDefaults.workshop;
  let normalized: Pick<ZhihuFavlistThemes, 'themes' | 'misc' | 'start'> | null = null;
  try {
    const { messages, alias } = buildThemePrompt(favlistTitle, limited);
    const response = await Promise.race([
      chatFn(messages, modelId, { temperature: 0.3, maxTokens: 1800, responseFormat: 'json_object' }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('theme_timeout')), 45_000)),
    ]);
    normalized = normalizeThemes(parseJsonResponse<RawThemes>(response.content), alias, limited);
  } catch (error) {
    log.warn('zhihu-theme: model failed, using fallback', { favlistUrlToken, message: (error as Error)?.message });
  }
  const result: ZhihuFavlistThemes = normalized
    ? { ...base, ...normalized, source: 'model', model: modelId }
    : { ...base, ...fallbackThemes(limited, favlistTitle), source: 'fallback', model: modelId };
  await writeCachedThemes(userId, favlistUrlToken, result).catch((error: Error) => log.warn('zhihu-theme: cache write failed', { message: error.message }));
  log.info('zhihu-theme: computed', { userId, favlistUrlToken, items: limited.length, themes: result.themes.length, misc: result.misc.length, source: result.source });
  return result;
}
