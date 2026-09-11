/**
 * runtime —— 执行老师写的 <draw> 脚本：注入 API 全局 → 跑 → 渲染成 SVG 标记。
 *
 * 多个 chunk（首块 + 若干 `into` 追加）拼成**一个**函数体一起执行，所以后面的追加能直接
 * 用前面定义的变量（A、B、圆 c）；`__chunk(i)` 标记让 drawable 记住自己属于哪一段，
 * 渲染时只输出 fromChunk 之后的新元素，并沿用首块的 transform（图不会因为追加而缩放跳动）。
 *
 * 安全边界在调用方：本模块假定自己跑在 Worker 里（无 DOM、opaque origin）；这里只做超时之外的
 * 事——语法 / 运行错误变成结构化结果返回，永不抛出。
 */

import { createApi, Scene, type TimelineSpec } from './scene';
import { fitTransform, render, type Transform } from './render';
import { compileTimeline, sampleCount } from './timeline';

export interface RunOptions {
  params?: Record<string, number>;
  idPrefix?: string;
  transform?: Transform;
  fromChunk?: number;
}

export type RunResult =
  | {
      ok: true;
      markup: string;
      viewBox: string;
      transform: Transform;
      params: Array<{ name: string; min: number; max: number; step: number; value: number }>;
      names: string[];
      log: string[];
      drawables: number;
      /**
       * 脚本中途报错但已有对象画出来了：能画多少画多少，错误留给调用方（显示一句人话 / 送去自愈）。
       * 出错所在 chunk 见 errorChunk。
       */
      error?: string;
      errorChunk?: number;
      /** 脚本用了 time()：这段标记里带 SMIL 动画 */
      timeline?: TimelineSpec;
    }
  | { ok: false; error: string; chunk: number };

/** 模型偶发把脚本包进 ```js 围栏或写成 <script>：剥掉 */
export function cleanScript(src: string): string {
  return src
    .replace(/^\s*```[a-zA-Z]*\s*\n?/, '')
    .replace(/\n?\s*```\s*$/, '')
    .replace(/^\s*<script[^>]*>/i, '')
    .replace(/<\/script>\s*$/i, '')
    .trim();
}

interface ExecResult {
  scene: Scene;
  logs: string[];
  error: string | null;
  chunk: number;
}

/** 执行一遍脚本（now = 采样时刻），返回场景与错误；不渲染 */
function execute(chunks: string[], params: Record<string, number>, now: number): ExecResult {
  const scene = new Scene(params, now);
  const api = createApi(scene);
  const names = Object.keys(api);
  const values = Object.values(api);
  const logs: string[] = [];
  const fakeConsole = {
    log: (...args: unknown[]) => logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')),
    warn: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    error: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
  };
  const body = chunks.map((c, i) => `__chunk(${i});\n${cleanScript(c)}`).join('\n');
  let currentChunk = 0;
  let error: string | null = null;
  // 非严格模式：老师偶发写 `l = lineThrough(P, 100)` 忘了 const，严格模式会直接 ReferenceError；
  // 宽松模式下它成了隐式全局——跑完把新冒出来的全局删掉，图与图之间不串。
  const globalObj = globalThis as unknown as Record<string, unknown>;
  const before = new Set(Object.keys(globalObj));
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(...names, 'console', '__chunk', body);
    fn.call(undefined, ...values, fakeConsole, (i: number) => {
      currentChunk = i;
      scene.chunk = i;
    });
  } catch (err) {
    const e = err as Error;
    error = `${e?.name ?? 'Error'}: ${e?.message ?? String(err)}`;
  } finally {
    for (const key of Object.keys(globalObj)) {
      if (!before.has(key)) {
        try {
          delete globalObj[key];
        } catch {
          // 不可删的全局忽略
        }
      }
    }
  }
  return { scene, logs, error, chunk: currentChunk };
}

function unionViewBox(boxes: string[]): string {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    const [x, y, w, h] = b.split(/\s+/).map(Number);
    if (![x, y, w, h].every(Number.isFinite)) continue;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  }
  if (!Number.isFinite(x0)) return boxes[0] ?? '0 0 800 450';
  const f = (n: number) => (Math.round(n * 10) / 10).toString();
  return `${f(x0)} ${f(y0)} ${f(x1 - x0)} ${f(y1 - y0)}`;
}

export function runDraw(chunks: string[], options: RunOptions = {}): RunResult {
  const params = options.params ?? {};
  const base = execute(chunks, params, 0);
  const { scene, logs } = base;
  const scriptError = base.error;
  // 语法错误：一个对象都没登记，只能整块失败；运行期报错：把报错前算好的画出来
  if (scriptError && scene.drawables.length === 0) return { ok: false, error: scriptError, chunk: base.chunk };

  const renderOpts = { idPrefix: options.idPrefix, transform: options.transform, fromChunk: options.fromChunk };
  try {
    // 时间轴：按帧采样 → 同一 transform 渲染每帧 → 差分编译成 SMIL
    if (scene.timeline && !scriptError) {
      const spec = scene.timeline;
      const K = sampleCount(spec.dur);
      const frames: Scene[] = [scene];
      let frameError: string | null = null;
      for (let k = 1; k < K; k++) {
        const r = execute(chunks, params, (spec.dur * k) / (K - 1));
        if (r.error) {
          frameError = r.error;
          break;
        }
        frames.push(r.scene);
      }
      if (!frameError) {
        const union = new Scene(params, 0);
        union.view = scene.view;
        union.size = scene.size;
        union.equalAxes = scene.equalAxes;
        union.viewLocked = scene.viewLocked;
        union.drawables = frames.flatMap((f) => f.drawables);
        const transform = options.transform ?? fitTransform(union);
        const rendered = frames.map((f) => render(f, { ...renderOpts, transform }));
        const { markup, animated } = compileTimeline(
          rendered.map((r) => r.markup),
          spec,
        );
        return {
          ok: true,
          markup,
          viewBox: unionViewBox(rendered.map((r) => r.viewBox)),
          transform,
          params: rendered[0].params,
          names: rendered[0].names,
          log: [...logs, `timeline: ${K} frames, ${animated} animated attributes`],
          drawables: scene.drawables.length,
          timeline: spec,
        };
      }
      logs.push(`timeline 采样报错，退回静态图：${frameError}`);
    }

    const r = render(scene, renderOpts);
    return {
      ok: true,
      ...r,
      log: logs,
      drawables: scene.drawables.length,
      ...(scriptError ? { error: scriptError, errorChunk: base.chunk } : {}),
    };
  } catch (err) {
    const e = err as Error;
    return { ok: false, error: `render: ${e?.message ?? String(err)}`, chunk: base.chunk };
  }
}
