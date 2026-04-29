'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { academicFetch, AcademicClientError } from '@/components/academic/academic-client';

function InviteAcceptInner() {
  const router = useRouter();
  const search = useSearchParams();
  const token = search.get('token') || '';
  const { accessToken, isAuthenticated, isCheckingAuth } = useAuth();

  const [info, setInfo] = useState<{ role: string; org: { id: string; name: string; industry: string }; usedAt: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setErr('缺少邀请 token');
      return;
    }
    academicFetch<{ invite: { role: string; org: { id: string; name: string; industry: string }; usedAt: string | null } }>(
      `/api/console/invite?token=${encodeURIComponent(token)}`,
      { accessToken: null },
    )
      .then((res) => setInfo(res.invite))
      .catch((e: AcademicClientError) => setErr(e.message));
  }, [token]);

  async function accept() {
    if (!accessToken) {
      // /login 不支持 next 参数。把 pending token 写 localStorage，登录成功后浏览器再手动打开邀请链接即可。
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('mm:pending-invite-token', token);
      }
      router.replace('/login');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await academicFetch<{ orgId: string; role: string }>('/api/console/invite', {
        accessToken,
        method: 'POST',
        body: { token },
      });
      setDone(true);
      // 按角色跳到对应首屏
      setTimeout(() => {
        if (res.role === 'student') router.replace('/learn');
        else if (res.role === 'teacher') router.replace('/teacher');
        else router.replace('/console');
      }, 800);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '接受失败');
    } finally {
      setBusy(false);
    }
  }

  if (err) return <div className="mx-auto max-w-xl p-10 text-sm text-rose-600">{err}</div>;
  if (!info) return <div className="mx-auto max-w-xl p-10 text-sm text-ink-muted">加载中…</div>;
  if (info.usedAt) return <div className="mx-auto max-w-xl p-10 text-sm text-ink-muted">该邀请链接已被使用。</div>;

  return (
    <div className="mx-auto max-w-xl space-y-6 p-10">
      <h1 className="text-2xl font-medium">加入「{info.org.name}」</h1>
      <p className="text-sm text-ink-secondary">
        这是一条来自 <b>{info.org.name}</b>（行业：{info.org.industry}）的邀请，你将以 <b>{info.role}</b> 的身份加入该机构。
      </p>
      {done ? (
        <div className="text-sm text-emerald-700">加入成功，正在跳转…</div>
      ) : isCheckingAuth ? (
        <div className="text-sm text-ink-muted">检查登录状态…</div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={accept}
          className="rounded bg-ink px-4 py-2 text-sm text-card disabled:opacity-40"
        >
          {isAuthenticated ? '接受邀请' : '登录并接受邀请'}
        </button>
      )}
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-ink-muted">加载中…</div>}>
      <InviteAcceptInner />
    </Suspense>
  );
}
