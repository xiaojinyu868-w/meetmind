'use client';

/**
 * 登录页面 - 视频背景 + 玻璃态设计
 * 支持：邮箱密码登录、邮箱验证码登录、手机验证码登录
 * 验证码登录支持自动注册新用户
 */

import { useState, useEffect, Suspense, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';

type LoginMethod = 'password' | 'code';
type LoginType = 'email' | 'phone';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, loginWithCode, isAuthenticated, isLoading, getWechatAuthUrl } = useAuth();
  
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('code');
  const [loginType, setLoginType] = useState<LoginType>('email');
  
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [wechatAuthUrl, setWechatAuthUrl] = useState<string | null>(null);
  
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const isAutoLoginTriggered = useRef(false);

  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) setError(decodeURIComponent(errorParam));
  }, [searchParams]);

  useEffect(() => {
    if (!isLoading && isAuthenticated) router.push('/app');
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    getWechatAuthUrl().then(setWechatAuthUrl);
  }, [getWechatAuthUrl]);

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

    setIsSendingCode(true);
    setError('');

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

      if (result.success) {
        setCountdown(60);
      } else {
        setError(result.error || '发送失败');
        if (result.retryAfter) setCountdown(result.retryAfter);
      }
    } catch {
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

  const handleGuestMode = () => router.push('/app');

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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full animate-bounce bg-rose-400" style={{ animationDelay: '0ms' }} />
          <div className="w-3 h-3 rounded-full animate-bounce bg-rose-300" style={{ animationDelay: '150ms' }} />
          <div className="w-3 h-3 rounded-full animate-bounce bg-rose-200" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    );
  }

  const currentTarget = loginType === 'email' ? email : phone;

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* 视频背景 - 完全覆盖，裁剪黑边 */}
      <video
        autoPlay
        muted
        loop
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
        style={{ 
          objectFit: 'cover',
          objectPosition: 'center center',
          transform: 'scale(1.05)'  // 稍微放大裁剪边缘黑框
        }}
        poster="/videos/poster.jpg"
      >
        <source src="/videos/video1.mp4" type="video/mp4" />
      </video>
      
      {/* 渐变遮罩 - 右侧加深提升可读性 */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{ 
          background: 'linear-gradient(to right, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.5) 100%)'
        }} 
      />

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
              <p className="text-sm text-white/70">AI 智能学习助手</p>
            </div>
          </div>

          {/* 登录卡片 - 玻璃态 */}
          <div 
            className="w-full rounded-3xl p-8 backdrop-blur-xl animate-slide-up"
            style={{ 
              backgroundColor: 'rgba(255,241,242,0.85)',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)'
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
                onClick={() => handleLoginTypeChange('phone')}
                className="text-base pb-1 border-b-2 transition-all font-medium"
                style={{ 
                  color: loginType === 'phone' ? '#E11D48' : '#6B7280',
                  borderColor: loginType === 'phone' ? '#E11D48' : 'transparent',
                }}
              >
                手机号登录
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
                    <button
                      type="button"
                      onClick={sendVerificationCode}
                      disabled={isSendingCode || countdown > 0}
                      className="px-4 py-3.5 rounded-xl font-medium whitespace-nowrap transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-rose-100 text-rose-600 hover:bg-rose-200 border border-rose-200"
                    >
                      {isSendingCode ? '发送中...' : countdown > 0 ? `${countdown}s` : '获取验证码'}
                    </button>
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
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-4 px-4 font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed text-white text-base shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0"
                style={{ 
                  background: 'linear-gradient(135deg, #E11D48 0%, #F43F5E 100%)',
                  boxShadow: '0 10px 30px -5px rgba(225,29,72,0.4)'
                }}
              >
                {isSubmitting ? '登录中...' : (loginMethod === 'code' ? '登录 / 注册' : '登录')}
              </button>

              {/* 验证码登录提示 */}
              {loginMethod === 'code' && (
                <p className="text-center text-xs text-gray-500">
                  新用户使用验证码登录将自动创建账户
                </p>
              )}

              {/* 访客模式 */}
              <button
                type="button"
                onClick={handleGuestMode}
                className="w-full py-3.5 px-4 font-medium rounded-xl transition-all bg-white border-2 border-rose-200 text-rose-500 hover:bg-rose-50 hover:border-rose-300"
              >
                访客模式体验
              </button>
            </form>

            {/* 微信登录 */}
            {wechatAuthUrl && (
              <div className="mt-5 pt-5 border-t border-rose-200/50">
                <a
                  href={wechatAuthUrl}
                  className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl transition-all bg-[#07C160] hover:bg-[#06AE56] text-white font-medium"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178A1.17 1.17 0 014.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178 1.17 1.17 0 01-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 01.598.082l1.584.926a.272.272 0 00.14.045c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 01-.023-.156.49.49 0 01.201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.269-.03-.406-.03zm-2.344 3.356c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.969-.982z"/>
                  </svg>
                  <span>微信登录</span>
                </a>
              </div>
            )}

            {/* 协议提示 */}
            <p className="mt-5 text-center text-xs leading-relaxed text-gray-500">
              登录即表示您同意{' '}
              <Link href="/terms" className="text-rose-500 hover:underline">用户协议</Link>
              {' '}和{' '}
              <Link href="/privacy" className="text-rose-500 hover:underline">隐私政策</Link>
            </p>
          </div>
        </div>
      </div>

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
      <div className="min-h-screen flex items-center justify-center bg-black">
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
