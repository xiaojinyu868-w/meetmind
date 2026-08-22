'use client';

/**
 * /settings — 装配层。
 *
 * 2026-08 重设计（原 964 行 God File 拆分）：
 * - 行/卡/section 原子组件 → src/components/settings/primitives.tsx
 * - 桌面左侧锚点导航 → SettingsNav.tsx（md 以下隐藏，移动保持单列）
 * - 账户区 → AccountSection.tsx（含游客登录卡）；关于你 → AboutYouSection.tsx
 *   （学习档案 / 教练画像拆双卡）
 * - 用户面字符串统一 COPY.settings（src/lib/ui/copy.ts）
 * - 版本号从「更多」卡片移出，收口到页脚（设置页惯例，卡片只放可点条目）
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/hooks/useAuth';
import { getPreference, setPreference } from '@/lib/db';
import { COPY } from '@/lib/ui/copy';
import { useAdminLens } from '@/components/admin/AdminLensProvider';
import { PointsSettingsSection } from '@/components/points/PointsSettingsSection';
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
import type { LearnerProfile } from '@/types/user';
import { SettingsNav, type SettingsNavItem } from '@/components/settings/SettingsNav';
import { AccountSection } from '@/components/settings/AccountSection';
import { AboutYouSection } from '@/components/settings/AboutYouSection';
import {
  ActionButtonRow,
  ActionLinkRow,
  GroupDivider,
  SelectRow,
  SettingGroup,
  SettingSection,
  ToggleRow,
} from '@/components/settings/primitives';

const LearnerOnboardingComponent = dynamic(() => import('@/components/LearnerOnboarding'), { ssr: false });
// 设置页会员/充积分入口也要能唤起付费拦截页（usePaywall 全局状态）
const PaywallDialog = dynamic(() => import('@/components/points/PaywallDialog').then(m => ({ default: m.PaywallDialog })), { ssr: false });
const IntentDialogContainer = dynamic(
  () => import('@/components/intent/IntentDialogContainer').then((m) => ({ default: m.IntentDialogContainer })),
  { ssr: false },
);
const WechatQrAuthDialog = dynamic(() => import('@/components/WechatQrAuthDialog'), { ssr: false });
const WECHAT_LOGIN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_WECHAT_LOGIN === 'true';

const S = COPY.settings;
const APP_VERSION = '1.0.0';

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

export default function SettingsPage() {
  const { user, isAuthenticated, isCheckingAuth, updateProfile, logout, saveLearnerProfile } = useAuth();
  const { enabled: adminLensEnabled, setEnabled: setAdminLensEnabled } = useAdminLens();
  const router = useRouter();
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [defaultModelId, setDefaultModelId] = useState('');
  const [profileForm, setProfileForm] = useState<ProfileForm>(DEFAULT_PROFILE_FORM);
  const [loading, setLoading] = useState(true);
  const [savingSetting, setSavingSetting] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [saveMessage, setSaveMessage] = useState<BannerMessage | null>(null);
  const [showLearnerEdit, setShowLearnerEdit] = useState(false);
  const [showIntentDialog, setShowIntentDialog] = useState(false);
  const [showWechatQr, setShowWechatQr] = useState(false);

  // R9-2 修返回 bug：永远渲染 button + onClick handleBack，内部按 history.length
  // 决定 router.back() 还是 push('/')（曾用 canGoBack state 首渲染出死链）。
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
        const response = await fetch('/api/llm/models');
        const data = (await response.json()) as {
          models?: Array<{ id?: string; name?: string; recommended?: boolean }>;
          defaultModel?: string;
        };
        if (!alive) return;
        const nextDefaultModel = data.defaultModel?.trim() || '';
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
      showMessage('success', S.toastSaved);
    } catch {
      showMessage('error', S.toastSaveFailed);
    } finally {
      setSavingSetting(false);
    }
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

      showMessage(success ? 'success' : 'error', success ? S.toastProfileSaved : S.toastProfileFailed);
    } catch {
      showMessage('error', S.toastProfileFailed);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    showMessage('success', S.toastLoggedOut);
  };

  const navItems = useMemo<SettingsNavItem[]>(() => {
    const items: SettingsNavItem[] = [{ id: 'account', label: S.nav.account }];
    if (isAuthenticated) {
      items.push({ id: 'about', label: S.nav.about });
    }
    items.push({ id: 'prefs', label: S.nav.prefs });
    if (isAuthenticated) {
      items.push({ id: 'points', label: S.nav.points });
    }
    items.push({ id: 'import', label: S.nav.import }, { id: 'more', label: S.nav.more });
    return items;
  }, [isAuthenticated]);

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
    ? defaultModelName ? S.prefs.modelAutoWithDefault(defaultModelName) : S.prefs.modelAuto
    : (modelOptions.find((model) => model.id === settings.modelPreference)?.name || S.prefs.modelAuto);

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-10 border-b border-divider bg-paper/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center px-5">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-divider bg-card text-ink transition-all hover:border-pine hover:text-pine hover:bg-pine/5 active:scale-95"
            aria-label={S.backAria}
            title={S.backAria}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 text-center text-[16px] font-semibold tracking-[-0.012em] text-ink">{S.title}</div>
          <div className="w-9" />
        </div>
      </header>

      {/* 右上角小 toast（slide-in，macOS / Stripe 风），不阻塞当前操作 */}
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

      <div className="mx-auto grid w-full max-w-4xl grid-cols-1 px-5 pb-16 pt-8 md:grid-cols-[168px_minmax(0,1fr)] md:gap-10">
        <aside className="hidden md:block">
          <SettingsNav items={navItems} />
        </aside>

        <main className="flex w-full max-w-2xl flex-col gap-9">
          <AccountSection
            user={user}
            isAuthenticated={isAuthenticated}
            profileForm={profileForm}
            savingProfile={savingProfile}
            wechatEnabled={WECHAT_LOGIN_ENABLED}
            wechatBindLabel={COPY.wechatQr.bindAction}
            onFieldChange={(field, value) => setProfileForm((prev) => ({ ...prev, [field]: value }))}
            onSaveProfile={handleProfileSave}
            onShowWechat={() => setShowWechatQr(true)}
            onLogout={handleLogout}
          />

          {isAuthenticated ? (
            <AboutYouSection
              profile={user?.learnerProfile}
              saveLearnerProfile={saveLearnerProfile}
              onEditProfile={() => setShowLearnerEdit(true)}
              onOpenCoach={() => setShowIntentDialog(true)}
            />
          ) : null}

          {user?.role === 'admin' ? (
            <SettingSection
              caption={COPY.adminAi.settingsCaption}
              description={COPY.adminAi.settingsDescription}
            >
              <SettingGroup>
                <ToggleRow
                  label={COPY.adminAi.managementView}
                  hint={COPY.adminAi.managementViewHint}
                  checked={adminLensEnabled}
                  onChange={setAdminLensEnabled}
                />
                <GroupDivider />
                <ActionLinkRow href="/admin/ai-control" label={COPY.adminAi.openControlCenter} />
              </SettingGroup>
            </SettingSection>
          ) : null}

          <SettingSection
            id="prefs"
            caption={S.prefs.caption}
            description={S.prefs.description}
          >
            <SettingGroup>
              <SelectRow
                label={S.prefs.modelLabel}
                value={settings.modelPreference}
                displayValue={selectedModelLabel}
                disabled={savingSetting}
                onChange={(value) => updateSetting('modelPreference', value)}
                options={[
                  { value: AI_MODEL_AUTO_VALUE, label: defaultModelName ? S.prefs.modelAutoWithDefault(defaultModelName) : S.prefs.modelAutoRecommended },
                  ...modelOptions.map((model) => ({
                    value: model.id,
                    label: `${model.name}${model.recommended ? S.prefs.modelRecommendedSuffix : ''}`,
                  })),
                ]}
              />
              <GroupDivider />
              <ToggleRow
                label={S.prefs.timestampsLabel}
                hint={S.prefs.timestampsHint}
                checked={settings.tutorShowTimestamps}
                disabled={savingSetting}
                onChange={(checked) => updateSetting('tutorShowTimestamps', checked)}
              />
              <GroupDivider />
              <ToggleRow
                label={S.prefs.thinkingLabel}
                hint={S.prefs.thinkingHint}
                checked={settings.tutorThinkingGuide}
                disabled={savingSetting}
                onChange={(checked) => updateSetting('tutorThinkingGuide', checked)}
              />
              <GroupDivider />
              <ToggleRow
                label={S.prefs.autoSaveLabel}
                hint={S.prefs.autoSaveHint}
                checked={settings.autoSave}
                disabled={savingSetting}
                onChange={(checked) => updateSetting('autoSave', checked)}
              />
              <GroupDivider />
              <ToggleRow
                label={S.prefs.classCheckLabel}
                hint={S.prefs.classCheckHint}
                checked={settings.classCheckEnabled}
                disabled={savingSetting}
                onChange={(checked) => updateSetting('classCheckEnabled', checked)}
              />
            </SettingGroup>
          </SettingSection>

          {/* 积分区块：余额 / 免费录课进度 / 流水；未登录时组件内静默隐藏。
              外层 div 提供锚点，内容隐藏时点击导航也只是停在空锚点，不报错。 */}
          <div id="points" className="scroll-mt-24">
            <PointsSettingsSection />
          </div>

          <SettingSection
            id="import"
            caption={S.import.caption}
            description={S.import.description}
          >
            <SettingGroup>
              <div className="px-5 pb-4 pt-4">
                <div className="pb-2.5 text-[14px] font-medium text-ink">{S.import.cookieLabel}</div>
                <textarea
                  value={settings.bilibiliCookie}
                  onChange={(event) => setSettings((prev) => ({ ...prev, bilibiliCookie: event.target.value }))}
                  onBlur={() => updateSetting('bilibiliCookie', settings.bilibiliCookie.trim())}
                  placeholder={S.import.cookiePlaceholder}
                  rows={3}
                  disabled={savingSetting}
                  className="w-full resize-none rounded-xl border border-divider bg-paper px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none transition-all placeholder:text-ink-muted/60 focus:border-pine/50 focus:bg-card focus:ring-2 focus:ring-pine/15"
                />
                <div className="pt-2 text-[11.5px] text-ink-muted">{S.import.cookieNote}</div>
              </div>

              {settings.bilibiliCookie ? (
                <>
                  <GroupDivider />
                  <ActionButtonRow
                    label={S.import.clearCookie}
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
                  {S.import.helpToggle}
                </summary>
                <ol className="mt-3 list-decimal space-y-1.5 pl-9 text-[12.5px] leading-relaxed text-ink-secondary marker:font-mono marker:text-pine/60">
                  {S.import.helpSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </details>
            </SettingGroup>
          </SettingSection>

          <SettingSection id="more" caption={S.more.caption}>
            <SettingGroup>
              <ActionLinkRow href="/help" label={S.more.help} />
              <GroupDivider />
              <ActionLinkRow href="/feedback" label={S.more.feedback} />
            </SettingGroup>
          </SettingSection>

          <footer className="pt-1 text-center font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-muted/60">
            {S.footerVersion(APP_VERSION)}
          </footer>
        </main>
      </div>

      {showIntentDialog && (
        <IntentDialogContainer
          open
          onClose={() => setShowIntentDialog(false)}
        />
      )}

      <WechatQrAuthDialog
        open={showWechatQr}
        mode="bind"
        onClose={() => setShowWechatQr(false)}
        onBound={() => showMessage('success', COPY.wechatQr.boundToast)}
      />

      {/* 会员/充积分入口唤起的付费拦截页 */}
      <PaywallDialog />

      {showLearnerEdit && (
        <LearnerOnboardingComponent
          onComplete={async (profile: LearnerProfile) => {
            const success = await saveLearnerProfile(profile);
            if (success) {
              setShowLearnerEdit(false);
              showMessage('success', S.toastLearnerSaved);
            } else {
              showMessage('error', S.toastSaveFailed);
            }
          }}
          onSkip={() => setShowLearnerEdit(false)}
        />
      )}
    </div>
  );
}
