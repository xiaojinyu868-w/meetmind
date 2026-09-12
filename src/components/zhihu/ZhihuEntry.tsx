'use client';

/**
 * /apps/zhihu 第一屏：连接知乎 → 选一个收藏夹 → 开课。
 *
 * 三种状态各一句人话，不摆功能：
 * - 未登录：知乎登录可用时给「用知乎登录」，不可用时只给「用 MeetMind 账号登录」并说明原因——不给一颗点了会坏的按钮
 * - 已登录未连接 / 已过期：连接 / 重新连接
 * - 已连接：收藏夹带状态（已收下几条 / 读了几篇全文 / 开过几节课），每个一颗「开课」；下面是「你开过的课」
 * 「开课」= 收下这个收藏夹 → 同学读最值得讲的几篇 → 开讲，三步进度真实可见。授权回来的提示只出现一次。
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { ZHIHU_COPY as C } from '@/lib/ui/copy-zhihu';
import type { ZhihuFavlist } from '@/lib/services/zhihu/zhihu-open-client';
import {
  createLesson,
  fetchCaptures,
  fetchFavlists,
  fetchLessons,
  fetchZhihuPublicStatus,
  fetchZhihuStatus,
  importFavlist,
  startZhihuOAuth,
  ZhihuClientError,
  type ZhihuCaptureDto,
  type ZhihuLessonSummaryDto,
  type ZhihuStatus,
} from './zhihu-api-client';

type Notice = { tone: 'quiet' | 'warn'; text: string } | null;
type StepState = 'todo' | 'doing' | 'done';

const LOGIN_NEXT = '/login?next=%2Fapps%2Fzhihu';
const primary = 'inline-flex items-center rounded-full bg-pine px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-pine-deep disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'inline-flex items-center rounded-full border border-divider bg-card px-5 py-2.5 text-[14px] text-ink transition hover:bg-paper-warm disabled:cursor-not-allowed disabled:opacity-50';
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

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return `${sameYear ? '' : `${d.getFullYear()}.`}${d.getMonth() + 1}.${d.getDate()}`;
}

interface FavlistState {
  imported: number;
  full: number;
  lessons: ZhihuLessonSummaryDto[];
}

function favlistStates(captures: ZhihuCaptureDto[], lessons: ZhihuLessonSummaryDto[], favlists: ZhihuFavlist[]): Map<string, FavlistState> {
  const map = new Map<string, FavlistState>();
  for (const f of favlists) map.set(f.urlToken, { imported: 0, full: 0, lessons: [] });
  for (const c of captures) {
    for (const f of c.zhihu.favlists) {
      const state = map.get(f.urlToken);
      if (!state) continue;
      state.imported += 1;
      if (c.zhihu.body === 'full') state.full += 1;
    }
  }
  for (const lesson of lessons) {
    const favlist = favlists.find((f) => f.title === lesson.materialsTitle);
    if (favlist) map.get(favlist.urlToken)?.lessons.push(lesson);
  }
  return map;
}

function StepDot({ state }: { state: StepState }) {
  if (state === 'done') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0 text-pine">
        <path d="M3 7.2l2.6 2.6L11 4.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return <span aria-hidden className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ${state === 'doing' ? 'animate-pulse bg-pine' : 'bg-divider'}`} />;
}

export function ZhihuEntry() {
  const router = useRouter();
  const { isAuthenticated, accessToken, isLoading, isCheckingAuth } = useAuth();
  // 本机有 token 但还在向服务端核对时不能当「未登录」渲染，否则登录用户会先闪一下「去登录」
  const authPending = isLoading || isCheckingAuth;
  const [publicStatus, setPublicStatus] = React.useState<{ enabled: boolean; oauthReady: boolean } | null>(null);
  const [status, setStatus] = React.useState<ZhihuStatus | null>(null);
  const [favlists, setFavlists] = React.useState<ZhihuFavlist[] | null>(null);
  const [captures, setCaptures] = React.useState<ZhihuCaptureDto[]>([]);
  const [lessons, setLessons] = React.useState<ZhihuLessonSummaryDto[]>([]);
  const [mode, setMode] = React.useState<'oauth' | 'self' | null>(null);
  const [notice, setNotice] = React.useState<Notice>(null);
  const [busy, setBusy] = React.useState<'connect' | string | null>(null);
  const [steps, setSteps] = React.useState<[StepState, StepState, StepState]>(['todo', 'todo', 'todo']);

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
    fetchZhihuPublicStatus().then(setPublicStatus).catch(() => setPublicStatus({ enabled: false, oauthReady: false }));
  }, []);

  const reload = React.useCallback(async (token: string) => {
    const s = await fetchZhihuStatus(token);
    setStatus(s);
    if (!(s.enabled && s.connected)) return;
    const [list, caps, mine] = await Promise.all([fetchFavlists(token), fetchCaptures(token).catch(() => []), fetchLessons(token).catch(() => [])]);
    setFavlists(list.favlists);
    setMode(list.mode);
    setCaptures(caps);
    setLessons(mine);
  }, []);

  // 已登录：看连接状态 → 已连接就拉收藏夹 + 已收下的 + 开过的课
  React.useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      setStatus(null);
      setFavlists(null);
      setLessons([]);
      return;
    }
    let cancelled = false;
    reload(accessToken).catch((error: unknown) => {
      if (!cancelled) setNotice({ tone: 'warn', text: messageFor(error) });
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, accessToken, reload]);

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
      setSteps(['doing', 'todo', 'todo']);
      try {
        const imported = await importFavlist(accessToken, favlist.urlToken);
        if (imported.imported === 0) {
          setNotice({ tone: 'warn', text: C.emptyFavlist });
          return;
        }
        setSteps(['done', 'doing', 'todo']);
        const lesson = await createLesson(accessToken, favlist.urlToken);
        setSteps(['done', 'done', 'doing']);
        router.push(`/apps/zhihu/lesson/${encodeURIComponent(lesson.thread.id)}`);
      } catch (error) {
        setNotice({ tone: 'warn', text: messageFor(error) });
        setBusy(null);
        setSteps(['todo', 'todo', 'todo']);
      }
    },
    [accessToken, router],
  );

  const states = React.useMemo(() => favlistStates(captures, lessons, favlists ?? []), [captures, lessons, favlists]);
  const connected = Boolean(isAuthenticated && status?.enabled && status.connected);
  const oauthReady = publicStatus?.oauthReady ?? false;

  return (
    <main className="min-h-screen bg-paper px-5 py-8 text-ink sm:px-10 sm:py-10">
      <div className="mx-auto max-w-2xl">
        <Link href="/app" className="text-[13px] text-pine">← {C.back}</Link>

        <header className="mt-8 flex items-start gap-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/octo-buddy/happy.png" alt="" width={72} height={66} className="mt-1 h-[66px] w-[72px] shrink-0 select-none" draggable={false} />
          <div className="min-w-0">
            <h1 className="text-[26px] font-medium leading-tight tracking-tight">{C.title}</h1>
            <p className="mt-2 text-[15px] leading-7 text-ink-secondary">{C.subtitle}</p>
            <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-muted">
              {C.steps.map((step, index) => (
                <li key={step} className="flex items-center gap-2">
                  {index > 0 && <span aria-hidden>→</span>}
                  <span className={connected && index === 0 ? 'text-pine' : undefined}>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </header>

        {notice && (
          <p className={`mt-6 rounded-xl px-4 py-3 text-[13px] leading-6 ${notice.tone === 'warn' ? 'bg-cinnabar-fog text-cinnabar-deep' : 'bg-pine-fog text-pine-deep'}`}>
            {notice.text}
          </p>
        )}

        {/* 状态还没回来：给一行字，不留白屏 */}
        {((isAuthenticated && !status) || authPending || (!isAuthenticated && !publicStatus)) && !notice && (
          <p className="mt-8 text-[13px] text-ink-muted">{C.loading}</p>
        )}

        {/* 未登录 */}
        {!authPending && !isAuthenticated && publicStatus && (
          <section className="mt-8 rounded-2xl border border-divider bg-card p-6">
            {!publicStatus.enabled ? (
              <p className="text-[14px] text-ink-secondary">{C.disabled}</p>
            ) : oauthReady ? (
              <>
                <div className="flex flex-wrap items-center gap-4">
                  <button type="button" className={primary} onClick={connect} disabled={busy === 'connect'}>
                    {busy === 'connect' ? C.connecting : C.loginWithZhihu}
                  </button>
                  <Link className={ghost} href={LOGIN_NEXT}>{C.loginOther}</Link>
                </div>
                <p className="mt-4 text-[13px] leading-6 text-ink-muted">{C.connectHint}</p>
              </>
            ) : (
              <>
                <Link className={primary} href={LOGIN_NEXT}>{C.loginOther}</Link>
                <p className="mt-4 text-[13px] leading-6 text-ink-muted">{C.oauthNotReady}</p>
              </>
            )}
          </section>
        )}

        {/* 已登录，未连接 / 已过期 / 未开放 */}
        {isAuthenticated && status && !(status.enabled && status.connected) && (
          <section className="mt-8 rounded-2xl border border-divider bg-card p-6">
            {!status.enabled ? (
              <p className="text-[14px] text-ink-secondary">{C.disabled}</p>
            ) : oauthReady ? (
              <>
                <p className="text-[14px] leading-7 text-ink-secondary">{status.expired ? C.expired : C.notConnected}</p>
                <div className="mt-4">
                  <button type="button" className={primary} onClick={connect} disabled={busy === 'connect'}>
                    {busy === 'connect' ? C.connecting : status.expired ? C.reconnect : C.connect}
                  </button>
                </div>
                <p className="mt-4 text-[13px] leading-6 text-ink-muted">{C.connectHint}</p>
              </>
            ) : (
              <p className="text-[14px] leading-7 text-ink-secondary">{C.oauthNotReadyLoggedIn}</p>
            )}
          </section>
        )}

        {/* 已连接：收藏夹 */}
        {connected && (
          <section className="mt-8">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[17px] font-medium">{C.favlistsTitle}</h2>
              {mode === 'self' && <span className="text-[12px] text-ink-muted">{C.selfMode}</span>}
            </div>
            <p className="mt-1 text-[13px] leading-6 text-ink-secondary">{C.favlistsHint}</p>
            {favlists === null && <p className="mt-4 text-[13px] text-ink-muted">{C.favlistsLoading}</p>}
            {favlists && favlists.length === 0 && <p className="mt-4 text-[13px] text-ink-muted">{C.favlistsEmpty}</p>}
            {favlists && favlists.length > 0 && (
              <ul className="mt-4 divide-y divide-divider-light rounded-2xl border border-divider bg-card">
                {favlists.map((favlist) => {
                  const active = busy === favlist.urlToken;
                  const state = states.get(favlist.urlToken);
                  const taught = state?.lessons.length ?? 0;
                  const latest = state?.lessons[0];
                  return (
                    <li key={favlist.urlToken} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-[15px] font-medium">{favlist.title}</span>
                            <span className="text-[11px] text-ink-muted">{favlist.isPublic ? C.favlistPublic : C.favlistPrivate}</span>
                          </div>
                          {favlist.description && <p className="mt-1 line-clamp-2 text-[13px] leading-6 text-ink-secondary">{favlist.description}</p>}
                          {state && (state.imported > 0 || taught > 0) && (
                            <p className="mt-1 text-[12px] text-ink-muted">
                              {[state.imported > 0 ? C.favlistImported(state.imported, state.full) : null, taught > 0 ? C.favlistTaught(taught) : null].filter(Boolean).join(' · ')}
                              {latest && (
                                <>
                                  {' · '}
                                  <Link className="text-pine underline-offset-4 hover:underline" href={`/apps/zhihu/lesson/${encodeURIComponent(latest.threadId)}`}>
                                    {C.lessonContinue}
                                  </Link>
                                </>
                              )}
                            </p>
                          )}
                        </div>
                        <button type="button" className={`${taught > 0 ? secondary : primary} shrink-0`} onClick={() => open(favlist)} disabled={busy !== null}>
                          {active ? C.loading : taught > 0 ? C.startAgain : C.startLesson}
                        </button>
                      </div>
                      {active && (
                        <ol className="mt-3 space-y-1.5 text-[12.5px]">
                          {[C.progressImport, C.progressRead, C.progressOpen].map((label, index) => {
                            const s = steps[index];
                            return (
                              <li key={label} className={`flex items-center gap-2 ${s === 'todo' ? 'text-ink-muted' : 'text-ink'}`}>
                                <StepDot state={s} />
                                <span>{label}</span>
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {/* 你开过的课 */}
        {connected && lessons.length > 0 && (
          <section className="mt-10">
            <h2 className="text-[17px] font-medium">{C.lessonsTitle}</h2>
            <ul className="mt-4 space-y-2">
              {lessons.map((lesson) => (
                <li key={lesson.threadId}>
                  <Link
                    href={`/apps/zhihu/lesson/${encodeURIComponent(lesson.threadId)}`}
                    className="flex items-center justify-between gap-4 rounded-xl border border-divider bg-card px-5 py-3.5 transition hover:bg-paper-warm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[14.5px] font-medium">{lesson.title || lesson.topic}</span>
                      <span className="mt-0.5 block text-[12px] text-ink-muted">
                        {C.lessonFrom(lesson.materialsTitle, lesson.itemCount)} · {formatDay(lesson.updatedAt)}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] text-pine">{C.lessonContinue} →</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
