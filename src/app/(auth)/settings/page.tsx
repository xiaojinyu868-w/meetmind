'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/hooks/useAuth';
import { getPreference, setPreference } from '@/lib/db';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  AI_MODEL_AUTO_VALUE,
  AI_MODEL_PREFERENCE_KEY,
} from '@/lib/utils/ai-model-preference';
import {
  TUTOR_PREFERENCES_DEFAULT,
  TUTOR_SHOW_TIMESTAMPS_KEY,
  TUTOR_THINKING_GUIDE_KEY,
  parseTutorBooleanPreference,
  serializeTutorBooleanPreference,
} from '@/lib/utils/tutor-preferences';
import { LEARNER_STAGE_LABELS, type LearnerProfile, type LearnerStage } from '@/types/user';

const LearnerOnboardingComponent = dynamic(() => import('@/components/LearnerOnboarding'), { ssr: false });
const IntentDialogContainer = dynamic(
  () => import('@/components/intent/IntentDialogContainer').then((m) => ({ default: m.IntentDialogContainer })),
  { ssr: false },
);

const SETTINGS_KEYS = {
  AUTO_SAVE: 'settings_auto_save',
  MODEL_PREFERENCE: AI_MODEL_PREFERENCE_KEY,
  BILIBILI_COOKIE: 'settings_bilibili_cookie',
  CLASS_CHECK_ENABLED: 'settings_class_check_enabled',
  TUTOR_SHOW_TIMESTAMPS: TUTOR_SHOW_TIMESTAMPS_KEY,
  TUTOR_THINKING_GUIDE: TUTOR_THINKING_GUIDE_KEY,
};

interface SettingsState {
  autoSave: boolean;
  modelPreference: string;
  bilibiliCookie: string;
  classCheckEnabled: boolean;
  tutorShowTimestamps: boolean;
  tutorThinkingGuide: boolean;
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
  tutorShowTimestamps: TUTOR_PREFERENCES_DEFAULT.showTimestamps,
  tutorThinkingGuide: TUTOR_PREFERENCES_DEFAULT.thinkingGuide,
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
  const router = useRouter();
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [defaultModelId, setDefaultModelId] = useState('DeepSeek-V4-Flash');
  const [profileForm, setProfileForm] = useState<ProfileForm>(DEFAULT_PROFILE_FORM);
  const [loading, setLoading] = useState(true);
  const [savingSetting, setSavingSetting] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [saveMessage, setSaveMessage] = useState<BannerMessage | null>(null);
  const [showLearnerEdit, setShowLearnerEdit] = useState(false);
  const [showIntentDialog, setShowIntentDialog] = useState(false);

  // R9-2 修返回 bug：之前用 canGoBack state 判断，初始 false 让首次渲染是 <Link href="/">,
  // 即使 useEffect 后改成 true 也来不及——用户点击触发的仍是死链跳首页。
  // 修法：永远渲染 button + onClick handleBack，state 内部判断 history.length 决定行为。
  const handleBack = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/');
    }
  }, [router]);

  const showMessage = useCallback((type: BannerMessage['type'], text: string) => {
    setSaveMessage({ type, text });
    window.setTimeout(() => setSaveMessage(null), 2200);
  }, []);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [autoSave, modelPreference, bilibiliCookie, classCheckEnabled, tutorShowTimestampsRaw, tutorThinkingGuideRaw] = await Promise.all([
          getPreference(SETTINGS_KEYS.AUTO_SAVE, DEFAULT_SETTINGS.autoSave),
          getPreference(SETTINGS_KEYS.MODEL_PREFERENCE, DEFAULT_SETTINGS.modelPreference),
          getPreference(SETTINGS_KEYS.BILIBILI_COOKIE, DEFAULT_SETTINGS.bilibiliCookie),
          getPreference(SETTINGS_KEYS.CLASS_CHECK_ENABLED, DEFAULT_SETTINGS.classCheckEnabled),
          getPreference<string | null>(SETTINGS_KEYS.TUTOR_SHOW_TIMESTAMPS, null),
          getPreference<string | null>(SETTINGS_KEYS.TUTOR_THINKING_GUIDE, null),
        ]);

        setSettings({
          autoSave,
          modelPreference,
          bilibiliCookie,
          classCheckEnabled,
          tutorShowTimestamps: parseTutorBooleanPreference(
            tutorShowTimestampsRaw,
            DEFAULT_SETTINGS.tutorShowTimestamps,
          ),
          tutorThinkingGuide: parseTutorBooleanPreference(
            tutorThinkingGuideRaw,
            DEFAULT_SETTINGS.tutorThinkingGuide,
          ),
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
        const nextDefaultModel = data.defaultModel?.trim() || 'DeepSeek-V4-Flash';
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
      tutorShowTimestamps: SETTINGS_KEYS.TUTOR_SHOW_TIMESTAMPS,
      tutorThinkingGuide: SETTINGS_KEYS.TUTOR_THINKING_GUIDE,
    };

    // tutor 偏好用字符串序列化（和 tutor-preferences.ts 的 parser 对齐）
    const persistedValue =
      key === 'tutorShowTimestamps' || key === 'tutorThinkingGuide'
        ? serializeTutorBooleanPreference(value as boolean)
        : value;

    setSavingSetting(true);
    try {
      await setPreference(keyMap[key], persistedValue);
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
      <div className="flex min-h-screen items-center justify-center bg-paper">
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
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-10 border-b border-divider bg-paper/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center px-5">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-divider bg-card text-ink transition-all hover:border-pine hover:text-pine hover:bg-pine/5 active:scale-95"
            aria-label="返回"
            title="返回上一页"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 text-center text-[16px] font-semibold tracking-[-0.012em] text-ink">设置</div>
          <div className="w-9" />
        </div>
      </header>

      {/* R9-2 toast 重做：从 top-center 大 banner → 右上角小 toast，
          slide-in 动画，更克制更现代（macOS / Stripe 风）。 */}
      {saveMessage ? (
        <div className="pointer-events-none fixed right-5 top-[68px] z-30 animate-in slide-in-from-top-2 fade-in duration-200">
          <div
            className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-[12.5px] font-medium shadow-card ${
              saveMessage.type === 'success'
                ? 'border-pine/25 bg-card text-pine'
                : 'border-vermilion/30 bg-card text-vermilion'
            }`}
          >
            {saveMessage.type === 'success' ? (
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            {saveMessage.text}
          </div>
        </div>
      ) : null}

      <main className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-5 pb-20 pt-7">
        {/* R9-2 顶级 UX 升级：User Identity Hero
            进设置页第一眼就知道"我是谁"。把账户 group 顶部的小 avatar 行
            升级为 page hero，给设置页一个真正的产品入口感。 */}
        {isAuthenticated && user ? (
          <header className="flex items-center gap-4 px-1 pb-1">
            <Avatar className="h-16 w-16 border border-divider bg-paper-warm shadow-soft">
              {user.avatar ? <AvatarImage src={user.avatar} alt={user.nickname} className="object-cover" /> : null}
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
                  {roleLabels[user.role] || user.role}
                </span>
              </div>
              <p className="mt-1 truncate text-[13px] text-ink-secondary">
                {user.email || user.phone || '尚未填写联系方式'}
              </p>
            </div>
          </header>
        ) : null}

        {/* 账户 — 标识身份 / 联系方式 / 安全 */}
        <SettingSection
          caption="账户"
          description={isAuthenticated ? '修改你的展示信息和登录方式' : '登录后可同步学习数据'}
        >
          <SettingGroup id="account">
            {isAuthenticated && user ? (
              <>
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
                {/* R9-2：保存按钮从 ink 大按钮 → pine outline 克制 pill，右对齐次操作 */}
                <div className="flex items-center justify-end px-4 py-3">
                  <button
                    onClick={handleProfileSave}
                    disabled={savingProfile}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-pine/40 bg-card px-4 text-[13px] font-medium text-pine transition-all hover:border-pine hover:bg-pine/[0.06] active:scale-95 disabled:opacity-50"
                  >
                    {savingProfile ? '保存中…' : '保存资料'}
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
        </SettingSection>

        {isAuthenticated && (() => {
          const bio = (user?.learnerProfile as { bio?: { headline: string; detail?: string; updatedAt?: string } } | undefined)?.bio;
          const handleClearBio = async () => {
            if (!confirm('确定要清除画像吗？以后回访时会重新认识你。')) return;
            const profile = user?.learnerProfile;
            if (!profile) return;
            const next = { ...(profile as object) } as Record<string, unknown>;
            delete next.bio;
            await saveLearnerProfile(next as unknown as typeof profile);
          };
          return (
            <SettingSection
              caption="关于你"
              description="教练在「聊聊你想要的」里和你一起记下来的画像。以后所有对话都接着这个走"
            >
              <SettingGroup>
                {bio?.headline ? (
                  <>
                    <div className="px-5 py-4">
                      <p className="text-[15px] font-medium leading-7 text-ink">{bio.headline}</p>
                      {bio.detail ? (
                        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-secondary">
                          {bio.detail}
                        </p>
                      ) : null}
                      {bio.updatedAt ? (
                        <p className="mt-2 font-mono text-[10.5px] uppercase tracking-caps text-ink-muted">
                          上次更新 · {new Date(bio.updatedAt).toLocaleDateString('zh-CN')}
                        </p>
                      ) : null}
                    </div>
                    <GroupDivider />
                    <ActionButtonRow
                      label="和教练再聊聊（更新画像）"
                      tone="default"
                      onClick={() => setShowIntentDialog(true)}
                    />
                    <GroupDivider />
                    <ActionButtonRow
                      label="清除画像"
                      tone="danger"
                      onClick={handleClearBio}
                    />
                  </>
                ) : (
                  <>
                    <div className="px-5 py-4 text-[13.5px] leading-relaxed text-ink-secondary">
                      还没认识你。和教练聊聊，我会自然地了解你这个人——以后我们就接着这个聊。
                    </div>
                    <GroupDivider />
                    <ActionButtonRow
                      label="和教练聊一聊"
                      tone="default"
                      onClick={() => setShowIntentDialog(true)}
                    />
                  </>
                )}
              </SettingGroup>
            </SettingSection>
          );
        })()}

        {isAuthenticated && (
          <SettingSection
            caption="聊聊你想要的"
            description="和教练聊一聊，把脑子里的事一起捋清楚——也可以打电话语音聊"
          >
            <SettingGroup>
              {(() => {
                const goals = (user?.learnerProfile as { goals?: Array<{ id: string; title: string; summary?: string; status?: string }> } | undefined)?.goals ?? [];
                if (goals.length > 0) {
                  return (
                    <>
                      {goals.map((g, idx) => (
                        <div key={g.id ?? idx}>
                          {idx > 0 ? <GroupDivider /> : null}
                          <div className="px-5 py-4">
                            <p className="text-[14.5px] font-medium leading-6 text-ink">{g.title}</p>
                            {g.summary ? (
                              <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{g.summary}</p>
                            ) : null}
                          </div>
                        </div>
                      ))}
                      <GroupDivider />
                      <ActionButtonRow label="和教练再聊一会" tone="default" onClick={() => setShowIntentDialog(true)} />
                    </>
                  );
                }
                return (
                  <>
                    <div className="px-5 py-4 text-[13.5px] leading-relaxed text-ink-secondary">
                      还没聊过。你最近想做的事 / 想去的方向 / 还在纠结的选择，都可以慢慢说。
                    </div>
                    <GroupDivider />
                    <ActionButtonRow label="和教练聊一聊" tone="default" onClick={() => setShowIntentDialog(true)} />
                  </>
                );
              })()}
            </SettingGroup>
          </SettingSection>
        )}

        {showIntentDialog && (
          <IntentDialogContainer
            open
            onClose={() => setShowIntentDialog(false)}
          />
        )}

        {isAuthenticated && (
          <SettingSection
            caption="学习档案"
            description="告诉同学你的身份背景，让 AI 回答更贴你"
          >
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
                  <div className="px-5 py-4 text-[13.5px] leading-relaxed text-ink-secondary">
                    完善学习档案，让同学更懂你。我们会用它判断该用什么深度回答你。
                  </div>
                  <GroupDivider />
                  <ActionButtonRow label="填写学习档案" tone="default" onClick={() => setShowLearnerEdit(true)} />
                </>
              )}
            </SettingGroup>
          </SettingSection>
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

        <SettingSection
          caption="偏好"
          description="录课和复习时的默认行为"
        >
          <SettingGroup>
            <ToggleRow
              label="自动保存"
              hint="录音结束后自动保存到云端"
              checked={settings.autoSave}
              disabled={savingSetting}
              onChange={(checked) => updateSetting('autoSave', checked)}
            />
            <GroupDivider />
            <ToggleRow
              label="随堂检验"
              hint="播放视频或音频时 AI 会在合适的节点自动暂停并出题"
              checked={settings.classCheckEnabled}
              disabled={savingSetting}
              onChange={(checked) => updateSetting('classCheckEnabled', checked)}
            />
          </SettingGroup>
        </SettingSection>

        <SettingSection
          caption="学习同桌"
          description="决定 AI 回答你的方式"
        >
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
            <GroupDivider />
            <ToggleRow
              label="回答里附时间戳"
              hint="AI 引用课堂内容时附 [MM:SS] 标签，点击跳回原片段"
              checked={settings.tutorShowTimestamps}
              disabled={savingSetting}
              onChange={(checked) => updateSetting('tutorShowTimestamps', checked)}
            />
            <GroupDivider />
            <ToggleRow
              label="展示思考过程"
              hint="开启后 AI 先展示推理过程再给最终答案；关闭由 AI 自己判断"
              checked={settings.tutorThinkingGuide}
              disabled={savingSetting}
              onChange={(checked) => updateSetting('tutorThinkingGuide', checked)}
            />
          </SettingGroup>
        </SettingSection>

        <SettingSection
          caption="导入"
          description="从 B 站等平台导入课程时需要的凭证"
        >
          <SettingGroup>
            <div className="px-5 pb-4 pt-4">
              <div className="pb-2.5 text-[14px] font-medium text-ink">B站 Cookie</div>
              <textarea
                value={settings.bilibiliCookie}
                onChange={(event) => setSettings((prev) => ({ ...prev, bilibiliCookie: event.target.value }))}
                onBlur={() => updateSetting('bilibiliCookie', settings.bilibiliCookie.trim())}
                placeholder="粘贴 SESSDATA、bili_jct、DedeUserID"
                rows={3}
                disabled={savingSetting}
                className="w-full resize-none rounded-xl border border-divider bg-paper px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none transition-all placeholder:text-ink-muted/60 focus:border-pine/50 focus:bg-card focus:ring-2 focus:ring-pine/15"
              />
              <div className="pt-2 text-[11.5px] text-ink-muted">仅保存在当前浏览器</div>
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
            <details className="group px-5 py-3.5">
              <summary className="flex cursor-pointer items-center gap-2 text-[13.5px] text-ink-secondary transition-colors hover:text-pine">
                <svg className="h-3 w-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M9 5l7 7-7 7" />
                </svg>
                如何获取导入凭证
              </summary>
              <ol className="mt-3 list-decimal space-y-1.5 pl-9 text-[12.5px] leading-relaxed text-ink-secondary marker:text-pine/60 marker:font-mono">
                <li>登录 bilibili.com</li>
                <li>按 F12 打开开发者工具</li>
                <li>切到「应用 / Application」</li>
                <li>找到 Cookie → https://www.bilibili.com</li>
                <li>复制 SESSDATA、bili_jct、DedeUserID 并用分号拼接</li>
              </ol>
            </details>
          </SettingGroup>
        </SettingSection>

        <SettingSection caption="更多">
          <SettingGroup>
            <ActionLinkRow href="/help" label="帮助中心" />
            <GroupDivider />
            <ActionLinkRow href="/feedback" label="意见反馈" />
            <GroupDivider />
            <StaticRow label="版本" value="1.0.0" />
          </SettingGroup>
        </SettingSection>
      </main>
    </div>
  );
}

/**
 * SettingSection — caption + 可选 description 一行（顶级 UX 升级）
 *
 * 之前 SectionCaption 只有标题，每个 section 干嘛用户得猜。现在每段加一行
 * description（ink-muted 12px 解释意图），让信息层级真正清晰。
 *
 * 视觉规则：caption mono uppercase tracking 资产化 + description 普通字体收口。
 */
function SettingSection({
  caption,
  description,
  children,
}: {
  caption: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="px-2 pb-3">
        <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
          {caption}
        </div>
        {description ? (
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted/85">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function SettingGroup({
  children,
  id,
}: {
  children: React.ReactNode;
  id?: string;
}) {
  // R9：bg-white → bg-card / 加 shadow-soft 让 group 有轻盈边界
  return (
    <section id={id} className="overflow-hidden rounded-2xl border border-divider bg-card shadow-soft">
      {children}
    </section>
  );
}

function GroupDivider() {
  return <div className="h-px bg-divider" />;
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
    <label className="flex min-h-[52px] items-center gap-4 px-5">
      <span className="w-16 flex-shrink-0 text-[15px] text-ink">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-12 min-w-0 flex-1 appearance-none bg-transparent px-0 text-right text-[15px] text-ink outline-none placeholder:text-ink-muted/70"
      />
    </label>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  /** R9-2：可选 hint 内联到 label 下方（取代之前散落在 group 里的 px-4 pb-3 div）。
      让 label + 解释作为一个原子单元，不被 GroupDivider 切开。 */
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={`flex items-start gap-4 px-5 ${hint ? 'py-3.5' : 'min-h-[52px] items-center'}`}>
      <div className="min-w-0 flex-1">
        <div className={`text-[14.5px] text-ink ${hint ? 'leading-snug' : ''}`}>{label}</div>
        {hint ? (
          <p className="mt-1 text-[12px] leading-relaxed text-ink-muted/85">{hint}</p>
        ) : null}
      </div>
      <button
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-7 w-[46px] flex-shrink-0 rounded-full transition-colors ${
          hint ? 'mt-[2px]' : ''
        } ${checked ? 'bg-pine' : 'bg-divider'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      >
        <span
          className={`mt-[2px] inline-block h-[22px] w-[22px] transform rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-[2px]'
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
    <label className="relative flex min-h-[52px] items-center gap-4 px-5">
      <span className="w-20 flex-shrink-0 text-[15px] text-ink">{label}</span>
      <div className="min-w-0 flex-1">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="h-12 w-full appearance-none bg-transparent pr-6 text-right text-[15px] text-ink outline-none disabled:opacity-60"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="sr-only">{displayValue}</span>
      </div>
      <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-ink-muted">
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
  // R9：hover 用 pine 微提示（"AI 在场"信号扩散到设置项交互），不是普通 paper bg
  return (
    <Link
      href={href}
      className="group flex min-h-[52px] items-center justify-between px-5 text-[14.5px] text-ink transition-all hover:bg-pine/[0.04]"
    >
      <span>{label}</span>
      <svg className="h-4 w-4 text-ink-muted transition-all group-hover:text-pine group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
      className={`flex min-h-[52px] w-full items-center justify-between px-4 text-left text-[15px] transition-colors hover:bg-paper ${
        tone === 'danger' ? 'text-vermilion' : 'text-ink'
      }`}
    >
      <span>{label}</span>
      <svg className="h-4 w-4 text-ink-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
    <div className="flex min-h-[52px] items-center justify-between px-5 text-[14.5px]">
      <span className="text-ink">{label}</span>
      <span className="text-ink-secondary">{value}</span>
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
