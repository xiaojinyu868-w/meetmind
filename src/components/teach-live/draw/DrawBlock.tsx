'use client';

/**
 * DrawBlock —— <draw> 块：老师写的脚本 → 沙箱 Worker 计算 → SVG 上板（逐笔长出）。
 *
 * - 首段脚本决定布局（transform）；`into` 追加段与首段拼成一个作用域再跑，只输出新元素，
 *   沿用首段布局（图不会因为追加而跳动；越界时 viewBox 外扩）。
 * - 脚本里 param() 登记的参数在图下出滑块；改动 → 整图重算（瞬时替换，不重放描画）。
 * - 脚本报错：这块显示一句人话，错误文本经 onIssue 交给会话（下一次学生开口时告诉老师，让它自己改）。
 */

import * as React from 'react';
import type { RunResult, RunOptions } from '@/lib/teach-live-draw/runtime';
import type { Transform } from '@/lib/teach-live-draw/render';
import { TEACH_LIVE_COPY } from '@/lib/ui/copy-teach-live';
import type { LiveBlock, LiveSegment } from '../live-model';
import { ProgressiveSvg } from '../blocks/ProgressiveSvg';
import { runDrawScript } from './draw-runtime-client';

interface DrawBlockProps {
  block: LiveBlock;
  animate: boolean;
  onGrow?: () => void;
  onIssue?: (blockId: string, message: string) => void;
}

interface SegmentResult {
  markup: string;
  viewBox: string;
  transform: Transform;
}

type OkResult = Extract<RunResult, { ok: true }>;

export function DrawBlock({ block, animate, onGrow, onIssue }: DrawBlockProps) {
  const [results, setResults] = React.useState<Record<string, SegmentResult>>({});
  const [params, setParams] = React.useState<OkResult['params']>([]);
  const [paramValues, setParamValues] = React.useState<Record<string, number>>({});
  const [full, setFull] = React.useState<{ key: number; markup: string; viewBox: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const runningRef = React.useRef<Set<string>>(new Set());
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const idPrefix = `${block.id}-`;

  const ready = block.segments.filter((s) => s.revealed && s.complete);

  // 按顺序跑每个就绪且未跑过的 segment。
  // 结果按 segment id 幂等落地，不随 effect 生命周期作废：StrictMode 的双跑 / 依赖抖动只会让 runningRef 去重，不会把结果丢掉。
  React.useEffect(() => {
    const run = async () => {
      for (let i = 0; i < ready.length; i++) {
        const seg = ready[i];
        if (results[seg.id] || runningRef.current.has(seg.id)) continue;
        // 前一段还没出结果就等下一轮 effect
        if (i > 0 && !results[ready[i - 1].id]) return;
        runningRef.current.add(seg.id);
        const base = results[ready[0].id];
        const options: RunOptions = {
          idPrefix,
          params: paramValues,
          ...(i > 0 && base ? { transform: base.transform, fromChunk: i } : {}),
        };
        const r = await runDrawScript(
          ready.slice(0, i + 1).map((s) => s.text),
          options,
        );
        runningRef.current.delete(seg.id);
        if (!mountedRef.current) return;
        if (!r.ok) {
          setError(r.error);
          onIssue?.(block.id, `${block.attrs.id ? `图「${block.attrs.id}」` : '一张图'}的脚本没跑通：${r.error}`);
          return;
        }
        setError(null);
        if (i === 0) setParams(r.params);
        setResults((prev) => ({ ...prev, [seg.id]: { markup: r.markup, viewBox: r.viewBox, transform: r.transform } }));
        return; // 一次一个，state 落地后 effect 再跑下一段
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready.map((s) => s.id).join(','), results, block.id]);

  // 参数变化：整图重算并瞬时替换
  const rerunWithParams = React.useCallback(
    async (values: Record<string, number>) => {
      const chunks = ready.map((s) => s.text);
      if (chunks.length === 0) return;
      const r = await runDrawScript(chunks, { idPrefix, params: values });
      if (!r.ok) return;
      setFull((prev) => ({ key: (prev?.key ?? 0) + 1, markup: r.markup, viewBox: r.viewBox }));
    },
    [ready, idPrefix],
  );

  const onParam = (name: string, value: number) => {
    const next = { ...paramValues, [name]: value };
    setParamValues(next);
    void rerunWithParams(next);
  };

  const segments: LiveSegment[] = full
    ? [{ id: `${block.id}-full-${full.key}`, text: full.markup, complete: true, revealed: true }]
    : ready.filter((s) => results[s.id]).map((s) => ({ id: s.id, text: results[s.id].markup, complete: true, revealed: true }));
  const viewBox = full ? full.viewBox : segments.length ? results[ready[segments.length - 1].id]?.viewBox : undefined;

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
