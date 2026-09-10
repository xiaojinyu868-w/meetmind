/**
 * 速查表纸面排印（静态 CSS，与组件逻辑分开）。
 *
 * 纸面变量由窗口按版式偏好写在 .cs-root 上：
 *   --cs-font（正文 px）· --cs-lh（行高）· --cs-item-gap / --cs-topic-gap（em）· --cs-scale（屏幕缩放）
 *
 * 排印判断：
 *   - 全部 Inter（'palt' 紧排）——这是一张产品里的纸，不是学术论文；Instrument Serif 只留给首页一句用法说明；
 *   - 字号层级只有四档（标题 / 主题 / 正文 / 页眉页脚），层级靠粗细与一道线，不靠颜色；
 *   - 颜色只来自荧光笔和朱红波浪线，正文永远是墨色——黑白打印照样成立；
 *   - 栏线 0.5px、booktabs 表格、居中公式：对齐学术 cheat sheet 的密排传统。
 */
export const CHEATSHEET_PAPER_CSS = `
.cs-root {
  --cs-font: 10px;
  --cs-lh: 1.4;
  --cs-item-gap: 0.28em;
  --cs-topic-gap: 1em;
  --cs-scale: 1;
  --cs-ink: var(--mm-ink);
  --cs-ink-2: var(--mm-ink-secondary);
  --cs-ink-3: var(--mm-ink-muted);
  --cs-rule: rgba(32, 49, 42, 0.16);
  color: var(--cs-ink);
}

/* ── 逻辑页 ─────────────────────────────────────────── */
.cs-page-frame {
  position: relative;
  width: calc(794px * var(--cs-scale));
  height: calc(var(--cs-page-h, 1123px) * var(--cs-scale));
  flex-shrink: 0;
  /* 缩放 / 装进一页 / 单页缩短：纸的尺寸 280ms 过渡，不跳 */
  transition: width 280ms cubic-bezier(0.2, 0.8, 0.2, 1), height 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.cs-page {
  position: absolute;
  inset: 0 auto auto 0;
  width: 794px;
  height: var(--cs-page-h, 1123px);
  box-sizing: border-box;
  padding: 30px 34px 28px;
  display: flex;
  flex-direction: column;
  background: #ffffff; /* 纸永远是白的，与主题无关 */
  color: var(--cs-ink);
  font-family: var(--font-inter);
  font-feature-settings: 'palt' 1, 'tnum' 1;
  font-size: var(--cs-font);
  line-height: var(--cs-lh);
  transform: scale(var(--cs-scale));
  transform-origin: top left;
  box-shadow: 0 1px 2px rgba(32, 49, 42, 0.06), 0 12px 36px rgba(32, 49, 42, 0.08);
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  transition: transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1), height 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
@media (prefers-reduced-motion: reduce) {
  .cs-page-frame, .cs-page, .cs-hl { transition: none !important; }
}

/* 首页标题区 */
.cs-title-head {
  padding-bottom: 6px;
  margin-bottom: 8px;
  border-bottom: 1.5px solid var(--cs-ink);
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}
.cs-title-head h1 {
  font-size: 2.05em;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0;
}
.cs-title-overview {
  margin: 3px 0 0;
  font-family: var(--font-instrument-serif);
  font-style: italic;
  font-size: 1.12em;
  color: var(--cs-ink-2);
  letter-spacing: 0.005em;
}
.cs-title-legend {
  flex-shrink: 0;
  display: flex;
  gap: 0.9em;
  font-size: 0.82em;
  color: var(--cs-ink-3);
  white-space: nowrap;
  padding-bottom: 0.25em;
}
.cs-title-legend .cs-hl { color: var(--cs-ink-2); }

/* 后续页页眉 */
.cs-running-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 7px;
  padding-bottom: 3px;
  border-bottom: 0.5px solid var(--cs-ink);
  font-size: 0.82em;
  color: var(--cs-ink-2);
}
.cs-running-head strong { font-weight: 600; color: var(--cs-ink); }

/* 页脚：来源 · 页码。朱批时间戳不进正文，只有这一行说「来自哪」 */
.cs-page-foot {
  margin-top: auto;
  padding-top: 5px;
  border-top: 0.5px solid var(--cs-rule);
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  font-family: var(--font-jetbrains-mono);
  font-size: 0.74em;
  letter-spacing: 0.01em;
  color: var(--cs-ink-3);
  white-space: nowrap;
  overflow: hidden;
}
.cs-page-foot span:first-child { overflow: hidden; text-overflow: ellipsis; }

/* ── 栏 ─────────────────────────────────────────────── */
.cs-columns {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(var(--cs-cols, 3), minmax(0, 1fr));
  align-items: start;
}
.cs-col {
  min-width: 0;
  height: 100%;
  overflow: hidden;
  padding: 0 8px;
}
.cs-col:first-child { padding-left: 0; }
.cs-col:last-child { padding-right: 0; }
.cs-col + .cs-col { border-left: 0.5px solid var(--cs-rule); }

/* ── 块 ─────────────────────────────────────────────── */
.cs-block { break-inside: avoid; }
.cs-heading {
  display: flex;
  align-items: baseline;
  gap: 0.45em;
  padding-bottom: 0.18em;
  margin-bottom: 0.32em;
  border-bottom: 1px solid var(--cs-ink);
  font-size: 1.16em;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.25;
  position: relative;
}
.cs-heading + .cs-heading,
.cs-item + .cs-heading { margin-top: var(--cs-topic-gap); }
.cs-heading-no {
  font-family: var(--font-jetbrains-mono);
  font-size: 0.78em;
  font-weight: 500;
  color: var(--cs-ink-3);
  letter-spacing: 0.02em;
  flex-shrink: 0;
}
.cs-heading-title { min-width: 0; }

.cs-item {
  position: relative;
  padding-bottom: var(--cs-item-gap);
}
.cs-line {
  text-align: left;
  overflow-wrap: anywhere;
}
.cs-term {
  font-weight: 650;
  color: var(--cs-ink);
}
.cs-term-sep {
  color: var(--cs-ink-3);
  margin-right: 0.1em;
}
.cs-strong .cs-term {
  text-decoration: underline wavy var(--mm-vermilion);
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.18em;
  text-decoration-skip-ink: none;
}

/* 荧光笔：半透明、两端略溢出字形、每行独立（clone），像真的马克笔 */
.cs-hl {
  --hl: var(--mm-marker-yellow);
  /* <mark> 的 UA 默认是纯黄底 + 黑字，先清掉，颜色只来自渐变 */
  background-color: transparent;
  color: inherit;
  background-image: linear-gradient(100deg, transparent 0.6%, var(--hl) 2.6%, var(--hl) 96.5%, transparent 98.6%);
  background-repeat: no-repeat;
  /* 开关时荧光笔像被划上 / 擦掉：background-size 从左往右 240ms（渐变本身不能过渡） */
  background-size: 100% 100%;
  background-position: left center;
  transition: background-size 240ms ease;
  padding: 0.05em 0.26em 0.03em;
  margin: 0 -0.2em;
  border-radius: 0.35em 0.18em 0.32em 0.22em;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
.cs-hl[data-kind='formula'] { --hl: var(--mm-marker-green); }
.cs-hl[data-kind='pitfall'] { --hl: var(--mm-marker-red); }
.cs-root[data-highlight='off'] .cs-hl { background-size: 0% 100%; }
@media print { .cs-root[data-highlight='off'] .cs-hl { background-image: none; padding: 0; margin: 0; } }

.cs-inline-body .cheatsheet-richtext,
.cs-inline-body .cheatsheet-richtext > p,
.cs-term .cheatsheet-richtext,
.cs-term .cheatsheet-richtext > p { display: inline; margin: 0; }
.cs-bodyblock { margin-top: 0.08em; }

.cs-formula {
  margin: 0.25em 0 0.15em;
  text-align: center;
  overflow-x: auto;
  overflow-y: hidden;
}
.cs-formula .katex-display { margin: 0; }
.cs-formula .katex { font-size: 1.08em; }

/* 条目末尾的动作：只在 hover 出现，纸面上看不出有一套系统 */
.cs-item-actions {
  position: absolute;
  right: 0;
  top: 0;
  display: flex;
  gap: 0.55em;
  padding: 0 0.15em 0 0.6em;
  font-family: var(--font-jetbrains-mono);
  font-size: 0.78em;
  line-height: calc(var(--cs-lh) * 1em * 1.25);
  color: var(--cs-ink-3);
  background: linear-gradient(90deg, rgba(255,255,255,0), #fff 30%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}
.cs-item:hover .cs-item-actions,
.cs-heading:hover .cs-item-actions,
.cs-item:focus-within .cs-item-actions,
.cs-heading:focus-within .cs-item-actions { opacity: 1; pointer-events: auto; }
.cs-item-actions button {
  color: inherit;
  white-space: nowrap;
}
.cs-item-actions button:hover { color: var(--cs-ink); }
.cs-item-actions button[data-tone='vermilion']:hover { color: var(--mm-vermilion); }
.cs-item:focus, .cs-heading:focus { outline: none; }
/* 触屏：点到条目才出现（:focus-within），且不盖住正文而是另起一行贴右 */
@media (hover: none) {
  .cs-item:focus-within .cs-item-actions,
  .cs-heading:focus-within .cs-item-actions { background: none; position: static; padding: 0.15em 0 0; justify-content: flex-end; }
}

/* 内联编辑 */
.cs-edit {
  display: grid;
  gap: 0.4em;
  padding: 0.4em 0 0.5em;
  font-family: var(--font-inter);
}
.cs-edit input, .cs-edit textarea {
  width: 100%;
  border: 0.5px solid var(--cs-rule);
  border-radius: 0.4em;
  padding: 0.35em 0.5em;
  font: inherit;
  line-height: 1.4;
  color: var(--cs-ink);
  background: #fff;
  outline: none;
  resize: vertical;
}
.cs-edit input:focus, .cs-edit textarea:focus { border-color: var(--mm-pine); }
.cs-edit .cs-edit-latex { font-family: var(--font-jetbrains-mono); font-size: 0.92em; }
.cs-edit-actions { display: flex; justify-content: flex-end; gap: 1em; font-size: 0.9em; }
.cs-edit-actions button { color: var(--cs-ink-2); }
.cs-edit-actions button[data-primary] { color: var(--mm-pine); font-weight: 600; }
.cs-edit-actions button:disabled { opacity: 0.4; }

/* ── 正文富文本 ──────────────────────────────────────── */
.cs-page .cheatsheet-richtext, .cs-flow .cheatsheet-richtext { font-size: inherit; line-height: inherit; color: var(--cs-ink); }
.cs-page .cheatsheet-richtext p, .cs-flow .cheatsheet-richtext p { margin: 0.05em 0; }
.cs-page .cheatsheet-richtext ul, .cs-page .cheatsheet-richtext ol,
.cs-flow .cheatsheet-richtext ul, .cs-flow .cheatsheet-richtext ol { margin: 0.1em 0 0.1em; padding-left: 1.15em; }
.cs-page .cheatsheet-richtext ul, .cs-flow .cheatsheet-richtext ul { list-style: none; }
.cs-page .cheatsheet-richtext ul > li, .cs-flow .cheatsheet-richtext ul > li { position: relative; }
.cs-page .cheatsheet-richtext ul > li::before, .cs-flow .cheatsheet-richtext ul > li::before {
  content: '•';
  position: absolute;
  left: -0.95em;
  color: var(--cs-ink-2);
}
.cs-page .cheatsheet-richtext ul ul > li::before, .cs-flow .cheatsheet-richtext ul ul > li::before { content: '–'; }
.cs-page .cheatsheet-richtext ol, .cs-flow .cheatsheet-richtext ol { list-style: decimal; }
.cs-page .cheatsheet-richtext ol > li::marker, .cs-flow .cheatsheet-richtext ol > li::marker { color: var(--cs-ink-2); font-variant-numeric: tabular-nums; }
.cs-page .cheatsheet-richtext li, .cs-flow .cheatsheet-richtext li { padding-left: 0.1em; }
.cs-page .cheatsheet-richtext strong, .cs-flow .cheatsheet-richtext strong { font-weight: 650; color: var(--cs-ink); }
.cs-page .cheatsheet-richtext em, .cs-flow .cheatsheet-richtext em { color: var(--cs-ink-2); }
.cs-page .cheatsheet-richtext code, .cs-flow .cheatsheet-richtext code {
  font-family: var(--font-jetbrains-mono);
  font-size: 0.9em;
  background: rgba(32, 49, 42, 0.05);
  padding: 0 0.25em;
  border-radius: 0.2em;
}
.cs-page .cheatsheet-richtext h4, .cs-page .cheatsheet-richtext h5,
.cs-flow .cheatsheet-richtext h4, .cs-flow .cheatsheet-richtext h5 { margin: 0.2em 0 0.05em; font-size: 1em; font-weight: 600; }
.cs-page .cheatsheet-codeblock, .cs-flow .cheatsheet-codeblock {
  display: block;
  margin: 0.2em 0;
  padding: 0.3em 0.5em;
  border-left: 1.5px solid var(--cs-rule);
  background: rgba(32, 49, 42, 0.035);
  white-space: pre-wrap;
  font-size: 0.88em;
  line-height: 1.35;
}
.cs-page .cheatsheet-richtext blockquote, .cs-flow .cheatsheet-richtext blockquote {
  margin: 0.15em 0;
  padding-left: 0.6em;
  border-left: 1.5px solid var(--cs-rule);
  color: var(--cs-ink-2);
}
.cs-page .cheatsheet-richtext hr, .cs-flow .cheatsheet-richtext hr { border: 0; border-top: 0.5px solid var(--cs-rule); margin: 0.3em 0; }
.cs-page .cheatsheet-richtext a, .cs-flow .cheatsheet-richtext a { color: inherit; text-decoration: underline; text-decoration-color: var(--cs-rule); }
.cs-page .cheatsheet-richtext .katex-display, .cs-flow .cheatsheet-richtext .katex-display { margin: 0.2em 0; overflow-x: auto; overflow-y: hidden; }

/* booktabs：上下粗线、表头细线、无竖线 */
.cs-page .cheatsheet-table-wrap, .cs-flow .cheatsheet-table-wrap { margin: 0.25em 0 0.2em; overflow: visible; }
.cs-page .cheatsheet-table-wrap table, .cs-flow .cheatsheet-table-wrap table {
  width: 100%;
  table-layout: auto;
  border-collapse: collapse;
  font-size: 0.94em;
  line-height: 1.3;
}
.cs-page .cheatsheet-table-wrap th, .cs-flow .cheatsheet-table-wrap th {
  border: 0;
  border-top: 1.2px solid var(--cs-ink);
  border-bottom: 0.5px solid var(--cs-ink);
  padding: 0.18em 0.4em;
  text-align: left;
  font-weight: 600;
  background: none;
  color: var(--cs-ink);
}
.cs-page .cheatsheet-table-wrap td, .cs-flow .cheatsheet-table-wrap td {
  border: 0;
  padding: 0.18em 0.4em;
  vertical-align: top;
  color: var(--cs-ink);
}
.cs-page .cheatsheet-table-wrap tr:last-child td, .cs-flow .cheatsheet-table-wrap tr:last-child td { border-bottom: 1.2px solid var(--cs-ink); }
.cs-page .cheatsheet-mermaid, .cs-flow .cheatsheet-mermaid { break-inside: avoid; }
.cs-page .cheatsheet-mermaid .chat-mermaid-svg svg { max-height: 150px; max-width: 100%; }

/* ── 单栏长文（手机 / 窄栏） ─────────────────────────── */
.cs-flow {
  background: #fff;
  color: var(--cs-ink);
  font-family: var(--font-inter);
  font-feature-settings: 'palt' 1, 'tnum' 1;
  font-size: var(--cs-font);
  line-height: var(--cs-lh);
  padding: 18px 18px 22px;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(32, 49, 42, 0.06), 0 8px 28px rgba(32, 49, 42, 0.06);
}
.cs-flow .cs-title-head { display: block; }
.cs-flow .cs-title-legend { margin-top: 0.4em; justify-content: flex-start; white-space: normal; flex-wrap: wrap; }
.cs-flow .cs-page-foot { margin-top: 1.2em; white-space: normal; }

/* ── 量高度用的隐藏渲染器：与页内块同 CSS、同栏宽、同字号 ──── */
.cs-measure {
  position: absolute;
  left: -100000px;
  top: 0;
  visibility: hidden;
  pointer-events: none;
  font-family: var(--font-inter);
  font-feature-settings: 'palt' 1, 'tnum' 1;
  font-size: var(--cs-font);
  line-height: var(--cs-lh);
  color: var(--cs-ink);
}

/* ── 打印：只剩纸 ─────────────────────────────────────── */
@media print {
  @page { size: A4 portrait; margin: 0; }
  html, body { background: #fff !important; }
  .cs-root { --cs-scale: 1 !important; }
  .cs-noprint { display: none !important; }
  .cs-desk { padding: 0 !important; overflow: visible !important; height: auto !important; background: #fff !important; }
  .cs-pages { gap: 0 !important; align-items: flex-start !important; }
  .cs-page-frame { width: 210mm !important; height: 297mm !important; break-after: page; page-break-after: always; }
  .cs-page-frame:last-child { break-after: auto; page-break-after: auto; }
  .cs-page { width: 210mm !important; height: 297mm !important; transform: none !important; box-shadow: none !important; padding: 9mm 9mm 7.5mm !important; }
  .cs-item-actions { display: none !important; }
  .cs-flow { box-shadow: none !important; border-radius: 0 !important; padding: 12mm !important; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}
`;
