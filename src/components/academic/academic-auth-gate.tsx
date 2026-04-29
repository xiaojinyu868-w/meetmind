'use client';

/**
 * Academic 三端（/console /teacher /learn）统一的鉴权门厅：
 *
 * 跟 MeetMind 课堂版的 /login 解耦——不跳转、不走原有 /app 回跳逻辑。
 *
 * 行为：
 *   - SSR 及 CSR 首帧：显示"验证登录状态…"（保证 hydration 一致）
 *   - 已登录：直接渲染 children
 *   - 未登录：就地渲染紧凑的登录/注册表单；成功后 stay，由内层页面按各自逻辑继续
 *
 * 这样做的好处：
 *   - 不受 /login 原有「登录即跳 /app」限制
 *   - 机构主 / 老师 / 学生 的入口完全"自主"
 *   - 邀请链接 /invite?token=xxx 场景下，登录后会留在 /invite 页继续 accept
 */

import { useEffect, useState, type ReactNode, type FormEvent } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';

export function AcademicAuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isCheckingAuth, accessToken } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || isCheckingAuth) {
    return <div className="p-10 text-sm text-ink-muted">验证登录状态…</div>;
  }

  if (!isAuthenticated || !accessToken) {
    return <InlineAuthPanel />;
  }

  return <>{children}</>;
}

// --------------------------------------------------------------------

type Mode = 'login' | 'register';

function InlineAuthPanel() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res =
        mode === 'login'
          ? await login({ username, password })
          : await register({
              username,
              password,
              nickname: nickname || username,
              email: email || undefined,
              role: 'student',
            });
      if (!res.success) {
        setErr(res.error || (mode === 'login' ? '登录失败' : '注册失败'));
      }
      // 成功时 useAuth 会把 isAuthenticated / accessToken 改掉，Gate 会自动切到 children
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-5 py-16">
      <div>
        <h1 className="text-xl font-medium">欢迎使用 MeetMind Education Service OS</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {mode === 'login' ? '请登录你的账号以继续。' : '创建一个账号，3 分钟就能接入你的第一个机构。'}
        </p>
      </div>

      {err && <div className="rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-700">{err}</div>}

      <form className="space-y-3" onSubmit={onSubmit}>
        <div className="space-y-1">
          <label className="block text-xs text-ink-secondary">用户名</label>
          <input
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded border border-divider bg-card px-3 py-2 text-sm"
            placeholder="用户名（3-32 位）"
            autoComplete="username"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-ink-secondary">密码</label>
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-divider bg-card px-3 py-2 text-sm"
            placeholder={mode === 'register' ? '至少 8 位，含大小写 + 数字' : ''}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </div>
        {mode === 'register' && (
          <>
            <div className="space-y-1">
              <label className="block text-xs text-ink-secondary">昵称（可选）</label>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="w-full rounded border border-divider bg-card px-3 py-2 text-sm"
                placeholder="留空将使用用户名"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-ink-secondary">邮箱（可选）</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded border border-divider bg-card px-3 py-2 text-sm"
                autoComplete="email"
              />
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={busy || !username.trim() || !password}
          className="w-full rounded bg-ink px-4 py-2 text-sm text-card disabled:opacity-40"
        >
          {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并继续'}
        </button>
      </form>

      <div className="text-center text-xs text-ink-muted">
        {mode === 'login' ? (
          <>
            还没有账号？
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setErr(null);
              }}
              className="ml-1 text-ink hover:underline"
            >
              注册
            </button>
          </>
        ) : (
          <>
            已经有账号？
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErr(null);
              }}
              className="ml-1 text-ink hover:underline"
            >
              登录
            </button>
          </>
        )}
      </div>
    </div>
  );
}