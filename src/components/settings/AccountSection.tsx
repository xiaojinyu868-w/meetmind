/**
 * settings/AccountSection — 「账户」区：登录态 = 身份 hero + 资料/安全卡片；
 * 游客态 = 一张安静的登录卡片（原来是「状态：未登录 / 登录 / 注册」三行干列表，
 * 没有说明价值）。所有用户面字符串走 COPY.settings.account。
 */

'use client';

import Link from 'next/link';
import { COPY } from '@/lib/ui/copy';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  ActionButtonRow,
  ActionLinkRow,
  GroupDivider,
  InputSettingRow,
  SettingGroup,
  SettingSection,
} from './primitives';

const S = COPY.settings;

export interface AccountUser {
  nickname?: string | null;
  username?: string | null;
  email?: string | null;
  phone?: string | null;
  avatar?: string | null;
  role?: string;
}

export interface ProfileFormState {
  nickname: string;
  email: string;
  phone: string;
}

export function AccountSection({
  user,
  isAuthenticated,
  profileForm,
  savingProfile,
  wechatEnabled,
  wechatBindLabel,
  onFieldChange,
  onSaveProfile,
  onShowWechat,
  onLogout,
}: {
  user: AccountUser | null;
  isAuthenticated: boolean;
  profileForm: ProfileFormState;
  savingProfile: boolean;
  wechatEnabled: boolean;
  wechatBindLabel: string;
  onFieldChange: (field: keyof ProfileFormState, value: string) => void;
  onSaveProfile: () => void;
  onShowWechat: () => void;
  onLogout: () => void;
}) {
  return (
    <SettingSection
      id="account"
      caption={S.account.caption}
      description={isAuthenticated ? S.account.descriptionAuthed : S.account.descriptionGuest}
    >
      {isAuthenticated && user ? (
        <>
          {/* 身份 hero：进设置页第一眼知道"我是谁" */}
          <header className="flex items-center gap-4 px-2 pb-5">
            <Avatar className="h-16 w-16 border border-divider bg-paper-warm shadow-soft">
              {user.avatar ? <AvatarImage src={user.avatar} alt={user.nickname ?? ''} className="object-cover" /> : null}
              <AvatarFallback className="bg-paper-warm text-[22px] font-semibold text-ink">
                {(user.nickname || user.username || 'U').slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-[20px] font-semibold tracking-[-0.018em] text-ink">
                  {user.nickname || user.username}
                </h1>
                <span className="inline-flex items-center rounded-full bg-pine/10 px-2 py-[2px] font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-pine">
                  {S.roles[user.role ?? ''] || user.role}
                </span>
              </div>
              <p className="mt-1 truncate text-[13px] text-ink-secondary">
                {user.email || user.phone || S.account.noContact}
              </p>
            </div>
          </header>

          <SettingGroup>
            <InputSettingRow
              label={S.account.nickname}
              type="text"
              value={profileForm.nickname}
              placeholder={S.account.unset}
              onChange={(value) => onFieldChange('nickname', value)}
            />
            <GroupDivider />
            <InputSettingRow
              label={S.account.email}
              type="email"
              value={profileForm.email}
              placeholder={S.account.unset}
              onChange={(value) => onFieldChange('email', value)}
            />
            <GroupDivider />
            <InputSettingRow
              label={S.account.phone}
              type="tel"
              value={profileForm.phone}
              placeholder={S.account.unset}
              onChange={(value) => onFieldChange('phone', value)}
            />
            <GroupDivider />
            <div className="flex items-center justify-end px-4 py-3">
              <button
                onClick={onSaveProfile}
                disabled={savingProfile}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-pine/40 bg-card px-4 text-[13px] font-medium text-pine transition-all hover:border-pine hover:bg-pine/[0.06] active:scale-95 disabled:opacity-50"
              >
                {savingProfile ? S.account.savingProfile : S.account.saveProfile}
              </button>
            </div>
            <GroupDivider />
            {wechatEnabled ? (
              <>
                <ActionButtonRow label={wechatBindLabel} tone="default" onClick={onShowWechat} />
                <GroupDivider />
              </>
            ) : null}
            <ActionLinkRow href="/profile/password" label={S.account.changePassword} />
            <GroupDivider />
            <ActionButtonRow label={S.account.logout} tone="danger" onClick={onLogout} />
          </SettingGroup>
        </>
      ) : (
        <SettingGroup>
          <div className="px-5 pb-5 pt-5">
            <p className="text-[13.5px] leading-relaxed text-ink-secondary">{S.account.guestBody}</p>
            <div className="mt-4 flex items-center gap-3">
              <Link
                href="/login"
                className="inline-flex h-9 items-center rounded-full bg-pine px-5 text-[13px] font-medium text-white transition-all hover:bg-pine/90 active:scale-95"
              >
                {S.account.login}
              </Link>
              <Link
                href="/register"
                className="inline-flex h-9 items-center rounded-full border border-divider px-5 text-[13px] font-medium text-ink transition-all hover:border-pine/40 hover:text-pine active:scale-95"
              >
                {S.account.register}
              </Link>
            </div>
          </div>
        </SettingGroup>
      )}
    </SettingSection>
  );
}
