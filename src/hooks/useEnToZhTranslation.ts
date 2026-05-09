'use client';

/**
 * useEnToZhTranslation (M7.9)
 *
 * 输入：一组英文片段
 * 输出：同样片段的中译
 *
 * 设计要点：
 *   - Session 内 Map 缓存：同一片段只翻一次，即便跨 segment
 *   - Debounce 批量提交：短时间内多个新片段合并成一次 API 调用
 *   - 失败静默：拿到什么给什么，没翻到的片段不渲染气泡
 *   - LocalStorage 持久化缓存（跨 session）：课堂常用术语不需要反复翻
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getTranslationRetryDelayMs, shouldSkipTranslationTerm } from '@/lib/utils/translation-retry-policy';

export type TranslationMode = 'off' | 'en-zh' | 'zh-en';

const MAX_BATCH = 6;
const DEBOUNCE_MS = 80;
const CACHE_KEY_BY_MODE: Record<Exclude<TranslationMode, 'off'>, string> = {
  'en-zh': 'meetmind_translate_en_zh_cache_v1',
  'zh-en': 'meetmind_translate_zh_en_cache_v1',
};
const ENDPOINT_BY_MODE: Record<Exclude<TranslationMode, 'off'>, string> = {
  'en-zh': '/api/translate/en-zh',
  'zh-en': '/api/translate/zh-en',
};

function resolveActiveMode(enabled: boolean, mode: Exclude<TranslationMode, 'off'>): Exclude<TranslationMode, 'off'> | null {
  return enabled ? mode : null;
}

function loadCache(mode: Exclude<TranslationMode, 'off'>): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CACHE_KEY_BY_MODE[mode]);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveCache(mode: Exclude<TranslationMode, 'off'>, cache: Record<string, string>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY_BY_MODE[mode], JSON.stringify(cache));
  } catch {
    /* quota exceeded — drop */
  }
}

export function useEnToZhTranslation(enabled: boolean, mode: Exclude<TranslationMode, 'off'> = 'en-zh') {
  const activeMode = resolveActiveMode(enabled, mode);
  const [translations, setTranslations] = useState<Record<string, string>>(() => loadCache(mode));
  const pendingRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<Set<string>>(new Set());
  const failedUntilRef = useRef<Record<string, number>>({});

  useEffect(() => {
    setTranslations(loadCache(mode));
    pendingRef.current.clear();
    inflightRef.current.clear();
    failedUntilRef.current = {};
  }, [mode]);

  // Flush 当前 pending 批次
  const flush = useCallback(async () => {
    if (!activeMode) return;
    const toSend = Array.from(pendingRef.current).slice(0, MAX_BATCH);
    if (toSend.length === 0) return;
    pendingRef.current = new Set(Array.from(pendingRef.current).slice(MAX_BATCH));
    for (const t of toSend) inflightRef.current.add(t);

    try {
      const resp = await fetch(ENDPOINT_BY_MODE[activeMode], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terms: toSend }),
      });
      if (!resp.ok) {
        const failedUntil = Date.now() + getTranslationRetryDelayMs(resp.status);
        for (const term of toSend) failedUntilRef.current[term] = failedUntil;
        return;
      }
      const data = (await resp.json()) as { translations?: Record<string, string> };
      if (data.translations) {
        setTranslations((prev) => {
          const next: Record<string, string> = { ...prev };
          for (const [k, v] of Object.entries(data.translations ?? {})) {
            if (typeof v === 'string' && v.trim()) next[k] = v.trim();
          }
          saveCache(activeMode, next);
          return next;
        });
      }
    } catch {
      const failedUntil = Date.now() + getTranslationRetryDelayMs(null);
      for (const term of toSend) failedUntilRef.current[term] = failedUntil;
    } finally {
      for (const t of toSend) inflightRef.current.delete(t);
      // 如果 pending 还有剩下的，继续下一批
      if (pendingRef.current.size > 0) {
        timerRef.current = setTimeout(flush, DEBOUNCE_MS);
      }
    }
  }, [activeMode]);

  const request = useCallback(
    (terms: string[]) => {
      if (!activeMode) return;
      let added = false;
      for (const t of terms) {
        if (!t) continue;
        if (translations[t]) continue;
        if (shouldSkipTranslationTerm(t, failedUntilRef.current)) continue;
        if (inflightRef.current.has(t)) continue;
        if (pendingRef.current.has(t)) continue;
        pendingRef.current.add(t);
        added = true;
      }
      if (!added) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, DEBOUNCE_MS);
    },
    [activeMode, translations, flush],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const lookup = useCallback(
    (term: string): string | undefined => translations[term],
    [translations],
  );

  return useMemo(() => ({ request, lookup, translations }), [request, lookup, translations]);
}

// ──────────────────────────────────────────────────────────────
// 持久化的用户偏好：翻译气泡是否开启
// ──────────────────────────────────────────────────────────────

const LS_MODE_KEY = 'meetmind_translation_mode_v1';

function normalizeMode(value: string | null): TranslationMode {
  return value === 'en-zh' || value === 'zh-en' ? value : 'off';
}

export function useTranslationMode(): [TranslationMode, (next: TranslationMode) => void] {
  const [mode, setMode] = useState<TranslationMode>('off');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setMode(normalizeMode(window.localStorage.getItem(LS_MODE_KEY)));
  }, []);
  const update = useCallback((next: TranslationMode) => {
    setMode(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LS_MODE_KEY, next);
    }
  }, []);
  return [mode, update];
}

export function useEnToZhEnabled(): [boolean, (next: boolean) => void] {
  const [mode, setMode] = useTranslationMode();
  const update = useCallback((next: boolean) => {
    setMode(next ? 'en-zh' : 'off');
  }, [setMode]);
  return [mode === 'en-zh', update];
}
