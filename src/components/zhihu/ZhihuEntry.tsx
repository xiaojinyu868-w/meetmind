'use client';

/**
 * /apps/zhihu 第一屏：连接知乎 → 选一个收藏夹 → 开课。
 *
 * 三种状态各一句人话，不摆功能：未登录（用知乎登录 / 用 MeetMind 账号登录）→ 已登录未连接（连接知乎）→
 * 已连接（收藏夹列表，每个一颗「开课」）。授权回来的 ?zhihu= / ?zhihu_error= 只提示一次就从地址栏清掉。
 * 「开课」= 收下这个收藏夹（导入）→ 同学读几篇（抽正文）→ 跳到课堂页；中间的等待用三行进度说人话。
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { ZHIHU_COPY as C } from '@/lib/ui/copy-zhihu';
import type { ZhihuFavlist } from '@/lib/services/zhihu/zhihu-open-client';
import { createLesson, fetchFavlists, fetchZhihuStatus, importFavlist, startZhihuOAuth, ZhihuClientError, type ZhihuStatus } from './zhihu-api-client';

type Notice = { tone: 'quiet' | 'warn'; text: string } | null;

const button = 'inline-flex items-center rounded-full bg-pine px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-pine-deep disabled:cursor-not-allowed disabled:opacity-50';
const ghost = 'text-[13px] text-ink-secondary underline-offset-4 hover:text-pine hover:underline';

function messageFor(error: unknown): string {
  if (error instanceof ZhihuClientError) {
    if (error.code === 'zhihu_rate_limit' || error.code === 'zhihu_quota') return C.quotaExceeded;
    if (error.code === 'zhihu_reconnect') return C.expired;
    if (error.code === 'zhihu_not_connected') return C.notConnected;
    if (error.code === 'zhihu_disabled' || error.code === 'zhihu_login_unavailable') return C.disabled;
    if (error.code === 'zhihu_upstream' || error.code === 'zhihu_upstream_auth') return C.upstreamDown;
    if (error.code === 'favlist_not_found' && /视频或想法/.test(error.message)) return C.nothingToTeach;
    return error.message;
  }
  return C.errors.unknown;
}

export function ZhihuEntry() {
  const router = useRouter();
  const { isAuthenticated, accessToken, isLoading } = useAuth();
  const [status, setStatus] = React.useState<ZhihuStatus | null>(null);
  const [favlists, setFavlists] = React.useState<ZhihuFavlist[] | null>(null);
  const [mode, setMode] = React.useState<'oauth' | 'self' | null>(null);
  const [notice, setNotice] = React.useState<Notice>(null);
  const [busy, setBusy] = React.useState<'connect' | string | null>(null);
  const [progress, setProgress] = React.useState<string[]>([]);

  // 授权回来的提示：读一次，清掉地址栏
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ok = params.get('zhihu');
    const err = params.get('zhihu_error');
    if (ok === 'created') setNotice({ tone: 'quiet', text: C.createdAccount });
    else if (ok === 'connected') setNotice({ tone: 'quiet', text: C.connected });
    else if (err) setNotice({ tone: 'warn', text: C.errors[err] ?? C.errors.unknown });
    if (ok || err) {
      params.delete('zhihu');
      params.delete('zhihu_error');
      const url = new URL(window.location.href);
      url.search = params.toString();
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  // 已登录：看连接状态 → 已连接就拉收藏夹
  React.useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      setStatus(null);
      setFavlists(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const s = await fetchZhihuStatus(accessToken);
        if (cancelled) return;
        setStatus(s);
        if (s.enabled && s.connected) {
          const list = await fetchFavlists(accessToken);
          if (cancelled) return;
          setFavlists(list.favlists);
          setMode(list.mode);
        }
      } catch (error) {
        if (!cancelled) setNotice({ tone: 'warn', text: messageFor(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, accessToken]);

  const connect = React.useCallback(async () => {
    setBusy('connect');
    setNotice(null);
    try {
      const url = await startZhihuOAuth(isAuthenticated ? accessToken : null);
      window.location.assign(url);
    } catch (error) {
      setNotice({ tone: 'warn', text: messageFor(error) });
      setBusy(null);
    }
  }, [accessToken, isAuthenticated]);

  const open = React.useCallback(
    async (favlist: ZhihuFavlist) => {
      if (!accessToken) return;
      setBusy(favlist.urlToken);
      setNotice(null);
      setProgress([C.importing]);
      try {
        const imported = await importFavlist(accessToken, favlist.urlToken);
        if (imported.imported === 0) {
          setNotice({ tone: 'warn', text: C.emptyFavlist });
          return;
        }
        setProgress([C.imported(imported.imported), C.reading(Math.min(8, imported.imported))]);
        const lesson = await createLesson(accessToken, favlist.urlToken);
        setProgress((p) => [...p, C.opening]);
        router.push(`/apps/zhihu/lesson/${encodeURIComponent(lesson.thread.id)}`);
      } catch (error) {
        setNotice({ tone: 'warn', text: messageFor(error) });
      } finally {
        setBusy(null);
        setProgress([]);
      }
    },
    [accessToken, router],
  );

  return (
    <main className="min-h-screen bg-paper px-5 py-10 text-ink sm:px-10">
      <div className="mx-auto max-w-2xl">
        <Link href="/app" className="text-sm text-pine">← {C.back}</Link>
        <header className="mb-8 mt-8">
          <h1 className="text-[26px] font-medium leading-tight tracking-tight">{C.title}</h1>
          <p className="mt-3 text-[15px] leading-7 text-ink-secondary">{C.subtitle}</p>
        </header>

        {notice && (
          <p className={`mb-6 rounded-xl px-4 py-3 text-[13px] leading-6 ${notice.tone === 'warn' ? 'bg-cinnabar-fog text-cinnabar-deep' : 'bg-pine-fog text-pine-deep'}`}>
            {notice.text}
          </p>
        )}

        {/* 未登录 */}
        {!isLoading && !isAuthenticated && (
          <section className="rounded-2xl border border-divider bg-card p-6">
            <div className="flex flex-wrap items-center gap-4">
              <button type="button" className={button} onClick={connect} disabled={busy === 'connect'}>
                {busy === 'connect' ? C.connecting : C.loginWithZhihu}
              </button>
              <Link className={ghost} href="/login">{C.loginOther}</Link>
            </div>
            <p className="mt-4 text-[13px] leading-6 text-ink-muted">{C.connectHint}</p>
          </section>
        )}

        {/* 已登录，未连接 / 已过期 / 未开放 */}
        {isAuthenticated && status && !(status.enabled && status.connected) && (
          <section className="rounded-2xl border border-divider bg-card p-6">
            {!status.enabled ? (
              <p className="text-[14px] text-ink-secondary">{C.disabled}</p>
            ) : (
              <>
                <p className="text-[14px] leading-7 text-ink-secondary">{status.expired ? C.expired : C.notConnected}</p>
                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <button type="button" className={button} onClick={connect} disabled={busy === 'connect'}>
                    {busy === 'connect' ? C.connecting : status.expired ? C.reconnect : C.connect}
                  </button>
                </div>
                <p className="mt-4 text-[13px] leading-6 text-ink-muted">{C.connectHint}</p>
              </>
            )}
          </section>
        )}

        {/* 已连接：收藏夹 */}
        {isAuthenticated && status?.enabled && status.connected && (
          <section>
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-[17px] font-medium">{C.favlistsTitle}</h2>
              {mode === 'self' && <span className="text-[12px] text-ink-muted">{C.selfMode}</span>}
            </div>
            <p className="mb-5 text-[13px] leading-6 text-ink-secondary">{C.favlistsHint}</p>
            {favlists === null && <p className="text-[13px] text-ink-muted">{C.favlistsLoading}</p>}
            {favlists && favlists.length === 0 && <p className="text-[13px] text-ink-muted">{C.favlistsEmpty}</p>}
            {favlists && favlists.length > 0 && (
              <ul className="divide-y divide-divider-light rounded-2xl border border-divider bg-card">
                {favlists.map((favlist) => {
                  const active = busy === favlist.urlToken;
                  return (
                    <li key={favlist.urlToken} className="flex items-start justify-between gap-4 px-5 py-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[15px] font-medium">{favlist.title}</span>
                          <span className="shrink-0 text-[11px] text-ink-muted">{favlist.isPublic ? C.favlistPublic : C.favlistPrivate}</span>
                        </div>
                        {favlist.description && <p className="mt-1 line-clamp-2 text-[13px] leading-6 text-ink-secondary">{favlist.description}</p>}
                        {active && progress.length > 0 && (
                          <ol className="mt-2 space-y-0.5 text-[12px] text-pine">
                            {progress.map((line) => <li key={line}>{line}</li>)}
                          </ol>
                        )}
                      </div>
                      <button type="button" className={`${button} shrink-0`} onClick={() => open(favlist)} disabled={busy !== null}>
                        {active ? C.loading : C.startLesson}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
