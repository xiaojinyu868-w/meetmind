/**
 * mindmap-gestures — 导图画布的手势与键盘纯函数（可单测）：
 * 缩放锚点、平移边界、松手惯性、双指缩放、方向键在兄弟 / 父子之间移动焦点、根到节点的路径。
 * 画布组件（MindmapCanvas）只负责把事件喂进来、把结果写回 transform。
 */

export interface ViewTransform { x: number; y: number; scale: number }
export interface Size { width: number; height: number }
export interface Point { x: number; y: number }

export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 2.6;
/** 平移边界：任何方向至少留这么多像素的内容在视口里，拖不丢 */
export const PAN_KEEP_PX = 96;
/** 惯性：每 16ms 速度衰减到 0.94；低于 0.02px/ms 停 */
export const INERTIA_FRICTION = 0.94;
export const INERTIA_STOP = 0.02;
export const INERTIA_MIN_START = 0.15;

export function clampScale(scale: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

/** 以 anchor（视口坐标）为锚缩放：锚点下的内容不动 */
export function zoomAround(t: ViewTransform, factor: number, anchor: Point): ViewTransform {
  const scale = clampScale(t.scale * factor);
  const ratio = scale / t.scale;
  return { scale, x: anchor.x - (anchor.x - t.x) * ratio, y: anchor.y - (anchor.y - t.y) * ratio };
}

/** 把内容框住：内容比视口小时允许在视口内任意位置；大时至少留 PAN_KEEP_PX 在视口里 */
export function clampPan(t: ViewTransform, content: Size, viewport: Size, keep: number = PAN_KEEP_PX): ViewTransform {
  const w = content.width * t.scale;
  const h = content.height * t.scale;
  const minX = Math.min(keep - w, viewport.width - w);
  const maxX = Math.max(viewport.width - keep, 0);
  const minY = Math.min(keep - h, viewport.height - h);
  const maxY = Math.max(viewport.height - keep, 0);
  return { ...t, x: Math.min(maxX, Math.max(minX, t.x)), y: Math.min(maxY, Math.max(minY, t.y)) };
}

/** 一帧惯性：返回新的位移与衰减后的速度；速度足够小时返回 null 表示停 */
export function inertiaStep(velocity: Point, dtMs: number): { delta: Point; velocity: Point } | null {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (speed < INERTIA_STOP) return null;
  const decay = Math.pow(INERTIA_FRICTION, dtMs / 16);
  const next = { x: velocity.x * decay, y: velocity.y * decay };
  return { delta: { x: velocity.x * dtMs, y: velocity.y * dtMs }, velocity: next };
}

export function shouldStartInertia(velocity: Point): boolean {
  return Math.hypot(velocity.x, velocity.y) >= INERTIA_MIN_START;
}

/** 双指：按两指距离比例缩放，锚在两指中点 */
export function applyPinch(t: ViewTransform, from: [Point, Point], to: [Point, Point]): ViewTransform {
  const d1 = Math.hypot(from[0].x - from[1].x, from[0].y - from[1].y) || 1;
  const d2 = Math.hypot(to[0].x - to[1].x, to[0].y - to[1].y) || 1;
  const mid1 = { x: (from[0].x + from[1].x) / 2, y: (from[0].y + from[1].y) / 2 };
  const mid2 = { x: (to[0].x + to[1].x) / 2, y: (to[0].y + to[1].y) / 2 };
  const zoomed = zoomAround(t, d2 / d1, mid1);
  return { ...zoomed, x: zoomed.x + (mid2.x - mid1.x), y: zoomed.y + (mid2.y - mid1.y) };
}

/* ── 节点 id 结构：'root' / 'root-0' / 'root-0-2'（buildLayoutTree 约定） ── */

export function parentIdOf(id: string): string | null {
  if (id === 'root') return null;
  const cut = id.lastIndexOf('-');
  return cut > 0 ? id.slice(0, cut) : null;
}

/** 根到该节点的整条路径 id（含自身），用于悬停高亮 */
export function pathIdsOf(id: string): Set<string> {
  const path = new Set<string>();
  let cursor: string | null = id;
  while (cursor) { path.add(cursor); cursor = parentIdOf(cursor); }
  return path;
}

export interface NavNode { id: string; y: number; side?: 'left' | 'right' }

/**
 * 方向键：→ 往远离根的方向（右侧子树进子节点、左侧子树回父节点），← 反之；↑↓ 在兄弟之间按 y 序移动。
 * 根节点：→ 进右侧第一个主干，← 进左侧第一个主干。找不到目标返回 null（焦点不动）。
 */
export function mindmapKeyTarget(nodes: NavNode[], focusedId: string, key: string): string | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const current = byId.get(focusedId);
  if (!current) return nodes[0]?.id ?? null;
  const childrenOf = (id: string) => nodes.filter((node) => parentIdOf(node.id) === id).sort((a, b) => a.y - b.y);
  // 兄弟：同一父节点下、且在根的同一侧（一级主干分左右两列，↑↓ 只在本列里走）
  const siblings = () => {
    const parent = parentIdOf(focusedId);
    if (!parent) return [];
    return childrenOf(parent).filter((node) => (node.side ?? 'right') === (current.side ?? 'right'));
  };
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const list = siblings();
    const at = list.findIndex((node) => node.id === focusedId);
    const next = list[at + (key === 'ArrowDown' ? 1 : -1)];
    return next?.id ?? null;
  }
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  const towardRight = key === 'ArrowRight';
  if (focusedId === 'root') {
    const first = childrenOf('root').find((node) => (towardRight ? node.side !== 'left' : node.side === 'left'));
    return first?.id ?? null;
  }
  const onLeft = current.side === 'left';
  const outward = towardRight ? !onLeft : onLeft;
  if (outward) return childrenOf(focusedId)[0]?.id ?? null;
  return parentIdOf(focusedId);
}
