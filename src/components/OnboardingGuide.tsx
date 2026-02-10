'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import type { OnboardingStep } from '@/hooks/useOnboarding';
import { useResponsive } from '@/hooks/useResponsive';

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
  const t = useTranslations();
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [arrowPosition, setArrowPosition] = useState<'top' | 'bottom' | 'left' | 'right'>('bottom');
  const { isMobile } = useResponsive();
  const targetElementRef = useRef<Element | null>(null);
  
  // 从步骤配置中读取是否为交互式（默认 false，统一使用下一步按钮）
  const isInteractive = step?.interactive === true;

  useEffect(() => {
    setMounted(true);
  }, []);

  // 交互式引导：监听目标元素的点击事件
  useEffect(() => {
    if (!isInteractive || !isActive || !step?.targetSelector) return;

    const target = document.querySelector(step.targetSelector);
    if (!target) return;

    targetElementRef.current = target;

    const handleTargetClick = (e: Event) => {
      // 阻止事件冒泡，避免触发遮罩的点击事件
      e.stopPropagation();
      // 延迟一点执行下一步，让用户能看到点击效果
      setTimeout(() => {
        onNext();
      }, 150);
    };

    target.addEventListener('click', handleTargetClick, { capture: true });

    return () => {
      target.removeEventListener('click', handleTargetClick, { capture: true });
    };
  }, [isInteractive, isActive, step?.targetSelector, onNext]);

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
      // 移动端使用更小的 padding，并考虑安全区域
      const padding = isMobile ? 12 : 16;
      const safeAreaBottom = isMobile ? 34 : 0; // iPhone 底部安全区域
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

      // 边界检测 - 水平方向
      if (left < padding) left = padding;
      if (left + tooltipRect.width > viewportWidth - padding) {
        left = viewportWidth - tooltipRect.width - padding;
      }
      
      // 边界检测 - 垂直方向（考虑安全区域）
      if (top < padding) {
        top = rect.bottom + padding;
        arrow = 'top';
      }
      if (top + tooltipRect.height > viewportHeight - padding - safeAreaBottom) {
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
  }, [step, isMobile]);

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

  // 响应式箭头样式（使用固定的 Tailwind 类名）
  const getArrowStylesFixed = () => {
    const base = 'absolute w-0 h-0';
    switch (arrowPosition) {
      case 'top':
        return `${base} top-0 left-1/2 -translate-x-1/2 -translate-y-full border-l-[8px] border-r-[8px] border-b-[8px] border-l-transparent border-r-transparent border-b-white sm:border-l-[10px] sm:border-r-[10px] sm:border-b-[10px]`;
      case 'bottom':
        return `${base} bottom-0 left-1/2 -translate-x-1/2 translate-y-full border-l-[8px] border-r-[8px] border-t-[8px] border-l-transparent border-r-transparent border-t-white sm:border-l-[10px] sm:border-r-[10px] sm:border-t-[10px]`;
      case 'left':
        return `${base} left-0 top-1/2 -translate-x-full -translate-y-1/2 border-t-[8px] border-b-[8px] border-r-[8px] border-t-transparent border-b-transparent border-r-white sm:border-t-[10px] sm:border-b-[10px] sm:border-r-[10px]`;
      case 'right':
        return `${base} right-0 top-1/2 translate-x-full -translate-y-1/2 border-t-[8px] border-b-[8px] border-l-[8px] border-t-transparent border-b-transparent border-l-white sm:border-t-[10px] sm:border-b-[10px] sm:border-l-[10px]`;
    }
  };

  const content = (
    <div className="fixed inset-0 z-[9999]" style={{ pointerEvents: 'none' }}>
      {/* 遮罩层 - 使用四个矩形围绕目标元素，保留镂空区域可点击 */}
      {targetRect && step.spotlight && isInteractive ? (
        // 交互式模式：四个独立的遮罩块，中间镂空可点击
        // 注意：交互式模式下点击遮罩不退出引导，只有点击目标元素才进入下一步
        <>
          {/* 上方遮罩 */}
          <div 
            className="absolute left-0 right-0 top-0 bg-black/60 pointer-events-auto cursor-default"
            style={{ height: Math.max(0, targetRect.top - (isMobile ? 6 : 8)) }}
            onClick={(e) => e.stopPropagation()}
          />
          {/* 下方遮罩 */}
          <div 
            className="absolute left-0 right-0 bottom-0 bg-black/60 pointer-events-auto cursor-default"
            style={{ top: targetRect.bottom + (isMobile ? 6 : 8) }}
            onClick={(e) => e.stopPropagation()}
          />
          {/* 左侧遮罩 */}
          <div 
            className="absolute left-0 bg-black/60 pointer-events-auto cursor-default"
            style={{ 
              top: targetRect.top - (isMobile ? 6 : 8),
              width: Math.max(0, targetRect.left - (isMobile ? 6 : 8)),
              height: targetRect.height + (isMobile ? 12 : 16),
            }}
            onClick={(e) => e.stopPropagation()}
          />
          {/* 右侧遮罩 */}
          <div 
            className="absolute right-0 bg-black/60 pointer-events-auto cursor-default"
            style={{ 
              top: targetRect.top - (isMobile ? 6 : 8),
              left: targetRect.right + (isMobile ? 6 : 8),
              height: targetRect.height + (isMobile ? 12 : 16),
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </>
      ) : (
        // 非交互式模式或无目标：使用 SVG 遮罩
        // 点击遮罩不退出引导，避免用户误操作
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <defs>
            <mask id="spotlight-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {targetRect && step.spotlight && (
                <rect
                  x={targetRect.left - (isMobile ? 6 : 8)}
                  y={targetRect.top - (isMobile ? 6 : 8)}
                  width={targetRect.width + (isMobile ? 12 : 16)}
                  height={targetRect.height + (isMobile ? 12 : 16)}
                  rx={isMobile ? 8 : 12}
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
            className="pointer-events-auto cursor-default"
            onClick={(e) => e.stopPropagation()}
          />
        </svg>
      )}

      {/* 高亮边框 */}
      {targetRect && step.spotlight && (
        <div
          className="absolute pointer-events-none rounded-lg sm:rounded-xl"
          style={{
            top: targetRect.top - (isMobile ? 6 : 8),
            left: targetRect.left - (isMobile ? 6 : 8),
            width: targetRect.width + (isMobile ? 12 : 16),
            height: targetRect.height + (isMobile ? 12 : 16),
            boxShadow: '0 0 0 3px rgba(225, 29, 72, 0.6), 0 0 20px rgba(225, 29, 72, 0.4)',
            animation: 'pulse-ring 2s ease-in-out infinite',
          }}
        />
      )}

      {/* 提示气泡 - 响应式样式 */}
      <div
        ref={tooltipRef}
        className={`
          bg-white shadow-2xl pointer-events-auto z-10
          rounded-xl sm:rounded-2xl
          p-3 sm:p-5
          w-[calc(100vw-24px)] sm:w-auto sm:max-w-sm
          max-w-[320px] sm:max-w-sm
        `}
        style={isCenter ? {
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: isMobile ? 'calc(100vw - 48px)' : undefined,
          maxWidth: isMobile ? '320px' : '384px',
        } : tooltipStyle}
      >
        {!isCenter && <div className={getArrowStylesFixed()} />}

        <div className="space-y-2 sm:space-y-3">
          {totalSteps > 1 && (
            <div className="flex items-center gap-1 sm:gap-1.5">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <div
                  key={i}
                  className={`h-1 sm:h-1.5 rounded-full transition-all ${
                    i === stepIndex
                      ? 'w-4 sm:w-6 bg-rose-500'
                      : i < stepIndex
                        ? 'w-1 sm:w-1.5 bg-rose-300'
                        : 'w-1 sm:w-1.5 bg-gray-200'
                  }`}
                />
              ))}
            </div>
          )}

          <h3 className="text-base sm:text-lg font-bold text-gray-900">{step.title}</h3>
          <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">{step.description}</p>

          <div className="flex items-center justify-between pt-1 sm:pt-2">
            <button
              onClick={onSkip}
              className="text-xs sm:text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              {t('onboarding.skip')}
            </button>
            {/* 交互式模式：显示"点击试试"提示；非交互式：显示下一步按钮 */}
            {isInteractive && targetRect ? (
              <span className="px-3 sm:px-5 py-1.5 sm:py-2 text-rose-500 text-xs sm:text-sm font-medium flex items-center gap-1">
                <span className="animate-bounce">👆</span>
                {t('onboarding.try')}
              </span>
            ) : (
              <button
                onClick={onNext}
                className="px-3 sm:px-5 py-1.5 sm:py-2 bg-rose-500 hover:bg-rose-600 text-white text-xs sm:text-sm font-medium rounded-full transition-colors shadow-lg"
              >
                {stepIndex === totalSteps - 1 ? t('onboarding.start') : t('onboarding.next')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

// 欢迎弹窗组件 - 完全居中，响应式适配
export function WelcomeModal({
  isOpen,
  onStart,
  onSkip,
}: {
  isOpen: boolean;
  onStart: () => void;
  onSkip: () => void;
}) {
  const t = useTranslations();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !isOpen) return null;

  const content = (
    <div 
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-5"
    >
      {/* 遮罩 - 点击关闭 */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onSkip}
      />

      {/* 弹窗容器 - 响应式布局 */}
      <div 
        className="relative bg-white rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-[calc(100vw-32px)] sm:max-w-md overflow-hidden max-h-[90vh] flex flex-col"
        style={{ 
          animation: 'modal-pop 0.3s ease-out forwards',
        }}
      >
        {/* 顶部装饰 - 移动端高度缩小 */}
        <div className="h-20 sm:h-28 bg-gradient-to-br from-rose-400 via-rose-500 to-amber-500 relative overflow-hidden flex-shrink-0">
          <div className="absolute -top-6 -right-6 sm:-top-8 sm:-right-8 w-24 h-24 sm:w-32 sm:h-32 bg-white/10 rounded-full" />
          <div className="absolute -bottom-3 -left-3 sm:-bottom-4 sm:-left-4 w-16 h-16 sm:w-20 sm:h-20 bg-white/10 rounded-full" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-white rounded-xl sm:rounded-2xl shadow-lg flex items-center justify-center">
              <span className="text-2xl sm:text-3xl font-bold text-rose-500">M</span>
            </div>
          </div>
        </div>

        {/* 内容 - 可滚动，响应式内边距 */}
        <div className="p-4 sm:p-6 text-center overflow-y-auto flex-1">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-0.5 sm:mb-1">{t('onboarding.welcome.title')}</h2>
          <p className="text-gray-500 text-xs sm:text-sm mb-3 sm:mb-4">{t('onboarding.welcome.subtitle')}</p>

          <div className="space-y-1.5 sm:space-y-2 text-left mb-4 sm:mb-5">
            <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-2.5 rounded-lg sm:rounded-xl bg-rose-50">
              <span className="text-base sm:text-lg">🎙️</span>
              <div>
                <div className="font-medium text-gray-900 text-xs sm:text-sm">{t('onboarding.welcome.feature1')}</div>
                <div className="text-[10px] sm:text-xs text-gray-500">{t('onboarding.welcome.feature1Desc')}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-2.5 rounded-lg sm:rounded-xl bg-amber-50">
              <span className="text-base sm:text-lg">🎯</span>
              <div>
                <div className="font-medium text-gray-900 text-xs sm:text-sm">{t('onboarding.welcome.feature2')}</div>
                <div className="text-[10px] sm:text-xs text-gray-500">{t('onboarding.welcome.feature2Desc')}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-2.5 rounded-lg sm:rounded-xl bg-blue-50">
              <span className="text-base sm:text-lg">🤖</span>
              <div>
                <div className="font-medium text-gray-900 text-xs sm:text-sm">{t('onboarding.welcome.feature3')}</div>
                <div className="text-[10px] sm:text-xs text-gray-500">{t('onboarding.welcome.feature3Desc')}</div>
              </div>
            </div>
          </div>

          <div className="space-y-1.5 sm:space-y-2">
            <button
              onClick={onStart}
              className="w-full py-2 sm:py-2.5 bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white text-sm sm:text-base font-medium rounded-lg sm:rounded-xl transition-all shadow-lg shadow-rose-500/25"
            >
              {t('onboarding.welcome.start')}
            </button>
            <button
              onClick={onSkip}
              className="w-full py-1.5 sm:py-2 text-gray-400 hover:text-gray-600 text-xs sm:text-sm transition-colors"
            >
              {t('onboarding.welcome.skip')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
