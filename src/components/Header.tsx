'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PointsChip } from '@/components/points/PointsChip';
import {
  GraduationCap,
  User,
  UserCircle,
  Settings,
  HelpCircle,
  MessageSquare,
  LogOut,
  Mic,
  BookOpen,
} from 'lucide-react';

const ICON_SM = 16;
const ICON_STROKE = 1.75;
const ICON_TAB_STROKE = 1.75;

interface HeaderProps {
  lessonTitle: string;
  courseName: string;
  viewMode?: 'record' | 'review';
  /** 桌面端模式切换回调，传入后显示收集/复习切换器 */
  onViewModeChange?: (mode: 'record' | 'review') => void;
  /** 模式切换栏右侧的状态信息（数据源 badge、困惑数、ServiceStatus 等） */
  statusSlot?: ReactNode;
}

export function Header({ lessonTitle, courseName, viewMode = 'record', onViewModeChange, statusSlot }: HeaderProps) {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const { user, isAuthenticated, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    setShowUserMenu(false);
  };

  const roleLabels: Record<string, string> = {
    student: '学生',
    admin: '管理员',
  };

  return (
    <header className="h-14 border-b flex items-center justify-between px-5 flex-shrink-0 no-print relative z-20" style={{ background: 'var(--edu-bg-secondary)', borderColor: 'var(--edu-border-light)' }}>
      <div className="flex items-center gap-4 min-w-0">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group flex-shrink-0">
          <div className="w-8 h-8 bg-[#FDF3C0] rounded-lg flex items-center justify-center group-hover:scale-105 transition-all">
            <GraduationCap size={18} strokeWidth={2} className="text-white" />
          </div>
          <span className="font-semibold text-navy text-base whitespace-nowrap">MeetMind</span>
        </Link>

        {/* 分隔线 */}
        <div className="w-px h-5 bg-divider flex-shrink-0" />

        {/* 模式切换器：传入 onViewModeChange 时渲染 */}
        {onViewModeChange ? (
          <div
            className="flex items-center gap-1 rounded-xl p-0.5"
            style={{ background: 'var(--edu-bg-soft)' }}
          >
            <button
              onClick={() => onViewModeChange('record')}
              data-testid="mode-record-button"
              className={`mode-tab flex items-center gap-1.5 ${viewMode === 'record' ? 'active' : ''}`}
            >
              <Mic size={14} strokeWidth={ICON_TAB_STROKE} />
              收集
            </button>
            <button
              onClick={() => onViewModeChange('review')}
              data-testid="mode-review-button"
              className={`mode-tab flex items-center gap-1.5 ${viewMode === 'review' ? 'active' : ''}`}
            >
              <BookOpen size={14} strokeWidth={ICON_TAB_STROKE} />
              复习
            </button>
          </div>
        ) : (
          /* 无模式切换时显示课程信息 */
          <div className="flex items-center gap-2 min-w-0 hidden sm:flex">
            {courseName && (
              <span className="px-2.5 py-1 bg-sunflower-100 text-sunflower-800 rounded-lg text-xs font-medium whitespace-nowrap flex-shrink-0">
                {courseName}
              </span>
            )}
            <div className="flex items-center gap-1.5 min-w-0">
              {viewMode === 'record' ? (
                <Mic size={ICON_SM} strokeWidth={ICON_STROKE} className="text-[#5C5A55] flex-shrink-0" />
              ) : (
                <BookOpen size={ICON_SM} strokeWidth={ICON_STROKE} className="text-[#5C5A55] flex-shrink-0" />
              )}
              <h1 className="text-sm font-medium text-navy truncate min-w-0">{lessonTitle}</h1>
            </div>
          </div>
        )}
      </div>

      {/* 右侧：状态信息 + 用户菜单 */}
      <div className="flex items-center gap-4">
        {/* 外部传入的状态信息 slot */}
        {statusSlot}

        {/* 积分 chip：未登录时组件内部静默隐藏 */}
        {isAuthenticated && <PointsChip />}

        {/* 用户头像/登录按钮 */}
        <div className="relative">
          {isAuthenticated && user ? (
            <>
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="w-8 h-8 bg-lilac-200 rounded-full flex items-center justify-center hover:bg-lilac-300 transition-all overflow-hidden"
              >
                <Avatar className="w-full h-full">
                  {user.avatar ? (
                    <AvatarImage src={user.avatar} alt={user.nickname} className="object-cover" />
                  ) : null}
                  <AvatarFallback className="bg-transparent text-base">
                    <User size={16} strokeWidth={ICON_STROKE} className="text-lilac-600" />
                  </AvatarFallback>
                </Avatar>
              </button>
              
              {showUserMenu && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl border border-divider-light py-2 animate-scale-in z-50">
                  <div className="px-4 py-2 border-b border-divider-light">
                    <p className="text-sm font-medium text-navy">{user.nickname}</p>
                    <p className="text-xs text-ink-muted">{roleLabels[user.role] || user.role}账号</p>
                  </div>
                  <Link
                    href="/profile"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2.5 w-full px-4 py-2 text-left text-sm text-ink-secondary hover:bg-lilac-50 transition-colors"
                  >
                    <UserCircle size={ICON_SM} strokeWidth={ICON_STROKE} className="text-ink-muted" />
                    个人资料
                  </Link>
                  <Link
                    href="/settings"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2.5 w-full px-4 py-2 text-left text-sm text-ink-secondary hover:bg-lilac-50 transition-colors"
                  >
                    <Settings size={ICON_SM} strokeWidth={ICON_STROKE} className="text-ink-muted" />
                    设置
                  </Link>
                  <Link
                    href="/help"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2.5 w-full px-4 py-2 text-left text-sm text-ink-secondary hover:bg-lilac-50 transition-colors"
                  >
                    <HelpCircle size={ICON_SM} strokeWidth={ICON_STROKE} className="text-ink-muted" />
                    帮助
                  </Link>
                  <Link
                    href="/feedback"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2.5 w-full px-4 py-2 text-left text-sm text-ink-secondary hover:bg-lilac-50 transition-colors"
                  >
                    <MessageSquare size={ICON_SM} strokeWidth={ICON_STROKE} className="text-ink-muted" />
                    意见反馈
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2.5 w-full px-4 py-2 text-left text-sm text-coral-600 hover:bg-coral-50 transition-colors"
                  >
                    <LogOut size={ICON_SM} strokeWidth={ICON_STROKE} />
                    退出登录
                  </button>
                </div>
              )}
            </>
          ) : (
            <Link
              href="/login"
              className="px-4 py-2 text-sm font-medium text-white bg-[#FDF3C0] rounded-lg hover:bg-[#FDECC8] transition-all"
            >
              登录
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
