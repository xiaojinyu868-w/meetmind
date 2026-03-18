'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';
import { getPreference, setPreference } from '@/lib/db';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

// 设置项的键名
const SETTINGS_KEYS = {
  AUTO_SAVE: 'settings_auto_save',
  MODEL_PREFERENCE: 'settings_model_preference',
  BILIBILI_COOKIE: 'settings_bilibili_cookie',
};

interface Settings {
  autoSave: boolean;
  modelPreference: string;
  bilibiliCookie: string;
}

const DEFAULT_SETTINGS: Settings = {
  autoSave: true,
  modelPreference: 'auto',
  bilibiliCookie: '',
};

export default function SettingsPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 加载设置
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [autoSave, modelPreference, bilibiliCookie] = await Promise.all([
          getPreference(SETTINGS_KEYS.AUTO_SAVE, DEFAULT_SETTINGS.autoSave),
          getPreference(SETTINGS_KEYS.MODEL_PREFERENCE, DEFAULT_SETTINGS.modelPreference),
          getPreference(SETTINGS_KEYS.BILIBILI_COOKIE, DEFAULT_SETTINGS.bilibiliCookie),
        ]);

        setSettings({
          autoSave,
          modelPreference,
          bilibiliCookie,
        });
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, []);

  // 保存单个设置
  const updateSetting = async <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const keyMap: Record<keyof Settings, string> = {
      autoSave: SETTINGS_KEYS.AUTO_SAVE,
      modelPreference: SETTINGS_KEYS.MODEL_PREFERENCE,
      bilibiliCookie: SETTINGS_KEYS.BILIBILI_COOKIE,
    };

    setSaving(true);
    try {
      await setPreference(keyMap[key], value);
      setSettings(prev => ({ ...prev, [key]: value }));
      setSaveMessage({ type: 'success', text: '设置已保存' });
      setTimeout(() => setSaveMessage(null), 2000);
    } catch (error) {
      console.error('Failed to save setting:', error);
      setSaveMessage({ type: 'error', text: '保存失败，请重试' });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#232322]"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航 */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href="/"
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">设置</h1>
        </div>
      </header>

      {/* 内容区域 */}
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* 保存提示 */}
        {saveMessage && (
          <div className={`fixed top-20 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded-lg z-50 ${
            saveMessage.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
          }`}>
            {saveMessage.text}
          </div>
        )}

        {/* 用户信息卡片 */}
        {isAuthenticated && user && (
          <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-[#FDF3C0] rounded-full flex items-center justify-center">
                <Avatar className="w-full h-full">
                  {user.avatar ? (
                    <AvatarImage src={user.avatar} alt={user.nickname} className="object-cover" />
                  ) : null}
                  <AvatarFallback className="bg-transparent text-2xl">👤</AvatarFallback>
                </Avatar>
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-gray-900">{user.nickname}</h3>
                <p className="text-sm text-gray-500">{user.email || user.phone || '未绑定'}</p>
              </div>
              <Link
                href="/profile"
                className="text-sm text-[#787774] hover:text-[#232322]"
              >
                编辑资料
              </Link>
            </div>
          </section>
        )}

        {/* 通用设置 */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-100">
          <h2 className="px-4 py-3 text-sm font-medium text-gray-500 border-b border-gray-100">
            通用设置
          </h2>
          
          <div className="divide-y divide-gray-100">
            {/* 自动保存 */}
            <SettingToggle
              label="自动保存"
              description="自动保存对话记录和学习进度"
              checked={settings.autoSave}
              onChange={(checked) => updateSetting('autoSave', checked)}
              disabled={saving}
            />
          </div>
        </section>

        {/* AI 设置 */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-100">
          <h2 className="px-4 py-3 text-sm font-medium text-gray-500 border-b border-gray-100">
            AI 助手
          </h2>
          
          <div className="divide-y divide-gray-100">
            {/* 模型偏好 */}
            <div className="px-4 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">默认模型</p>
                  <p className="text-xs text-gray-500 mt-0.5">选择 AI 助手使用的模型</p>
                </div>
                <select
                  value={settings.modelPreference}
                  onChange={(e) => updateSetting('modelPreference', e.target.value)}
                  disabled={saving}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#232322] focus:border-transparent"
                >
                  <option value="auto">自动选择</option>
                  <option value="qwen3.5-plus">通义千问 3.5 Plus（推荐）</option>
                  <option value="qwen3-vl-plus-2025-12-19">通义千问 3 VL（多模态）</option>
                  <option value="qwen3-max-2026-01-23">通义千问 3 Max（思考模式）</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* 视频导入设置 */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-100">
          <h2 className="px-4 py-3 text-sm font-medium text-gray-500 border-b border-gray-100">
            视频导入
          </h2>

          <div className="divide-y divide-gray-100">
            <div className="px-4 py-4 space-y-3">
              <div>
                <p className="text-sm font-medium text-gray-900">B站 Cookie</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  配置后可导入更多B站视频。Cookie 仅存储在你的浏览器中，不会上传到服务器保存。
                </p>
              </div>
              <textarea
                value={settings.bilibiliCookie}
                onChange={(e) => setSettings(prev => ({ ...prev, bilibiliCookie: e.target.value }))}
                onBlur={() => updateSetting('bilibiliCookie', settings.bilibiliCookie.trim())}
                placeholder="粘贴你的 B站 Cookie（包含 SESSDATA、bili_jct 等字段）"
                rows={3}
                disabled={saving}
                className="w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#232322] focus:border-transparent resize-none placeholder:text-gray-400"
              />
              <details className="text-xs text-gray-500">
                <summary className="cursor-pointer hover:text-[#232322] transition-colors">如何获取 Cookie？</summary>
                <ol className="mt-2 ml-4 space-y-1 list-decimal">
                  <li>用浏览器登录 <a href="https://www.bilibili.com" target="_blank" rel="noopener noreferrer" className="text-[#787774] underline">bilibili.com</a></li>
                  <li>按 F12 打开开发者工具</li>
                  <li>切换到「应用」(Application) 标签</li>
                  <li>左侧找到 Cookie → https://www.bilibili.com</li>
                  <li>复制 SESSDATA、bili_jct、DedeUserID 的值，格式如：<br/><code className="bg-gray-100 px-1 rounded">SESSDATA=xxx; bili_jct=xxx; DedeUserID=xxx</code></li>
                </ol>
              </details>
              {settings.bilibiliCookie && (
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-green-400"></span>
                  <span className="text-xs text-green-600">Cookie 已配置</span>
                  <button
                    onClick={() => updateSetting('bilibiliCookie', '')}
                    className="ml-auto text-xs text-red-400 hover:text-red-600 transition-colors"
                  >
                    清除
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 关于 */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-100">
          <h2 className="px-4 py-3 text-sm font-medium text-gray-500 border-b border-gray-100">
            关于
          </h2>
          
          <div className="divide-y divide-gray-100">
            <Link href="/help" className="block px-4 py-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-900">帮助中心</p>
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
            
            <Link href="/feedback" className="block px-4 py-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-900">意见反馈</p>
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
            
            <div className="px-4 py-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-900">版本</p>
                <p className="text-sm text-gray-500">1.0.0</p>
              </div>
            </div>
          </div>
        </section>

        {/* 底部间距 */}
        <div className="h-8"></div>
      </main>
    </div>
  );
}

// 设置开关组件
function SettingToggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-900">{label}</p>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
        <button
          onClick={() => onChange(!checked)}
          disabled={disabled}
          className={`
            relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
            transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#232322] focus:ring-offset-2
            ${checked ? 'bg-[#232322]' : 'bg-gray-200'}
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          <span
            className={`
              pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0
              transition duration-200 ease-in-out
              ${checked ? 'translate-x-5' : 'translate-x-0'}
            `}
          />
        </button>
      </div>
    </div>
  );
}
