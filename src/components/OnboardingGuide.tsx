'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { OnboardingStep } from '@/hooks/useOnboarding';

interface OnboardingGuideProps {
  step: OnboardingStep | null;
  stepIndex: number;
  totalSteps: number;
  onNext: () => void;
  onSkip: () => void;
  isActive: boolean;
}

export function OnboardingGuide({
  step,
  stepIndex,
  totalSteps,
  onNext,
  onSkip,
  isActive,
}: OnboardingGuideProps) {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [arrowPosition, setArrowPosition] = useState<'top' | 'bottom' | 'left' | 'right'>('bottom');

  useEffect(() => {
    setMounted(true);
  }, []);

  // 查找目标元素并计算位置
  const updatePosition = useCallback(() => {
    if (!step) return;

    // 居中模式（无目标元素）
    if (!step.targetSelector || step.position === 'center') {
      setTargetRect(null);
      return;
    }

    const target = document.querySelector(step.targetSelector);
    if (!target) {
      console.warn(`Onboarding target not found: ${step.targetSelector}`);
      setTargetRect(null);
      return;
    }

    const rect = target.getBoundingClientRect();
    setTargetRect(rect);

    // 延迟计算 tooltip 位置
    requestAnimationFrame(() => {
      const tooltip = tooltipRef.current;
      if (!tooltip) return;

      const tooltipRect = tooltip.getBoundingClientRect();
      const padding = 16;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let top = 0;
      let left = 0;
      let arrow: 'top' | 'bottom' | 'left' | 'right' = 'top';

      switch (step.position) {
        case 'top':
          top = rect.top - tooltipRect.height - padding;
          left = rect.left + rect.width / 2 - tooltipRect.width / 2;
          arrow = 'bottom';
          break;
        case 'bottom':
          top = rect.bottom + padding;
          left = rect.left + rect.width / 2 - tooltipRect.width / 2;
          arrow = 'top';
          break;
        case 'left':
          top = rect.top + rect.height / 2 - tooltipRect.height / 2;
          left = rect.left - tooltipRect.width - padding;
          arrow = 'right';
          break;
        case 'right':
          top = rect.top + rect.height / 2 - tooltipRect.height / 2;
          left = rect.right + padding;
          arrow = 'left';
          break;
        default:
          top = rect.bottom + padding;
          left = rect.left + rect.width / 2 - tooltipRect.width / 2;
          arrow = 'top';
      }

      // 边界检测
      if (left < padding) left = padding;
      if (left + tooltipRect.width > viewportWidth - padding) {
        left = viewportWidth - tooltipRect.width - padding;
      }
      if (top < padding) {
        top = rect.bottom + padding;
        arrow = 'top';
      }
      if (top + tooltipRect.height > viewportHeight - padding) {
        top = rect.top - tooltipRect.height - padding;
        arrow = 'bottom';
      }

      setArrowPosition(arrow);
      setTooltipStyle({
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
      });
    });
  }, [step]);

  useEffect(() => {
    if (!isActive || !step) return;

    updatePosition();
    const timers = [
      setTimeout(updatePosition, 50),
      setTimeout(updatePosition, 150),
      setTimeout(updatePosition, 300),
    ];

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isActive, step, updatePosition]);

  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip();
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, onNext, onSkip]);

  if (!mounted || !isActive || !step) return null;

  const isCenter = step.position === 'center' || !step.targetSelector;

  const getArrowStyles = () => {
    const base = 'absolute w-0 h-0';
    switch (arrowPosition) {
      case 'top':
        return `${base} top-0 left-1/2 -translate-x-1/2 -translate-y-full border-l-[10px] border-r-[10px] border-b-[10px] border-l-transparent border-r-transparent border-b-white`;
      case 'bottom':
        return `${base} bottom-0 left-1/2 -translate-x-1/2 translate-y-full border-l-[10px] border-r-[10px] border-t-[10px] border-l-transparent border-r-transparent border-t-white`;
      case 'left':
        return `${base} left-0 top-1/2 -translate-x-full -translate-y-1/2 border-t-[10px] border-b-[10px] border-r-[10px] border-t-transparent border-b-transparent border-r-white`;
      case 'right':
        return `${base} right-0 top-1/2 translate-x-full -translate-y-1/2 border-t-[10px] border-b-[10px] border-l-[10px] border-t-transparent border-b-transparent border-l-white`;
    }
  };

  const content = (
    <div className="fixed inset-0 z-[9999]">
      {/* SVG 遮罩 + 镂空 */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        <defs>
          <mask id="spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {targetRect && step.spotlight && (
              <rect
                x={targetRect.left - 8}
                y={targetRect.top - 8}
                width={targetRect.width + 16}
                height={targetRect.height + 16}
                rx="12"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.6)"
          mask="url(#spotlight-mask)"
          className="pointer-events-auto"
          onClick={onSkip}
        />
      </svg>

      {/* 高亮边框 */}
      {targetRect && step.spotlight && (
        <div
          className="absolute pointer-events-none rounded-xl"
          style={{
            top: targetRect.top - 8,
            left: targetRect.left - 8,
            width: targetRect.width + 16,
            height: targetRect.height + 16,
            boxShadow: '0 0 0 3px rgba(225, 29, 72, 0.6), 0 0 20px rgba(225, 29, 72, 0.4)',
            animation: 'pulse-ring 2s ease-in-out infinite',
          }}
        />
      )}

      {/* 提示气泡 */}
      <div
        ref={tooltipRef}
        className="bg-white rounded-2xl shadow-2xl p-5 max-w-sm pointer-events-auto z-10"
        style={isCenter ? {
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        } : tooltipStyle}
      >
        {!isCenter && <div className={getArrowStyles()} />}

        <div className="space-y-3">
          {totalSteps > 1 && (
            <div className="flex items-center gap-1.5">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i === stepIndex
                      ? 'w-6 bg-rose-500'
                      : i < stepIndex
                        ? 'w-1.5 bg-rose-300'
                        : 'w-1.5 bg-gray-200'
                  }`}
                />
              ))}
            </div>
          )}

          <h3 className="text-lg font-bold text-gray-900">{step.title}</h3>
          <p className="text-sm text-gray-600 leading-relaxed">{step.description}</p>

          <div className="flex items-center justify-between pt-2">
            <button
              onClick={onSkip}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              跳过引导
            </button>
            <button
              onClick={onNext}
              className="px-5 py-2 bg-rose-500 hover:bg-rose-600 text-white text-sm font-medium rounded-full transition-colors shadow-lg"
            >
              {stepIndex === totalSteps - 1 ? '开始使用' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

// 欢迎弹窗组件 - 完全居中
export function WelcomeModal({
  isOpen,
  onStart,
  onSkip,
}: {
  isOpen: boolean;
  onStart: () => void;
  onSkip: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !isOpen) return null;

  const content = (
    <div 
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      style={{ padding: '20px' }}
    >
      {/* 遮罩 - 点击关闭 */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onSkip}
      />

      {/* 弹窗容器 - 使用 flex 居中 */}
      <div 
        className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
        style={{ 
          animation: 'modal-pop 0.3s ease-out forwards',
        }}
      >
        {/* 顶部装饰 */}
        <div className="h-28 bg-gradient-to-br from-rose-400 via-rose-500 to-amber-500 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/10 rounded-full" />
          <div className="absolute -bottom-4 -left-4 w-20 h-20 bg-white/10 rounded-full" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 bg-white rounded-2xl shadow-lg flex items-center justify-center">
              <span className="text-3xl font-bold text-rose-500">M</span>
            </div>
          </div>
        </div>

        {/* 内容 */}
        <div className="p-6 text-center">
          <h2 className="text-xl font-bold text-gray-900 mb-1">欢迎使用 MeetMind</h2>
          <p className="text-gray-500 text-sm mb-4">AI智能学习助手 - 你的专属AI同桌</p>

          <div className="space-y-2 text-left mb-5">
            <div className="flex items-center gap-3 p-2.5 rounded-xl bg-rose-50">
              <span className="text-lg">🎙️</span>
              <div>
                <div className="font-medium text-gray-900 text-sm">课堂录音</div>
                <div className="text-xs text-gray-500">实时转写，不错过重点</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-2.5 rounded-xl bg-amber-50">
              <span className="text-lg">🎯</span>
              <div>
                <div className="font-medium text-gray-900 text-sm">困惑标记</div>
                <div className="text-xs text-gray-500">一键标记，课后 AI 解答</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-2.5 rounded-xl bg-blue-50">
              <span className="text-lg">🤖</span>
              <div>
                <div className="font-medium text-gray-900 text-sm">AI 家教</div>
                <div className="text-xs text-gray-500">基于课堂内容，精准辅导</div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <button
              onClick={onStart}
              className="w-full py-2.5 bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white font-medium rounded-xl transition-all shadow-lg shadow-rose-500/25"
            >
              开始体验
            </button>
            <button
              onClick={onSkip}
              className="w-full py-2 text-gray-400 hover:text-gray-600 text-sm transition-colors"
            >
              我已了解，直接使用
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
