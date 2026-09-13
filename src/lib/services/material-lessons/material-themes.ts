/**
 * 同学读一组材料（能力层，与来源无关）：把几十上百条按"适合放在同一节课里一起讲"分成几条线，并挑出最值得先讲的那一篇。
 *
 * 为什么要这一步：真实的收藏夹 / 收集是杂的，"一组材料 = 一节课"不成立；课的单位是一篇或一条线。
 * 这里是"机器先理解，再给学生选"——不是让学生填表分类。
 *
 * 一次模型调用（tutorQuick），只看标题 / 体裁 / 作者 / 摘要，不抓正文；结果按条目集合的 hash 落盘缓存（按 userId + collectionKey），
 * 条目变了才重算。模型给不出合法 JSON 时退回"一条线 = 全部可讲的"，页面照样能用。
 * 从 services/zhihu/zhihu-theme-service 抽出（2026-09-13）。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chat, type ChatMessage } from '@/lib/services/llm-service';
import { ModelDefaults } from '@/lib/config/app.config';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { createLogger } from '@/lib/logger';
import { isTeachableKind, MATERIAL_KIND_LABEL, type MaterialCandidate } from './material-candidate';

const log = createLogger('material-themes');

export interface MaterialTheme {
  id: string;
  /** 像课程名，不像标签 */
  title: string;
  /** 一句话：为什么这几篇是一条线 */
  why: string;
  itemIds: string[];
}

export interface MaterialThemes {
  v: 1;
  /** 这组材料的标识（如 zhihu-favlist:<token>） */
  collectionKey: string;
  hash: string;
  themes: MaterialTheme[];
  /** 零散的：不属于任何一条线（含视频 / 想法这类没法讲的） */
  misc: string[];
  /** 最值得先讲的那一篇 + 为什么 */
  start: { itemId: string; why: string } | null;
  source: 'model' | 'fallback' | 'trivial';
  model: string | null;
  createdAt: string;
}

export type ThemeChatFn = (messages: ChatMessage[], modelId: string, options?: { temperature?: number; maxTokens?: number; responseFormat?: 'json_object' | 'text' }) => Promise<{ content: string }>;

const MAX_ITEMS = 120;

/** 缓存目录：沿用 ZHIHU_THEMES_DIR（历史环境变量名），默认 data/material-themes；老的 data/zhihu-themes 缓存丢了只是重算一次 */
function themesDir(): string {
  return path.join(process.cwd(), process.env.MATERIAL_THEMES_DIR || process.env.ZHIHU_THEMES_DIR || 'data/material-themes');
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

function cachePath(userId: string, collectionKey: string): string {
  return path.join(themesDir(), safeName(userId), `${safeName(collectionKey)}.json`);
}

/** 条目集合（id + 标题）的指纹：收藏夹加了 / 删了条目就重算 */
export function themesHash(candidates: MaterialCandidate[]): string {
  const h = createHash('sha1');
  for (const c of [...candidates].sort((a, b) => a.id.localeCompare(b.id))) h.update(`${c.id}|${c.title}\n`);
  return h.digest('hex').slice(0, 16);
}

export function buildThemePrompt(collectionTitle: string, candidates: MaterialCandidate[]): { messages: ChatMessage[]; alias: Map<string, string> } {
  const alias = new Map<string, string>();
  const lines = candidates.map((c, i) => {
    const n = String(i + 1);
    alias.set(n, c.id);
    const summary = (c.summary || c.text || '').replace(/\s+/g, ' ').trim().slice(0, 110);
    return `${n}. [${MATERIAL_KIND_LABEL[c.kind]}] ${c.title}${c.author ? ` — ${c.author}` : ''}（赞同 ${c.votes}）${summary ? `：${summary}` : ''}`;
  });
  const system = `你是一位同学，正在翻一位学生收藏的一组材料「${collectionTitle}」，准备之后一篇一篇讲给 TA 听。
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
export function normalizeThemes(raw: RawThemes | null, alias: Map<string, string>, candidates: MaterialCandidate[]): Pick<MaterialThemes, 'themes' | 'misc' | 'start'> | null {
  if (!raw || !Array.isArray(raw.themes)) return null;
  const taken = new Set<string>();
  const resolve = (value: unknown): string | null => {
    const key = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
    const id = alias.get(key);
    return id ?? null;
  };
  const themes: MaterialTheme[] = [];
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
  const misc = candidates.map((c) => c.id).filter((id) => !taken.has(id));
  const startId = resolve(raw.start?.id);
  const startCandidate = startId ? candidates.find((c) => c.id === startId) : undefined;
  const start = startId && startCandidate && isTeachableKind(startCandidate.kind) ? { itemId: startId, why: typeof raw.start?.why === 'string' ? raw.start.why.trim().slice(0, 60) : '' } : null;
  return { themes, misc, start };
}

function fallbackThemes(candidates: MaterialCandidate[], collectionTitle: string): Pick<MaterialThemes, 'themes' | 'misc' | 'start'> {
  const teachable = candidates.filter((c) => isTeachableKind(c.kind) && c.text.trim());
  const misc = candidates.filter((c) => !teachable.includes(c)).map((c) => c.id);
  const best = [...teachable].sort((a, b) => b.votes - a.votes)[0];
  return {
    themes: teachable.length ? [{ id: 't1', title: collectionTitle, why: '同学这次没能分出线，先按整组看', itemIds: teachable.map((c) => c.id) }] : [],
    misc,
    start: best ? { itemId: best.id, why: '这组里赞同最多的一篇' } : null,
  };
}

export async function readCachedThemes(userId: string, collectionKey: string): Promise<MaterialThemes | null> {
  try {
    const raw = await fs.readFile(cachePath(userId, collectionKey), 'utf8');
    const parsed = JSON.parse(raw) as MaterialThemes;
    return parsed?.v === 1 && Array.isArray(parsed.themes) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeCachedThemes(userId: string, collectionKey: string, themes: MaterialThemes): Promise<void> {
  const file = cachePath(userId, collectionKey);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(themes, null, 2), 'utf8');
}

/**
 * 读一组材料的分线：缓存命中（hash 一致）直接回；否则叫一次模型；只有 ≤1 篇可讲的不叫模型。
 */
export async function themesForCollection(
  userId: string,
  collectionKey: string,
  collectionTitle: string,
  candidates: MaterialCandidate[],
  opts: { chatFn?: ThemeChatFn; modelId?: string; force?: boolean; now?: () => number } = {},
): Promise<MaterialThemes> {
  const now = opts.now ?? Date.now;
  const limited = candidates.slice(0, MAX_ITEMS);
  const hash = themesHash(limited);
  if (!opts.force) {
    const cached = await readCachedThemes(userId, collectionKey);
    if (cached && cached.hash === hash) return cached;
  }
  const teachable = limited.filter((c) => isTeachableKind(c.kind) && c.text.trim());
  const base = { v: 1 as const, collectionKey, hash, model: null as string | null, createdAt: new Date(now()).toISOString() };

  if (teachable.length <= 1) {
    const result: MaterialThemes = { ...base, ...fallbackThemes(limited, collectionTitle), source: 'trivial' };
    await writeCachedThemes(userId, collectionKey, result).catch(() => undefined);
    return result;
  }

  const chatFn: ThemeChatFn = opts.chatFn ?? ((messages, modelId, options) => chat(messages, modelId, options));
  const modelId = opts.modelId ?? ModelDefaults.tutorQuick ?? ModelDefaults.workshop;
  let normalized: Pick<MaterialThemes, 'themes' | 'misc' | 'start'> | null = null;
  try {
    const { messages, alias } = buildThemePrompt(collectionTitle, limited);
    const response = await Promise.race([
      chatFn(messages, modelId, { temperature: 0.3, maxTokens: 1800, responseFormat: 'json_object' }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('theme_timeout')), 45_000)),
    ]);
    normalized = normalizeThemes(parseJsonResponse<RawThemes>(response.content), alias, limited);
  } catch (error) {
    log.warn('material-themes: model failed, using fallback', { collectionKey, message: (error as Error)?.message });
  }
  const result: MaterialThemes = normalized
    ? { ...base, ...normalized, source: 'model', model: modelId }
    : { ...base, ...fallbackThemes(limited, collectionTitle), source: 'fallback', model: modelId };
  await writeCachedThemes(userId, collectionKey, result).catch((error: Error) => log.warn('material-themes: cache write failed', { message: error.message }));
  log.info('material-themes: computed', { userId, collectionKey, items: limited.length, themes: result.themes.length, misc: result.misc.length, source: result.source });
  return result;
}
