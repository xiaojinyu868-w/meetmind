'use client';

/**
 * DesktopSidebar — 桌面端可折叠侧边栏
 *
 * 设计参考 Get笔记 / Notion / Linear：
 * - 展开态 200px：Logo + 文字导航 + 搜索 + 用户信息
 * - 折叠态 56px：仅图标，hover tooltip 提示
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
  Clock,
  AlertCircle,
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
  viewMode: 'record' | 'review';
  onViewModeChange: (mode: 'record' | 'review') => void;
  onOpenAISearch: () => void;
  /** 打开"全部收集"面板 */
  onOpenHistory: () => void;
  /** 打开"回声"面板 */
  onOpenEcho: () => void;
  /** 回声数量 badge */
  echoCount: number;
  /** 复习模式：当前选中的 reviewTab */
  reviewTab?: string;
  /** 复习模式：切换 reviewTab */
  onReviewTabChange?: (tab: string) => void;
  /** 复习模式：未解决困惑点数量 */
  unresolvedAnchorCount?: number;
  /** 复习模式：是否有时间轴数据（无时间轴时隐藏该子导航） */
  hasTimeline?: boolean;
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
}: DesktopSidebarProps) {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
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
    { key: 'record' as const, label: '收集', Icon: Mic },
    { key: 'review' as const, label: '复习', Icon: BookOpen },
  ];

  return (
    <aside
      className="group/sidebar relative flex h-full flex-shrink-0 flex-col border-r border-[#E9E9E7] bg-[#F7F7F5] transition-[width] duration-200 ease-out"
      style={{ width: collapsed ? 56 : 200 }}
    >
      {/* ── 顶部：Logo + 折叠按钮 ── */}
      <div className={`flex items-center ${collapsed ? 'justify-center px-0' : 'justify-between px-3.5'} pb-1 pt-4`}>
        {collapsed ? (
          /* 折叠态：Logo 图标，hover 时变成展开图标，点击展开侧栏 */
          <button
            type="button"
            onClick={toggleCollapsed}
            className="group/logo-btn flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-[#FDF3C0] transition-all hover:bg-[#EDE8D0] cursor-pointer"
            title="展开侧栏"
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
      <div className={`${collapsed ? 'px-1.5' : 'px-2.5'} pb-1 pt-3`}>
        <button
          type="button"
          onClick={onOpenAISearch}
          className={`flex w-full items-center rounded-lg transition-all hover:bg-[#EFEFEF] hover:text-[#787774] ${
            collapsed
              ? 'h-9 justify-center px-0 text-[#A3A39E]'
              : 'gap-2.5 px-2.5 py-[7px] text-[13px] text-[#A3A39E]'
          }`}
          title={collapsed ? '搜索笔记' : undefined}
        >
          <Search size={collapsed ? 16 : 15} strokeWidth={1.6} className="flex-shrink-0" />
          {!collapsed && <span>搜索笔记</span>}
        </button>
      </div>

      {/* ── 分割线 ── */}
      <div className={`${collapsed ? 'mx-2' : 'mx-3'} my-1.5 h-px bg-[#E9E9E7]/70`} />

      {/* ── 核心导航 ── */}
      <nav className={`flex flex-col gap-0.5 ${collapsed ? 'px-1.5' : 'px-2.5'} pt-0.5`}>
        {navItems.map(({ key, label, Icon }) => {
          const isActive = viewMode === key;
          return (
            <div key={key}>
              <button
                type="button"
                onClick={() => onViewModeChange(key)}
                className={`flex w-full items-center rounded-lg transition-all ${
                  collapsed
                    ? `h-9 justify-center px-0 ${
                        isActive
                          ? 'bg-white text-[#232322] ring-[0.5px] ring-[#232322]/[0.06]'
                          : 'text-[#787774] hover:bg-[#EFEFEF] hover:text-[#232322]'
                      }`
                    : `gap-2.5 px-2.5 py-[7px] text-[13.5px] font-medium ${
                        isActive
                          ? 'bg-white text-[#232322] ring-[0.5px] ring-[#232322]/[0.06]'
                          : 'text-[#787774] hover:bg-[#EFEFEF] hover:text-[#232322]'
                      }`
                }`}
                title={collapsed ? label : undefined}
              >
                <Icon size={collapsed ? 17 : 16} strokeWidth={1.7} className="flex-shrink-0" />
                {!collapsed && <span>{label}</span>}
              </button>

              {/* ── 收集模式的子导航：全部收集 / 回声 ── */}
              {key === 'record' && isActive && !collapsed && (
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
                    <span>回声</span>
                    {echoCount > 0 && (
                      <span className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[#232322] px-1 text-[9px] font-semibold leading-none text-white">
                        {echoCount}
                      </span>
                    )}
                  </button>
                </div>
              )}

              {/* ── 折叠态下收集模式的子导航图标 ── */}
              {key === 'record' && isActive && collapsed && (
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
                    title="回声"
                  >
                    <Sparkles size={15} strokeWidth={1.6} />
                    {echoCount > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-[#232322] px-0.5 text-[8px] font-bold leading-none text-white">
                        {echoCount}
                      </span>
                    )}
                  </button>
                </div>
              )}

              {/* ── 复习模式的子导航：按内容类型智能显示 ── */}
              {key === 'review' && isActive && !collapsed && onReviewTabChange && (
                <div className="ml-[18px] mt-0.5 flex flex-col gap-0.5 border-l border-[#E9E9E7]/80 pl-2.5">
                  {hasTimeline && (
                    <button
                      type="button"
                      onClick={() => onReviewTabChange('timeline')}
                      className={`flex items-center gap-2 rounded-md px-2 py-[5px] text-[12.5px] transition-all ${
                        reviewTab === 'timeline'
                          ? 'bg-white text-[#232322] ring-[0.5px] ring-[#232322]/[0.06] font-medium'
                          : 'text-[#787774] hover:bg-[#EFEFEF] hover:text-[#232322]'
                      }`}
                    >
                      <Clock size={13} strokeWidth={1.6} className="flex-shrink-0" />
                      <span>时间轴</span>
                    </button>
                  )}
                  {hasTimeline && (
                    <button
                      type="button"
                      onClick={() => onReviewTabChange('anchor-detail')}
                      className={`flex items-center gap-2 rounded-md px-2 py-[5px] text-[12.5px] transition-all ${
                        reviewTab === 'anchor-detail'
                          ? 'bg-white text-[#232322] ring-[0.5px] ring-[#232322]/[0.06] font-medium'
                          : 'text-[#787774] hover:bg-[#EFEFEF] hover:text-[#232322]'
                      }`}
                    >
                      <AlertCircle size={13} strokeWidth={1.6} className="flex-shrink-0" />
                      <span>困惑点</span>
                      {unresolvedAnchorCount > 0 && (
                        <span className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[#FADEC9] px-1 text-[9px] font-semibold leading-none text-[#232322]">
                          {unresolvedAnchorCount}
                        </span>
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onReviewTabChange('apps')}
                    className={`flex items-center gap-2 rounded-md px-2 py-[5px] text-[12.5px] transition-all ${
                      reviewTab === 'apps'
                        ? 'bg-white text-[#232322] ring-[0.5px] ring-[#232322]/[0.06] font-medium'
                        : 'text-[#787774] hover:bg-[#EFEFEF] hover:text-[#232322]'
                    }`}
                  >
                    <Boxes size={13} strokeWidth={1.6} className="flex-shrink-0" />
                    <span>AI工坊</span>
                  </button>
                </div>
              )}

              {/* ── 折叠态下复习模式的子导航图标 ── */}
              {key === 'review' && isActive && collapsed && onReviewTabChange && (
                <div className="mt-0.5 flex flex-col gap-0.5">
                  {hasTimeline && (
                    <button
                      type="button"
                      onClick={() => onReviewTabChange('timeline')}
                      className={`flex h-8 items-center justify-center rounded-lg transition-all ${
                        reviewTab === 'timeline'
                          ? 'bg-white text-[#232322] ring-[0.5px] ring-[#232322]/[0.06]'
                          : 'text-[#A3A39E] hover:bg-[#EFEFEF] hover:text-[#787774]'
                      }`}
                      title="时间轴"
                    >
                      <Clock size={15} strokeWidth={1.6} />
                    </button>
                  )}
                  {hasTimeline && (
                    <button
                      type="button"
                      onClick={() => onReviewTabChange('anchor-detail')}
                      className={`relative flex h-8 items-center justify-center rounded-lg transition-all ${
                        reviewTab === 'anchor-detail'
                          ? 'bg-white text-[#232322] ring-[0.5px] ring-[#232322]/[0.06]'
                          : 'text-[#A3A39E] hover:bg-[#EFEFEF] hover:text-[#787774]'
                      }`}
                      title="困惑点"
                    >
                      <AlertCircle size={15} strokeWidth={1.6} />
                      {unresolvedAnchorCount > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-[#FADEC9] px-0.5 text-[8px] font-bold leading-none text-[#232322]">
                          {unresolvedAnchorCount}
                        </span>
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onReviewTabChange('apps')}
                    className={`flex h-8 items-center justify-center rounded-lg transition-all ${
                      reviewTab === 'apps'
                        ? 'bg-white text-[#232322] ring-[0.5px] ring-[#232322]/[0.06]'
                        : 'text-[#A3A39E] hover:bg-[#EFEFEF] hover:text-[#787774]'
                    }`}
                    title="AI工坊"
                  >
                    <Boxes size={15} strokeWidth={1.6} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* ── 弹性填充 ── */}
      <div className="flex-1" />

      {/* ── 底部用户区 ── */}
      <div className={`relative ${collapsed ? 'px-1.5' : 'px-2.5'} pb-3.5 pt-2`}>
        {isAuthenticated && user ? (
          <>
            <button
              type="button"
              onClick={() => setShowUserMenu(!showUserMenu)}
              className={`flex w-full items-center rounded-lg transition-all hover:bg-[#EFEFEF] ${
                collapsed ? 'h-9 justify-center px-0' : 'gap-2.5 px-2.5 py-[7px]'
              }`}
              title={collapsed ? user.nickname : undefined}
            >
              <Avatar className="h-7 w-7 flex-shrink-0">
                {user.avatar ? (
                  <AvatarImage src={user.avatar} alt={user.nickname} className="object-cover" />
                ) : null}
                <AvatarFallback className="bg-[#E9E9E7] text-[11px]">
                  <User size={13} strokeWidth={ICON_STROKE} className="text-[#787774]" />
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
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
                    left: collapsed ? 4 : 10,
                    right: collapsed ? 'auto' : 10,
                    width: collapsed ? 192 : undefined,
                  }}
                >
                  <div className="border-b border-[#E9E9E7] px-3.5 pb-2 pt-1.5">
                    <p className="text-[13px] font-medium text-[#232322]">{user.nickname}</p>
                    <p className="text-[11px] text-[#A3A39E]">{roleLabels[user.role] || user.role}账号</p>
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
              collapsed ? 'mx-auto h-9 w-9 px-0' : 'w-full px-4 py-2'
            }`}
            title={collapsed ? '登录' : undefined}
          >
            {collapsed ? <User size={15} strokeWidth={1.7} /> : '登录'}
          </Link>
        )}
      </div>
    </aside>
  );
}

export default DesktopSidebar;
