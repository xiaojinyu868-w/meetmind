/**
 * board-canvas-styles — BoardCanvas 的 <style> 块（从组件拆出，行数限制）。
 * 模板串依赖 PAPER 调色板（马克笔黄横扫），其余是静态 keyframes。
 */

import { PAPER } from './board-lecture';

export const BOARD_CANVAS_CSS = `
  .mm-chalk-char {
    display: inline-block;
    opacity: 0;
    animation: mm-chalk-in 0.22s ease-out forwards;
  }
  @keyframes mm-chalk-in {
    from { opacity: 0; transform: translateY(calc(var(--mm-y, 0px) + 3px)) scale(1.04); }
    to { opacity: var(--mm-jitter, 1); transform: translateY(var(--mm-y, 0px)) scale(1); }
  }
  .mm-board-page { animation: mm-page-in 0.45s ease-out; }
  .mm-board-paused .mm-chalk-char { animation-play-state: paused; }
  /* v31 块级公式：KaTeX 无法逐字接力，整块快速淡入 */
  .mm-formula-in { animation: mm-formula-in 0.4s ease-out; }
  @keyframes mm-formula-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  /* KaTeX display 默认 1em 上下外边距：8 个公式就白丢 ~300px 内容高度，
     会把整页逼进收缩兜底——块距由 roleBlockStyle 统一给，这里清零 */
  .mm-board-page .katex-display { margin: 0; }
  /* 马克笔高亮：从左到右横扫一挥 */
  .mm-hl-mark, .mm-hl-mark-instant {
    background-image: linear-gradient(${PAPER.marker}, ${PAPER.marker});
    background-repeat: no-repeat;
    background-position: 0 62%;
  }
  .mm-hl-mark {
    background-size: 0% 78%;
    animation: mm-hl-sweep 0.35s ease-out forwards;
  }
  .mm-hl-mark-instant { background-size: 100% 78%; }
  @keyframes mm-hl-sweep { to { background-size: 100% 78%; } }
  .mm-board-paused .mm-formula-in,
  .mm-board-paused .mm-hl-mark { animation-play-state: paused; }
  @keyframes mm-page-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
`;
