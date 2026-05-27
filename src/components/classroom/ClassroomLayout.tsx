'use client';

/**
 * ClassroomLayout — 课堂页左右分栏布局（桌面 + 移动响应）
 *
 * 设计决策（v4 · 可拖拽宽度）：
 *   右栏不再默认 360/380px——太窄，对话 + 内联卡片放不开。
 *   默认改成 **480px**，并且左右分隔线本身就是一个**可拖拽 handle**：
 *     - 悬停时分隔线变粗（2px）并泛出极浅的暗色
 *     - 按下 + 拖动 → 即时调整宽度
 *     - 双击 → 在 "宽" (500) / "默认" (480) / "紧凑" (360) 三挡循环
 *     - 释放后宽度持久化到 localStorage
 *
 * 用户不再"猜怎么调"，而是像 Linear / Notion 那样"线就是抓手"。
 *
 * 桌面端（lg+）：
 *   - 左（主内容）：flex-1
 *   - 右（可召唤 + 可拖拽宽度）：
 *       open=true  → 用户设定宽度（默认 480，范围 320-720）
 *       open=false → 48px 折叠窄条
 *
 * 移动端（< lg）：
 *   - 主内容铺满；右下浮动"问同学"按钮；点击展开全屏 Sheet
 */

import React, { type ReactNode, useState, useCallback, useEffect, useRef } from 'react';
import { MessageCircle, X, ChevronRight } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';
import { OctoBuddyFloatingButton, type OctoBuddyMood } from './OctoBuddy';

export interface ClassroomLayoutProps {
  left: ReactNode;
  right: ReactNode;
  /** 由外部驱动的"同学是否展开"——录课态建议传 true */
  companionOpen?: boolean;
  /** 用户手动切换时的回调；未传则走内部自管状态 */
  onCompanionOpenChange?: (open: boolean) => void;
  /** 悬浮球的动作 / 表情状态 */
  companionMood?: OctoBuddyMood;
  /** 是否存在足够课堂上下文来召唤同学；无上下文时不显示右栏/浮标/移动入口 */
  companionAvailable?: boolean;
}

/** 宽度约束（px） */
const MIN_WIDTH = 300;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 400;
const WIDTH_STORAGE_KEY = 'classroom-companion-width-px:v2';
// 双击循环三挡
const SNAP_WIDTHS = [340, 400, 520] as const;

function clampWidth(w: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(w)));
}

function readStoredWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
    if (!raw) return DEFAULT_WIDTH;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_WIDTH;
    return clampWidth(parsed);
  } catch {
    return DEFAULT_WIDTH;
  }
}

function writeStoredWidth(w: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(w));
  } catch {
    /* ignore */
  }
}

export function ClassroomLayout({
  left,
  right,
  companionOpen,
  onCompanionOpenChange,
  companionMood = 'idle',
  companionAvailable = true,
}: ClassroomLayoutProps) {
  // 受控 / 非受控：外部传了就跟随，否则内部管
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = companionOpen !== undefined;
  const requestedOpen = isControlled ? !!companionOpen : internalOpen;
  const open = companionAvailable && requestedOpen;

  const setOpen = useCallback((next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onCompanionOpenChange?.(next);
  }, [isControlled, onCompanionOpenChange]);

  // 移动端 sheet 独立管状态
  const [mobileCompanionOpen, setMobileCompanionOpen] = useState(false);
  const openMobileCompanion = useCallback(() => {
    if (companionAvailable) setMobileCompanionOpen(true);
  }, [companionAvailable]);
  const closeMobileCompanion = useCallback(() => setMobileCompanionOpen(false), []);

  useEffect(() => {
    if (!companionAvailable) {
      setOpen(false);
      setMobileCompanionOpen(false);
    }
  }, [companionAvailable, setOpen]);

  // ── 可拖拽宽度 ──
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(DEFAULT_WIDTH);

  // 初次挂载时读持久化值
  useEffect(() => {
    setWidth(readStoredWidth());
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setDragging(true);
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = width;
  }, [width]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    // 拖动方向：handle 在左，panel 在右——往左拖 = panel 变宽
    const delta = dragStartXRef.current - e.clientX;
    const next = clampWidth(dragStartWidthRef.current + delta);
    setWidth(next);
  }, [dragging]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    setDragging(false);
    writeStoredWidth(width);
  }, [dragging, width]);

  /** 双击 handle → 在 snap widths 里循环 */
  const handleDoubleClick = useCallback(() => {
    // 选距离当前宽度最近的 snap，切到下一档
    let nearestIndex = 0;
    let nearestDelta = Infinity;
    SNAP_WIDTHS.forEach((w, i) => {
      const d = Math.abs(w - width);
      if (d < nearestDelta) {
        nearestDelta = d;
        nearestIndex = i;
      }
    });
    const nextIndex = (nearestIndex + 1) % SNAP_WIDTHS.length;
    const next = SNAP_WIDTHS[nextIndex];
    setWidth(next);
    writeStoredWidth(next);
  }, [width]);

  return (
    <div className="relative flex h-full min-h-0 flex-1 bg-canvas">
      {/* 拖拽时全局光标 + 选区抑制 */}
      {dragging ? (
        <style>{`body { cursor: col-resize !important; user-select: none; }`}</style>
      ) : null}

      {/* ── 左侧：主内容 ── */}
      <div className="flex flex-1 flex-col min-w-0 min-h-0">
        {left}
      </div>

      {/* ── 桌面端右侧：可召唤 + 可拖拽宽度的同学栏 ── */}
      <aside
        className={`hidden lg:flex flex-shrink-0 flex-col bg-canvas ${
          dragging ? '' : 'transition-[width] duration-300 ease-out'
        }`}
        style={{ width: open ? width : 0 }}
      >
        {open ? (
          <div className="relative flex h-full flex-col">
            {/* ── 左侧可拖拽分隔 handle ──
                视觉是一条 1px 细线，但 hit-area 是 5px。鼠标悬停时线变 2px，
                拖拽中保持深一点的色值，给用户"抓住了"的手感。 */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="拖动以调整同学面板宽度"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onDoubleClick={handleDoubleClick}
              title="拖动调整宽度 · 双击循环三挡"
              className={`absolute left-0 top-0 bottom-0 z-10 flex w-[5px] -translate-x-[2px] cursor-col-resize items-center justify-center group`}
            >
              <span
                className={`block h-full w-px transition-colors ${
                  dragging
                    ? 'bg-[#232322]/30'
                    : 'bg-[#E9E9E7] group-hover:bg-[#232322]/20'
                }`}
              />
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-2 top-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full bg-canvas/90 text-ink-muted transition hover:bg-[#EFEFED] active:scale-95"
              aria-label="收起同学"
              title="收起"
            >
              <ChevronRight size={15} strokeWidth={1.8} />
            </button>
            <div className="flex min-h-0 flex-1 flex-col">
              {right}
            </div>
          </div>
        ) : null}
      </aside>

      {companionAvailable && !open ? (
        <OctoBuddyFloatingButton
          mood={companionMood}
          label={COPY.octoBuddy[companionMood]}
          sublabel={COPY.octoBuddy.openHint}
          onClick={() => setOpen(true)}
        />
      ) : null}

      {/* ── 移动端：底部"问同学"悬浮按钮 ── */}
      {companionAvailable ? (
        <button
          type="button"
          onClick={openMobileCompanion}
          className="fixed bottom-[5.5rem] right-4 z-30 flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-[12.5px] font-medium text-white transition active:scale-95 lg:hidden"
          aria-label="问同学"
        >
          <MessageCircle size={14} strokeWidth={2} />
          问同学
        </button>
      ) : null}

      {/* ── 移动端：全屏 Sheet ── */}
      {companionAvailable && mobileCompanionOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex flex-col bg-canvas animate-[fadeIn_200ms_ease-out]">
          <div className="flex-shrink-0 flex items-center justify-end border-b border-[#E9E9E7] bg-canvas px-2 py-2">
            <button
              type="button"
              onClick={closeMobileCompanion}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-[#EFEFED] active:scale-95 transition"
              aria-label="关闭"
            >
              <X size={18} strokeWidth={1.8} />
            </button>
          </div>
          <div className="flex-1 min-h-0 flex flex-col">
            {right}
          </div>
        </div>
      )}
    </div>
  );
}

export default ClassroomLayout;
