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
 * 设计系统：v7 设计宪法：95% 克制 + 5% 仪式时刻情绪化（shadow-soft / shadow-card / shadow-ai-glow）
 */

import { useState, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/lib/hooks/useAuth';
import { COPY } from '@/lib/ui/copy';
import { useAdminLens } from '@/components/admin/AdminLensProvider';
import { usePointsSummary } from '@/hooks/usePointsSummary';
import { openPaywallGlobal } from '@/hooks/usePaywall';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Mic,
  BookOpen,
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
  SlidersHorizontal,
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
  /** 打开“今日情报”面板 */
  onOpenEcho: () => void;
  /** 今日情报面板是否正在展示 */
  isEchoActive?: boolean;
  /** 同桌沉淀数量 badge */
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
  isEchoActive = false,
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
  const { user, isAuthenticated, isCheckingAuth, logout } = useAuth();
  const { enabled: adminLensEnabled, toggle: toggleAdminLens } = useAdminLens();
  // 会员档位：免费用户在一级页面看到安静的升级入口（付费不藏在设置里）
  const { summary: pointsSummary } = usePointsSummary();
  const membershipTier = pointsSummary?.membership.tier ?? null;

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
    { key: 'classroom' as const, label: COPY.navigation.classroom, Icon: BookOpen },
    { key: 'record' as const, label: COPY.navigation.collection, Icon: Mic },
  ];

  return (
    <aside
      className="group/sidebar relative flex h-full flex-shrink-0 flex-col border-r border-divider bg-paper transition-[width] duration-200 ease-out"
      style={{ width: effectiveCollapsed ? 52 : 168 }}
    >
      {/* ── 顶部：Logo + 折叠按钮 ── */}
      <div className={`flex items-center ${effectiveCollapsed ? 'justify-center px-0' : 'justify-between px-3.5'} pb-1 pt-4`}>
        {effectiveCollapsed ? (
          /* 折叠态：Octo logo，hover 时变成展开图标，点击展开侧栏 */
          <button
            type="button"
            onClick={focusMode ? undefined : toggleCollapsed}
            className="group/logo-btn relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] border border-divider bg-card transition-all hover:border-pine cursor-pointer overflow-hidden"
            title={focusMode ? '录课中保持专注' : '展开侧栏'}
          >
            {/* 默认显示 Octo idle，hover 时切换为展开图标 */}
            <Image
              src="/images/octo-buddy/idle.png"
              alt=""
              aria-hidden
              width={22}
              height={22}
              unoptimized
              className="h-[22px] w-[22px] object-contain group-hover/logo-btn:hidden"
            />
            <PanelLeftOpen size={16} strokeWidth={1.7} className="hidden text-pine group-hover/logo-btn:block" />
          </button>
        ) : (
          /* 展开态：Octo logo + 收起按钮 */
          <>
            <Link href="/" className="flex items-center gap-2.5 group/logo" title="MeetMind">
              <div className="octo-aura relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] border border-divider bg-card overflow-hidden transition-transform group-hover/logo:scale-105">
                <Image
                  src="/images/octo-buddy/idle.png"
                  alt=""
                  aria-hidden
                  width={22}
                  height={22}
                  unoptimized
                  className="relative z-10 h-[22px] w-[22px] object-contain"
                />
              </div>
              <span className="text-[15px] font-semibold tracking-display text-ink whitespace-nowrap">
                MeetMind
              </span>
            </Link>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-all hover:bg-divider hover:text-ink-secondary"
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
          className={`flex w-full items-center rounded-lg transition-all hover:bg-paper-warm hover:text-ink-secondary ${
            effectiveCollapsed
              ? 'h-9 justify-center px-0 text-ink-muted'
              : 'gap-2.5 px-2.5 py-[7px] text-[13px] text-ink-muted'
          }`}
          title={effectiveCollapsed ? COPY.navigation.search : undefined}
        >
          <Sparkles size={effectiveCollapsed ? 16 : 15} strokeWidth={1.6} className="flex-shrink-0" />
          {!effectiveCollapsed && <span>{COPY.navigation.search}</span>}
        </button>
      </div>

      {/* ── 分割线 ── */}
      <div className={`${effectiveCollapsed ? 'mx-2' : 'mx-3'} my-1.5 h-px bg-divider/70`} />

      {/* ── 核心导航 ── */}
      <nav className={`flex flex-col gap-0.5 ${effectiveCollapsed ? 'px-1.5' : 'px-2.5'} pt-0.5`}>
        {navItems.map(({ key, label, Icon }) => {
          // review 状态下高亮课堂 tab（复习是课堂的下钻状态）
          const isActive = !isEchoActive && (viewMode === key || (key === 'classroom' && viewMode === 'review'));
          return (
            <div key={key}>
              <button
                type="button"
                onClick={() => onViewModeChange(key)}
                className={`flex w-full items-center rounded-lg transition-all ${
                  effectiveCollapsed
                    ? `h-9 justify-center px-0 ${
                        isActive
                          ? 'border border-pine/15 bg-pine-fog text-pine'
                          : 'text-ink-secondary hover:bg-paper-warm hover:text-ink'
                      }`
                    : `gap-2.5 px-2.5 py-[7px] text-[13.5px] font-medium ${
                        isActive
                          ? 'border border-pine/15 bg-pine-fog text-pine'
                          : 'text-ink-secondary hover:bg-paper-warm hover:text-ink'
                      }`
                }`}
                title={effectiveCollapsed ? label : undefined}
              >
                <Icon size={effectiveCollapsed ? 17 : 16} strokeWidth={1.7} className="flex-shrink-0" />
                {!effectiveCollapsed && <span>{label}</span>}
              </button>

              {/* 收集的管理入口；今日情报已提升为一级导航。 */}
              {key === 'record' && isActive && !effectiveCollapsed && (
                <div className="ml-[18px] mt-0.5 flex flex-col gap-0.5 border-l border-divider/80 pl-2.5">
                  <button
                    type="button"
                    onClick={onOpenHistory}
                    className="flex items-center gap-2 rounded-md px-2 py-[5px] text-[12.5px] text-ink-secondary transition-all hover:bg-paper-warm hover:text-ink"
                  >
                    <Boxes size={13} strokeWidth={1.6} className="flex-shrink-0" />
                    <span>{COPY.navigation.allCollections}</span>
                  </button>
                </div>
              )}

              {/* ── 折叠态下收集模式的子导航图标 ── */}
              {key === 'record' && isActive && effectiveCollapsed && (
                <div className="mt-0.5 flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={onOpenHistory}
                    className="flex h-8 items-center justify-center rounded-lg text-ink-muted transition-all hover:bg-paper-warm hover:text-ink-secondary"
                    title={COPY.navigation.allCollections}
                  >
                    <Boxes size={15} strokeWidth={1.6} />
                  </button>
                </div>
              )}

              {/* 复习模式：不再展开子导航，tab 切换由内容区自己管 */}
            </div>
          );
        })}

        <button
          type="button"
          onClick={onOpenEcho}
          className={`relative flex w-full items-center rounded-lg transition-all ${
            effectiveCollapsed
              ? `h-9 justify-center px-0 ${isEchoActive ? 'border border-pine/15 bg-pine-fog text-pine' : 'text-ink-secondary hover:bg-paper-warm hover:text-ink'}`
              : `gap-2.5 px-2.5 py-[7px] text-[13.5px] font-medium ${isEchoActive ? 'border border-pine/15 bg-pine-fog text-pine' : 'text-ink-secondary hover:bg-paper-warm hover:text-ink'}`
          }`}
          title={effectiveCollapsed ? COPY.feed.relatedInfoLabel : undefined}
        >
          <Sparkles size={effectiveCollapsed ? 17 : 16} strokeWidth={1.7} className="flex-shrink-0" />
          {!effectiveCollapsed && <span>{COPY.feed.relatedInfoLabel}</span>}
          {echoCount > 0 && (
            <span className={`${effectiveCollapsed ? 'absolute -right-1 -top-1' : 'ml-auto'} inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-pine px-1.5 text-[11px] font-semibold leading-none text-white`}>
              {echoCount}
            </span>
          )}
        </button>
      </nav>

      {/* ── 弹性填充 ── */}
      <div className="flex-1" />

      {/* ── 底部用户区 ── */}
      <div className={`relative ${effectiveCollapsed ? 'px-1.5' : 'px-2.5'} pb-3.5 pt-2`}>
        {isCheckingAuth ? (
          <div
            aria-busy="true"
            aria-live="polite"
            className={`flex w-full items-center ${
              effectiveCollapsed ? 'h-9 justify-center' : 'gap-2.5 px-2.5 py-[7px]'
            }`}
          >
            <span className="skel h-7 w-7 flex-shrink-0 rounded-full" />
            {!effectiveCollapsed ? <span className="skel h-3 w-20" /> : null}
          </div>
        ) : isAuthenticated && user ? (
          <>
            {/* 免费用户的一级页面升级入口（对齐 ChatGPT 侧栏底部 Upgrade 卡：
                短标题 + 一行放得下的短副标题，永不截断） */}
            {membershipTier === 'free' ? (
              <button
                type="button"
                onClick={() => openPaywallGlobal({ reason: 'upgrade', tab: 'membership' })}
                className={
                  effectiveCollapsed
                    ? 'mx-auto mb-1.5 flex h-9 w-9 items-center justify-center rounded-lg text-pine transition-all hover:bg-pine-fog'
                    : 'mb-1.5 flex w-full items-center gap-2.5 rounded-lg border border-pine/20 bg-pine-fog px-2.5 py-2 text-left transition-all hover:border-pine/40 hover:bg-pine-fog/70'
                }
                title={COPY.membership.freeTierCta}
              >
                <Sparkles size={effectiveCollapsed ? 16 : 15} strokeWidth={1.7} className="flex-shrink-0 text-pine" />
                {!effectiveCollapsed ? (
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium leading-tight text-pine">{COPY.membership.freeTierCta}</span>
                    <span className="mt-0.5 block whitespace-nowrap text-[11px] leading-tight text-ink-muted">{COPY.membership.upgradeEntryHint}</span>
                  </span>
                ) : null}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setShowUserMenu(!showUserMenu)}
              className={`flex w-full items-center rounded-lg transition-all hover:bg-paper-warm ${
                effectiveCollapsed ? 'h-9 justify-center px-0' : 'gap-2.5 px-2.5 py-[7px]'
              }`}
              title={effectiveCollapsed ? user.nickname : undefined}
            >
              <span className="relative flex-shrink-0">
                <Avatar className="h-7 w-7">
                  {user.avatar ? (
                    <AvatarImage src={user.avatar} alt={user.nickname} className="object-cover" />
                  ) : null}
                  <AvatarFallback className="bg-divider text-[12px]">
                    <User size={13} strokeWidth={ICON_STROKE} className="text-ink-secondary" />
                  </AvatarFallback>
                </Avatar>
                {adminLensEnabled ? <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-paper bg-vermilion" aria-hidden /> : null}
              </span>
              {!effectiveCollapsed && (
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-[13px] font-medium text-ink">{user.nickname}</p>
                </div>
              )}
            </button>

            {showUserMenu ? (
              <>
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                <div
                  className="absolute z-50 mb-1 rounded-xl border border-divider bg-white py-1.5 animate-scale-in"
                  style={{
                    bottom: '100%',
                    left: effectiveCollapsed ? 4 : 10,
                    right: effectiveCollapsed ? 'auto' : 10,
                    width: effectiveCollapsed ? 192 : undefined,
                  }}
                >
                  <div className="border-b border-divider px-3.5 pb-2 pt-1.5">
                    <p className="text-[13px] font-medium text-ink">{user.nickname}</p>
                    <p className="text-[12px] text-ink-muted">{roleLabels[user.role] || user.role}账号</p>
                  </div>
                  {/* 会员入口：一级页面直达 Paywall，不用进设置找 */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowUserMenu(false);
                      openPaywallGlobal({ reason: 'upgrade', tab: 'membership' });
                    }}
                    className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] text-ink-secondary transition-colors hover:bg-paper hover:text-ink"
                  >
                    <Sparkles size={ICON_SM} strokeWidth={ICON_STROKE} className="text-pine" />
                    <span className="flex-1">{COPY.membership.menuCta[membershipTier ?? 'free']}</span>
                    {membershipTier ? (
                      <span className="text-[11px] text-ink-muted">{COPY.membership.tierName[membershipTier]}</span>
                    ) : null}
                  </button>
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
                      className="flex items-center gap-2 px-3.5 py-2 text-[13px] text-ink-secondary transition-colors hover:bg-paper hover:text-ink"
                    >
                      <ItemIcon size={ICON_SM} strokeWidth={ICON_STROKE} className="text-ink-muted" />
                      {label}
                    </Link>
                  ))}
                  {user.role === 'admin' ? (
                    <button
                      type="button"
                      onClick={toggleAdminLens}
                      className={`flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] transition-colors ${adminLensEnabled ? 'bg-vermilion/[0.04] text-vermilion' : 'text-ink-secondary hover:bg-paper hover:text-ink'}`}
                      aria-pressed={adminLensEnabled}
                      title={COPY.adminAi.managementViewHint}
                    >
                      <SlidersHorizontal size={ICON_SM} strokeWidth={ICON_STROKE} className={adminLensEnabled ? 'text-vermilion' : 'text-ink-muted'} />
                      <span className="flex-1">{COPY.adminAi.managementView}</span>
                      <span className="text-[10px] text-ink-muted">{adminLensEnabled ? COPY.adminAi.managementViewEnabled : COPY.adminAi.managementViewDisabled}</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] text-vermilion transition-colors hover:bg-vermilion-fog"
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
            className={`flex items-center justify-center rounded-lg bg-pine text-[13px] font-medium text-white transition-all hover:bg-pine-deep ${
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
