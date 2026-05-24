'use client';

/**
 * DesktopSidebar — 桌面端可折叠侧边栏
 *
 * 设计参考 Get笔记 / Notion / Linear：
 * - 展开态 168px：Logo + 文字导航 + 搜索 + 用户信息
 * - 折叠态 52px：仅图标，hover tooltip 提示
 * - 录课专注态自动使用折叠宽度，把空间还给课堂内容
 * - 顺滑 CSS transition 动画
 *
 * 设计系统：零渐变、零阴影、纯平涂
 */

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  GraduationCap,
  Mic,
  BookOpen,
  Search,
  User,
  UserCircle,
  Settings,
  HelpCircle,
  MessageSquare,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Boxes,
  Sparkles,
} from 'lucide-react';

const ICON_SM = 15;
const ICON_STROKE = 1.7;

// 侧栏折叠状态持久化 key
const SIDEBAR_COLLAPSED_KEY = 'mm-sidebar-collapsed';

function getInitialCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

interface DesktopSidebarProps {
  viewMode: 'record' | 'review' | 'classroom';
  onViewModeChange: (mode: 'record' | 'review' | 'classroom') => void;
  onOpenAISearch: () => void;
  /** 打开"全部收集"面板 */
  onOpenHistory: () => void;
  /** 打开“笔记总结”面板 */
  onOpenEcho: () => void;
  /** 笔记总结数量 badge */
  echoCount: number;
  /** 复习模式：当前选中的 reviewTab */
  reviewTab?: string;
  /** 复习模式：切换 reviewTab */
  onReviewTabChange?: (tab: string) => void;
  /** 复习模式：未解决困惑点数量 */
  unresolvedAnchorCount?: number;
  /** 复习模式：是否有时间轴数据（无时间轴时隐藏该子导航） */
  hasTimeline?: boolean;
  /** 录课专注态：强制收起侧栏，只保留图标导航 */
  focusMode?: boolean;
}

export function DesktopSidebar({
  viewMode,
  onViewModeChange,
  onOpenAISearch,
  onOpenHistory,
  onOpenEcho,
  echoCount,
  reviewTab,
  onReviewTabChange,
  unresolvedAnchorCount = 0,
  hasTimeline = true,
  focusMode = false,
}: DesktopSidebarProps) {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const effectiveCollapsed = collapsed || focusMode;
  const [showUserMenu, setShowUserMenu] = useState(false);
  const { user, isAuthenticated, logout } = useAuth();

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* */ }
      return next;
    });
    setShowUserMenu(false);
  }, []);

  const handleLogout = async () => {
    await logout();
    setShowUserMenu(false);
  };

  const roleLabels: Record<string, string> = {
    student: '学生',
    admin: '管理员',
  };

  // 导航项配置
  const navItems = [
    { key: 'classroom' as const, label: '课堂', Icon: BookOpen },
    { key: 'record' as const, label: '收集', Icon: Mic },
  ];

  return (
    <aside
      className="group/sidebar relative flex h-full flex-shrink-0 flex-col border-r border-[#E9E9E7] bg-[#F7F7F5] transition-[width] duration-200 ease-out"
      style={{ width: effectiveCollapsed ? 52 : 168 }}
    >
      {/* ── 顶部：Logo + 折叠按钮 ── */}
      <div className={`flex items-center ${effectiveCollapsed ? 'justify-center px-0' : 'justify-between px-3.5'} pb-1 pt-4`}>
        {effectiveCollapsed ? (
          /* 折叠态：Logo 图标，hover 时变成展开图标，点击展开侧栏 */
          <button
            type="button"
            onClick={focusMode ? undefined : toggleCollapsed}
            className="group/logo-btn flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-[#FDF3C0] transition-all hover:bg-[#EDE8D0] cursor-pointer"
            title={focusMode ? '录课中保持专注' : '展开侧栏'}
          >
            {/* 默认显示 Logo，hover 时切换为展开图标 */}
            <GraduationCap size={16} strokeWidth={2} className="text-[#C4A135] group-hover/logo-btn:hidden" />
            <PanelLeftOpen size={16} strokeWidth={1.7} className="hidden text-[#9E8A2E] group-hover/logo-btn:block" />
          </button>
        ) : (
          /* 展开态：Logo 链接 + 收起按钮 */
          <>
            <Link href="/" className="flex items-center gap-2.5 group/logo" title="MeetMind">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-[#FDF3C0] transition-transform group-hover/logo:scale-105">
                <GraduationCap size={16} strokeWidth={2} className="text-[#C4A135]" />
              </div>
              <span className="text-[15px] font-semibold tracking-[-0.01em] text-[#232322]">
                MeetMind
              </span>
            </Link>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[#A3A39E] transition-all hover:bg-[#E9E9E7] hover:text-[#787774]"
              title="收起侧栏"
            >
              <PanelLeftClose size={16} strokeWidth={1.5} />
            </button>
          </>
        )}
      </div>

      {/* ── 搜索入口 ── */}
      <div className={`${effectiveCollapsed ? 'px-1.5' : 'px-2.5'} pb-1 pt-3`}>
        <button
          type="button"
          onClick={onOpenAISearch}
          className={`flex w-full items-center rounded-lg transition-all hover:bg-[#EFEFEF] hover:text-[#787774] ${
            effectiveCollapsed
              ? 'h-9 justify-center px-0 text-[#A3A39E]'
              : 'gap-2.5 px-2.5 py-[7px] text-[13px] text-[#A3A39E]'
          }`}
          title={effectiveCollapsed ? '搜索笔记' : undefined}
        >
          <Search size={effectiveCollapsed ? 16 : 15} strokeWidth={1.6} className="flex-shrink-0" />
          {!effectiveCollapsed && <span>搜索笔记</span>}
        </button>
      </div>

      {/* ── 分割线 ── */}
      <div className={`${effectiveCollapsed ? 'mx-2' : 'mx-3'} my-1.5 h-px bg-[#E9E9E7]/70`} />

      {/* ── 核心导航 ── */}
      <nav className={`flex flex-col gap-0.5 ${effectiveCollapsed ? 'px-1.5' : 'px-2.5'} pt-0.5`}>
        {navItems.map(({ key, label, Icon }) => {
          // review 状态下高亮课堂 tab（复习是课堂的下钻状态）
          const isActive = viewMode === key || (key === 'classroom' && viewMode === 'review');
          return (
            <div key={key}>
              <button
                type="button"
                onClick={() => onViewModeChange(key)}
                className={`flex w-full items-center rounded-lg transition-all ${
                  effectiveCollapsed
                    ? `h-9 justify-center px-0 ${
                        isActive
                          ? 'border border-[#E9E9E7] bg-white text-[#232322]'
                          : 'text-[#787774] hover:bg-[#EFEFEF] hover:text-[#232322]'
                      }`
                    : `gap-2.5 px-2.5 py-[7px] text-[13.5px] font-medium ${
                        isActive
                          ? 'border border-[#E9E9E7] bg-white text-[#232322]'
                          : 'text-[#787774] hover:bg-[#EFEFEF] hover:text-[#232322]'
                      }`
                }`}
                title={effectiveCollapsed ? label : undefined}
              >
                <Icon size={effectiveCollapsed ? 17 : 16} strokeWidth={1.7} className="flex-shrink-0" />
                {!effectiveCollapsed && <span>{label}</span>}
              </button>

              {/* ── 收集模式的子导航：全部收集 / 笔记总结 ── */}
              {key === 'record' && isActive && !effectiveCollapsed && (
                <div className="ml-[18px] mt-0.5 flex flex-col gap-0.5 border-l border-[#E9E9E7]/80 pl-2.5">
                  <button
                    type="button"
                    onClick={onOpenHistory}
                    className="flex items-center gap-2 rounded-md px-2 py-[5px] text-[12.5px] text-[#787774] transition-all hover:bg-[#EFEFEF] hover:text-[#232322]"
                  >
                    <Boxes size={13} strokeWidth={1.6} className="flex-shrink-0" />
                    <span>全部收集</span>
                  </button>
                  <button
                    type="button"
                    onClick={onOpenEcho}
                    className="flex items-center gap-2 rounded-md px-2 py-[5px] text-[12.5px] text-[#787774] transition-all hover:bg-[#EFEFEF] hover:text-[#232322]"
                  >
                    <Sparkles size={13} strokeWidth={1.6} className="flex-shrink-0" />
                    <span>笔记总结</span>
                    {echoCount > 0 && (
                      <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#232322] px-1.5 text-[11px] font-semibold leading-none text-white">
                        {echoCount}
                      </span>
                    )}
                  </button>
                </div>
              )}

              {/* ── 折叠态下收集模式的子导航图标 ── */}
              {key === 'record' && isActive && effectiveCollapsed && (
                <div className="mt-0.5 flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={onOpenHistory}
                    className="flex h-8 items-center justify-center rounded-lg text-[#A3A39E] transition-all hover:bg-[#EFEFEF] hover:text-[#787774]"
                    title="全部收集"
                  >
                    <Boxes size={15} strokeWidth={1.6} />
                  </button>
                  <button
                    type="button"
                    onClick={onOpenEcho}
                    className="relative flex h-8 items-center justify-center rounded-lg text-[#A3A39E] transition-all hover:bg-[#EFEFEF] hover:text-[#787774]"
                    title="笔记总结"
                  >
                    <Sparkles size={15} strokeWidth={1.6} />
                    {echoCount > 0 && (
                      <span className="absolute -right-1 -top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#232322] px-1 text-[11px] font-bold leading-none text-white">
                        {echoCount}
                      </span>
                    )}
                  </button>
                </div>
              )}

              {/* 复习模式：不再展开子导航，tab 切换由内容区自己管 */}
            </div>
          );
        })}
      </nav>

      {/* ── 弹性填充 ── */}
      <div className="flex-1" />

      {/* ── 底部用户区 ── */}
      <div className={`relative ${effectiveCollapsed ? 'px-1.5' : 'px-2.5'} pb-3.5 pt-2`}>
        {isAuthenticated && user ? (
          <>
            <button
              type="button"
              onClick={() => setShowUserMenu(!showUserMenu)}
              className={`flex w-full items-center rounded-lg transition-all hover:bg-[#EFEFEF] ${
                effectiveCollapsed ? 'h-9 justify-center px-0' : 'gap-2.5 px-2.5 py-[7px]'
              }`}
              title={effectiveCollapsed ? user.nickname : undefined}
            >
              <Avatar className="h-7 w-7 flex-shrink-0">
                {user.avatar ? (
                  <AvatarImage src={user.avatar} alt={user.nickname} className="object-cover" />
                ) : null}
                <AvatarFallback className="bg-[#E9E9E7] text-[12px]">
                  <User size={13} strokeWidth={ICON_STROKE} className="text-[#787774]" />
                </AvatarFallback>
              </Avatar>
              {!effectiveCollapsed && (
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-[13px] font-medium text-[#232322]">{user.nickname}</p>
                </div>
              )}
            </button>

            {showUserMenu ? (
              <>
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                <div
                  className="absolute z-50 mb-1 rounded-xl border border-[#E9E9E7] bg-white py-1.5 animate-scale-in"
                  style={{
                    bottom: '100%',
                    left: effectiveCollapsed ? 4 : 10,
                    right: effectiveCollapsed ? 'auto' : 10,
                    width: effectiveCollapsed ? 192 : undefined,
                  }}
                >
                  <div className="border-b border-[#E9E9E7] px-3.5 pb-2 pt-1.5">
                    <p className="text-[13px] font-medium text-[#232322]">{user.nickname}</p>
                    <p className="text-[12px] text-[#A3A39E]">{roleLabels[user.role] || user.role}账号</p>
                  </div>
                  {[
                    { href: '/profile', icon: UserCircle, label: '个人资料' },
                    { href: '/settings', icon: Settings, label: '设置' },
                    { href: '/help', icon: HelpCircle, label: '帮助' },
                    { href: '/feedback', icon: MessageSquare, label: '反馈' },
                  ].map(({ href, icon: ItemIcon, label }) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setShowUserMenu(false)}
                      className="flex items-center gap-2 px-3.5 py-2 text-[13px] text-[#787774] transition-colors hover:bg-[#F7F7F5] hover:text-[#232322]"
                    >
                      <ItemIcon size={ICON_SM} strokeWidth={ICON_STROKE} className="text-[#A3A39E]" />
                      {label}
                    </Link>
                  ))}
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] text-[#D96B6B] transition-colors hover:bg-[#FDECEC]"
                  >
                    <LogOut size={ICON_SM} strokeWidth={ICON_STROKE} />
                    退出登录
                  </button>
                </div>
              </>
            ) : null}
          </>
        ) : (
          <Link
            href="/login"
            className={`flex items-center justify-center rounded-lg bg-[#232322] text-[13px] font-medium text-white transition-all hover:bg-[#111111] ${
              effectiveCollapsed ? 'mx-auto h-9 w-9 px-0' : 'w-full px-4 py-2'
            }`}
            title={effectiveCollapsed ? '登录' : undefined}
          >
            {effectiveCollapsed ? <User size={15} strokeWidth={1.7} /> : '登录'}
          </Link>
        )}
      </div>
    </aside>
  );
}

export default DesktopSidebar;
