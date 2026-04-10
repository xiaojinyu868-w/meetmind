/**
 * useExtractTerms
 *
 * ASR 热词提取 + 实时上下文提示 — 从 page.tsx 提取（Phase 6）
 *
 * 包含：
 *   extractTerms useEffect  — debounced /api/extract-terms 调用
 *   liveASRContextHint useMemo — 合并手动提示 + 参考片段 + 提取词汇
 *
 * 遵循 (deps) 模式。Store 写入通过 getState().actions。
 */

import { useEffect, useMemo, useRef } from 'react';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import { buildASRContextHint } from '@/lib/utils/page-utils';
import type { SupportReferenceItem } from '@/types/page-types';

// ── Deps interface ──

interface UseExtractTermsDeps {
  asrContextHint: string;
  isGuestFastEntry: boolean;
  supportReferences: SupportReferenceItem[];
  extractedTermsHint: string;
}

// ── Hook ──

export function useExtractTerms(deps: UseExtractTermsDeps) {
  const {
    asrContextHint,
    isGuestFastEntry,
    supportReferences,
    extractedTermsHint,
  } = deps;

  // Auto-extract terms from user-provided context (course topic + reference materials)
  const extractTermsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Debounce: wait 2s after last change before calling the API
    if (extractTermsTimerRef.current) {
      clearTimeout(extractTermsTimerRef.current);
    }

    if (isGuestFastEntry) {
      useCaptureEditorStore.getState().actions.setExtractedTermsHint('');
      return;
    }

    const topic = asrContextHint.trim();
    const refs = supportReferences.map((item) => item.snippet).filter(Boolean);

    // Only call if there's something to extract from
    if (!topic && refs.length === 0) {
      useCaptureEditorStore.getState().actions.setExtractedTermsHint('');
      return;
    }

    extractTermsTimerRef.current = setTimeout(async () => {
      try {
        const response = await fetch('/api/extract-terms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic,
            referenceTexts: refs.slice(0, 3),
          }),
        });
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.contextHint) {
            useCaptureEditorStore.getState().actions.setExtractedTermsHint(data.contextHint);
          }
        }
      } catch (err) {
        console.warn('[App] Failed to extract terms:', err);
      }
    }, 2000);

    return () => {
      if (extractTermsTimerRef.current) {
        clearTimeout(extractTermsTimerRef.current);
      }
    };
  }, [asrContextHint, isGuestFastEntry, supportReferences]);

  // Build live context hint for real-time ASR (hot-word injection)
  // Combines: user manual hint + reference snippets + auto-extracted terms
  const liveASRContextHint = useMemo(() => {
    const baseHint = buildASRContextHint({
      manualHint: asrContextHint,
      recentSegments: [],
      importedReferences: supportReferences.map((item) => item.snippet),
      maxChars: 2000,
    });
    if (!extractedTermsHint) return baseHint;
    return [baseHint, extractedTermsHint].filter(Boolean).join('\n\n').slice(0, 3000);
  }, [asrContextHint, supportReferences, extractedTermsHint]);

  return {
    liveASRContextHint,
  };
}
