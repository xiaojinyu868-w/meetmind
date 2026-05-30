'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/hooks/useAuth';
import { getPreference, setPreference } from '@/lib/db';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  AI_MODEL_AUTO_VALUE,
  AI_MODEL_PREFERENCE_KEY,
} from '@/lib/utils/ai-model-preference';
import { LEARNER_STAGE_LABELS, type LearnerProfile, type LearnerStage } from '@/types/user';

const LearnerOnboardingComponent = dynamic(() => import('@/components/LearnerOnboarding'), { ssr: false });

const SETTINGS_KEYS = {
  AUTO_SAVE: 'settings_auto_save',
  MODEL_PREFERENCE: AI_MODEL_PREFERENCE_KEY,
  BILIBILI_COOKIE: 'settings_bilibili_cookie',
  CLASS_CHECK_ENABLED: 'settings_class_check_enabled',
};

interface SettingsState {
  autoSave: boolean;
  modelPreference: string;
  bilibiliCookie: string;
  classCheckEnabled: boolean;
}

interface ProfileForm {
  nickname: string;
  email: string;
  phone: string;
}

type BannerMessage = {
  type: 'success' | 'error';
  text: string;
};

type ModelOption = {
  id: string;
  name: string;
  recommended?: boolean;
};

const DEFAULT_SETTINGS: SettingsState = {
  autoSave: true,
  modelPreference: AI_MODEL_AUTO_VALUE,
  bilibiliCookie: '',
  classCheckEnabled: false,
};

const DEFAULT_PROFILE_FORM: ProfileForm = {
  nickname: '',
  email: '',
  phone: '',
};

const roleLabels: Record<string, string> = {
  student: '学生',
  admin: '管理员',
};

export default function SettingsPage() {
  const { user, isAuthenticated, isCheckingAuth, updateProfile, logout, saveLearnerProfile, onboardingCompleted } = useAuth();
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [defaultModelId, setDefaultModelId] = useState('step-3.7-flash');
  const [profileForm, setProfileForm] = useState<ProfileForm>(DEFAULT_PROFILE_FORM);
  const [loading, setLoading] = useState(true);
  const [savingSetting, setSavingSetting] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [saveMessage, setSaveMessage] = useState<BannerMessage | null>(null);
  const [showLearnerEdit, setShowLearnerEdit] = useState(false);

  const showMessage = useCallback((type: BannerMessage['type'], text: string) => {
    setSaveMessage({ type, text });
    window.setTimeout(() => setSaveMessage(null), 2200);
  }, []);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [autoSave, modelPreference, bilibiliCookie, classCheckEnabled] = await Promise.all([
          getPreference(SETTINGS_KEYS.AUTO_SAVE, DEFAULT_SETTINGS.autoSave),
          getPreference(SETTINGS_KEYS.MODEL_PREFERENCE, DEFAULT_SETTINGS.modelPreference),
          getPreference(SETTINGS_KEYS.BILIBILI_COOKIE, DEFAULT_SETTINGS.bilibiliCookie),
          getPreference(SETTINGS_KEYS.CLASS_CHECK_ENABLED, DEFAULT_SETTINGS.classCheckEnabled),
        ]);

        setSettings({
          autoSave,
          modelPreference,
          bilibiliCookie,
          classCheckEnabled,
        });
      } finally {
        setLoading(false);
      }
    };

    void loadSettings();
  }, []);

  useEffect(() => {
    let alive = true;
    const loadModels = async () => {
      try {
        const response = await fetch('/api/chat');
        const data = (await response.json()) as {
          models?: Array<{ id?: string; name?: string; recommended?: boolean }>;
          defaultModel?: string;
        };
        if (!alive) return;
        const nextDefaultModel = data.defaultModel?.trim() || 'step-3.7-flash';
        setDefaultModelId(nextDefaultModel);
        setModelOptions((data.models || [])
          .filter((model): model is { id: string; name: string; recommended?: boolean } => Boolean(model.id && model.name))
          .map((model) => ({
            id: model.id,
            name: model.name,
            recommended: model.id === nextDefaultModel || Boolean(model.recommended),
          })));
      } catch {
        if (alive) setModelOptions([]);
      }
    };

    void loadModels();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!user) {
      setProfileForm(DEFAULT_PROFILE_FORM);
      return;
    }

    setProfileForm({
      nickname: user.nickname || '',
      email: user.email || '',
      phone: user.phone || '',
    });
  }, [user]);

  const updateSetting = async <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    const keyMap: Record<keyof SettingsState, string> = {
      autoSave: SETTINGS_KEYS.AUTO_SAVE,
      modelPreference: SETTINGS_KEYS.MODEL_PREFERENCE,
      bilibiliCookie: SETTINGS_KEYS.BILIBILI_COOKIE,
      classCheckEnabled: SETTINGS_KEYS.CLASS_CHECK_ENABLED,
    };

    setSavingSetting(true);
    try {
      await setPreference(keyMap[key], value);
      setSettings((prev) => ({ ...prev, [key]: value }));
      showMessage('success', '已保存');
    } catch {
      showMessage('error', '保存失败');
    } finally {
      setSavingSetting(false);
    }
  };

  const handleProfileFieldChange = (field: keyof ProfileForm, value: string) => {
    setProfileForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleProfileSave = async () => {
    if (!isAuthenticated) return;

    setSavingProfile(true);
    try {
      const success = await updateProfile({
        nickname: profileForm.nickname.trim(),
        email: profileForm.email.trim(),
        phone: profileForm.phone.trim(),
      });

      showMessage(success ? 'success' : 'error', success ? '资料已更新' : '资料保存失败');
    } catch {
      showMessage('error', '资料保存失败');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    showMessage('success', '已退出登录');
  };

  if (isCheckingAuth || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F7F5]">
        <div className="loading-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    );
  }

  const defaultModelName = modelOptions.find((model) => model.id === defaultModelId)?.name;
  const selectedModelLabel = settings.modelPreference === AI_MODEL_AUTO_VALUE
    ? defaultModelName ? `自动选择（${defaultModelName}）` : '自动选择'
    : (modelOptions.find((model) => model.id === settings.modelPreference)?.name || '自动选择');

  return (
    <div className="min-h-screen bg-[#F7F7F5]">
      <header className="sticky top-0 z-10 border-b border-[#E9E9E7] bg-[#F7F7F5]/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-md items-center px-4">
          <Link
            href="/"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#E9E9E7] bg-white text-[#232322]"
            aria-label="返回"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1 text-center text-[17px] font-semibold text-[#232322]">设置</div>
          <div className="w-9" />
        </div>
      </header>

      {saveMessage ? (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-20 flex justify-center px-4">
          <div
            className={`rounded-full border px-4 py-2 text-xs ${
              saveMessage.type === 'success'
                ? 'border-[#E9E9E7] bg-white text-[#232322]'
                : 'border-[#F0D7D1] bg-white text-[#B4513D]'
            }`}
          >
            {saveMessage.text}
          </div>
        </div>
      ) : null}

      <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-3 pb-16 pt-4">
        <div>
          <SectionCaption>账户</SectionCaption>
          <SettingGroup id="account">
            {isAuthenticated && user ? (
              <>
                <div className="flex items-center gap-3 px-4 py-4">
                  <Avatar className="h-14 w-14 border border-[#E9E9E7] bg-[#F7F7F5]">
                    {user.avatar ? <AvatarImage src={user.avatar} alt={user.nickname} className="object-cover" /> : null}
                    <AvatarFallback className="bg-[#F7F7F5] text-[#232322]">
                      {(user.nickname || user.username || 'U').slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[17px] font-medium text-[#232322]">
                      {user.nickname || user.username}
                    </div>
                    <div className="mt-1 truncate text-[13px] text-[#787774]">
                      {roleLabels[user.role] || user.role}
                      {user.email ? ` · ${user.email}` : user.phone ? ` · ${user.phone}` : ''}
                    </div>
                  </div>
                </div>

                <GroupDivider />
                <InputSettingRow
                  label="昵称"
                  type="text"
                  value={profileForm.nickname}
                  placeholder="未设置"
                  onChange={(value) => handleProfileFieldChange('nickname', value)}
                />
                <GroupDivider />
                <InputSettingRow
                  label="邮箱"
                  type="email"
                  value={profileForm.email}
                  placeholder="未设置"
                  onChange={(value) => handleProfileFieldChange('email', value)}
                />
                <GroupDivider />
                <InputSettingRow
                  label="手机"
                  type="tel"
                  value={profileForm.phone}
                  placeholder="未设置"
                  onChange={(value) => handleProfileFieldChange('phone', value)}
                />
                <GroupDivider />
                <div className="p-3">
                  <button
                    onClick={handleProfileSave}
                    disabled={savingProfile}
                    className="inline-flex h-11 w-full items-center justify-center rounded-[14px] bg-[#232322] text-[15px] font-medium text-white transition-opacity disabled:opacity-50"
                  >
                    {savingProfile ? '保存中...' : '保存资料'}
                  </button>
                </div>
                <GroupDivider />
                <ActionLinkRow href="/profile/password" label="修改密码" />
                <GroupDivider />
                <ActionButtonRow label="退出登录" tone="danger" onClick={handleLogout} />
              </>
            ) : (
              <>
                <StaticRow label="状态" value="未登录" />
                <GroupDivider />
                <ActionLinkRow href="/login" label="登录" />
                <GroupDivider />
                <ActionLinkRow href="/register" label="注册" />
              </>
            )}
          </SettingGroup>
        </div>

        {isAuthenticated && (
          <div>
            <SectionCaption>学习档案</SectionCaption>
            <SettingGroup>
              {user?.learnerProfile ? (
                <>
                  <StaticRow
                    label="身份"
                    value={LEARNER_STAGE_LABELS[user.learnerProfile.stage as LearnerStage] || user.learnerProfile.stage}
                  />
                  <GroupDivider />
                  {user.learnerProfile.stage === 'k12' && (
                    <StaticRow label="年级" value={(user.learnerProfile as { gradeLevel?: string }).gradeLevel || '未设置'} />
                  )}
                  {user.learnerProfile.stage === 'university' && (
                    <>
                      <StaticRow label="专业" value={(user.learnerProfile as { major?: string }).major || '未设置'} />
                      <GroupDivider />
                      <StaticRow label="年级" value={(user.learnerProfile as { year?: string }).year || '未设置'} />
                    </>
                  )}
                  {user.learnerProfile.stage === 'graduate' && (
                    <StaticRow label="方向" value={(user.learnerProfile as { field?: string }).field || '未设置'} />
                  )}
                  {user.learnerProfile.stage === 'working' && (
                    <>
                      <StaticRow label="行业" value={(user.learnerProfile as { industry?: string }).industry || '未设置'} />
                      <GroupDivider />
                      <StaticRow label="目标" value={(user.learnerProfile as { learningGoal?: string }).learningGoal || '未设置'} />
                    </>
                  )}
                  {(user.learnerProfile as { otherInterests?: string }).otherInterests && (
                    <>
                      <GroupDivider />
                      <StaticRow label="也在学" value={(user.learnerProfile as { otherInterests?: string }).otherInterests!} />
                    </>
                  )}
                  <GroupDivider />
                  <ActionButtonRow label="重新填写" tone="default" onClick={() => setShowLearnerEdit(true)} />
                </>
              ) : (
                <>
                  <div className="px-4 py-4 text-[14px] text-[#787774]">
                    完善学习档案，让同学更懂你
                  </div>
                  <GroupDivider />
                  <ActionButtonRow label="填写学习档案" tone="default" onClick={() => setShowLearnerEdit(true)} />
                </>
              )}
            </SettingGroup>
          </div>
        )}

        {showLearnerEdit && (
          <LearnerOnboardingModal
            currentProfile={user?.learnerProfile ?? null}
            onSave={async (profile) => {
              const success = await saveLearnerProfile(profile);
              if (success) {
                setShowLearnerEdit(false);
                showMessage('success', '学习档案已更新');
              } else {
                showMessage('error', '保存失败');
              }
            }}
            onClose={() => setShowLearnerEdit(false)}
          />
        )}

        <div>
          <SectionCaption>偏好</SectionCaption>
          <SettingGroup>
            <ToggleRow
              label="自动保存"
              checked={settings.autoSave}
              disabled={savingSetting}
              onChange={(checked) => updateSetting('autoSave', checked)}
            />
            <GroupDivider />
            <ToggleRow
              label="随堂检验"
              checked={settings.classCheckEnabled}
              disabled={savingSetting}
              onChange={(checked) => updateSetting('classCheckEnabled', checked)}
            />
            <div className="px-4 pb-3 text-[12px] text-[#A3A39E]">
              开启后，播放视频或音频时 AI 会在合适的节点自动暂停并出题，检验是否真正听懂
            </div>
          </SettingGroup>
        </div>

        <div>
          <SectionCaption>学习同桌</SectionCaption>
          <SettingGroup id="ai">
            <SelectRow
              label="回答方式"
              value={settings.modelPreference}
              displayValue={selectedModelLabel}
              disabled={savingSetting}
              onChange={(value) => updateSetting('modelPreference', value)}
              options={[
                { value: AI_MODEL_AUTO_VALUE, label: defaultModelName ? `自动选择（${defaultModelName}）` : '自动选择（推荐）' },
                ...modelOptions.map((model) => ({
                  value: model.id,
                  label: `${model.name}${model.recommended ? '（推荐）' : ''}`,
                })),
              ]}
            />
          </SettingGroup>
        </div>

        <div>
          <SectionCaption>导入</SectionCaption>
          <SettingGroup>
            <div className="px-4 pb-4 pt-3">
              <div className="px-1 pb-3 text-[15px] text-[#232322]">B站 Cookie</div>
              <textarea
                value={settings.bilibiliCookie}
                onChange={(event) => setSettings((prev) => ({ ...prev, bilibiliCookie: event.target.value }))}
                onBlur={() => updateSetting('bilibiliCookie', settings.bilibiliCookie.trim())}
                placeholder="粘贴 SESSDATA、bili_jct、DedeUserID"
                rows={4}
                disabled={savingSetting}
                className="w-full resize-none rounded-[16px] border border-[#E9E9E7] bg-[#F7F7F5] px-4 py-4 text-[14px] leading-6 text-[#232322] outline-none placeholder:text-[#A3A39E]"
              />
              <div className="px-1 pt-3 text-[12px] text-[#A3A39E]">仅保存在当前浏览器</div>
            </div>

            {settings.bilibiliCookie ? (
              <>
                <GroupDivider />
                <ActionButtonRow
                  label="清除 Cookie"
                  tone="default"
                  onClick={() => updateSetting('bilibiliCookie', '')}
                />
              </>
            ) : null}

            <GroupDivider />
            <details className="px-4 py-4">
              <summary className="cursor-pointer text-[15px] text-[#232322]">如何获取导入凭证</summary>
              <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-[13px] leading-6 text-[#787774]">
                <li>登录 bilibili.com</li>
                <li>按 F12 打开开发者工具</li>
                <li>切到「应用 / Application」</li>
                <li>找到 Cookie → https://www.bilibili.com</li>
                <li>复制 SESSDATA、bili_jct、DedeUserID 并用分号拼接</li>
              </ol>
            </details>
          </SettingGroup>
        </div>

        <div>
          <SectionCaption>更多</SectionCaption>
          <SettingGroup>
            <ActionLinkRow href="/help" label="帮助中心" />
            <GroupDivider />
            <ActionLinkRow href="/feedback" label="意见反馈" />
            <GroupDivider />
            <StaticRow label="版本" value="1.0.0" />
          </SettingGroup>
        </div>
      </main>
    </div>
  );
}

function SectionCaption({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pb-2 text-[12px] font-medium text-[#A3A39E]">{children}</div>;
}

function SettingGroup({
  children,
  id,
}: {
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="overflow-hidden rounded-[20px] border border-[#E9E9E7] bg-white">
      {children}
    </section>
  );
}

function GroupDivider() {
  return <div className="h-px bg-[#E9E9E7]" />;
}

function InputSettingRow({
  label,
  type,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  type: 'text' | 'email' | 'tel';
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-h-[56px] items-center gap-4 px-4">
      <span className="w-16 flex-shrink-0 text-[15px] text-[#232322]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-12 min-w-0 flex-1 appearance-none bg-transparent px-0 text-right text-[15px] text-[#232322] outline-none placeholder:text-[#A3A39E]"
      />
    </label>
  );
}

function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-h-[56px] items-center gap-4 px-4">
      <div className="min-w-0 flex-1 text-[15px] text-[#232322]">{label}</div>
      <button
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-8 w-14 flex-shrink-0 rounded-full transition-colors ${
          checked ? 'bg-[#34C759]' : 'bg-[#D8D8D4]'
        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      >
        <span
          className={`mt-[2px] inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-[2px]'
          }`}
        />
      </button>
    </div>
  );
}

function SelectRow({
  label,
  value,
  displayValue,
  disabled,
  onChange,
  options,
}: {
  label: string;
  value: string;
  displayValue: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="relative flex min-h-[56px] items-center gap-4 px-4">
      <span className="w-20 flex-shrink-0 text-[15px] text-[#232322]">{label}</span>
      <div className="min-w-0 flex-1">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="h-12 w-full appearance-none bg-transparent pr-6 text-right text-[15px] text-[#232322] outline-none disabled:opacity-60"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="sr-only">{displayValue}</span>
      </div>
      <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-[#A3A39E]">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </span>
    </label>
  );
}

function ActionLinkRow({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[56px] items-center justify-between px-4 text-[15px] text-[#232322] transition-colors hover:bg-[#F7F7F5]"
    >
      <span>{label}</span>
      <svg className="h-4 w-4 text-[#A3A39E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

function ActionButtonRow({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: 'default' | 'danger';
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex min-h-[56px] w-full items-center justify-between px-4 text-left text-[15px] transition-colors hover:bg-[#F7F7F5] ${
        tone === 'danger' ? 'text-[#B4513D]' : 'text-[#232322]'
      }`}
    >
      <span>{label}</span>
      <svg className="h-4 w-4 text-[#A3A39E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

function StaticRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-h-[56px] items-center justify-between px-4 text-[15px]">
      <span className="text-[#232322]">{label}</span>
      <span className="text-[#787774]">{value}</span>
    </div>
  );
}

function LearnerOnboardingModal({
  onSave,
  onClose,
}: {
  currentProfile: LearnerProfile | null;
  onSave: (profile: LearnerProfile) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <LearnerOnboardingComponent
      onComplete={onSave}
      onSkip={onClose}
    />
  );
}
