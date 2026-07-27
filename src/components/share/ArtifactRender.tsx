'use client';

/**
 * ArtifactRender — 分享态产物的 React 渲染（v3.0）
 *
 * 第一性原理：
 *   B 打开 /share/[token]，第一眼必须看到产物本身——速查表 6 区、思维导图分支、
 *   或测验题干 + 选项。让 B 不需要"领取"就先看到价值，再决定是否对话 / 领取。
 *
 * 不重写应用 UI：用极简的、可识别的预览样式（与 WorkshopWindow 同源色板，
 * 但不引入任何重交互；测验不显示答案，强裂变保留）。
 *
 * payload 兼容几种分享态产物形态：
 *   - cheatsheet     → CheatsheetPayload {sections}
 *   - mindmap        → {root, branches: [{label, children: [{label}]}]}
 *   - quiz           → {questions | items: [{stem, options}]}
 *   - flashcards     → {cards: [{front, back}]}（可选）
 *   - notes / chat-only / fallback → 使用 summary 文字
 */

import * as React from 'react';
import type {
  CheatsheetPayload,
  CheatsheetSection,
  CheatsheetItem,
} from '@/lib/ai-native/plugins/cheatsheet.plugin';
import type { ShareArtifactKind } from '@/lib/services/share-agent-service';
import { ShareMindmapGraph } from '@/components/share/ShareMindmapGraph';

// ── 共用：从 snapshot.artifact 解 payload ─────────────────

interface ArtifactWrapper {
  summary?: string;
  payload?: unknown;
  /** 旧版本可能直接把 payload 当 artifact 顶层 */
  [k: string]: unknown;
}

function extractPayload(artifact: unknown): unknown {
  if (!artifact || typeof artifact !== 'object') return null;
  const obj = artifact as ArtifactWrapper;
  if (obj.payload && typeof obj.payload === 'object') return obj.payload;
  // 兼容旧 snapshot：artifact 直接是 payload（无 wrapper）
  if (Array.isArray((obj as { sections?: unknown[] }).sections)) return obj;
  if ('root' in obj || 'branches' in obj) return obj;
  if ('questions' in obj || 'items' in obj) return obj;
  if ('cards' in obj) return obj;
  return null;
}

function extractSummary(artifact: unknown): string {
  if (!artifact || typeof artifact !== 'object') return '';
  const obj = artifact as ArtifactWrapper;
  if (typeof obj.summary === 'string') return obj.summary;
  if (typeof (obj as { title?: string }).title === 'string') {
    return (obj as { title: string }).title;
  }
  return '';
}

// ── 6 区 cheatsheet 色板（与 CheatsheetWindow 一致） ──

const SECTION_ACCENT: Record<string, { bar: string; tint: string; label: string }> = {
  definition: { bar: '#20312A', tint: '#EDF2EE', label: '#20312A' },
  formula:    { bar: '#B8842B', tint: '#FBF2EF', label: '#2F6B55' },
  process:    { bar: '#2F6B55', tint: '#F0F7F3', label: '#2F6B55' },
  contrast:   { bar: '#2F6B55', tint: '#F0F7F3', label: '#2F6B55' },
  pitfall:    { bar: '#C45E4C', tint: '#FCF3F0', label: '#C45E4C' },
  exemplar:   { bar: '#2F6B55', tint: '#F0F7F3', label: '#2F6B55' },
};

function pickCheatsheetItem(section: CheatsheetSection): CheatsheetItem | null {
  if (!section.items || section.items.length === 0) return null;
  const strong = section.items.find((it) => it.emphasis === 'strong');
  return strong ?? section.items[0];
}

function CheatsheetPreview({ payload }: { payload: CheatsheetPayload }) {
  const usable = (payload.sections ?? [])
    .filter((s) => s.items && s.items.length > 0)
    .slice(0, 6);

  if (usable.length === 0) {
    return (
      <p className="text-[13px] leading-7 text-ink-secondary">
        速查表正在准备中。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {payload.title?.trim() ? (
        <h3 className="text-[15.5px] font-semibold tracking-tight text-ink">
          {payload.title.trim()}
        </h3>
      ) : null}
      {payload.overview?.trim() ? (
        <p className="text-[12.5px] leading-6 text-ink-secondary">
          {payload.overview.trim()}
        </p>
      ) : null}
      <div className="mt-1 flex flex-col gap-2">
        {usable.map((section, i) => {
          const accent = SECTION_ACCENT[section.key] ?? SECTION_ACCENT.definition;
          const item = pickCheatsheetItem(section);
          if (!item) return null;
          return (
            <div
              key={`${section.key}-${i}`}
              className="relative overflow-hidden rounded-xl px-3.5 py-2.5"
              style={{ backgroundColor: accent.tint }}
            >
              <div
                aria-hidden
                className="absolute left-0 top-0 h-full w-[3px]"
                style={{ backgroundColor: accent.bar }}
              />
              <p
                className="text-[10px] font-bold uppercase tracking-[0.16em]"
                style={{ color: accent.label }}
              >
                {section.label}
              </p>
              <p className="mt-1 text-[13.5px] font-semibold leading-snug text-ink">
                {item.term || section.label}
              </p>
              {item.body?.trim() ? (
                <p className="mt-1 text-[12.5px] leading-6 text-ink-secondary line-clamp-3">
                  {item.body.trim()}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Mindmap ─────────────────────────────────────────────

interface MindmapNodeLike {
  title?: string;
  label?: string;
  children?: Array<MindmapNodeLike>;
}

interface MindmapPayload {
  root?: string;
  /** plugin 实际用的字段：children:[{title, children}] */
  children?: Array<MindmapNodeLike>;
  /** 旧版兼容：branches:[{label, children}] */
  branches?: Array<MindmapNodeLike>;
  /** markmap markdown 大纲（plugin 也存了，作为 fallback 渲染） */
  markdown?: string;
}

function hasMindmapContent(payload: MindmapPayload): boolean {
  const nodes = payload.children ?? payload.branches ?? [];
  return nodes.length > 0 || Boolean(payload.markdown?.trim());
}

// ── Quiz（不显示答案——必须对话 / 领取才看分数） ──────

interface QuizQuestion {
  stem?: string;
  options?: string[] | Array<{ label?: string; text?: string }>;
}
interface QuizPayload {
  questions?: QuizQuestion[];
  items?: QuizQuestion[];
}

function getQuizQuestions(p: unknown): QuizQuestion[] {
  if (!p || typeof p !== 'object') return [];
  const obj = p as QuizPayload;
  return obj.questions ?? obj.items ?? [];
}

function QuizPreview({ payload }: { payload: unknown }) {
  const questions = getQuizQuestions(payload).slice(0, 1); // 只露第一题，强裂变
  const total = getQuizQuestions(payload).length;

  if (questions.length === 0) {
    return (
      <p className="text-[13px] leading-7 text-ink-secondary">
        测验正在准备中。
      </p>
    );
  }

  const q = questions[0];
  const rawOptions = q.options ?? [];
  const labels = ['A', 'B', 'C', 'D', 'E'];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
        试一道这节课的题{total > 1 ? ` · 共 ${total} 题` : ''}
      </p>
      <h3 className="text-[15.5px] font-semibold leading-snug tracking-tight text-ink">
        {q.stem?.trim() || '请回答下面的问题'}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {rawOptions.slice(0, 4).map((opt, i) => {
          const text = typeof opt === 'string' ? opt : (opt.text ?? opt.label ?? '');
          if (!text.trim()) return null;
          return (
            <li
              key={i}
              className="flex items-start gap-2.5 rounded-lg border border-divider/60 bg-paper-warm/60 px-3 py-2"
            >
              <span className="text-[12.5px] font-semibold tabular-nums text-ink">
                {labels[i]}.
              </span>
              <span className="min-w-0 flex-1 text-[13px] leading-6 text-ink-secondary">
                {text}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-[11.5px] italic text-ink-muted">
        选好了？跟同学说一下，他会跟你对答案
      </p>
    </div>
  );
}

// ── Flashcards（仅展示数量 + 第一张，避免一次铺太多） ──

interface FlashcardsPayload {
  cards?: Array<{ front?: string; back?: string }>;
}

function FlashcardsPreview({ payload }: { payload: FlashcardsPayload }) {
  const cards = (payload.cards ?? []).filter((c) => c.front?.trim());
  if (cards.length === 0) {
    return (
      <p className="text-[13px] leading-7 text-ink-secondary">闪卡正在准备中。</p>
    );
  }
  const first = cards[0];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
        共 {cards.length} 张闪卡
      </p>
      <div className="rounded-2xl border border-divider/60 bg-paper-warm/60 px-4 py-4">
        <p className="text-[14px] font-medium text-ink">{first.front?.trim()}</p>
        <p className="mt-2 text-[11.5px] italic text-ink-muted">背面在领取后翻看</p>
      </div>
    </div>
  );
}

// ── 主入口 ─────────────────────────────────────────────

export interface ArtifactRenderProps {
  artifactKind: ShareArtifactKind;
  artifact: unknown;
}

/**
 * 按 artifactKind 分发。失败统统降级到 summary 文字 / 空 hint。
 */
export function ArtifactRender({ artifactKind, artifact }: ArtifactRenderProps) {
  const payload = extractPayload(artifact);
  const summary = extractSummary(artifact);

  if (artifactKind === 'cheatsheet' && payload) {
    const cs = payload as Partial<CheatsheetPayload>;
    if (Array.isArray(cs.sections)) {
      return <CheatsheetPreview payload={payload as CheatsheetPayload} />;
    }
  }

  if (artifactKind === 'mindmap' && payload) {
    const mm = payload as MindmapPayload;
    if (hasMindmapContent(mm)) {
      // 标题不重复：图里的根节点胶囊已经说了主题，外面不再加标题
      return <ShareMindmapGraph payload={mm} />;
    }
  }

  if (artifactKind === 'quiz' && payload) {
    return <QuizPreview payload={payload} />;
  }

  if (artifactKind === 'flashcards' && payload) {
    const fc = payload as FlashcardsPayload;
    if (Array.isArray(fc.cards)) {
      return <FlashcardsPreview payload={fc} />;
    }
  }

  if (artifactKind === 'infographic' && payload) {
    const ig = payload as { image?: { imageUrl?: string }; draft?: { title?: string } };
    if (ig.image?.imageUrl) {
      return (
        <div className="flex flex-col gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ig.image.imageUrl}
            alt={ig.draft?.title || '课堂信息图'}
            className="w-full rounded-xl object-contain"
          />
        </div>
      );
    }
  }

  // Fallback：summary 文字（适用于 notes / chat-only / 旧 snapshot 没存 payload 的情况）
  if (summary.trim()) {
    return (
      <p className="text-[13.5px] leading-7 text-ink whitespace-pre-wrap">
        {summary.trim()}
      </p>
    );
  }

  return (
    <p className="text-[13px] leading-7 text-ink-secondary">
      完整产物会在你领取后出现在工作台里。
    </p>
  );
}

export default ArtifactRender;
