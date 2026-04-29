'use client';

/**
 * ClassCheckToast — 随堂检验邀请 toast
 *
 * 设计理念：
 * - 从视频区域底部滑入，不遮挡画面
 * - 轻量、不侵入，用户可以选择参与或忽略
 * - 8 秒后自动消失（等同于忽略）
 * - 遵循 MeetMind 设计系统：零渐变、零阴影、纯平涂
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClassCheckCheckpoint } from '@/app/api/(meetmind-learning)/class-check/plan/route';

const ACCENT = '#E67E22';
const AUTO_DISMISS_MS = 8000;

interface ClassCheckToastProps {
  checkpoint: ClassCheckCheckpoint;
  onAccept: () => void;
  onDismiss: () => void;
}

export function ClassCheckToast({ checkpoint, onAccept, onDismiss }: ClassCheckToastProps) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 入场动画
  useEffect(() => {
    // requestAnimationFrame 确保 DOM 先渲染 opacity:0 状态，再触发 transition
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // 自动消失倒计时
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      handleDismiss();
    }, AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDismiss = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    setVisible(false);
    // 等退场动画结束后通知父组件
    setTimeout(() => onDismiss(), 300);
  }, [exiting, onDismiss]);

  const handleAccept = useCallback(() => {
    if (exiting) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setExiting(true);
    setVisible(false);
    setTimeout(() => onAccept(), 200);
  }, [exiting, onAccept]);

  return (
    <div
      className="fixed bottom-6 left-1/2 z-[250] -translate-x-1/2"
      style={{
        opacity: visible ? 1 : 0,
        transform: `translateX(-50%) translateY(${visible ? '0' : '20px'})`,
        transition: 'opacity 0.3s ease, transform 0.3s ease',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <div
        className="flex items-center gap-3 rounded-2xl border border-[#E9E9E7] bg-white px-4 py-3"
        style={{ minWidth: 280, maxWidth: 420 }}
      >
        {/* 左侧小图标 */}
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: '#FDF2E9' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="2" width="18" height="16" rx="3" fill={ACCENT} opacity="0.9" />
            <text x="12" y="13" textAnchor="middle" fill="white" fontSize="12" fontWeight="700" fontFamily="system-ui">?</text>
            <line x1="6" y1="18" x2="6" y2="22" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>

        {/* 内容 */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-[#232322] leading-snug truncate">
            {checkpoint.topic}
          </p>
          <p className="text-[11px] text-[#A3A39E] mt-0.5">
            {checkpoint.questions.length} 道小题，测测掌握程度
          </p>
        </div>

        {/* 按钮组 */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleAccept}
            className="rounded-xl px-3.5 py-2 text-[12px] font-semibold text-white transition-colors"
            style={{ backgroundColor: ACCENT }}
          >
            来试试
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[#A3A39E] transition-colors hover:bg-[#F7F7F5] hover:text-[#787774]"
            aria-label="忽略"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 底部倒计时进度条 */}
        <div className="absolute bottom-0 left-4 right-4 h-[2px] overflow-hidden rounded-full">
          <div
            className="h-full rounded-full"
            style={{
              backgroundColor: ACCENT,
              opacity: 0.3,
              animation: `classcheck-toast-countdown ${AUTO_DISMISS_MS}ms linear forwards`,
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes classcheck-toast-countdown {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
}

export default ClassCheckToast;
