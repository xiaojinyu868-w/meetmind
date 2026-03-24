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
import { RippleButton } from '@/components/ui/ripple-button';

// Performance: Lazy-load agreement modal (contains ~300 lines of legal text)
const AgreementModal = dynamic(() => import('@/components/AgreementModal'), { ssr: false });

type LoginMethod = 'password' | 'code';
type LoginType = 'email' | 'phone';
type AgreementType = 'terms' | 'privacy' | null;

const WECHAT_LOGIN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_WECHAT_LOGIN === 'true';

/**
 * 延迟加载视频背景组件
 * 使用 requestIdleCallback 在空闲时加载视频
 */
function LazyVideoBackground() {
  const [shouldLoadVideo, setShouldLoadVideo] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // 使用 requestIdleCallback 延迟加载视频，优先保证 UI 响应
    const loadVideo = () => setShouldLoadVideo(true);
    
    if ('requestIdleCallback' in window) {
      const idleId = requestIdleCallback(loadVideo, { timeout: 2000 });
      return () => cancelIdleCallback(idleId);
    } else {
      // 降级方案：1秒后加载
      const timer = setTimeout(loadVideo, 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleVideoCanPlay = () => {
    setIsVideoReady(true);
  };

  return (
    <>
      {/* 底层背景色 - 防止任何情况下露出空白 */}
      <div 
        className="absolute inset-0"
        style={{ backgroundColor: '#1a1a2e' }}
      />
      
      {/* 海报图背景 - 始终显示，视频就绪后淡出 */}
      <div 
        className="absolute transition-opacity duration-1000"
        style={{ 
          inset: '-20px', // 扩展边界确保覆盖
          backgroundImage: 'url(/videos/poster.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: isVideoReady ? 0 : 1,
        }}
      />
      
      {/* 视频背景 - 延迟加载，就绪后淡入 */}
      {shouldLoadVideo && (
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          onCanPlay={handleVideoCanPlay}
          className="absolute inset-0 w-full h-full transition-opacity duration-1000"
          style={{ 
            objectFit: 'cover',
            objectPosition: 'center',
            transform: 'scale(1.1)', // 放大10%确保完全覆盖
            opacity: isVideoReady ? 1 : 0,
          }}
        >
          <source src="/videos/video1.mp4" type="video/mp4" />
        </video>
      )}
      
      {/* 渐变遮罩 - 右侧加深提升可读性 */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{ 
          background: 'linear-gradient(to right, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.5) 100%)'
        }} 
      />
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

  // 已登录用户自动跳转（异步检查，不阻塞渲染）
  useEffect(() => {
    if (isAuthenticated) router.push('/app');
  }, [isAuthenticated, router]);

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
      router.replace('/app');
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

    const result = await loginWithCode({
      target,
      code: codeToUse,
      type: loginType === 'email' ? 'email' : 'sms',
      rememberMe
    });

    if (result.success) {
      router.replace('/app');
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
    // 使用 replace 避免返回到登录页，添加 guest=1 参数让 /app 页跳过 Splash
    router.replace('/app?guest=1');
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
    <div 
      className="min-h-screen relative overflow-hidden"
      style={{
        backgroundColor: '#1a1a2e',
      }}
    >
      {/* 延迟加载视频背景 */}
      <LazyVideoBackground />

      {/* 主内容区 */}
      <div className="relative z-10 min-h-screen flex items-center justify-center lg:justify-end px-4 lg:pr-16 xl:pr-24">
        <div className="w-full max-w-[400px] flex flex-col items-center">
          
          {/* Logo - 卡片上方 */}
          <div className="mb-6 flex items-center gap-3 animate-fade-in">
            <div 
              className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-2xl"
              style={{ 
                background: 'linear-gradient(135deg, #F43F5E 0%, #FB7185 100%)',
                boxShadow: '0 10px 40px -10px rgba(244,63,94,0.5)'
              }}
            >
              <span className="text-white font-bold text-3xl">M</span>
            </div>
            <div>
              <span className="font-bold text-3xl text-white drop-shadow-lg">MeetMind</span>
              <p className="text-sm text-white/70">清华北大联合团队打造 - 你的智能同桌</p>
            </div>
          </div>

          {/* 登录卡片 - 毛玻璃效果 */}
          <div 
            className="w-full rounded-3xl p-8 animate-slide-up"
            style={{ 
              backgroundColor: 'rgba(255,255,255,0.6)',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25), 0 8px 32px rgba(255,255,255,0.1) inset',
              border: '1px solid rgba(255,255,255,0.4)'
            }}
          >
            {/* 登录类型切换 */}
            <div className="flex items-center gap-6 mb-5 border-b border-rose-200/50 pb-4">
              <button
                onClick={() => handleLoginTypeChange('email')}
                className="text-base pb-1 border-b-2 transition-all font-medium"
                style={{ 
                  color: loginType === 'email' ? '#E11D48' : '#6B7280',
                  borderColor: loginType === 'email' ? '#E11D48' : 'transparent',
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
                <span className="ml-1 text-xs text-gray-400">(即将开放)</span>
              </button>
            </div>

            {/* 邮箱登录方式切换 */}
            {loginType === 'email' && (
              <div className="flex items-center gap-3 mb-5">
                <button
                  onClick={() => setLoginMethod('code')}
                  className="text-sm px-4 py-1.5 rounded-full transition-all"
                  style={{ 
                    backgroundColor: loginMethod === 'code' ? '#FEE2E2' : 'transparent',
                    color: loginMethod === 'code' ? '#E11D48' : '#6B7280',
                    border: loginMethod === 'code' ? '1px solid #FECACA' : '1px solid transparent'
                  }}
                >
                  验证码登录
                </button>
                <button
                  onClick={() => setLoginMethod('password')}
                  className="text-sm px-4 py-1.5 rounded-full transition-all"
                  style={{ 
                    backgroundColor: loginMethod === 'password' ? '#FEE2E2' : 'transparent',
                    color: loginMethod === 'password' ? '#E11D48' : '#6B7280',
                    border: loginMethod === 'password' ? '1px solid #FECACA' : '1px solid transparent'
                  }}
                >
                  密码登录
                </button>
              </div>
            )}

            {/* 错误提示 */}
            {error && (
              <div className="mb-4 p-3 rounded-xl text-sm bg-red-50 border border-red-200 text-red-600">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* 邮箱/手机号输入 */}
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700">
                  {loginType === 'email' ? '邮箱地址' : '手机号码'}
                </label>
                <input
                  type={loginType === 'email' ? 'email' : 'tel'}
                  value={currentTarget}
                  onChange={(e) => loginType === 'email' ? setEmail(e.target.value) : setPhone(e.target.value)}
                  placeholder={loginType === 'email' ? '请输入邮箱地址' : '请输入手机号码'}
                  required
                  className="w-full px-4 py-3.5 rounded-xl transition-all focus:outline-none bg-white border-2 border-rose-100 focus:border-rose-400 focus:ring-4 focus:ring-rose-100 text-gray-800 placeholder-gray-400"
                />
              </div>

              {/* 密码输入 */}
              {loginMethod === 'password' && loginType === 'email' && (
                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-700">密码</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入密码"
                    required
                    className="w-full px-4 py-3.5 rounded-xl transition-all focus:outline-none bg-white border-2 border-rose-100 focus:border-rose-400 focus:ring-4 focus:ring-rose-100 text-gray-800 placeholder-gray-400"
                  />
                </div>
              )}

              {/* 验证码输入 */}
              {(loginMethod === 'code' || loginType === 'phone') && (
                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-700">
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
                      className="flex-1 px-4 py-3.5 rounded-xl transition-all focus:outline-none bg-white border-2 border-rose-100 focus:border-rose-400 focus:ring-4 focus:ring-rose-100 text-gray-800 placeholder-gray-400"
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
                    className="w-4 h-4 rounded border-rose-300 text-rose-500 focus:ring-rose-400"
                  />
                  <span className="text-gray-600">记住登录30天</span>
                </label>
                {loginMethod === 'password' && (
                  <Link href="/forgot-password" className="text-rose-500 hover:text-rose-600 hover:underline">
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
                className="w-full"
                style={{ 
                  background: 'linear-gradient(135deg, #E11D48 0%, #F43F5E 100%)',
                  boxShadow: '0 10px 30px -5px rgba(225,29,72,0.4)'
                }}
              >
                {loginMethod === 'code' ? '登录 / 注册' : '登录'}
              </RippleButton>

              {/* 验证码登录提示 */}
              {loginMethod === 'code' && (
                <p className="text-center text-xs text-gray-500">
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
                访客模式体验
              </RippleButton>
            </form>

            {/* 微信登录 */}
            {WECHAT_LOGIN_ENABLED && (wechatAuthUrl || wechatOnly) && (
              <div className="mt-5 pt-5 border-t border-rose-200/50">
                {wechatAuthUrl ? (
                  <a
                    href={wechatAuthUrl}
                    className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl transition-all bg-[#07C160] hover:bg-[#06AE56] text-white font-medium"
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
                    className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl transition-all bg-[#07C160] hover:bg-[#06AE56] text-white font-medium"
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
            <p className="mt-5 text-center text-xs leading-relaxed text-gray-500">
              登录即表示您同意{' '}
              <button 
                type="button"
                onClick={() => setShowAgreement('terms')} 
                className="text-rose-500 hover:underline"
              >
                用户协议
              </button>
              {' '}和{' '}
              <button 
                type="button"
                onClick={() => setShowAgreement('privacy')} 
                className="text-rose-500 hover:underline"
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
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#07C160]/10">
                <svg className="h-8 w-8 text-[#07C160]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178A1.17 1.17 0 014.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178 1.17 1.17 0 01-1.162-1.178c0-.651.52-1.18 1.162-1.18z"/>
                </svg>
              </div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">请在微信中打开</h3>
              <p className="mb-1 text-sm text-gray-500">
                微信登录需要在微信内置浏览器中完成
              </p>
              <p className="mb-5 text-sm text-gray-500">
                请复制以下链接，在微信中打开：
              </p>
              <div className="mb-4 w-full rounded-lg bg-gray-50 px-3 py-2.5">
                <p className="break-all text-xs text-gray-600 select-all">
                  {typeof window !== 'undefined' ? window.location.origin + '/login' : 'https://capture.meetmind.online/login'}
                </p>
              </div>
              <div className="flex w-full gap-3">
                <button
                  type="button"
                  onClick={() => setShowWechatGuide(false)}
                  className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
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
                  className="flex-1 rounded-xl bg-[#07C160] py-2.5 text-sm font-medium text-white transition hover:bg-[#06AE56]"
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
      <div 
        className="min-h-screen flex items-center justify-center"
        style={{ 
          backgroundColor: '#1a1a2e',
          backgroundImage: 'url(/videos/poster.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full animate-bounce bg-rose-400" style={{ animationDelay: '0ms' }} />
          <div className="w-3 h-3 rounded-full animate-bounce bg-rose-300" style={{ animationDelay: '150ms' }} />
          <div className="w-3 h-3 rounded-full animate-bounce bg-rose-200" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
