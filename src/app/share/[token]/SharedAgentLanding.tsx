'use client';

/**
 * SharedAgentLanding — 公开落地页主体（v3.0）
 *
 * 任何人凭 token 可访问。
 * 1. 拉取 GET /api/share/[token]
 * 2. 渲染分享者 + 课程标题 + 转录摘要 + artifact 预览 + 同学（如果允许对话）
 * 3. 提供「领取到我的工作台」（要登录）和「也分享给别人」按钮
 */

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useAuth } from '@/lib/hooks/useAuth';
import { COPY } from '@/lib/ui/copy';
import { OctoBuddySprite } from '@/components/classroom/OctoBuddy';
import { SharedAgentChat } from './SharedAgentChat';
import type {
  PublicSharedAgent,
  ShareArtifactKind,
} from '@/lib/services/share-agent-service';

interface SharedAgentLandingProps {
  token: string;
}

/**
 * artifact 预览 —— v0 用文字描述 + 关键字段，不重渲染应用 UI。
 * 后续 M11.5 再把 cheatsheet / mindmap 的真实 UI 接进来。
 */
function ArtifactPreview({ artifactKind, artifact }: { artifactKind: ShareArtifactKind; artifact?: unknown }) {
  const title = COPY.share.landing.artifactTitle(artifactKind);
  // artifact 形态目前是开放的 unknown —— 这里只渲染少量摘要字段
  let summary: string | null = null;
  if (artifact && typeof artifact === 'object') {
    const obj = artifact as { summary?: string; title?: string };
    summary = obj.summary ?? obj.title ?? null;
  }
  return (
    <section className="rounded-3xl border border-divider bg-white px-5 py-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
        {title}
      </p>
      {summary ? (
        <p className="mt-2 text-[14px] leading-7 text-ink">{summary}</p>
      ) : (
        <p className="mt-2 text-[13px] leading-7 text-ink-secondary">
          完整产物会在你领取后出现在工作台里。
        </p>
      )}
    </section>
  );
}

export function SharedAgentLanding({ token }: SharedAgentLandingProps) {
  const { isAuthenticated, accessToken } = useAuth();
  const [share, setShare] = React.useState<PublicSharedAgent | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [notFound, setNotFound] = React.useState(false);
  const [claiming, setClaiming] = React.useState(false);
  const [claimed, setClaimed] = React.useState(false);

  // 拉取 share
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    fetch(`/api/share/${encodeURIComponent(token)}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as { success: boolean; share: PublicSharedAgent };
        setShare(data.share);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[share-landing] load failed', err);
        setNotFound(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, accessToken]);

  const handleClaim = React.useCallback(async () => {
    if (!isAuthenticated || !accessToken) {
      // 未登录：跳到登录，登录后回到这页
      const next = encodeURIComponent(`/share/${token}`);
      window.location.href = `/login?next=${next}`;
      return;
    }
    setClaiming(true);
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(token)}/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { success: boolean; alreadyClaimed?: boolean };
      setClaimed(true);
      toast.success(
        data.alreadyClaimed
          ? COPY.share.landing.claimAlready
          : COPY.share.landing.claimDone,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : '领取失败';
      toast.error(msg);
    } finally {
      setClaiming(false);
    }
  }, [accessToken, isAuthenticated, token]);

  const handleReshare = React.useCallback(async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: share?.title ?? 'MeetMind', url });
        return;
      }
    } catch {
      // 用户取消 / 不支持，走复制兜底
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(COPY.share.creator.doneCopied);
    } catch {
      toast.error('复制失败，请手动复制地址栏');
    }
  }, [share?.title]);

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-3 px-4 py-10 text-center">
        <OctoBuddySprite mood="thinking" size="md" />
        <p className="text-[13px] text-ink-muted">{COPY.loading.preparing}</p>
      </main>
    );
  }

  if (notFound || !share) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-4 py-10 text-center">
        <OctoBuddySprite mood="surprised" size="md" />
        <h1 className="text-[18px] font-semibold text-ink">
          {COPY.share.landing.notFoundTitle}
        </h1>
        <p className="text-[13px] leading-7 text-ink-secondary">
          {COPY.share.landing.notFoundBody}
        </p>
        <Link href="/" className="mt-2 text-[12.5px] text-ink-muted underline-offset-4 hover:underline">
          回 MeetMind 首页
        </Link>
      </main>
    );
  }

  const sharerNickname = share.sharerNickname?.trim() || '一位同学';

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-5 px-4 py-8 sm:py-10">
      {/* 头部：分享者 + 课名 */}
      <header className="flex items-center gap-4">
        <OctoBuddySprite mood="happy" size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] uppercase tracking-[0.18em] text-ink-muted">
            {share.sharerNickname
              ? COPY.share.landing.sharedBy(sharerNickname)
              : COPY.share.landing.sharedByAnon}
          </p>
          <h1 className="mt-1 truncate text-[20px] font-semibold tracking-tight text-ink sm:text-[22px]">
            {share.title}
          </h1>
          {share.subject ? (
            <p className="mt-0.5 text-[12.5px] text-ink-secondary">{share.subject}</p>
          ) : null}
        </div>
      </header>

      {/* 转录摘要（轻量陈列） */}
      {share.snapshot.transcriptDigest.segments.length > 0 ? (
        <section className="rounded-3xl border border-divider bg-[#FBFBFA] px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
            {COPY.share.landing.digestTitle}
          </p>
          <ul className="mt-3 flex flex-col gap-2.5 text-[13.5px] leading-[1.85] text-ink">
            {share.snapshot.transcriptDigest.segments.slice(0, 6).map((seg, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-shrink-0 text-[11px] tabular-nums text-ink-muted">
                  {Math.floor(seg.startSec / 60)
                    .toString()
                    .padStart(2, '0')}
                  :
                  {Math.floor(seg.startSec % 60)
                    .toString()
                    .padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1">{seg.text}</span>
              </li>
            ))}
          </ul>
          {share.snapshot.transcriptDigest.segments.length > 6 ? (
            <p className="mt-2 text-[11.5px] text-ink-muted">
              另 {share.snapshot.transcriptDigest.segments.length - 6} 段在同学的记忆里。
            </p>
          ) : null}
        </section>
      ) : null}

      {/* 产物预览 */}
      <ArtifactPreview artifactKind={share.artifactKind} artifact={share.snapshot.artifact} />

      {/* 对话面板 */}
      {share.conversationEnabled ? (
        <SharedAgentChat
          shareToken={token}
          courseTitle={share.title}
          sharerNickname={sharerNickname}
          authToken={accessToken ?? undefined}
        />
      ) : null}

      {/* 底部动作栏 */}
      <footer className="sticky bottom-3 mt-2 flex items-center gap-2 rounded-full border border-divider bg-white px-3 py-2 shadow-sm">
        <button
          type="button"
          onClick={handleClaim}
          disabled={claiming}
          className="flex-1 rounded-full bg-[#232322] px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-[#111] disabled:opacity-50"
        >
          {claimed
            ? COPY.share.landing.claimDone
            : claiming
              ? COPY.share.landing.claiming
              : isAuthenticated
                ? COPY.share.landing.claimAction
                : COPY.share.landing.claimGo}
        </button>
        <button
          type="button"
          onClick={handleReshare}
          className="rounded-full border border-divider bg-white px-4 py-2.5 text-[13px] font-medium text-ink-secondary transition hover:border-ink/30 hover:text-ink"
        >
          {COPY.share.landing.reshareAction}
        </button>
      </footer>

      <p className="text-center text-[11px] text-ink-muted">
        {COPY.share.landing.viewCount(share.viewCount)}
      </p>
    </main>
  );
}
