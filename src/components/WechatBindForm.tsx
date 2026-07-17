'use client';

import { useState, useRef, useEffect } from 'react';

interface WechatBindFormProps {
  linkToken: string;
  onBound: (nickname: string) => void;
}

type FallbackMode = 'code' | 'password';

const TOKEN_KEY = 'meetmind_access_token';

export default function WechatBindForm({ linkToken, onBound }: WechatBindFormProps) {
  const [wechatLoading, setWechatLoading] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [fallbackMode, setFallbackMode] = useState<FallbackMode>('code');

  // 验证码模式
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [codeSending, setCodeSending] = useState(false);

  // 密码模式
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // 共用
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function startCountdown() {
    setCountdown(60);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  /**
   * 使用微信登录 — 获取授权 URL 并跳转
   */
  async function handleWechatLogin() {
    setWechatLoading(true);
    setError('');

    try {
      const res = await fetch(`/api/wechat/bind/callback?action=authorize&linkToken=${encodeURIComponent(linkToken)}`);
      const data = await res.json();

      if (!data.success || !data.authUrl) {
        setError(data.error || '微信登录暂不可用');
        setWechatLoading(false);
        return;
      }

      // 跳转到微信授权页
      window.location.href = data.authUrl;
    } catch {
      setError('网络错误，请重试');
      setWechatLoading(false);
    }
  }

  async function handleSendCode() {
    if (!email.trim() || codeSending || countdown > 0) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError('请输入正确的邮箱地址');
      return;
    }

    setCodeSending(true);
    setError('');

    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: email.trim(), type: 'email', purpose: 'login' }),
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error || '发送失败');
        return;
      }

      startCountdown();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setCodeSending(false);
    }
  }

  async function handleFallbackSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      let payload: Record<string, string>;

      if (fallbackMode === 'code') {
        if (!email.trim() || !code.trim()) return;
        payload = { mode: 'code', email: email.trim(), code: code.trim(), linkToken };
      } else {
        if (!username.trim() || !password.trim()) return;
        payload = { mode: 'password', username: username.trim(), password: password.trim(), linkToken };
      }

      const res = await fetch('/api/wechat/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || '绑定失败');
        return;
      }

      const accessToken = data.accessToken || data.token;
      if (accessToken) {
        try {
          localStorage.setItem(TOKEN_KEY, accessToken);
          localStorage.removeItem('auth_token');
          localStorage.removeItem('refresh_token');
        } catch {
          // localStorage not available
        }
      }

      onBound(data.user?.nickname || '');
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 grid gap-3">
      {/* 主按钮：使用微信登录 */}
      <button
        type="button"
        onClick={handleWechatLogin}
        disabled={wechatLoading}
        className="flex items-center justify-center gap-2 rounded-2xl bg-[#2D6A4F] px-4 py-3.5 text-sm font-medium text-white disabled:opacity-60"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
          <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05a6.327 6.327 0 0 1-.261-1.789c0-3.723 3.541-6.743 7.91-6.743.267 0 .526.022.789.04C17.085 4.527 13.264 2.188 8.691 2.188zm-2.79 4.408c.558 0 1.01.452 1.01 1.01 0 .558-.452 1.01-1.01 1.01-.558 0-1.01-.452-1.01-1.01 0-.558.452-1.01 1.01-1.01zm5.144 0c.558 0 1.01.452 1.01 1.01 0 .558-.452 1.01-1.01 1.01-.558 0-1.01-.452-1.01-1.01 0-.558.452-1.01 1.01-1.01zm5.105 3.29c-3.837 0-6.95 2.708-6.95 6.048 0 3.34 3.113 6.047 6.95 6.047.77 0 1.505-.132 2.212-.35a.72.72 0 0 1 .588.082l1.578.927a.267.267 0 0 0 .138.045.241.241 0 0 0 .24-.245c0-.06-.023-.12-.039-.176l-.326-1.231a.487.487 0 0 1 .176-.547C20.928 19.6 22 17.857 22 15.934c0-3.34-3.113-6.048-6.95-6.048zm-2.872 3.453c.462 0 .837.375.837.837a.838.838 0 0 1-.837.837.838.838 0 0 1-.837-.837c0-.462.375-.837.837-.837zm4.698 0c.462 0 .837.375.837.837a.838.838 0 0 1-.837.837.838.838 0 0 1-.837-.837c0-.462.375-.837.837-.837z" />
        </svg>
        {wechatLoading ? '正在跳转...' : '使用微信登录'}
      </button>

      {error ? (
        <p className="text-xs text-vermilion">{error}</p>
      ) : null}

      {/* 分割线 */}
      <div className="flex items-center gap-3 py-1">
        <div className="h-px flex-1 bg-stone-100" />
        <button
          type="button"
          onClick={() => setShowFallback(!showFallback)}
          className="text-xs text-stone-400"
        >
          {showFallback ? '收起' : '其他登录方式'}
        </button>
        <div className="h-px flex-1 bg-stone-100" />
      </div>

      {/* 备选登录方式 */}
      {showFallback ? (
        <form onSubmit={handleFallbackSubmit} className="grid gap-3">
          {fallbackMode === 'code' ? (
            <>
              <input
                type="email"
                placeholder="输入你的邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none placeholder:text-stone-400 focus:border-stone-400 focus:bg-white"
                autoComplete="email"
                disabled={loading}
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="6 位验证码"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="flex-1 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none placeholder:text-stone-400 focus:border-stone-400 focus:bg-white"
                  autoComplete="one-time-code"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={!email.trim() || codeSending || countdown > 0 || loading}
                  className="shrink-0 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700 disabled:opacity-40"
                >
                  {codeSending ? '发送中' : countdown > 0 ? `${countdown}s` : '发送验证码'}
                </button>
              </div>
            </>
          ) : (
            <>
              <input
                type="text"
                placeholder="邮箱或用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none placeholder:text-stone-400 focus:border-stone-400 focus:bg-white"
                autoComplete="username"
                disabled={loading}
              />
              <input
                type="password"
                placeholder="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none placeholder:text-stone-400 focus:border-stone-400 focus:bg-white"
                autoComplete="current-password"
                disabled={loading}
              />
            </>
          )}

          <button
            type="submit"
            disabled={
              loading ||
              (fallbackMode === 'code' ? !email.trim() || code.length !== 6 : !username.trim() || !password.trim())
            }
            className="rounded-2xl bg-stone-950 px-4 py-3.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading
              ? '绑定中...'
              : fallbackMode === 'code'
                ? '验证并绑定'
                : '登录并绑定'}
          </button>

          <button
            type="button"
            onClick={() => {
              setFallbackMode(fallbackMode === 'code' ? 'password' : 'code');
              setError('');
            }}
            className="text-xs text-stone-400 underline underline-offset-2"
          >
            {fallbackMode === 'code' ? '使用密码登录' : '使用邮箱验证码'}
          </button>

          <p className="text-xs leading-5 text-stone-400">
            {fallbackMode === 'code'
              ? '没有账号也没关系，输入邮箱会自动创建。'
              : '绑定后，发给服务号的所有内容都会自动进入你的收集流。'}
          </p>
        </form>
      ) : null}
    </div>
  );
}
