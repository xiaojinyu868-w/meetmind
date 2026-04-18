'use client';

/**
 * ClassroomLayout — 课堂页左右分栏布局（桌面 + 移动响应）
 *
 * 设计决策（v3 · 可召唤式右栏）：
 *   右栏不再默认占据屏幕的 1/4。用户第一次进课堂看到的是干净的主内容，
 *   右边只有一条窄窄的"同桌"唤起条（像 VS Code 的 activity bar）。
 *   这样：
 *     1. 主内容获得最大视野（列表 / 录课），用户注意力不被分散
 *     2. AI 同桌的出现变成"用户主动伸手"的结果——符合"收→酿→应"的"应"
 *     3. 录课态自动展开——此时同桌是有用的
 *
 * 桌面端（lg+）：
 *   - 左（主内容）：flex-1
 *   - 右（可召唤）：
 *       companionOpen=true  → 360/380px 展开态
 *       companionOpen=false → 48px 折叠窄条，仅一个垂直文字 / 图标
 *
 * 移动端（< lg）：
 *   - 主内容铺满；右下浮动"问同桌"按钮；点击展开全屏 Sheet
 *
 * 设计系统：零渐变、零阴影、纯平涂；zero box-shadow，ring-[0.5px] 代替。
 */

import React, { type ReactNode, useState, useCallback, useEffect } from 'react';
import { MessageCircle, X, ChevronLeft, ChevronRight } from 'lucide-react';

export interface ClassroomLayoutProps {
  left: ReactNode;
  right: ReactNode;
  /** 由外部驱动的"同桌是否展开"——录课态建议传 true */
  companionOpen?: boolean;
  /** 用户手动切换时的回调；未传则走内部自管状态 */
  onCompanionOpenChange?: (open: boolean) => void;
}

export function ClassroomLayout({
  left,
  right,
  companionOpen,
  onCompanionOpenChange,
}: ClassroomLayoutProps) {
  // 受控 / 非受控：外部传了就跟随，否则内部管
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = companionOpen !== undefined;
  const open = isControlled ? !!companionOpen : internalOpen;

  const setOpen = useCallback((next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onCompanionOpenChange?.(next);
  }, [isControlled, onCompanionOpenChange]);

  // 移动端 sheet 独立管状态（和桌面的展开态解耦）
  const [mobileCompanionOpen, setMobileCompanionOpen] = useState(false);
  const openMobileCompanion = useCallback(() => setMobileCompanionOpen(true), []);
  const closeMobileCompanion = useCallback(() => setMobileCompanionOpen(false), []);

  // 外部强制展开（录课态）时：桌面跟随；移动端不强制打开 sheet，避免打断
  useEffect(() => {
    if (isControlled && companionOpen) {
      // 桌面已经受控跟随了，这里无需额外操作
    }
  }, [isControlled, companionOpen]);

  return (
    <div className="relative flex h-full min-h-0 flex-1 bg-canvas">
      {/* ── 左侧：主内容（桌面和移动都显示） ── */}
      <div className="flex flex-1 flex-col min-w-0 min-h-0">
        {left}
      </div>

      {/* ── 桌面端右侧：可召唤的同桌栏 ── */}
      {/* 展开态：360/380px，完整面板 */}
      <aside
        className={`hidden lg:flex flex-shrink-0 flex-col border-l border-[#E9E9E7] bg-canvas transition-[width] duration-300 ease-out ${
          open ? 'w-[360px] xl:w-[380px]' : 'w-12'
        }`}
      >
        {open ? (
          <div className="flex h-full flex-col">
            {/* 展开态顶部的小收起按钮——保持 Taste 的"安静"，放在右上角 */}
            <div className="flex-shrink-0 flex items-center justify-end px-2 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:bg-[#EFEFED] active:scale-95 transition"
                aria-label="收起 AI 同桌"
                title="收起"
              >
                <ChevronRight size={15} strokeWidth={1.8} />
              </button>
            </div>
            <div className="flex-1 min-h-0 flex flex-col">
              {right}
            </div>
          </div>
        ) : (
          /* 折叠态：极简竖条——只有一条垂直小字 + 悬停出小箭头 */
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="group relative flex h-full w-full items-center justify-center hover:bg-[#F0F0ED] transition-colors"
            aria-label="展开 AI 同桌"
            title="AI 同桌"
          >
            <span
              className="text-[10.5px] font-medium uppercase tracking-[0.32em] text-ink-muted group-hover:text-ink-secondary transition-colors"
              style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
            >
              COMPANION
            </span>
            <ChevronLeft
              size={12}
              strokeWidth={1.8}
              className="absolute left-1.5 top-1/2 -translate-y-1/2 text-ink-muted opacity-0 group-hover:opacity-100 transition-opacity"
            />
          </button>
        )}
      </aside>

      {/* ── 移动端：底部"问同桌"悬浮按钮 ── */}
      <button
        type="button"
        onClick={openMobileCompanion}
        className="lg:hidden fixed bottom-[5.5rem] right-4 z-30 flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-[12.5px] font-medium text-white ring-[0.5px] ring-[#232322]/20 active:scale-95 transition"
        aria-label="问 AI 同桌"
      >
        <MessageCircle size={14} strokeWidth={2} />
        问同桌
      </button>

      {/* ── 移动端：全屏 Sheet 形式的同桌面板 ── */}
      {mobileCompanionOpen && (
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
