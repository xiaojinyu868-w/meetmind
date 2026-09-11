'use client';

/**
 * DrawBlock —— <draw> 块：老师写的脚本 → 沙箱 Worker 计算 → SVG 上板（逐笔长出）。
 *
 * 计算与展示分开：
 * - **计算在段闭合时就开始**（不等揭示）——LiveBlockView 对 draw 块即使未揭示也挂载本组件（返回 null），
 *   所以脚本到达到被老师念到之间的几秒到几十秒，足够跑完、甚至修完。
 * - 展示只在段揭示后：ProgressiveSvg 逐笔描画。
 *
 * 自愈：脚本报错（语法 / 未定义变量）→ 先渲染报错前算好的部分（runtime 的 partial），同时向
 * /api/teach/threads/[id]/draw-fix 要一份修正（每段只试一次）→ 服务端复跑验证过的脚本替换该段重算。
 * 修不好 → 显示一句人话，并经 onIssue 记入会话（学生下次开口时带给老师，让它自己改）。
 *
 * 首段脚本决定布局（transform）；`into` 追加段与首段拼成一个作用域再跑，只输出新元素、沿用首段布局。
 * 结果按「前缀文本」缓存：修了第 3 段不会让 1、2 段重算重画。
 * 脚本里 param() 登记的参数在图下出滑块；改动 → 整图重算（瞬时替换，不重放描画）。
 */

import * as React from 'react';
import type { RunResult, RunOptions } from '@/lib/teach-live-draw/runtime';
import type { Transform } from '@/lib/teach-live-draw/render';
import { TEACH_LIVE_COPY } from '@/lib/ui/copy-teach-live';
import type { LiveBlock, LiveSegment } from '../live-model';
import { ProgressiveSvg } from '../blocks/ProgressiveSvg';
import { liveFixDraw } from '../live-client';
import { runDrawScript } from './draw-runtime-client';

interface DrawBlockProps {
  block: LiveBlock;
  animate: boolean;
  /** 至少一个 segment 已揭示：false 时只计算不展示 */
  revealed: boolean;
  threadId?: string | null;
  onGrow?: () => void;
  onIssue?: (blockId: string, message: string) => void;
}

interface SegmentResult {
  markup: string;
  viewBox: string;
  transform: Transform;
  /** 部分渲染：脚本在这段中途报错，已画出报错前的对象 */
  partialError?: string;
}

type OkResult = Extract<RunResult, { ok: true }>;

const SEP = '\u0000';

export function DrawBlock({ block, animate, revealed, threadId, onGrow, onIssue }: DrawBlockProps) {
  /** segmentId → 修正后的脚本 */
  const [fixes, setFixes] = React.useState<Record<string, string>>({});
  /** 前缀文本 → 结果（首段 key = 首段文本；第 i 段 key = 前 i+1 段文本拼接） */
  const [results, setResults] = React.useState<Record<string, SegmentResult>>({});
  const [params, setParams] = React.useState<OkResult['params']>([]);
  const [paramValues, setParamValues] = React.useState<Record<string, number>>({});
  const [full, setFull] = React.useState<{ key: number; markup: string; viewBox: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const runningRef = React.useRef<Set<string>>(new Set());
  const fixTriedRef = React.useRef<Set<string>>(new Set());
  const reportedRef = React.useRef<Set<string>>(new Set());
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const idPrefix = `${block.id}-`;

  // 计算对象：所有已闭合的段（不管揭示没揭示）
  const complete = React.useMemo(() => block.segments.filter((s) => s.complete), [block.segments]);
  const texts = React.useMemo(() => complete.map((s) => fixes[s.id] ?? s.text), [complete, fixes]);
  const prefixKey = React.useCallback((i: number) => texts.slice(0, i + 1).join(SEP), [texts]);
  const signature = texts.join(SEP);

  React.useEffect(() => {
    const run = async () => {
      for (let i = 0; i < complete.length; i++) {
        const seg = complete[i];
        const key = prefixKey(i);
        if (results[key] || runningRef.current.has(key)) continue;
        // 前一段还没出结果就等下一轮 effect
        const baseKey = prefixKey(0);
        const prevKey = i > 0 ? prefixKey(i - 1) : null;
        if (prevKey && !results[prevKey]) return;
        const base = results[baseKey];
        runningRef.current.add(key);
        const options: RunOptions = {
          idPrefix,
          params: paramValues,
          ...(i > 0 && base ? { transform: base.transform, fromChunk: i } : {}),
        };
        const r = await runDrawScript(texts.slice(0, i + 1), options);
        runningRef.current.delete(key);
        if (!mountedRef.current) return;

        const failure = !r.ok ? r.error : r.error ?? null;
        if (failure && threadId && !fixTriedRef.current.has(seg.id)) {
          // 自愈：让模型修这一段；修好了 fixes 变化 → signature 变化 → 本 effect 重跑
          fixTriedRef.current.add(seg.id);
          try {
            const fixed = await liveFixDraw(threadId, texts.slice(0, i + 1), i, failure);
            if (!mountedRef.current) return;
            if (fixed.verified && fixed.script.trim()) {
              setFixes((prev) => ({ ...prev, [seg.id]: fixed.script }));
              return;
            }
          } catch {
            // 修不好：走下面的兜底
          }
        }

        if (!r.ok) {
          setError(r.error);
          report(`${describe(block)}的脚本没跑通：${r.error}`);
          return;
        }
        setError(r.error ?? null);
        if (r.error) report(`${describe(block)}的脚本中途报错（只画出了前半部分）：${r.error}`);
        if (i === 0) setParams(r.params);
        setResults((prev) => ({
          ...prev,
          [key]: { markup: r.markup, viewBox: r.viewBox, transform: r.transform, ...(r.error ? { partialError: r.error } : {}) },
        }));
        return; // 一次一个，state 落地后 effect 再跑下一段
      }
    };
    const report = (message: string) => {
      if (reportedRef.current.has(message)) return;
      reportedRef.current.add(message);
      onIssue?.(block.id, message);
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, results, block.id, threadId]);

  // 参数变化：整图重算并瞬时替换
  const rerunWithParams = React.useCallback(
    async (values: Record<string, number>) => {
      if (texts.length === 0) return;
      const r = await runDrawScript(texts, { idPrefix, params: values });
      if (!r.ok) return;
      setFull((prev) => ({ key: (prev?.key ?? 0) + 1, markup: r.markup, viewBox: r.viewBox }));
    },
    [texts, idPrefix],
  );

  const onParam = (name: string, value: number) => {
    const next = { ...paramValues, [name]: value };
    setParamValues(next);
    void rerunWithParams(next);
  };

  if (!revealed) return null;

  // 展示对象：已揭示且已算出结果的段
  const shown: LiveSegment[] = [];
  let lastViewBox: string | undefined;
  for (let i = 0; i < complete.length; i++) {
    const seg = complete[i];
    if (!seg.revealed) break;
    const r = results[prefixKey(i)];
    if (!r) break;
    shown.push({ id: seg.id, text: r.markup, complete: true, revealed: true });
    lastViewBox = r.viewBox;
  }
  const segments: LiveSegment[] = full ? [{ id: `${block.id}-full-${full.key}`, text: full.markup, complete: true, revealed: true }] : shown;
  const viewBox = full ? full.viewBox : lastViewBox;

  if (error && segments.length === 0) {
    return (
      <div className="live-draw-error" role="note" title={error}>
        {TEACH_LIVE_COPY.drawFailed}
      </div>
    );
  }
  if (segments.length === 0) return <div className="live-skeleton" aria-busy="true" />;

  return (
    <div className="live-draw">
      <ProgressiveSvg
        key={full ? `full-${full.key}` : 'progressive'}
        attrs={{ viewbox: viewBox ?? '0 0 800 450', title: block.attrs.title ?? '' }}
        segments={segments}
        animate={full ? false : animate}
        onGrow={onGrow}
        className="live-svg live-draw-svg"
      />
      {params.length ? (
        <div className="live-draw-params">
          {params.map((p) => {
            const value = paramValues[p.name] ?? p.value;
            return (
              <label key={p.name} className="live-draw-param">
                <span className="live-draw-param-name">
                  {p.name} = <strong>{Number.isInteger(p.step) && Number.isInteger(value) ? value : value.toFixed(2).replace(/\.?0+$/, '')}</strong>
                </span>
                <input type="range" min={p.min} max={p.max} step={p.step} value={value} onChange={(e) => onParam(p.name, Number(e.target.value))} />
              </label>
            );
          })}
        </div>
      ) : null}
      {error ? (
        <div className="live-draw-error" title={error}>
          {TEACH_LIVE_COPY.drawPartlyFailed}
        </div>
      ) : null}
    </div>
  );
}

function describe(block: LiveBlock): string {
  return block.attrs.id ? `图「${block.attrs.id}」` : block.attrs.title ? `图「${block.attrs.title}」` : '一张图';
}
