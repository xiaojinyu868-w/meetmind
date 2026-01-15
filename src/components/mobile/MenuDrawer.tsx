'use client';

import { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';

export interface MenuDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** 抽屉位置 */
  position?: 'left' | 'right';
  /** 抽屉宽度 */
  width?: string;
  /** 标题 */
  title?: string;
  /** 自定义类名 */
  className?: string;
}

/**
 * 菜单抽屉组件
 * 从侧边滑入的抽屉面板
 */
export function MenuDrawer({
  isOpen,
  onClose,
  children,
  position = 'right',
  width = '85vw',
  title,
  className,
}: MenuDrawerProps) {
  // 处理 ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // 阻止背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  return (
    <>
      {/* 遮罩层 */}
      <div
        className={cn(
          "fixed inset-0 bg-black/30 backdrop-blur-sm z-50 transition-opacity duration-300",
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
      />
      
      {/* 抽屉面板 */}
      <div
        className={cn(
          "fixed top-0 bottom-0 z-50 bg-white shadow-2xl",
          "flex flex-col",
          "transition-transform duration-300 ease-out",
          position === 'left' ? 'left-0 rounded-r-2xl' : 'right-0 rounded-l-2xl',
          isOpen 
            ? 'translate-x-0' 
            : position === 'left' ? '-translate-x-full' : 'translate-x-full',
          className
        )}
        style={{ width, maxWidth: '400px' }}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100">
          {title && (
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          )}
          <button
            onClick={onClose}
            className="p-2 -mr-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="关闭菜单"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </>
  );
}

/**
 * 汉堡菜单按钮
 */
export interface HamburgerButtonProps {
  isOpen?: boolean;
  onClick: () => void;
  className?: string;
}

export function HamburgerButton({
  isOpen = false,
  onClick,
  className,
}: HamburgerButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors",
        className
      )}
      aria-label={isOpen ? '关闭菜单' : '打开菜单'}
    >
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        {isOpen ? (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        )}
      </svg>
    </button>
  );
}

/**
 * 抽屉菜单项
 */
export interface DrawerMenuItemProps {
  icon?: React.ReactNode;
  label: string;
  badge?: string | number;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}

export function DrawerMenuItem({
  icon,
  label,
  badge,
  onClick,
  active = false,
  className,
}: DrawerMenuItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
        active 
          ? "bg-blue-50 text-blue-600" 
          : "text-gray-700 hover:bg-gray-50",
        className
      )}
    >
      {icon && (
        <span className="flex-shrink-0 w-5 h-5">
          {icon}
        </span>
      )}
      <span className="flex-1 font-medium">{label}</span>
      {badge !== undefined && (
        <span className={cn(
          "px-2 py-0.5 text-xs font-medium rounded-full",
          active ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-600"
        )}>
          {badge}
        </span>
      )}
    </button>
  );
}

/**
 * 抽屉分割线
 */
export function DrawerDivider({ label }: { label?: string }) {
  if (label) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 mt-2">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
          {label}
        </span>
        <div className="flex-1 h-px bg-gray-100" />
      </div>
    );
  }
  
  return <div className="my-2 border-t border-gray-100" />;
}
