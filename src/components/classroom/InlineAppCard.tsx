'use client';

/**
 * InlineAppCard — 对话内应用卡片。
 *
 * 核心原则：对话里只负责承载与节奏，真正的应用 UI 复用
 * `components/apps/windows/AppRenderSurface`，也就是课后应用矩阵同一套渲染器。
 */

import * as React from 'react';
import type { AppExecutionResult, AppRenderMode } from '@/lib/ai-native/types';
import { getWorkshopAppByKey } from '@/lib/ai-native/app-catalog';
import { AppRenderSurface } from '@/components/apps/windows/AppRenderSurface';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { cn } from '@/lib/utils';

export interface InlineAppCardProps {
  inlineApp: NonNullable<import('./types').CompanionMessage['inlineApp']>;
  /** 用户在内联卡片里操作后的回调。不同 kind 传不同 payload。 */
  onInteraction?: (event: InlineAppInteraction) => void;
  onRetry?: () => void;
}

export type InlineAppInteraction =
  | {
      kind: 'quiz_submit';
      questionId: string;
      questionIndex: number;
      total: number;
      /** 题干，用来让同学在对话里引用 */
      stem: string;
      /** 用户选了哪个（字母或文本） */
      picked: string;
      /** 用户所选完整文本 */
      pickedText?: string;
      /** 正解（字母或文本，和 payload 保持一致） */
      correctAnswer: string;
      /** 正解完整文本（option 原文） */
      correctText?: string;
      /** 正解解析，用来把同学的"为什么"一次讲透 */
      explanation?: string;
      correct: boolean;
    }
  | { kind: 'quiz_all_done'; correct: number; total: number }
  | {
      kind: 'flashcard_rate';
      cardId: string;
      rating: 'again' | 'hard' | 'good' | 'easy';
      /** 卡片正面——同学拿来复述"这张没记住" */
      front: string;
      /** 卡片背面——作为答案展开 */
      back: string;
    }
  | { kind: 'flashcard_all_done'; reviewed: number };

type InlineAppKey = NonNullable<import('./types').CompanionMessage['inlineApp']>['appKey'];

// 四种内联应用同一张纸（2026-09-10：quiz / flashcards 的深色 immersive 底移除——对话里一块黑房间与四周的纸感打架）
const INLINE_SURFACE_CLASS: Record<InlineAppKey, string> = {
  quiz: 'h-[520px] bg-paper',
  flashcards: 'h-[520px] bg-paper',
  mindmap: 'h-[560px] bg-white p-2',
  cheatsheet: 'h-[560px] bg-canvas',
};

function renderModeForInline(appKey: InlineAppKey): AppRenderMode {
  const mode = getWorkshopAppByKey(appKey)?.renderMode;
  if (mode && mode !== 'custom(image-first)') return mode;
  if (appKey === 'quiz') return 'quiz';
  if (appKey === 'flashcards') return 'flashcards';
  if (appKey === 'mindmap') return 'mindmap';
  return 'document';
}

function resultFromInlineApp(inlineApp: InlineAppCardProps['inlineApp']): AppExecutionResult | null {
  if (inlineApp.result) return inlineApp.result;
  if (!inlineApp.payload) return null;
  const app = getWorkshopAppByKey(inlineApp.appKey);
  return {
    pluginId: app?.pluginId || inlineApp.appKey,
    version: 'inline-legacy-payload',
    cards: [],
    tasks: [],
    trace: ['inline_payload=legacy'],
    render: {
      mode: renderModeForInline(inlineApp.appKey),
      title: app?.name,
      description: app?.description,
      payload: inlineApp.payload,
    },
  };
}

export function InlineAppCard({ inlineApp, onRetry }: InlineAppCardProps) {
  const app = getWorkshopAppByKey(inlineApp.appKey);
  const appName = app?.name || '学习应用';

  if (inlineApp.status === 'loading') {
    return (
      <div className="mt-3 overflow-hidden rounded-3xl border border-divider bg-white">
        <div className="h-[360px]">
          <AppWindowPlaceholder status="loading" appKey={inlineApp.appKey} appName={appName} />
        </div>
      </div>
    );
  }

  if (inlineApp.status === 'error') {
    return (
      <div className="mt-3 overflow-hidden rounded-3xl border border-divider bg-white">
        <AppWindowPlaceholder status="error" appKey={inlineApp.appKey} appName={appName} errorMessage={inlineApp.error} onRetry={onRetry} />
      </div>
    );
  }

  const result = resultFromInlineApp(inlineApp);
  if (!result) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-3xl border border-divider bg-white">
      {/* 头部只有应用名：卡已经坐在同学的消息里，「已放进对话」副题与「同学」胶囊都是重复的标签 */}
      <header className="border-b border-divider bg-white px-5 py-3">
        <p className="truncate text-[14px] font-semibold tracking-[-0.01em] text-ink">{appName}</p>
      </header>
      <div className={cn('overflow-auto', INLINE_SURFACE_CLASS[inlineApp.appKey])}>
        <AppRenderSurface appKey={inlineApp.appKey} result={result} transcript={[]} />
      </div>
    </div>
  );
}

export default InlineAppCard;
