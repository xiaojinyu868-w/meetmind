'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import WechatBindForm from '@/components/WechatBindForm';

const TOKEN_KEY = 'meetmind_access_token';

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
          const accessToken = data.accessToken || data.token;
          if (data.success && accessToken) {
            try {
              localStorage.setItem(TOKEN_KEY, accessToken);
              localStorage.removeItem('auth_token');
              localStorage.removeItem('refresh_token');
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
      <section className="rounded-[28px] border border-divider bg-white px-5 py-5 shadow-card">
        <div className="flex items-center justify-center py-8">
          <div className="text-sm text-ink-muted">正在完成绑定...</div>
        </div>
      </section>
    );
  }

  if (bound) {
    return (
      <section className="rounded-[28px] border border-divider bg-white px-5 py-5 shadow-card">
        {nickname ? (
          <div className="mb-4 rounded-2xl bg-pine-mist px-4 py-3 text-sm text-ink">
            绑定成功{nickname ? `，${nickname}` : ''}。以后发给服务号的内容都会自动进入收集流。
          </div>
        ) : null}
        <h2 className="text-base font-semibold text-ink">
          {initialWorkspaceName
            ? `已接到「${initialWorkspaceName}」`
            : '下一步'}
        </h2>
        <div className="mt-4 grid gap-3">
          <Link
            href={`/app?wechat_capture=${encodeURIComponent(token)}`}
            className="rounded-[20px] bg-ink px-4 py-4 text-center text-sm font-medium text-white"
          >
            打开收集流
          </Link>
          <p className="rounded-[20px] bg-paper-warm px-4 py-4 text-sm leading-7 text-ink-secondary">
            补 PDF、课件、录音，或者进 Tutor 深挖，都从这里继续。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-divider bg-white px-5 py-5 shadow-card">
      <h2 className="text-base font-semibold text-ink">绑定你的 MeetMind 账号</h2>
      <p className="mt-2 text-sm leading-6 text-ink-muted">
        只需要绑定一次，之后发给服务号的所有内容都会自动出现在你的收集流里。
      </p>

      {error ? (
        <div className="mt-3 rounded-2xl bg-vermilion-mist/50 px-4 py-3 text-sm text-vermilion">
          {error}
        </div>
      ) : null}

      <WechatBindForm openId={openId} linkToken={token} onBound={handleBound} />
    </section>
  );
}
