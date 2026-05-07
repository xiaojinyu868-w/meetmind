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

const LS_KEY = 'meetmind_translate_en_zh_cache_v1';
const MAX_BATCH = 20;
const DEBOUNCE_MS = 300;

function loadCache(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, string>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(cache));
  } catch {
    /* quota exceeded — drop */
  }
}

export function useEnToZhTranslation(enabled: boolean) {
  const [translations, setTranslations] = useState<Record<string, string>>(() => loadCache());
  const pendingRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<Set<string>>(new Set());

  // Flush 当前 pending 批次
  const flush = useCallback(async () => {
    if (!enabled) return;
    const toSend = Array.from(pendingRef.current).slice(0, MAX_BATCH);
    if (toSend.length === 0) return;
    pendingRef.current = new Set(Array.from(pendingRef.current).slice(MAX_BATCH));
    for (const t of toSend) inflightRef.current.add(t);

    try {
      const resp = await fetch('/api/translate/en-zh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terms: toSend }),
      });
      const data = (await resp.json()) as { translations?: Record<string, string> };
      const next: Record<string, string> = { ...translations };
      if (data.translations) {
        for (const [k, v] of Object.entries(data.translations)) {
          if (typeof v === 'string' && v.trim()) next[k] = v.trim();
        }
      }
      setTranslations(next);
      saveCache(next);
    } catch {
      /* silent */
    } finally {
      for (const t of toSend) inflightRef.current.delete(t);
      // 如果 pending 还有剩下的，继续下一批
      if (pendingRef.current.size > 0) {
        timerRef.current = setTimeout(flush, DEBOUNCE_MS);
      }
    }
  }, [enabled, translations]);

  const request = useCallback(
    (terms: string[]) => {
      if (!enabled) return;
      let added = false;
      for (const t of terms) {
        if (!t) continue;
        if (translations[t]) continue;
        if (inflightRef.current.has(t)) continue;
        if (pendingRef.current.has(t)) continue;
        pendingRef.current.add(t);
        added = true;
      }
      if (!added) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, DEBOUNCE_MS);
    },
    [enabled, translations, flush],
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

const LS_ENABLED_KEY = 'meetmind_translate_en_zh_enabled_v1';

export function useEnToZhEnabled(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState(true); // 默认开启
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(LS_ENABLED_KEY);
    if (raw !== null) setEnabled(raw === 'true');
  }, []);
  const update = useCallback((next: boolean) => {
    setEnabled(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LS_ENABLED_KEY, String(next));
    }
  }, []);
  return [enabled, update];
}
