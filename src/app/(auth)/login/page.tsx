'use client';

/**
 * 登录页面 - 视频背景 + 玻璃态设计
 * 支持：邮箱密码登录、邮箱验证码登录、手机验证码登录
 * 验证码登录支持自动注册新用户
 * 
 * 性能优化：
 * - 视频延迟加载，先显示海报图
 * - 移除 isLoading 阻塞，立即渲染 UI
 * - 微信授权 URL 异步获取，不阻塞渲染
 * - 发送验证码使用乐观更新，即时响应
 * - 按钮使用涟漪效果，提供即时视觉反馈
 */

import { useState, useEffect, Suspense, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';
import { COPY } from '@/lib/ui/copy';
import { RippleButton } from '@/components/ui/ripple-button';
import { OctoAvatar } from '@/components/ui/octo-avatar';

// Performance: Lazy-load agreement modal (contains ~300 lines of legal text)
const AgreementModal = dynamic(() => import('@/components/AgreementModal'), { ssr: false });

type LoginMethod = 'password' | 'code';
type LoginType = 'email' | 'phone';
type AgreementType = 'terms' | 'privacy' | null;

const WECHAT_LOGIN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_WECHAT_LOGIN === 'true';

/** v7 登录背景：米白纸感 + 极淡墨绿/朱批光晕，让"安静"也有智能信号 */
function LazyVideoBackground() {
  return (
    <>
      {/* 米白底（v7 paper） */}
      <div className="absolute inset-0 bg-paper" />

      {/* 极淡墨绿 / 朱批光晕（仅装饰，不抢注意力） */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 50% 40% at 20% 30%, rgba(45,79,62,0.10) 0%, transparent 60%),
            radial-gradient(ellipse 50% 40% at 80% 70%, rgba(181,72,60,0.08) 0%, transparent 60%)
          `,
        }}
      />

      {/* 极淡纸纹 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(28,27,25,0.04) 1px, transparent 0)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* 装饰圈（更弱 + 暖色） */}
      <div className="absolute left-8 top-8 h-24 w-24 rounded-full border border-divider/60" />
      <div className="absolute bottom-10 right-10 h-36 w-36 rounded-full border border-divider/60" />
      <div className="absolute inset-x-0 top-0 h-px bg-divider/60" />
    </>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, loginWithCode, isAuthenticated, getWechatAuthUrl } = useAuth();
  
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('code');
  const [loginType, setLoginType] = useState<LoginType>('email');
  
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGuestLoading, setIsGuestLoading] = useState(false);
  const [wechatAuthUrl, setWechatAuthUrl] = useState<string | null>(null);
  const [wechatOnly, setWechatOnly] = useState(false);
  const [showWechatGuide, setShowWechatGuide] = useState(false);
  const [showAgreement, setShowAgreement] = useState<AgreementType>(null);
  
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const isAutoLoginTriggered = useRef(false);

  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) setError(decodeURIComponent(errorParam));
  }, [searchParams]);

  /**
   * 计算登录成功后该跳哪。
   * - 优先走 ?next=... （来自分享页 / 受保护路由的回流），但只允许相对路径，
   *   防御 open-redirect（攻击者构造 ?next=https://evil.com）
   * - 否则默认 /app
   */
  const resolveRedirect = useCallback((): string => {
    const next = searchParams.get('next');
    if (!next) return '/app';
    try {
      const decoded = decodeURIComponent(next);
      // 只接受相对路径（"/" 开头且非 "//"）
      if (decoded.startsWith('/') && !decoded.startsWith('//')) {
        return decoded;
      }
    } catch {
      // decode 失败就 fallback
    }
    return '/app';
  }, [searchParams]);

  // 已登录用户自动跳转（异步检查，不阻塞渲染）
  useEffect(() => {
    if (isAuthenticated) router.push(resolveRedirect());
  }, [isAuthenticated, resolveRedirect, router]);

  // 预加载 /app 页面，提升访客模式跳转速度
  // bundle-preload: Preload on hover/focus for perceived speed
  useEffect(() => {
    router.prefetch('/app');
  }, [router]);

  // 异步获取微信授权 URL，不阻塞 UI 渲染
  useEffect(() => {
    if (!WECHAT_LOGIN_ENABLED || isAuthenticated) {
      setWechatAuthUrl(null);
      setWechatOnly(false);
      return;
    }

    // 直接调用 API 而不是 getWechatAuthUrl()，以便获取 wechatOnly 标记
    const fetchWechatUrl = async () => {
      try {
        const response = await fetch('/api/auth/wechat');
        const data = await response.json();
        if (data.success) {
          setWechatAuthUrl(data.authUrl || null);
          setWechatOnly(!!data.wechatOnly);
        }
      } catch {
        // 静默失败
      }
    };
    
    if ('requestIdleCallback' in window) {
      const idleId = requestIdleCallback(() => { void fetchWechatUrl(); }, { timeout: 3000 });
      return () => cancelIdleCallback(idleId);
    } else {
      const timer = setTimeout(() => { void fetchWechatUrl(); }, 500);
      return () => clearTimeout(timer);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const sendVerificationCode = useCallback(async () => {
    const target = loginType === 'email' ? email : phone;
    
    if (!target) {
      setError(loginType === 'email' ? '请输入邮箱' : '请输入手机号');
      return;
    }

    if (loginType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setError('请输入正确的邮箱格式');
      return;
    }
    if (loginType === 'phone' && !/^1[3-9]\d{9}$/.test(target)) {
      setError('请输入正确的手机号');
      return;
    }

    // 乐观更新：立即显示发送中状态和启动倒计时
    setIsSendingCode(true);
    setError('');
    
    // 立即启动倒计时（乐观更新）
    setCountdown(60);

    try {
      const response = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          type: loginType === 'email' ? 'email' : 'sms',
          purpose: 'login'
        })
      });

      const result = await response.json();

      if (!result.success) {
        // 发送失败，回滚倒计时
        setCountdown(result.retryAfter || 0);
        setError(result.error || '发送失败');
      }
      // 成功时不需要做任何事，乐观更新已经处理了
    } catch {
      // 网络错误，回滚倒计时
      setCountdown(0);
      setError('网络错误，请稍后重试');
    } finally {
      setIsSendingCode(false);
    }
  }, [loginType, email, phone]);

  const handlePasswordLogin = async (): Promise<boolean> => {
    const username = loginType === 'email' ? email : phone;
    const result = await login({ username, password, rememberMe });
    
    if (result.success) {
      router.replace(resolveRedirect());
      return true;
    } else {
      // 检测用户未设置密码的情况，自动切换到验证码登录
      if (result.error?.includes('未设置密码')) {
        setError('该账户未设置密码，已为您切换到验证码登录');
        setLoginMethod('code');
        setPassword('');
        // 2秒后自动清除提示
        setTimeout(() => setError(''), 2000);
        return false;
      }
      setError(result.error || '登录失败');
      return false;
    }
  };

  const handleCodeLogin = async (codeValue?: string): Promise<boolean> => {
    const target = loginType === 'email' ? email : phone;
    const codeToUse = codeValue || code;

    // M7-fix7: 客户端预校验——避免空手点登录打到服务端才 400
    if (!target.trim()) {
      setError(loginType === 'email' ? '请填写邮箱' : '请填写手机号');
      return false;
    }
    if (!codeToUse || codeToUse.length !== 6) {
      setError('请先输入 6 位验证码');
      return false;
    }

    const result = await loginWithCode({
      target,
      code: codeToUse,
      type: loginType === 'email' ? 'email' : 'sms',
      rememberMe
    });

    if (result.success) {
      router.replace(resolveRedirect());
      return true;
    } else {
      setError(result.error || '登录失败');
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      let success = false;
      if (loginMethod === 'password') {
        success = await handlePasswordLogin();
      } else {
        success = await handleCodeLogin();
      }
      // 只有登录失败才恢复按钮
      if (!success) {
        setIsSubmitting(false);
      }
      // 登录成功时保持 isSubmitting=true，直到页面跳转完成
    } catch {
      setError('网络错误，请稍后重试');
      setIsSubmitting(false);
    }
  };

  const handleGuestMode = () => {
    // 立即显示加载状态（涟漪效果会提供即时反馈）
    setIsGuestLoading(true);
    // 使用 replace 避免返回到登录页；entry=demo 让试听入口直接进入 demo 课堂现场
    router.replace('/app?guest=1&entry=demo');
  };

  const handleLoginTypeChange = (type: LoginType) => {
    setLoginType(type);
    setError('');
    setCode('');
    isAutoLoginTriggered.current = false;
    if (type === 'phone') setLoginMethod('code');
  };

  // 验证码输入处理（含自动登录）
  const handleCodeChange = async (value: string) => {
    const newCode = value.replace(/\D/g, '').slice(0, 6);
    setCode(newCode);
    
    // 满6位自动登录
    if (newCode.length === 6 && !isAutoLoginTriggered.current && !isSubmitting) {
      const target = loginType === 'email' ? email : phone;
      if (!target) return;
      
      isAutoLoginTriggered.current = true;
      setError('');
      setIsSubmitting(true);
      
      try {
        const success = await handleCodeLogin(newCode);
        if (!success) {
          setIsSubmitting(false);
          isAutoLoginTriggered.current = false;
        }
      } catch {
        setError('网络错误，请稍后重试');
        setIsSubmitting(false);
        isAutoLoginTriggered.current = false;
      }
    } else if (newCode.length < 6) {
      isAutoLoginTriggered.current = false;
    }
  };

  const currentTarget = loginType === 'email' ? email : phone;

  // 访客模式：不再显示全屏加载，让 /app 页的 Splash 统一处理
  // 这样避免了 login 页 AppLoading → /app 页 Splash 的双重加载问题
  // isGuestLoading 状态仅用于禁用按钮，防止重复点击

  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas">
      {/* 延迟加载视频背景 */}
      <LazyVideoBackground />

      {/* 主内容区 */}
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
        <div className="flex w-full max-w-[400px] flex-col items-start">
          
          {/* Logo - 卡片上方 · v7 用 Octo 替代静态字母 */}
          <div className="mb-6 flex items-center gap-3 animate-fade-in">
            <OctoAvatar mood="idle" size="md" aura priority className="rounded-2xl" />
            <div>
              <span className="text-[26px] font-semibold tracking-display text-ink">MeetMind</span>
              <p className="mt-0.5 text-[13px] text-ink-muted">{COPY.login.subtitle}</p>
            </div>
          </div>

          {/* 登录卡片 - 毛玻璃效果 */}
          <div className="w-full rounded-3xl border border-divider bg-white p-8 animate-slide-up">
            {/* 登录类型切换 */}
            <div className="mb-5 flex items-center gap-6 border-b border-divider pb-4">
              <button
                onClick={() => handleLoginTypeChange('email')}
                className="text-base pb-1 border-b-2 transition-all font-medium"
                style={{ 
                  color: loginType === 'email' ? '#1C1B19' : '#5C5A55',
                  borderColor: loginType === 'email' ? '#1C1B19' : 'transparent',
                }}
              >
                邮箱登录
              </button>
              <button
                disabled
                className="text-base pb-1 border-b-2 transition-all font-medium cursor-not-allowed opacity-50"
                style={{ 
                  color: '#9CA3AF',
                  borderColor: 'transparent',
                }}
                title="即将开放"
              >
                手机号登录
                <span className="ml-1 text-xs text-ink-muted">(即将开放)</span>
              </button>
            </div>

            {/* 邮箱登录方式切换 */}
            {loginType === 'email' && (
              <div className="flex items-center gap-3 mb-5">
                <button
                  onClick={() => setLoginMethod('code')}
                  className="text-sm px-4 py-1.5 rounded-full transition-all"
                  style={{ 
                    backgroundColor: loginMethod === 'code' ? '#1C1B19' : 'transparent',
                    color: loginMethod === 'code' ? '#FFFFFF' : '#5C5A55',
                    border: loginMethod === 'code' ? '1px solid #1C1B19' : '1px solid transparent'
                  }}
                >
                  验证码登录
                </button>
                <button
                  onClick={() => setLoginMethod('password')}
                  className="text-sm px-4 py-1.5 rounded-full transition-all"
                  style={{ 
                    backgroundColor: loginMethod === 'password' ? '#1C1B19' : 'transparent',
                    color: loginMethod === 'password' ? '#FFFFFF' : '#5C5A55',
                    border: loginMethod === 'password' ? '1px solid #1C1B19' : '1px solid transparent'
                  }}
                >
                  密码登录
                </button>
              </div>
            )}

            {/* 错误提示 */}
            {error && (
              <div className="mb-4 p-3 rounded-xl text-sm bg-vermilion-mist/50 border border-vermilion/30 text-vermilion">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* 邮箱/手机号输入 */}
              <div>
                <label className="block text-sm font-medium mb-2 text-ink-secondary">
                  {loginType === 'email' ? '邮箱地址' : '手机号码'}
                </label>
                <input
                  type={loginType === 'email' ? 'email' : 'tel'}
                  value={currentTarget}
                  onChange={(e) => loginType === 'email' ? setEmail(e.target.value) : setPhone(e.target.value)}
                  placeholder={loginType === 'email' ? '请输入邮箱地址' : '请输入手机号码'}
                  required
                  className="w-full rounded-xl border border-divider bg-white px-4 py-3.5 text-ink placeholder:text-ink-muted transition focus:border-ink focus:outline-none"
                />
              </div>

              {/* 密码输入 */}
              {loginMethod === 'password' && loginType === 'email' && (
                <div>
                  <label className="block text-sm font-medium mb-2 text-ink-secondary">密码</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入密码"
                    required
                    className="w-full rounded-xl border border-divider bg-white px-4 py-3.5 text-ink placeholder:text-ink-muted transition focus:border-ink focus:outline-none"
                  />
                </div>
              )}

              {/* 验证码输入 */}
              {(loginMethod === 'code' || loginType === 'phone') && (
                <div>
                  <label className="block text-sm font-medium mb-2 text-ink-secondary">
                    {loginType === 'email' ? '邮箱验证码' : '短信验证码'}
                  </label>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={code}
                      onChange={(e) => handleCodeChange(e.target.value)}
                      placeholder="请输入6位验证码"
                      required
                      maxLength={6}
                      className="flex-1 rounded-xl border border-divider bg-white px-4 py-3.5 text-ink placeholder:text-ink-muted transition focus:border-ink focus:outline-none"
                    />
                    <RippleButton
                      type="button"
                      variant="soft"
                      onClick={sendVerificationCode}
                      disabled={countdown > 0}
                      loading={isSendingCode}
                      className="px-4 whitespace-nowrap"
                    >
                      {countdown > 0 ? `${countdown}s` : '获取验证码'}
                    </RippleButton>
                  </div>
                </div>
              )}

              {/* 记住登录 & 忘记密码 */}
              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 rounded border-divider text-ink focus:ring-ink-muted"
                  />
                  <span className="text-ink-secondary">记住登录30天</span>
                </label>
                {loginMethod === 'password' && (
                  <Link href="/forgot-password" className="text-ink-muted hover:text-ink hover:underline">
                    忘记密码？
                  </Link>
                )}
              </div>

              {/* 登录按钮 */}
              <RippleButton
                type="submit"
                variant="primary"
                size="lg"
                loading={isSubmitting}
                loadingText="登录中..."
                className="w-full bg-ink text-white hover:bg-[#1a1a19]"
              >
                {loginMethod === 'code' ? '登录 / 注册' : '登录'}
              </RippleButton>

              {/* 验证码登录提示 */}
              {loginMethod === 'code' && (
                <p className="text-center text-xs text-ink-muted">
                  新用户使用验证码登录将自动创建账户
                </p>
              )}

              {/* 访客模式 */}
              <RippleButton
                type="button"
                variant="secondary"
                onClick={handleGuestMode}
                disabled={isSubmitting || isGuestLoading}
                loading={isGuestLoading}
                className="w-full"
              >
                {COPY.login.guestCta}
              </RippleButton>
            </form>

            {/* 微信登录 */}
            {WECHAT_LOGIN_ENABLED && (wechatAuthUrl || wechatOnly) && (
              <div className="mt-5 border-t border-divider pt-5">
                {wechatAuthUrl ? (
                  <a
                    href={wechatAuthUrl}
                    className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl transition-all bg-[#2D6A4F] hover:bg-[#06AE56] text-white font-medium"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178A1.17 1.17 0 014.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178 1.17 1.17 0 01-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 01.598.082l1.584.926a.272.272 0 00.14.045c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 01-.023-.156.49.49 0 01.201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.269-.03-.406-.03zm-2.344 3.356c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.969-.982z"/>
                    </svg>
                    <span>微信登录</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowWechatGuide(true)}
                    className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl transition-all bg-[#2D6A4F] hover:bg-[#06AE56] text-white font-medium"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178A1.17 1.17 0 014.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178 1.17 1.17 0 01-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 01.598.082l1.584.926a.272.272 0 00.14.045c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 01-.023-.156.49.49 0 01.201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.269-.03-.406-.03zm-2.344 3.356c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.969-.982z"/>
                    </svg>
                    <span>微信登录</span>
                  </button>
                )}
              </div>
            )}

            {/* 协议提示 */}
            <p className="mt-5 text-center text-xs leading-relaxed text-ink-muted">
              登录即表示您同意{' '}
              <button 
                type="button"
                onClick={() => setShowAgreement('terms')} 
                className="text-ink-secondary hover:text-ink hover:underline"
              >
                用户协议
              </button>
              {' '}和{' '}
              <button 
                type="button"
                onClick={() => setShowAgreement('privacy')} 
                className="text-ink-secondary hover:text-ink hover:underline"
              >
                隐私政策
              </button>
            </p>
          </div>
        </div>
      </div>

      {/* 协议弹窗 - 动态加载 */}
      {showAgreement && <AgreementModal type={showAgreement} onClose={() => setShowAgreement(null)} />}

      {/* 微信登录引导弹窗 */}
      {showWechatGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowWechatGuide(false)}>
          <div
            className="w-full max-w-sm rounded-2xl border border-divider bg-white p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#2D6A4F]/10">
                <svg className="h-8 w-8 text-[#2D6A4F]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178A1.17 1.17 0 014.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178 1.17 1.17 0 01-1.162-1.178c0-.651.52-1.18 1.162-1.18z"/>
                </svg>
              </div>
              <h3 className="mb-2 text-lg font-semibold text-ink">请在微信中打开</h3>
              <p className="mb-1 text-sm text-ink-muted">
                微信登录需要在微信内置浏览器中完成
              </p>
              <p className="mb-5 text-sm text-ink-muted">
                请复制以下链接，在微信中打开：
              </p>
              <div className="mb-4 w-full rounded-lg bg-paper-warm px-3 py-2.5">
                <p className="break-all text-xs text-ink-secondary select-all">
                  {typeof window !== 'undefined' ? window.location.origin + '/login' : 'https://capture.meetmind.online/login'}
                </p>
              </div>
              <div className="flex w-full gap-3">
                <button
                  type="button"
                  onClick={() => setShowWechatGuide(false)}
                  className="flex-1 rounded-xl border border-divider py-2.5 text-sm font-medium text-ink-secondary transition hover:bg-paper-warm"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const url = (typeof window !== 'undefined' ? window.location.origin : 'https://capture.meetmind.online') + '/login';
                    navigator.clipboard?.writeText(url).then(() => {
                      setShowWechatGuide(false);
                      setError('链接已复制，请在微信中粘贴打开');
                    }).catch(() => {
                      // clipboard API 不可用时静默失败
                    });
                  }}
                  className="flex-1 rounded-xl bg-[#2D6A4F] py-2.5 text-sm font-medium text-white transition hover:bg-[#06AE56]"
                >
                  复制链接
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 动画样式 */}
      <style jsx>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.6s ease-out;
        }
        .animate-slide-up {
          animation: slide-up 0.6s ease-out 0.2s both;
        }
      `}</style>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="h-2.5 w-2.5 rounded-full bg-ink animate-[mindBreath_2600ms_ease-in-out_infinite]" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
