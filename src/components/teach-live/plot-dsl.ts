/**
 * plot-dsl —— <plot> 块的声明式语法 → SVG 标记（纯函数，服务端/客户端皆可跑，可单测）。
 *
 * 为什么不让模型直接画坐标系：坐标换算、刻度、不重叠的标注是机械活，模型会算错、
 * 会把文字压在线上。这里模型只说「画 x² 和 2x+1，标出 (2,4)」，排版由代码保证永远对齐。
 *
 * 语法（每行一条）：
 *   f(x) = x^2 - 2x        曲线（名字任意；颜色按顺序 pine / amber / blue / rose）
 *   point(2, 4, "P")       点 + 标注
 *   segment(0,0, 2,4)      线段
 *   vline(2)  hline(4)     参考线（虚线）
 *   label(1, 8, "顶点")    文字
 * 属性：x="-4,4" y="-2,10" title="…" grid="0|1"
 *
 * 表达式：+ - * / ^、一元负号、括号、函数（sin cos tan asin acos atan sinh cosh tanh
 * exp ln log log10 log2 sqrt abs floor ceil round sign）、常量 pi e、隐式乘法（2x、3(x+1)）。
 * 安全：手写 shunting-yard，不用 eval/Function。
 */

import type { LiveAttrs } from '@/types/teach-live';

// ---------- 表达式 ----------

type Token =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'comma' };

const FUNCTIONS: Record<string, (a: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  sqrt: Math.sqrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, π: Math.PI };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/²/g, '^2').replace(/³/g, '^3').replace(/√/g, 'sqrt');
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^\d*\.?\d+(?:e[+-]?\d+)?|^\d+\.?/i.exec(s.slice(i));
      if (!m) throw new Error(`bad number at ${i}`);
      tokens.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Zπ_]/.test(ch)) {
      const m = /^[a-zA-Zπ_][a-zA-Z0-9_]*/.exec(s.slice(i))!;
      let word = m[0];
      i += word.length;
      // 把 "2x" 之类连在一起的写法拆开：xsin 这种不处理；但 "x2" 视为 x*2 不合理，交给隐式乘法规则前先拆常见形态
      if (word.length > 1 && !(word in FUNCTIONS) && !(word in CONSTANTS) && word !== 'x') {
        // 形如 "xe" / "pix"：拆成已知符号序列
        const parts: string[] = [];
        let rest = word;
        while (rest.length) {
          const known = Object.keys(FUNCTIONS)
            .concat(Object.keys(CONSTANTS), ['x'])
            .filter((k) => rest.startsWith(k))
            .sort((a, b) => b.length - a.length)[0];
          if (!known) throw new Error(`unknown symbol ${rest}`);
          parts.push(known);
          rest = rest.slice(known.length);
        }
        for (const p of parts) tokens.push({ t: 'id', v: p });
        continue;
      }
      word = word.toLowerCase() === 'x' ? 'x' : word;
      tokens.push({ t: 'id', v: word });
      continue;
    }
    if ('+-*/^'.includes(ch)) {
      tokens.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ t: 'lp' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ t: 'rp' });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ t: 'comma' });
      i++;
      continue;
    }
    throw new Error(`unexpected '${ch}'`);
  }
  // 隐式乘法：num/id/rp 后面跟 num/id/lp（函数名后跟 lp 是调用，不插）
  const out: Token[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const cur = tokens[k];
    const prev = out[out.length - 1];
    if (prev) {
      const prevIsValue = prev.t === 'num' || prev.t === 'rp' || (prev.t === 'id' && !(prev.v in FUNCTIONS));
      const curStartsValue = cur.t === 'num' || cur.t === 'id' || cur.t === 'lp';
      if (prevIsValue && curStartsValue) out.push({ t: 'op', v: '*' });
    }
    out.push(cur);
  }
  return out;
}

type Rpn = Array<{ k: 'num'; v: number } | { k: 'var' } | { k: 'op'; v: string } | { k: 'fn'; v: string } | { k: 'neg' }>;

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };

export function compileExpression(src: string): (x: number) => number {
  const tokens = tokenize(src);
  const output: Rpn = [];
  const stack: Array<Token | { t: 'neg' }> = [];
  let expectOperand = true;
  for (const tok of tokens) {
    if (tok.t === 'num') {
      output.push({ k: 'num', v: tok.v });
      expectOperand = false;
    } else if (tok.t === 'id') {
      if (tok.v in FUNCTIONS) {
        stack.push(tok);
        expectOperand = true;
      } else if (tok.v in CONSTANTS) {
        output.push({ k: 'num', v: CONSTANTS[tok.v] });
        expectOperand = false;
      } else if (tok.v === 'x') {
        output.push({ k: 'var' });
        expectOperand = false;
      } else throw new Error(`unknown identifier ${tok.v}`);
    } else if (tok.t === 'op') {
      if (tok.v === '-' && expectOperand) {
        stack.push({ t: 'neg' });
        continue;
      }
      if (tok.v === '+' && expectOperand) continue;
      for (;;) {
        const top = stack[stack.length - 1];
        if (!top) break;
        if (top.t === 'neg') {
          if (tok.v === '^') break; // -x^2 = -(x^2)
          output.push({ k: 'neg' });
          stack.pop();
          continue;
        }
        if (top.t === 'op' && (PREC[top.v] > PREC[tok.v] || (PREC[top.v] === PREC[tok.v] && tok.v !== '^'))) {
          output.push({ k: 'op', v: top.v });
          stack.pop();
          continue;
        }
        break;
      }
      stack.push(tok);
      expectOperand = true;
    } else if (tok.t === 'lp') {
      stack.push(tok);
      expectOperand = true;
    } else if (tok.t === 'rp') {
      for (;;) {
        const top = stack.pop();
        if (!top) throw new Error('unbalanced )');
        if (top.t === 'lp') break;
        if (top.t === 'neg') output.push({ k: 'neg' });
        else if (top.t === 'op') output.push({ k: 'op', v: top.v });
      }
      const fn = stack[stack.length - 1];
      if (fn && fn.t === 'id' && fn.v in FUNCTIONS) {
        output.push({ k: 'fn', v: fn.v });
        stack.pop();
      }
      expectOperand = false;
    } else if (tok.t === 'comma') {
      throw new Error('multi-arg functions unsupported');
    }
  }
  while (stack.length) {
    const top = stack.pop()!;
    if (top.t === 'lp') throw new Error('unbalanced (');
    if (top.t === 'neg') output.push({ k: 'neg' });
    else if (top.t === 'op') output.push({ k: 'op', v: top.v });
    else if (top.t === 'id') output.push({ k: 'fn', v: top.v });
  }
  return (x: number) => {
    const st: number[] = [];
    for (const item of output) {
      if (item.k === 'num') st.push(item.v);
      else if (item.k === 'var') st.push(x);
      else if (item.k === 'neg') st.push(-(st.pop() ?? NaN));
      else if (item.k === 'fn') st.push(FUNCTIONS[item.v](st.pop() ?? NaN));
      else {
        const b = st.pop() ?? NaN;
        const a = st.pop() ?? NaN;
        st.push(item.v === '+' ? a + b : item.v === '-' ? a - b : item.v === '*' ? a * b : item.v === '/' ? a / b : Math.pow(a, b));
      }
    }
    return st.length === 1 ? st[0] : NaN;
  };
}

// ---------- 声明 ----------

export type PlotItem =
  | { type: 'fn'; name: string; expr: string; fn: (x: number) => number }
  | { type: 'point'; x: number; y: number; label?: string }
  | { type: 'segment'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'vline'; x: number }
  | { type: 'hline'; y: number }
  | { type: 'label'; x: number; y: number; text: string };

export interface PlotSpec {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  title?: string;
  grid: boolean;
  items: PlotItem[];
  errors: string[];
}

function parseRange(raw: string | undefined, fallback: [number, number]): [number, number] {
  if (!raw) return fallback;
  const parts = raw.split(/[,\s~]+/).map(Number).filter((n) => Number.isFinite(n));
  if (parts.length >= 2 && parts[1] > parts[0]) return [parts[0], parts[1]];
  return fallback;
}

function nums(argText: string): number[] {
  return argText.split(',').map((s) => Number(s.trim()));
}

function stripQuotes(s: string): string {
  return s.trim().replace(/^["'“”]+|["'“”]+$/g, '');
}

export function parsePlot(attrs: LiveAttrs, body: string): PlotSpec {
  const [xmin, xmax] = parseRange(attrs.x, [-5, 5]);
  const yRange = parseRange(attrs.y, [NaN, NaN]);
  const spec: PlotSpec = {
    xmin,
    xmax,
    ymin: yRange[0],
    ymax: yRange[1],
    title: attrs.title,
    grid: attrs.grid !== '0' && attrs.grid !== 'false',
    items: [],
    errors: [],
  };
  for (const rawLine of body.split(/\n|;/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    let m: RegExpExecArray | null;
    if ((m = /^point\((.+)\)$/i.exec(line))) {
      const parts = m[1].split(',');
      const [x, y] = nums(parts.slice(0, 2).join(','));
      if (Number.isFinite(x) && Number.isFinite(y)) spec.items.push({ type: 'point', x, y, label: parts[2] ? stripQuotes(parts.slice(2).join(',')) : undefined });
      else spec.errors.push(line);
    } else if ((m = /^segment\((.+)\)$/i.exec(line))) {
      const [x1, y1, x2, y2] = nums(m[1]);
      if ([x1, y1, x2, y2].every(Number.isFinite)) spec.items.push({ type: 'segment', x1, y1, x2, y2 });
      else spec.errors.push(line);
    } else if ((m = /^vline\((.+)\)$/i.exec(line))) {
      const [x] = nums(m[1]);
      if (Number.isFinite(x)) spec.items.push({ type: 'vline', x });
    } else if ((m = /^hline\((.+)\)$/i.exec(line))) {
      const [y] = nums(m[1]);
      if (Number.isFinite(y)) spec.items.push({ type: 'hline', y });
    } else if ((m = /^label\((.+)\)$/i.exec(line))) {
      const parts = m[1].split(',');
      const [x, y] = nums(parts.slice(0, 2).join(','));
      if (Number.isFinite(x) && Number.isFinite(y)) spec.items.push({ type: 'label', x, y, text: stripQuotes(parts.slice(2).join(',')) });
    } else if ((m = /^([a-zA-Z_][\w]*)\s*\(\s*x\s*\)\s*=\s*(.+)$/.exec(line)) || (m = /^(y)\s*=\s*(.+)$/.exec(line))) {
      try {
        spec.items.push({ type: 'fn', name: m[1], expr: m[2].trim(), fn: compileExpression(m[2]) });
      } catch {
        spec.errors.push(line);
      }
    } else {
      // 裸表达式当曲线
      try {
        spec.items.push({ type: 'fn', name: 'f', expr: line, fn: compileExpression(line) });
      } catch {
        spec.errors.push(line);
      }
    }
  }
  // y 范围缺省：按曲线采样取分位数，留边
  if (!Number.isFinite(spec.ymin) || !Number.isFinite(spec.ymax)) {
    const ys: number[] = [];
    for (const item of spec.items) {
      if (item.type === 'fn') {
        for (let i = 0; i <= 200; i++) {
          const y = item.fn(xmin + ((xmax - xmin) * i) / 200);
          if (Number.isFinite(y)) ys.push(y);
        }
      } else if (item.type === 'point') ys.push(item.y);
      else if (item.type === 'segment') ys.push(item.y1, item.y2);
    }
    if (ys.length) {
      ys.sort((a, b) => a - b);
      const lo = ys[Math.floor(ys.length * 0.03)];
      const hi = ys[Math.ceil(ys.length * 0.97) - 1];
      const pad = Math.max((hi - lo) * 0.12, 0.5);
      spec.ymin = Math.min(lo - pad, 0);
      spec.ymax = Math.max(hi + pad, 0.5);
      if (spec.ymax - spec.ymin < 1) spec.ymax = spec.ymin + 1;
    } else {
      spec.ymin = -5;
      spec.ymax = 5;
    }
  }
  return spec;
}

// ---------- 编译成 SVG ----------

const CURVE_COLORS = ['#2F6B55', '#C8873A', '#3B6FB6', '#C24B5A', '#7A5EA7'];
const W = 800;
const H = 500;
const PAD = { l: 64, r: 40, t: 44, b: 52 };

function niceStep(range: number, target = 8): number {
  const rough = range / target;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const candidates = [1, 2, 2.5, 5, 10].map((c) => c * pow);
  return candidates.find((c) => c >= rough) ?? candidates[candidates.length - 1];
}

function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : String(r);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function compilePlotSvg(spec: PlotSpec): { markup: string; viewBox: string } {
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const sx = (x: number) => PAD.l + ((x - spec.xmin) / (spec.xmax - spec.xmin)) * plotW;
  const sy = (y: number) => PAD.t + (1 - (y - spec.ymin) / (spec.ymax - spec.ymin)) * plotH;
  const parts: string[] = [];
  const clipId = `plotclip_${Math.random().toString(36).slice(2, 8)}`;

  parts.push(`<defs><clipPath id="${clipId}"><rect x="${PAD.l}" y="${PAD.t}" width="${plotW}" height="${plotH}"/></clipPath></defs>`);

  // 网格 + 刻度
  const xStep = niceStep(spec.xmax - spec.xmin);
  const yStep = niceStep(spec.ymax - spec.ymin, 6);
  const grid: string[] = [];
  const ticks: string[] = [];
  const x0 = Math.ceil(spec.xmin / xStep) * xStep;
  for (let x = x0; x <= spec.xmax + 1e-9; x += xStep) {
    const X = sx(x);
    if (spec.grid) grid.push(`<line x1="${X.toFixed(1)}" y1="${PAD.t}" x2="${X.toFixed(1)}" y2="${PAD.t + plotH}" stroke="#20312A" stroke-opacity="0.08" stroke-width="1"/>`);
    if (Math.abs(x) > 1e-9) ticks.push(`<text x="${X.toFixed(1)}" y="${PAD.t + plotH + 24}" font-size="15" fill="#53645C" text-anchor="middle">${fmt(x)}</text>`);
  }
  const y0 = Math.ceil(spec.ymin / yStep) * yStep;
  for (let y = y0; y <= spec.ymax + 1e-9; y += yStep) {
    const Y = sy(y);
    if (spec.grid) grid.push(`<line x1="${PAD.l}" y1="${Y.toFixed(1)}" x2="${PAD.l + plotW}" y2="${Y.toFixed(1)}" stroke="#20312A" stroke-opacity="0.08" stroke-width="1"/>`);
    if (Math.abs(y) > 1e-9) ticks.push(`<text x="${PAD.l - 12}" y="${(Y + 5).toFixed(1)}" font-size="15" fill="#53645C" text-anchor="end">${fmt(y)}</text>`);
  }
  if (grid.length) parts.push(`<g id="grid" data-draw="fade">${grid.join('')}</g>`);

  // 坐标轴（原点在范围内就穿过原点，否则贴边）
  const axisY = spec.ymin <= 0 && spec.ymax >= 0 ? sy(0) : PAD.t + plotH;
  const axisX = spec.xmin <= 0 && spec.xmax >= 0 ? sx(0) : PAD.l;
  parts.push(
    `<g id="axes"><line x1="${PAD.l - 6}" y1="${axisY.toFixed(1)}" x2="${PAD.l + plotW + 10}" y2="${axisY.toFixed(1)}" stroke="#20312A" stroke-width="2" stroke-linecap="round"/>` +
      `<polygon points="${PAD.l + plotW + 10},${axisY.toFixed(1)} ${PAD.l + plotW},${(axisY - 5).toFixed(1)} ${PAD.l + plotW},${(axisY + 5).toFixed(1)}" fill="#20312A"/>` +
      `<line x1="${axisX.toFixed(1)}" y1="${PAD.t + plotH + 6}" x2="${axisX.toFixed(1)}" y2="${PAD.t - 12}" stroke="#20312A" stroke-width="2" stroke-linecap="round"/>` +
      `<polygon points="${axisX.toFixed(1)},${PAD.t - 12} ${(axisX - 5).toFixed(1)},${PAD.t} ${(axisX + 5).toFixed(1)},${PAD.t}" fill="#20312A"/>` +
      `<text x="${PAD.l + plotW + 14}" y="${(axisY + 6).toFixed(1)}" font-size="18" fill="#20312A" font-style="italic">x</text>` +
      `<text x="${(axisX + 12).toFixed(1)}" y="${PAD.t - 6}" font-size="18" fill="#20312A" font-style="italic">y</text></g>`,
  );
  if (ticks.length) parts.push(`<g id="ticks" data-draw="fade">${ticks.join('')}</g>`);
  if (spec.title) parts.push(`<text x="${W / 2}" y="26" font-size="20" fill="#20312A" text-anchor="middle" font-weight="600">${esc(spec.title)}</text>`);

  // 参考线
  for (const item of spec.items) {
    if (item.type === 'vline') parts.push(`<line x1="${sx(item.x).toFixed(1)}" y1="${PAD.t}" x2="${sx(item.x).toFixed(1)}" y2="${PAD.t + plotH}" stroke="#53645C" stroke-width="1.5" stroke-dasharray="8 6"/>`);
    if (item.type === 'hline') parts.push(`<line x1="${PAD.l}" y1="${sy(item.y).toFixed(1)}" x2="${PAD.l + plotW}" y2="${sy(item.y).toFixed(1)}" stroke="#53645C" stroke-width="1.5" stroke-dasharray="8 6"/>`);
  }

  // 曲线
  let colorIdx = 0;
  const legends: string[] = [];
  const yPad = (spec.ymax - spec.ymin) * 0.5;
  for (const item of spec.items) {
    if (item.type !== 'fn') continue;
    const color = CURVE_COLORS[colorIdx % CURVE_COLORS.length];
    colorIdx++;
    const N = 480;
    let d = '';
    let pen = false;
    let prevY = NaN;
    let lastVisible: { x: number; y: number } | null = null;
    for (let i = 0; i <= N; i++) {
      const x = spec.xmin + ((spec.xmax - spec.xmin) * i) / N;
      const y = item.fn(x);
      const inRange = Number.isFinite(y) && y > spec.ymin - yPad && y < spec.ymax + yPad;
      const jump = Number.isFinite(prevY) && Number.isFinite(y) && Math.abs(y - prevY) > (spec.ymax - spec.ymin) * 0.9;
      if (!inRange || jump) {
        pen = false;
        prevY = y;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)} `;
      pen = true;
      prevY = y;
      if (y >= spec.ymin && y <= spec.ymax) lastVisible = { x, y };
    }
    if (d) parts.push(`<path id="curve-${esc(item.name)}" d="${d.trim()}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#${clipId})"/>`);
    const label = `${item.name}(x) = ${item.expr}`;
    if (lastVisible) {
      const lx = Math.min(sx(lastVisible.x) + 8, W - PAD.r - 8);
      const ly = Math.max(PAD.t + 12, Math.min(sy(lastVisible.y) - 8, PAD.t + plotH - 4));
      legends.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="16" fill="${color}" text-anchor="${lx > W - PAD.r - 120 ? 'end' : 'start'}" font-weight="600">${esc(label)}</text>`);
    } else {
      legends.push(`<text x="${W - PAD.r}" y="${PAD.t + 16 + legends.length * 22}" font-size="16" fill="${color}" text-anchor="end" font-weight="600">${esc(label)}</text>`);
    }
  }
  if (legends.length) parts.push(`<g id="legend" data-draw="fade">${legends.join('')}</g>`);

  // 线段 / 点 / 文字
  for (const item of spec.items) {
    if (item.type === 'segment') parts.push(`<line x1="${sx(item.x1).toFixed(1)}" y1="${sy(item.y1).toFixed(1)}" x2="${sx(item.x2).toFixed(1)}" y2="${sy(item.y2).toFixed(1)}" stroke="#3B6FB6" stroke-width="2.5" stroke-linecap="round"/>`);
  }
  for (const item of spec.items) {
    if (item.type === 'point') {
      const X = sx(item.x);
      const Y = sy(item.y);
      parts.push(
        `<g id="pt-${esc(item.label ?? `${item.x}-${item.y}`)}"><circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="6" fill="#C24B5A" stroke="#F6F8F6" stroke-width="2"/>` +
          (item.label ? `<text x="${(X + 12).toFixed(1)}" y="${(Y - 10).toFixed(1)}" font-size="17" fill="#C24B5A" font-weight="600">${esc(item.label)}</text>` : '') +
          `</g>`,
      );
    }
    if (item.type === 'label') parts.push(`<text x="${sx(item.x).toFixed(1)}" y="${sy(item.y).toFixed(1)}" font-size="18" fill="#20312A" text-anchor="middle">${esc(item.text)}</text>`);
  }

  return { markup: parts.join('\n'), viewBox: `0 0 ${W} ${H}` };
}
