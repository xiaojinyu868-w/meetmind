'use client';

/**
 * /apps/zhihu/favlist/[urlToken] —— 一个收藏夹，同学读过之后的样子。
 *
 * 课的单位是一篇或一条线，不是整个收藏夹。所以这一页：
 * 1. 先出条目（第一次打开顺手收进来）：每篇标题 / 作者 / 类型 / 赞同 / 收藏时间 / 一行摘要 / 正文状态 / 开过的课，每篇一个「讲这篇」
 * 2. 同学读完（一次模型调用，慢几秒）把条目按"放在一节课里讲得通"分成几条线，每条线一句为什么、一个「按这条线开一节」
 * 3. 顶部「随手开一节」：同学替你挑最值得先讲的一篇，并说为什么——零选择的默认，但说清它选了什么
 * 分线还没回来时，条目按收藏时间平铺，页面照样能用；视频 / 想法归到「零散的」并写明为什么讲不了。
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { ZHIHU_COPY as C } from '@/lib/ui/copy-zhihu';
import {
  createLesson,
  fetchFavlistDetail,
  fetchFavlistThemes,
  ZhihuClientError,
  type CreateLessonInput,
  type ZhihuFavlistDetailDto,
  type ZhihuFavlistItemDto,
  type ZhihuFavlistThemesDto,
} from './zhihu-api-client';

const KIND_LABEL: Record<string, string> = { answer: '回答', article: '文章', question: '问题', zvideo: '视频', pin: '想法', unknown: '内容' };
const TEACHABLE = new Set(['answer', 'article', 'question']);
const primary = 'inline-flex items-center rounded-full bg-pine px-4 py-2 text-[13px] font-medium text-white transition hover:bg-pine-deep disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'inline-flex items-center rounded-full border border-divider bg-card px-4 py-2 text-[13px] text-ink transition hover:bg-paper-warm disabled:cursor-not-allowed disabled:opacity-50';

function messageFor(error: unknown): string {
  if (error instanceof ZhihuClientError) {
    if (error.code === 'zhihu_rate_limit') return C.zhihuBusy;
    if (error.code === 'zhihu_quota') return C.quotaExceeded;
    if (error.code === 'zhihu_reconnect') return C.expired;
    if (error.code === 'zhihu_not_connected') return C.notConnected;
    if (error.code === 'zhihu_disabled') return C.disabled;
    if (error.code === 'favlist_not_found' && /视频或想法/.test(error.message)) return C.nothingToTeach;
    return error.message;
  }
  if ((error as Error)?.name === 'TimeoutError') return C.favlistSlow;
  return C.errors.unknown;
}

function favDay(favTime: number): string {
  if (!favTime) return '';
  const d = new Date(favTime * 1000);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} 收藏`;
}

type Busy = { key: string; step: 'read' | 'open' } | null;

function ItemRow({ item, busy, onTeach, startWhy }: { item: ZhihuFavlistItemDto; busy: Busy; onTeach: (item: ZhihuFavlistItemDto) => void; startWhy?: string }) {
  const teachable = TEACHABLE.has(item.kind);
  const active = busy?.key === `item:${item.id}`;
  const latest = item.lessons[0];
  return (
    <li className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-ink-muted">
            <span>{KIND_LABEL[item.kind] ?? '内容'}</span>
            {item.author && <span>{item.author}</span>}
            <span>赞同 {item.voteUpCount}</span>
            {item.favTime ? <span>{favDay(item.favTime)}</span> : null}
          </div>
          <a className="mt-0.5 block text-[15px] font-medium leading-6 text-ink hover:text-pine" href={item.url} target="_blank" rel="noopener noreferrer">
            {item.title}
          </a>
          {item.summary && <p className="mt-1 line-clamp-2 text-[13px] leading-6 text-ink-secondary">{item.summary}</p>}
          {startWhy && <p className="mt-1 text-[12.5px] leading-6 text-pine-deep">{C.startWhy(startWhy)}</p>}
          <p className="mt-1 text-[12px] text-ink-muted">
            {teachable ? (item.body === 'full' ? C.itemFull(item.bodyChars) : C.itemSummaryOnly) : C.itemNotTeachable(KIND_LABEL[item.kind] ?? '内容')}
            {latest && (
              <>
                {' · '}
                {C.itemTaught(item.lessons.length)}
                {' · '}
                <Link className="text-pine underline-offset-4 hover:underline" href={`/apps/zhihu/lesson/${encodeURIComponent(latest.threadId)}`}>
                  {C.lessonContinue}
                </Link>
              </>
            )}
          </p>
        </div>
        {teachable && (
          <button type="button" className={`${latest ? secondary : primary} shrink-0`} disabled={busy !== null} onClick={() => onTeach(item)}>
            {active ? (busy?.step === 'read' ? C.progressReadOne : C.progressOpen) : latest ? C.teachAgain : C.teachThis}
          </button>
        )}
      </div>
    </li>
  );
}

export function ZhihuFavlist({ urlToken }: { urlToken: string }) {
  const router = useRouter();
  const { isAuthenticated, accessToken, isLoading, isCheckingAuth } = useAuth();
  const [detail, setDetail] = React.useState<ZhihuFavlistDetailDto | null>(null);
  const [themes, setThemes] = React.useState<ZhihuFavlistThemesDto | null>(null);
  const [themesState, setThemesState] = React.useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<Busy>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setError(null);
    fetchFavlistDetail(accessToken, urlToken)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        setThemesState('loading');
        return fetchFavlistThemes(accessToken, urlToken)
          .then((t) => {
            if (cancelled) return;
            setThemes(t);
            setThemesState('ready');
          })
          .catch(() => {
            if (!cancelled) setThemesState('failed');
          });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(messageFor(e));
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, urlToken]);

  const open = React.useCallback(
    async (key: string, input: CreateLessonInput) => {
      if (!accessToken) return;
      setBusy({ key, step: 'read' });
      setError(null);
      try {
        const lesson = await createLesson(accessToken, input);
        setBusy({ key, step: 'open' });
        router.push(`/apps/zhihu/lesson/${encodeURIComponent(lesson.thread.id)}`);
      } catch (e) {
        setError(messageFor(e));
        setBusy(null);
      }
    },
    [accessToken, router],
  );

  if (!isLoading && !isCheckingAuth && !isAuthenticated) {
    return (
      <main className="min-h-screen bg-paper px-6 py-16 text-ink">
        <p className="text-[15px]">{C.loginFirst}</p>
        <a className="mt-4 inline-block text-pine underline-offset-4 hover:underline" href={`/login?next=${encodeURIComponent(`/apps/zhihu/favlist/${urlToken}`)}`}>{C.loginOther}</a>
      </main>
    );
  }

  const items = detail?.items ?? [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const startId = themes?.start?.itemId ?? null;
  const grouped = themesState === 'ready' && themes && themes.themes.length > 0;
  const miscItems = grouped ? themes!.misc.map((id) => byId.get(id)).filter((i): i is ZhihuFavlistItemDto => Boolean(i)) : [];
  const teachableCount = items.filter((i) => TEACHABLE.has(i.kind)).length;

  return (
    <main className="min-h-screen bg-paper px-5 py-8 text-ink sm:px-10 sm:py-10">
      <div className="mx-auto max-w-2xl">
        <Link href="/apps/zhihu" className="text-[13px] text-pine">← {C.backToFavlists}</Link>

        <header className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[24px] font-medium leading-tight tracking-tight">{detail?.favlist.title ?? C.loading}</h1>
            {detail && (
              <p className="mt-1 text-[13px] text-ink-muted">
                {detail.favlist.isPublic ? C.favlistPublic : C.favlistPrivate} · {C.favlistCount(items.length, teachableCount)}
                {detail.favlist.description ? ` · ${detail.favlist.description}` : ''}
              </p>
            )}
          </div>
          {detail && teachableCount > 0 && (
            <button type="button" className={`${primary} shrink-0`} disabled={busy !== null} onClick={() => open('auto', { kind: 'auto', favlistUrlToken: urlToken })}>
              {busy?.key === 'auto' ? (busy.step === 'read' ? C.progressReadOne : C.progressOpen) : C.autoLesson}
            </button>
          )}
        </header>

        {error && <p className="mt-6 rounded-xl bg-cinnabar-fog px-4 py-3 text-[13px] leading-6 text-cinnabar-deep">{error}</p>}
        {!detail && !error && <p className="mt-8 text-[13px] text-ink-muted">{C.favlistReading}</p>}

        {detail && (
          <>
            {/* 同学的阅读：分线 */}
            <section className="mt-8">
              {themesState === 'loading' && <p className="text-[13px] leading-6 text-ink-secondary">{C.themesReading(items.length)}</p>}
              {themesState === 'failed' && <p className="text-[13px] leading-6 text-ink-muted">{C.themesFailed}</p>}
              {grouped && (
                <p className="text-[14px] leading-7 text-ink-secondary">
                  {themes!.source === 'model' ? C.themesIntro(themes!.themes.length) : C.themesFallbackIntro}
                </p>
              )}
            </section>

            {grouped ? (
              <>
                {themes!.themes.map((theme) => {
                  const themeItems = theme.itemIds.map((id) => byId.get(id)).filter((i): i is ZhihuFavlistItemDto => Boolean(i));
                  const teachableIds = themeItems.filter((i) => TEACHABLE.has(i.kind)).map((i) => i.id);
                  const key = `theme:${theme.id}`;
                  return (
                    <section key={theme.id} className="mt-6">
                      <div className="flex flex-wrap items-start justify-between gap-3 px-1">
                        <div className="min-w-0">
                          <h2 className="text-[16px] font-medium">{theme.title}</h2>
                          {theme.why && <p className="mt-0.5 text-[13px] leading-6 text-ink-secondary">{theme.why}</p>}
                        </div>
                        {teachableIds.length >= 2 && (
                          <button
                            type="button"
                            className={`${secondary} shrink-0`}
                            disabled={busy !== null}
                            onClick={() => open(key, { kind: 'theme', captureIds: teachableIds.slice(0, 4), topic: theme.title, favlistUrlToken: urlToken })}
                          >
                            {busy?.key === key ? (busy.step === 'read' ? C.progressReadMany(Math.min(4, teachableIds.length)) : C.progressOpen) : C.teachTheme(Math.min(4, teachableIds.length))}
                          </button>
                        )}
                      </div>
                      <ul className="mt-3 divide-y divide-divider-light rounded-2xl border border-divider bg-card">
                        {themeItems.map((item) => (
                          <ItemRow key={item.id} item={item} busy={busy} onTeach={(it) => open(`item:${it.id}`, { kind: 'single', captureId: it.id, favlistUrlToken: urlToken })} startWhy={item.id === startId ? themes!.start?.why : undefined} />
                        ))}
                      </ul>
                    </section>
                  );
                })}
                {miscItems.length > 0 && (
                  <section className="mt-6">
                    <h2 className="px-1 text-[15px] font-medium text-ink-secondary">{C.miscTitle(miscItems.length)}</h2>
                    <ul className="mt-3 divide-y divide-divider-light rounded-2xl border border-divider bg-card">
                      {miscItems.map((item) => (
                        <ItemRow key={item.id} item={item} busy={busy} onTeach={(it) => open(`item:${it.id}`, { kind: 'single', captureId: it.id, favlistUrlToken: urlToken })} />
                      ))}
                    </ul>
                  </section>
                )}
              </>
            ) : (
              <section className="mt-4">
                {items.length === 0 ? (
                  <p className="text-[13px] text-ink-muted">{C.favlistEmptyItems}</p>
                ) : (
                  <ul className="divide-y divide-divider-light rounded-2xl border border-divider bg-card">
                    {items.map((item) => (
                      <ItemRow key={item.id} item={item} busy={busy} onTeach={(it) => open(`item:${it.id}`, { kind: 'single', captureId: it.id, favlistUrlToken: urlToken })} />
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
