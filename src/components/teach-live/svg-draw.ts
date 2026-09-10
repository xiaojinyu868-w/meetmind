'use client';

/**
 * svg-draw —— 让一张 SVG「一笔一笔长出来」的两件小工具：
 *
 * 1. splitTopLevelSvgChildren：把正在流式到达的 SVG 正文切成**已闭合**的顶层子元素——
 *    一个元素闭合就能上板，不必等整张图；半截的留在尾巴里等下一个 chunk。
 * 2. animateDrawIn：把新挂上的元素按落笔顺序描出来——有描边的形状按路径长度做
 *    stroke-dashoffset 描画（真的像笔在走），带填充的形状描完再淡入填充，文字上浮淡入，
 *    <g> 递归错开。一个共享的「笔尖」光点沿着正在画的路径移动。
 *
 * 只依赖 Web Animations API 与 SVGGeometryElement.getTotalLength，零库。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface SplitResult {
  /** 已闭合的顶层子元素（原文切片，含注释外的空白已去） */
  complete: string[];
  /** 剩余未闭合尾巴在原文中的起点 */
  restIndex: number;
}

/** 找到从 pos 开始的标签的 '>'（跳过引号内的 >） */
function findTagEnd(text: string, pos: number): number {
  let quote: string | null = null;
  for (let i = pos; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
  }
  return -1;
}

export function splitTopLevelSvgChildren(body: string): SplitResult {
  const complete: string[] = [];
  let depth = 0;
  let elementStart = -1;
  let i = 0;
  let restIndex = 0;
  while (i < body.length) {
    const lt = body.indexOf('<', i);
    if (lt < 0) break;
    if (body.startsWith('<!--', lt)) {
      const end = body.indexOf('-->', lt + 4);
      if (end < 0) break;
      i = end + 3;
      if (depth === 0) restIndex = i;
      continue;
    }
    const gt = findTagEnd(body, lt);
    if (gt < 0) break; // 标签没写完
    const isClose = body[lt + 1] === '/';
    const selfClosing = !isClose && body[gt - 1] === '/';
    if (depth === 0 && !isClose) elementStart = lt;
    if (isClose) {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && elementStart >= 0) {
        complete.push(body.slice(elementStart, gt + 1));
        elementStart = -1;
        restIndex = gt + 1;
      }
    } else if (selfClosing) {
      if (depth === 0) {
        complete.push(body.slice(elementStart, gt + 1));
        elementStart = -1;
        restIndex = gt + 1;
      }
    } else {
      depth += 1;
    }
    i = gt + 1;
  }
  return { complete, restIndex };
}

/** 把一段 SVG 片段挂进 svg 元素，返回新挂上的顶层元素（<style> 一律剥掉：内联 SVG 的 style 会泄漏到整页） */
export function mountSvgChildren(svg: SVGSVGElement, markup: string): Element[] {
  const tmp = document.createElementNS(SVG_NS, 'svg');
  tmp.innerHTML = markup;
  const mounted: Element[] = [];
  for (const child of Array.from(tmp.children)) {
    if (child.tagName.toLowerCase() === 'style') continue;
    if (child.tagName.toLowerCase() === 'script') continue;
    svg.appendChild(child);
    mounted.push(child);
  }
  return mounted;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

// ---------- 笔尖 ----------

export interface PenController {
  follow(el: SVGGeometryElement, durationMs: number, delayMs: number): void;
  dispose(): void;
}

export function createPen(svg: SVGSVGElement): PenController {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'live-pen');
  g.setAttribute('pointer-events', 'none');
  const halo = document.createElementNS(SVG_NS, 'circle');
  halo.setAttribute('r', '14');
  halo.setAttribute('fill', '#C8873A');
  halo.setAttribute('fill-opacity', '0.18');
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('r', '4.5');
  dot.setAttribute('fill', '#C8873A');
  g.appendChild(halo);
  g.appendChild(dot);
  g.style.opacity = '0';
  g.style.transition = 'opacity 180ms ease';
  svg.appendChild(g);

  let raf = 0;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let token = 0;

  const place = (x: number, y: number) => {
    g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  };

  return {
    follow(el, durationMs, delayMs) {
      const mine = ++token;
      if (hideTimer) clearTimeout(hideTimer);
      const start = () => {
        if (mine !== token) return;
        let total = 0;
        try {
          total = el.getTotalLength();
        } catch {
          return;
        }
        if (!Number.isFinite(total) || total <= 0) return;
        // 笔尖永远画在最上层
        svg.appendChild(g);
        g.style.opacity = '1';
        const t0 = performance.now();
        const step = (now: number) => {
          if (mine !== token) return;
          const p = Math.min(1, (now - t0) / durationMs);
          const eased = 1 - Math.pow(1 - p, 2);
          try {
            const pt = el.getPointAtLength(eased * total);
            place(pt.x, pt.y);
          } catch {
            return;
          }
          if (p < 1) raf = requestAnimationFrame(step);
          else hideTimer = setTimeout(() => mine === token && (g.style.opacity = '0'), 260);
        };
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(step);
      };
      if (delayMs > 0) setTimeout(start, delayMs);
      else start();
    },
    dispose() {
      token++;
      cancelAnimationFrame(raf);
      if (hideTimer) clearTimeout(hideTimer);
      g.remove();
    },
  };
}

// ---------- 描画 ----------

const GEOMETRY_TAGS = new Set(['path', 'line', 'polyline', 'polygon', 'circle', 'ellipse', 'rect']);

function hasVisibleStroke(el: Element): boolean {
  const stroke = (el.getAttribute('stroke') ?? getComputedStyle(el).stroke ?? '').trim();
  return !!stroke && stroke !== 'none' && stroke !== 'transparent';
}

function hasVisibleFill(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const attr = el.getAttribute('fill');
  if (attr === null) {
    // SVG 默认 fill=black；line/polyline 常常不写 fill 但也不该被当成实心
    return tag !== 'line' && tag !== 'polyline';
  }
  const fill = attr.trim();
  return fill !== 'none' && fill !== 'transparent';
}

function strokeDuration(length: number): number {
  return Math.max(260, Math.min(1100, length * 1.1));
}

interface DrawOptions {
  pen?: PenController | null;
  /** 顶层元素之间的错开 */
  stagger?: number;
}

/** 单个元素的描画；返回它占用的毫秒数（用于错开下一个） */
function drawOne(el: Element, delay: number, pen: PenController | null | undefined, depth: number): number {
  const tag = el.tagName.toLowerCase();
  const html = el as HTMLElement & SVGElement;

  if (el.getAttribute('data-draw') === 'fade') return fadeIn(el, delay);

  if (tag === 'g' || tag === 'a') {
    const children = Array.from(el.children);
    // 网格 / 刻度这类一大把的辅助元素：一起淡入，别一根一根描
    if (children.length > 6) {
      children.forEach((child, i) => fadeIn(child, delay + i * 30));
      return 320 + children.length * 30;
    }
    let inner = 0;
    const gap = depth === 0 ? 110 : 70;
    for (const child of children) {
      inner += drawOne(child, delay + inner, pen, depth + 1) * 0.55 + gap;
    }
    return Math.max(inner, 200);
  }

  if (tag === 'defs' || tag === 'title' || tag === 'desc' || tag === 'clippath' || tag === 'mask') return 0;

  if (GEOMETRY_TAGS.has(tag) && hasVisibleStroke(el)) {
    const geom = el as unknown as SVGGeometryElement;
    let length = 0;
    try {
      length = geom.getTotalLength();
    } catch {
      length = 0;
    }
    if (!Number.isFinite(length) || length <= 0) return fadeIn(el, delay);

    const duration = strokeDuration(length);
    const originalDash = el.getAttribute('stroke-dasharray');
    const fill = hasVisibleFill(el);
    const fillOpacityAttr = el.getAttribute('fill-opacity');
    const targetFillOpacity = fillOpacityAttr ? Number(fillOpacityAttr) : 1;

    html.style.strokeDasharray = `${length}`;
    html.style.strokeDashoffset = `${length}`;
    if (fill) html.style.fillOpacity = '0';
    html.style.opacity = '1';

    const anim = el.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
      duration,
      delay,
      easing: 'cubic-bezier(.3,.7,.3,1)',
      fill: 'forwards',
    });
    anim.onfinish = () => {
      html.style.strokeDasharray = originalDash ?? '';
      html.style.strokeDashoffset = '';
      anim.cancel();
      if (fill) {
        const fa = el.animate([{ fillOpacity: 0 }, { fillOpacity: targetFillOpacity }], {
          duration: 380,
          easing: 'ease-out',
          fill: 'forwards',
        });
        fa.onfinish = () => {
          html.style.fillOpacity = fillOpacityAttr ?? '';
          fa.cancel();
        };
      }
    };
    pen?.follow(geom, duration, delay);
    return duration + (fill ? 200 : 0);
  }

  if (tag === 'text' || tag === 'tspan') {
    html.style.opacity = '0';
    const anim = el.animate(
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 420, delay, easing: 'ease-out', fill: 'forwards' },
    );
    anim.onfinish = () => {
      html.style.opacity = '';
      anim.cancel();
    };
    return 420;
  }

  if (GEOMETRY_TAGS.has(tag) || tag === 'image' || tag === 'use' || tag === 'foreignobject') {
    // 无描边的实心形状：从中心长出来
    html.style.opacity = '0';
    html.style.transformBox = 'fill-box';
    html.style.transformOrigin = 'center';
    const anim = el.animate(
      [
        { opacity: 0, transform: 'scale(0.82)' },
        { opacity: 1, transform: 'scale(1)' },
      ],
      { duration: 460, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
    );
    anim.onfinish = () => {
      html.style.opacity = '';
      html.style.transform = '';
      anim.cancel();
    };
    return 460;
  }

  return fadeIn(el, delay);
}

function fadeIn(el: Element, delay: number): number {
  const html = el as HTMLElement;
  html.style.opacity = '0';
  const anim = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, delay, easing: 'ease-out', fill: 'forwards' });
  anim.onfinish = () => {
    html.style.opacity = '';
    anim.cancel();
  };
  return 360;
}

/**
 * 按顺序描出一批刚挂上的顶层元素。返回整段动画的总时长（ms）。
 * 元素必须已在 DOM 里（getTotalLength 需要布局）。
 */
export function animateDrawIn(elements: Element[], options: DrawOptions = {}): number {
  if (elements.length === 0) return 0;
  if (prefersReducedMotion()) return 0;
  const stagger = options.stagger ?? 140;
  let cursor = 0;
  for (const el of elements) {
    const took = drawOne(el, cursor, options.pen, 0);
    // 下一笔在这一笔画到六成时起笔——像人手，不等完全画完
    cursor += Math.max(took * 0.6, 120) + stagger;
  }
  return cursor;
}
