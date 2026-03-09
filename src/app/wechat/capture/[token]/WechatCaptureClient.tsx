'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import WechatBindForm from '@/components/WechatBindForm';

interface WechatCaptureClientProps {
  token: string;
  isBound: boolean;
  openId: string;
  workspaceName?: string | null;
}

export default function WechatCaptureClient({
  token,
  isBound: initialBound,
  openId,
  workspaceName: initialWorkspaceName,
}: WechatCaptureClientProps) {
  const [bound, setBound] = useState(initialBound);
  const [nickname, setNickname] = useState('');
  const [sessionLoading, setSessionLoading] = useState(false);
  const [error, setError] = useState('');

  // 检测 URL 中的 session 参数（微信 OAuth 回调后）
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');
    const errorMsg = params.get('error');

    if (errorMsg) {
      setError(decodeURIComponent(errorMsg));
      // 清除 URL 参数
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    if (session && !bound) {
      setSessionLoading(true);
      // 用 session token 换取 accessToken
      fetch('/api/wechat/bind/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken: session }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.accessToken) {
            try {
              localStorage.setItem('auth_token', data.accessToken);
              if (data.refreshToken) {
                localStorage.setItem('refresh_token', data.refreshToken);
              }
            } catch {
              // localStorage not available
            }
            setNickname(data.nickname || '');
            setBound(true);
          } else {
            setError(data.error || '绑定失败');
          }
        })
        .catch(() => {
          setError('网络错误，请重试');
        })
        .finally(() => {
          setSessionLoading(false);
          // 清除 URL 参数
          window.history.replaceState({}, '', window.location.pathname);
        });
    }
  }, [bound]);

  function handleBound(userNickname: string) {
    setBound(true);
    setNickname(userNickname);
  }

  if (sessionLoading) {
    return (
      <section className="rounded-[28px] border border-stone-200 bg-white px-5 py-5 shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
        <div className="flex items-center justify-center py-8">
          <div className="text-sm text-stone-500">正在完成绑定...</div>
        </div>
      </section>
    );
  }

  if (bound) {
    return (
      <section className="rounded-[28px] border border-stone-200 bg-white px-5 py-5 shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
        {nickname ? (
          <div className="mb-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            绑定成功{nickname ? `，${nickname}` : ''}。以后发给服务号的内容都会自动进入收集流。
          </div>
        ) : null}
        <h2 className="text-base font-semibold text-stone-900">
          {initialWorkspaceName
            ? `已接到「${initialWorkspaceName}」`
            : '下一步'}
        </h2>
        <div className="mt-4 grid gap-3">
          <Link
            href={`/app?mobile=1&wechat_capture=${encodeURIComponent(token)}`}
            className="rounded-[20px] bg-stone-950 px-4 py-4 text-center text-sm font-medium text-white"
          >
            打开收集流
          </Link>
          <p className="rounded-[20px] bg-stone-50 px-4 py-4 text-sm leading-7 text-stone-600">
            补 PDF、课件、录音，或者进 Tutor 深挖，都从这里继续。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-stone-200 bg-white px-5 py-5 shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
      <h2 className="text-base font-semibold text-stone-900">绑定你的 MeetMind 账号</h2>
      <p className="mt-2 text-sm leading-6 text-stone-500">
        只需要绑定一次，之后发给服务号的所有内容都会自动出现在你的收集流里。
      </p>

      {error ? (
        <div className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      ) : null}

      <WechatBindForm openId={openId} linkToken={token} onBound={handleBound} />
    </section>
  );
}
