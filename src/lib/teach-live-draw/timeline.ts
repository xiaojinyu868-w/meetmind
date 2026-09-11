/**
 * timeline —— 把「随时间 t 变化的几何」编译成浏览器原生动画（SMIL 属性插值）。
 *
 * 这是 Manim 的 ValueTracker + updater 搬进实时浏览器：脚本里写 `const t = time(4)`，
 * 后面的构造随便用 t（P = onCircle(c, 90 * t)、切线跟着 P 转、标签跟着算）。运行时把脚本在
 * t ∈ [0, dur] 上采样 K 帧，每帧都是**精确几何**（切线永远相切），再把逐帧的属性差异写成
 * <animate values="…" keyTimes="…">，由浏览器插值播放——没有逐帧脚本、没有主线程开销、
 * 回放 / 回看零成本。
 *
 * 输入是 render 出的 K 段标记（同一 transform、同一元素顺序），这里只做三件事：
 * 1. 解析成树，元素按 id / data-for / (父键 + 标签 + 序号) 跨帧对齐；
 * 2. 数值属性（cx cy r x y x1… d points）逐帧不同 → <animate>（d / points 结构一致时线性插值，否则离散）；
 *    颜色 / 显隐 → 离散；文字内容变化 → 按「相同内容的连续帧」复制 <text> 并用 opacity 切换（≤ 12 段）；
 * 3. 只在部分帧出现的元素 → opacity 离散切换；只在非首帧出现的元素忽略（提示词要求不要按 t 条件画）。
 */

export interface TimelineSpec {
  /** 秒 */
  dur: number;
  loop: boolean | 'pingpong';
}

export interface MarkupNode {
  tag: string;
  attrs: Record<string, string>;
  children: MarkupNode[];
  text: string;
  /** 跨帧对齐键 */
  key: string;
}
type Node = MarkupNode;

const NUMERIC_ATTRS = new Set(['cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-width', 'font-size']);
const SHAPE_ATTRS = new Set(['d', 'points']);
const DISCRETE_ATTRS = new Set(['fill', 'stroke', 'visibility', 'text-anchor', 'stroke-dasharray', 'transform']);
const TEXT_TAGS = new Set(['text', 'tspan', 'title']);
/** 文字每帧都变（角度读数）也要跟得上：上限 = 最大采样帧数；一张图里最多 4 个这样的读数（DOM 体积） */
const MAX_TEXT_RUNS = 40;
const MAX_TEXT_NODES = 4;

// ---------- 解析（只需处理我们自己 render 出来的格式） ----------

const ATTR_RE = /([^\s=/>]+)="([^"]*)"/g;

export function parseMarkup(markup: string): Node[] {
  const root: Node = { tag: '#root', attrs: {}, children: [], text: '', key: '' };
  const stack: Node[] = [root];
  let i = 0;
  const n = markup.length;
  while (i < n) {
    const lt = markup.indexOf('<', i);
    if (lt < 0) {
      appendText(stack[stack.length - 1], markup.slice(i));
      break;
    }
    if (lt > i) appendText(stack[stack.length - 1], markup.slice(i, lt));
    if (markup.startsWith('<!--', lt)) {
      const end = markup.indexOf('-->', lt);
      i = end < 0 ? n : end + 3;
      continue;
    }
    const gt = findTagEnd(markup, lt);
    if (gt < 0) break;
    const raw = markup.slice(lt + 1, gt);
    if (raw.startsWith('/')) {
      if (stack.length > 1) stack.pop();
      i = gt + 1;
      continue;
    }
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const sp = body.search(/\s/);
    const tag = (sp < 0 ? body : body.slice(0, sp)).toLowerCase();
    const attrs: Record<string, string> = {};
    if (sp >= 0) {
      ATTR_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      const attrText = body.slice(sp);
      while ((m = ATTR_RE.exec(attrText))) attrs[m[1]] = m[2];
    }
    const node: Node = { tag, attrs, children: [], text: '', key: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    i = gt + 1;
  }
  assignKeys(root, '');
  return root.children;
}

function appendText(node: Node, text: string): void {
  if (!text) return;
  if (TEXT_TAGS.has(node.tag)) node.text += text;
}

function findTagEnd(s: string, from: number): number {
  let quote = false;
  for (let i = from + 1; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') quote = !quote;
    else if (ch === '>' && !quote) return i;
  }
  return -1;
}

function assignKeys(parent: Node, parentKey: string): void {
  const counters: Record<string, number> = {};
  for (const child of parent.children) {
    let key: string;
    if (child.attrs.id) key = `#${child.attrs.id}`;
    else if (child.attrs['data-for']) key = `${parentKey}/for:${child.attrs['data-for']}`;
    else {
      const idx = (counters[child.tag] = (counters[child.tag] ?? 0) + 1);
      key = `${parentKey}/${child.tag}[${idx}]`;
    }
    child.key = key;
    assignKeys(child, key);
  }
}

function serialize(nodes: Node[]): string {
  return nodes.map(serializeOne).join('\n');
}
export const serializeNodes = serialize;

function serializeOne(node: Node): string {
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
  const inner = node.text + (node.children.length ? node.children.map(serializeOne).join('') : '');
  if (!inner) return `<${node.tag}${attrs}/>`;
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
}

// ---------- 对齐与差分 ----------

function indexTree(nodes: Node[], map: Map<string, Node>): void {
  for (const node of nodes) {
    map.set(node.key, node);
    indexTree(node.children, map);
  }
}

function shapeSignature(v: string): string {
  return (v.match(/[a-zA-Z]|-?\d*\.?\d+/g) ?? []).map((tok) => (/[a-zA-Z]/.test(tok) ? tok.toUpperCase() : '#')).join('');
}

function keyTimesFor(count: number): string {
  return Array.from({ length: count }, (_, i) => (count === 1 ? 0 : i / (count - 1)).toFixed(4).replace(/\.?0+$/, '')).join(';');
}

function animateEl(attr: string, values: string[], spec: TimelineSpec, calcMode: 'linear' | 'discrete'): Node {
  const seq = spec.loop === 'pingpong' ? [...values, ...values.slice(0, -1).reverse()] : values;
  const dur = spec.loop === 'pingpong' ? spec.dur * 2 : spec.dur;
  return {
    tag: 'animate',
    attrs: {
      attributeName: attr,
      values: seq.join(';'),
      keyTimes: keyTimesFor(seq.length),
      dur: `${dur}s`,
      repeatCount: spec.loop ? 'indefinite' : '1',
      calcMode,
      fill: 'freeze',
    },
    children: [],
    text: '',
    key: '',
  };
}

/** 把 K 帧标记编译成一段带 SMIL 的标记（以第 0 帧为基底） */
export function compileTimeline(frames: string[], spec: TimelineSpec): { markup: string; animated: number } {
  if (frames.length < 2) return { markup: frames[0] ?? '', animated: 0 };
  const trees = frames.map(parseMarkup);
  const indexes = trees.map((tree) => {
    const map = new Map<string, Node>();
    indexTree(tree, map);
    return map;
  });
  const base = trees[0];
  let animated = 0;
  let textNodesAnimated = 0;
  const extraSiblings = new Map<Node, Node[]>();

  const visit = (node: Node) => {
    if (node.tag === 'animate' || node.tag === 'animatemotion' || node.tag === 'mpath' || node.tag === 'defs' || node.tag === 'marker') return;
    const others = indexes.slice(1).map((m) => m.get(node.key));
    const present = [true, ...others.map((o) => !!o)];

    // 属性差分
    const attrNames = new Set<string>(Object.keys(node.attrs));
    for (const o of others) if (o) for (const k of Object.keys(o.attrs)) attrNames.add(k);
    for (const attr of attrNames) {
      const isNumeric = NUMERIC_ATTRS.has(attr);
      const isShape = SHAPE_ATTRS.has(attr);
      const isDiscrete = DISCRETE_ATTRS.has(attr);
      if (!isNumeric && !isShape && !isDiscrete) continue;
      const values: string[] = [];
      let differs = false;
      let baseVal = node.attrs[attr];
      for (let k = 0; k < frames.length; k++) {
        const src = k === 0 ? node : others[k - 1];
        const v = src?.attrs[attr];
        if (v === undefined) {
          // 该帧没有这个属性 / 元素：沿用上一帧的值（显隐由下面的 opacity 处理）
          values.push(values[values.length - 1] ?? baseVal ?? '');
          continue;
        }
        if (baseVal === undefined) baseVal = v;
        if (v !== baseVal) differs = true;
        values.push(v);
      }
      if (!differs) continue;
      let calcMode: 'linear' | 'discrete' = 'linear';
      if (isDiscrete) calcMode = 'discrete';
      else if (isShape) {
        const sig = shapeSignature(values[0]);
        if (!values.every((v) => shapeSignature(v) === sig)) calcMode = 'discrete';
      }
      node.children.push(animateEl(attr, values, spec, calcMode));
      animated++;
    }

    // 显隐：只在部分帧存在
    if (present.some((p) => !p)) {
      node.children.push(animateEl('opacity', present.map((p) => (p ? '1' : '0')), spec, 'discrete'));
      animated++;
    }

    // 文字内容变化：按连续相同内容分段复制
    if (TEXT_TAGS.has(node.tag) && node.tag !== 'tspan') {
      const texts = [node.text, ...others.map((o) => o?.text ?? node.text)];
      if (texts.some((t) => t !== node.text)) {
        const runs: Array<{ text: string; from: number; to: number }> = [];
        for (let k = 0; k < texts.length; k++) {
          const last = runs[runs.length - 1];
          if (last && last.text === texts[k]) last.to = k;
          else runs.push({ text: texts[k], from: k, to: k });
        }
        if (runs.length <= MAX_TEXT_RUNS && textNodesAnimated < MAX_TEXT_NODES) {
          textNodesAnimated++;
          const copies: Node[] = [];
          runs.forEach((run, idx) => {
            const visible = texts.map((_, k) => (k >= run.from && k <= run.to ? '1' : '0'));
            const copy: Node = idx === 0 ? node : { ...node, attrs: { ...node.attrs }, children: node.children.filter((c) => c.attrs.attributeName !== 'opacity'), text: run.text, key: '' };
            if (idx > 0) {
              delete copy.attrs.id;
              copies.push(copy);
            }
            copy.children = copy.children.filter((c) => c.attrs.attributeName !== 'opacity');
            copy.children.push(animateEl('opacity', visible, spec, 'discrete'));
          });
          if (copies.length) extraSiblings.set(node, copies);
          animated++;
        }
      }
    }

    for (const child of [...node.children]) visit(child);
  };
  for (const node of base) visit(node);

  // 把文字副本插到原元素后面
  const withCopies = (nodes: Node[]): Node[] => {
    const out: Node[] = [];
    for (const n of nodes) {
      n.children = withCopies(n.children);
      out.push(n);
      const extra = extraSiblings.get(n);
      if (extra) out.push(...extra);
    }
    return out;
  };
  return { markup: serialize(withCopies(base)), animated };
}

/** 采样帧数：每秒 10 帧，12–40 之间 */
export function sampleCount(dur: number): number {
  return Math.max(12, Math.min(40, Math.round(dur * 10)));
}
