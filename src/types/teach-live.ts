/**
 * teach-live —— AI 家教「上课」线第三代引擎（live stage）的共享契约。
 *
 * 前后端共用：服务端解析器产出这些事件，前端据此重建板面并按语音节奏演出。
 *
 * 协议一句话：老师的一轮输出是一条**标签流**（不是 JSON）——口播、板书块、
 * 提示动作交错出现，任何一种块的正文都是原生文本（SVG / LaTeX / Markdown /
 * 代码 / HTML 不需要转义），所以能边生成边渲染：一张图是一笔一笔长出来的。
 *
 *   <say>一句口语</say>                       老师说的话（流式）
 *   <scene title="课题"/>                      翻到一块干净的新板（一页）
 *   <note title="要点">markdown</note>         要点 / 小结（流式）
 *   <math label="勾股定理">a^2+b^2=c^2</math>  公式（KaTeX）
 *   <svg viewBox="0 0 800 450">…</svg>         自由图形（逐元素渐进描画）
 *   <draw id="fig">JS 脚本</draw>              精确图形：脚本在沙箱里跑，几何 / 函数 / 动画由代码计算（lib/teach-live-draw）
 *   <draw into="fig">…</draw>                  往已有 draw 图上追加（同一作用域，同一布局）
 *   <plot x="-5,5" y="-3,3">f(x)=x^2</plot>    函数图 / 坐标系（声明式，前端排版）
 *   <diagram>mermaid</diagram>                流程 / 关系 / 时间线 / 思维导图
 *   <code lang="python">…</code>              代码（流式，落定后高亮）
 *   <anim>svg + <style> keyframes</anim>      代码驱动的动画（SVG/CSS/SMIL）
 *   <widget title="…">html+js</widget>        沙箱交互件（滑块 / 模拟）
 *   <image prompt="…" alt="…"/>               生图（慢，异步回填）
 *   <ask>问学生的问题</ask>                    提问并等学生回答（一轮自然结束）
 *   <point at="id"/> <highlight at="id"/>      指向 / 强调板上的元素
 *   <pause s="1.5"/>                           留白
 *   <erase id="…"/>                            擦掉一块
 *
 * 事件 id 由服务端分配（线程内唯一），模型自己写的 id 留在 attrs.id 作为
 * 「标签」供 point/highlight 引用（前端解析为最近一块同名标签）。
 */

export const LIVE_BLOCK_KINDS = [
  'say',
  'ask',
  'note',
  'math',
  'svg',
  'draw',
  'plot',
  'diagram',
  'code',
  'anim',
  'widget',
  'image',
] as const;
export type LiveBlockKind = (typeof LIVE_BLOCK_KINDS)[number];

export const LIVE_CUE_NAMES = ['scene', 'point', 'highlight', 'pause', 'erase'] as const;
export type LiveCueName = (typeof LIVE_CUE_NAMES)[number];

export type LiveAttrs = Record<string, string>;

/** 板书块里「说的话」——口播类块，正文进 TTS 与字幕，不上板 */
export const LIVE_SPEECH_KINDS: ReadonlySet<LiveBlockKind> = new Set(['say', 'ask']);

/** 正文可以边到边渲染的块（其余等 block-close 再整体渲染） */
export const LIVE_STREAMING_KINDS: ReadonlySet<LiveBlockKind> = new Set([
  'say',
  'ask',
  'note',
  'svg',
  'code',
]);

/**
 * SSE / 事件日志上的 live 事件（与 teach-codex/event-bus.ts 的 TeachStreamEvent
 * 联合；老事件 text-delta / turn-complete / interrupted / image-ready / error 原样复用）。
 */
export type LiveBlockOpenEvent = {
  type: 'block-open';
  id: string;
  kind: LiveBlockKind;
  attrs: LiveAttrs;
};
export type LiveBlockDeltaEvent = { type: 'block-delta'; id: string; text: string };
export type LiveBlockCloseEvent = {
  type: 'block-close';
  id: string;
  /** false = 模型输出在这里被截断 / 打断，正文可能不完整 */
  complete: boolean;
};
export type LiveCueEvent = { type: 'cue'; name: LiveCueName; args: LiveAttrs };

export type LiveEvent = LiveBlockOpenEvent | LiveBlockDeltaEvent | LiveBlockCloseEvent | LiveCueEvent;

export function isLiveBlockKind(name: string): name is LiveBlockKind {
  return (LIVE_BLOCK_KINDS as readonly string[]).includes(name);
}

export function isLiveCueName(name: string): name is LiveCueName {
  return (LIVE_CUE_NAMES as readonly string[]).includes(name);
}
