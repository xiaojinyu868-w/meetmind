'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import { DedaoMenuButton } from '@/components/mobile/DedaoMenu';
import { MobileTabSwitch } from '@/components/mobile/MobileTabSwitch';
import type { ViewMode } from '@/types/page-types';

interface MobileTopBarUser {
  avatar?: string | null;
  nickname?: string | null;
}

interface MobileTopBarProps {
  viewMode: ViewMode;
  onTabChange: (tab: ViewMode) => void;
  isAuthenticated: boolean;
  user: MobileTopBarUser | null;
  onOpenMenu: () => void;
}

/**
 * v7 移动端顶栏：
 * - Logo 由 GraduationCap 升级为 Octo 头像（品牌资产化）
 * - 底色统一到 paper（v7 米白纸感）
 */
export function MobileTopBar({
  viewMode,
  onTabChange,
  isAuthenticated,
  user,
  onOpenMenu,
}: MobileTopBarProps) {
  return (
    <div className="flex-shrink-0 bg-paper px-4 pb-2 pt-[max(env(safe-area-inset-top),10px)]">
      <div className="mx-auto flex w-full max-w-md items-center gap-3">
        {/* Octo 头像作为品牌 logo（呼吸光环 · 永驻） */}
        <OctoAvatar mood="idle" size="sm" aura />

        <div className="flex min-w-0 flex-1 items-center justify-center">
          <MobileTabSwitch
            activeTab={viewMode}
            onTabChange={onTabChange}
          />
        </div>

        <div className="flex items-center gap-2">
          {isAuthenticated && user ? (
            <button
              onClick={onOpenMenu}
              className="h-8 w-8 overflow-hidden rounded-full"
              aria-label="打开菜单"
            >
              <Avatar className="h-full w-full">
                {user.avatar ? (
                  <AvatarImage src={user.avatar} alt={user.nickname || '用户'} className="object-cover" />
                ) : null}
                <AvatarFallback className="bg-paper-warm text-xs text-ink-muted">用户</AvatarFallback>
              </Avatar>
            </button>
          ) : (
            <a
              href="/login"
              className="inline-flex h-7 items-center justify-center rounded-full bg-ink px-3 text-[12px] font-medium text-white transition-colors hover:bg-black"
            >
              登录
            </a>
          )}

          <DedaoMenuButton onClick={onOpenMenu} />
        </div>
      </div>
    </div>
  );
}
