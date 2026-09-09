'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * 涟漪效果按钮组件
 * 
 * 特性：
 * - Material Design 风格涟漪动画
 * - Loading 状态支持
 * - 移动端触觉反馈
 * - 兼容所有 Button 变体
 */

// 按钮变体样式
const rippleButtonVariants = cva(
  'relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 overflow-hidden [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]',
  {
    variants: {
      // v7：主签名色 pine 是唯一饱和按钮；次级是 paper-warm 中性；朱砂只留给"此刻 / 引用"，不做按钮底色。
      // （此前 primary 是纯黑、secondary / soft / ghost 全是珊瑚色——登录页因此像另一个产品）
      variant: {
        primary:
          'bg-pine text-white shadow-soft hover:-translate-y-0.5 hover:opacity-95 focus-visible:ring-pine/40',
        secondary:
          'bg-card border border-divider text-ink-secondary hover:border-pine hover:text-pine focus-visible:ring-pine/30',
        ghost:
          'bg-transparent text-pine hover:bg-pine-fog focus-visible:ring-pine/30',
        soft:
          'bg-paper-warm text-ink-secondary border border-divider hover:border-pine/50 hover:text-pine focus-visible:ring-pine/30',
        amber:
          'bg-sand text-ink hover:-translate-y-0.5 focus-visible:ring-pine/30',
      },
      size: {
        sm: 'h-9 px-3 text-xs',
        default: 'h-11 px-4 py-2.5',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  }
);

// 涟漪效果接口
interface RippleEffect {
  id: number;
  x: number;
  y: number;
  size: number;
}

export interface RippleButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof rippleButtonVariants> {
  /** 作为子组件渲染 */
  asChild?: boolean;
  /** 是否显示加载状态 */
  loading?: boolean;
  /** 加载时显示的文字 */
  loadingText?: string;
  /** 涟漪颜色 (默认根据变体自动选择) */
  rippleColor?: string;
  /** 禁用涟漪效果 */
  disableRipple?: boolean;
  /** 禁用触觉反馈 */
  disableHaptic?: boolean;
}

const RippleButton = React.forwardRef<HTMLButtonElement, RippleButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      loadingText,
      rippleColor,
      disableRipple = false,
      disableHaptic = false,
      children,
      disabled,
      onClick,
      ...props
    },
    ref
  ) => {
    const [ripples, setRipples] = React.useState<RippleEffect[]>([]);
    const rippleIdRef = React.useRef(0);
    const buttonRef = React.useRef<HTMLButtonElement>(null);

    // 合并 ref
    React.useImperativeHandle(ref, () => buttonRef.current!);

    // 根据变体选择默认涟漪颜色
    const getDefaultRippleColor = () => {
      switch (variant) {
        case 'primary':
        case 'amber':
          return 'rgba(255, 255, 255, 0.4)';
        case 'secondary':
        case 'ghost':
        case 'soft':
        default:
          return 'rgba(47, 107, 85, 0.16)'; // pine with opacity
      }
    };

    const actualRippleColor = rippleColor || getDefaultRippleColor();

    // 创建涟漪效果
    const createRipple = React.useCallback(
      (event: React.MouseEvent<HTMLButtonElement> | React.TouchEvent<HTMLButtonElement>) => {
        if (disableRipple || loading || disabled) return;

        const button = buttonRef.current;
        if (!button) return;

        const rect = button.getBoundingClientRect();
        
        // 获取点击/触摸位置
        let clientX: number, clientY: number;
        if ('touches' in event) {
          clientX = event.touches[0].clientX;
          clientY = event.touches[0].clientY;
        } else {
          clientX = event.clientX;
          clientY = event.clientY;
        }

        const x = clientX - rect.left;
        const y = clientY - rect.top;

        // 计算涟漪大小（覆盖整个按钮）
        const size = Math.max(rect.width, rect.height) * 2.5;

        const newRipple: RippleEffect = {
          id: rippleIdRef.current++,
          x,
          y,
          size,
        };

        setRipples((prev) => [...prev, newRipple]);

        // 涟漪动画结束后移除
        setTimeout(() => {
          setRipples((prev) => prev.filter((r) => r.id !== newRipple.id));
        }, 600);
      },
      [disableRipple, loading, disabled]
    );

    // 触觉反馈
    const triggerHaptic = React.useCallback(() => {
      if (disableHaptic || loading || disabled) return;
      
      // 检查是否支持触觉反馈
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(10); // 轻微振动 10ms
        } catch {
          // 静默失败
        }
      }
    }, [disableHaptic, loading, disabled]);

    // 处理点击事件
    const handleClick = React.useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        createRipple(event);
        triggerHaptic();
        onClick?.(event);
      },
      [createRipple, triggerHaptic, onClick]
    );

    // 处理触摸开始事件（移动端即时反馈）
    const handleTouchStart = React.useCallback(
      (event: React.TouchEvent<HTMLButtonElement>) => {
        createRipple(event);
        triggerHaptic();
      },
      [createRipple, triggerHaptic]
    );

    const Comp = asChild ? Slot : 'button';
    const isDisabled = disabled || loading;

    return (
      <Comp
        ref={buttonRef}
        className={cn(rippleButtonVariants({ variant, size, className }))}
        disabled={isDisabled}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        {...props}
      >
        {/* 涟漪效果层 */}
        {ripples.map((ripple) => (
          <span
            key={ripple.id}
            className="absolute rounded-full pointer-events-none animate-ripple"
            style={{
              left: ripple.x - ripple.size / 2,
              top: ripple.y - ripple.size / 2,
              width: ripple.size,
              height: ripple.size,
              backgroundColor: actualRippleColor,
            }}
          />
        ))}

        {/* Loading 状态 */}
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center bg-inherit">
            <svg
              className="animate-spin h-5 w-5"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            {loadingText && (
              <span className="ml-2">{loadingText}</span>
            )}
          </span>
        )}

        {/* 按钮内容 */}
        <span className={cn('flex items-center justify-center gap-2', loading && 'invisible')}>
          {children}
        </span>
      </Comp>
    );
  }
);

RippleButton.displayName = 'RippleButton';

export { RippleButton, rippleButtonVariants };
