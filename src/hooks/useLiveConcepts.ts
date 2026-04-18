/**
 * useLiveConcepts — 录课中关键概念的客户端启发式抽取
 *
 * 设计意图：
 *   "AI 同桌在听课"不需要真的调 LLM——
 *   我们只要让用户"感觉到 AI 在记东西"就够了。
 *   所以用一个轻量客户端启发式：
 *     - 订阅 captureEditorStore.segments（录音边录边 ASR 出结果）
 *     - 对新出现的 final segment，抽取 2-6 字中文术语候选
 *     - 首次出现的、不在停用词里的，推一条 LiveConcept 到面板
 *
 *   这不追求语义准确，追求"感知在场"。
 *
 * Taste 约束：
 *   - 不刷屏：最多保留 5 条
 *   - 不重复：同一个术语只推一次
 *   - 不打扰：不带任何提示音/弹窗
 *
 * 未来可以换成：
 *   Recorder.transcript → 后端术语提取 API → 回流
 *   但现在先不走这条路，不增加后端压力。
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import type { TranscriptSegment } from '@/types';
import type { LiveConcept } from '@/components/classroom';

const MAX_CONCEPTS = 5;

/** 中文停用词 + 过泛用语 —— 降噪 */
const STOPWORDS = new Set([
  '我们', '你们', '他们', '这个', '那个', '什么', '怎么', '为什么', '所以', '但是',
  '因为', '如果', '就是', '其实', '然后', '现在', '一个', '一下', '那么', '这样',
  '那样', '开始', '结束', '时候', '地方', '问题', '情况', '东西', '方法', '方式',
  '过程', '内容', '部分', '大家', '老师', '同学', '自己', '比如', '例如', '还有',
]);

/** 粗糙的中文术语抽取：找连续 2-6 个汉字，过滤停用词。 */
function extractCandidates(text: string): string[] {
  if (!text) return [];
  const re = /[\u4e00-\u9fa5]{2,6}/g;
  const hits: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = m[0];
    if (token.length < 2 || token.length > 6) continue;
    if (STOPWORDS.has(token)) continue;
    hits.push(token);
  }
  return hits;
}

export interface UseLiveConceptsOptions {
  /** 是否激活（录课中才激活） */
  enabled: boolean;
}

export function useLiveConcepts({ enabled }: UseLiveConceptsOptions): LiveConcept[] {
  const segments = useCaptureEditorStore((s) => s.segments);
  const [concepts, setConcepts] = useState<LiveConcept[]>([]);
  const seenTermsRef = useRef<Set<string>>(new Set());
  const lastSegmentCountRef = useRef(0);

  // enabled 变化重置
  useEffect(() => {
    if (!enabled) {
      setConcepts([]);
      seenTermsRef.current = new Set();
      lastSegmentCountRef.current = 0;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    // 只处理"新增的 final segment"
    const prevCount = lastSegmentCountRef.current;
    const newSegments: TranscriptSegment[] = segments.slice(prevCount).filter((s) => s.isFinal);
    lastSegmentCountRef.current = segments.length;

    if (newSegments.length === 0) return;

    const next: LiveConcept[] = [];
    for (const seg of newSegments) {
      const candidates = extractCandidates(seg.text);
      for (const term of candidates) {
        if (seenTermsRef.current.has(term)) continue;
        seenTermsRef.current.add(term);
        next.push({
          id: `concept-${seg.startMs}-${term}`,
          term,
          quote: seg.text.length > 60 ? seg.text.slice(0, 60) + '…' : seg.text,
          at: seg.startMs,
        });
        // 一次 batch 最多推 2 个，避免一口气塞满
        if (next.length >= 2) break;
      }
      if (next.length >= 2) break;
    }

    if (next.length > 0) {
      setConcepts((prev) => {
        const merged = [...prev, ...next];
        return merged.length > MAX_CONCEPTS ? merged.slice(-MAX_CONCEPTS) : merged;
      });
    }
  }, [segments, enabled]);

  return concepts;
}