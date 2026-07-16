'use client';

/**
 * SharedAgentLanding — 公开落地页主体（v3.0 · v7 视觉升级）
 *
 * 任何人凭 token 可访问。
 * 1. 拉取 GET /api/share/[token]
 * 2. 渲染分享者 + 课程标题 + 转录摘要 + artifact 预览 + 同学（如果允许对话）
 * 3. 提供「领取到我的工作台」（要登录）和「也分享给别人」按钮
 *
 * v3.0 P0 闭环：
 * - 未登录点「领取」→ 跳 /login?next=/share/[token]?autoClaim=1
 * - 登录后回到本页 → useEffect 检测 ?autoClaim=1 + 已登录 → 自动 claim 不再让用户再点一次
 * - claim 成功 → 1.2 秒后打开 /app，引导去自己工作台看完整产物
 *
 * v7 视觉升级：
 * - 大气场 hero（米白 + 极淡墨绿/朱批光晕）—— 这是 MeetMind "唯一允许放飞"的页面
 * - Octo 永驻主图 · 大尺寸 + 呼吸光环 + hero-float 动画
 * - 双签名色：墨松绿 = AI / 已就绪；朱批红 = 此刻 / 重点
 * - Inter 西文 + Instrument Serif 仪式字
 * - JetBrains Mono 引用资产化（[MM:SS] / [资料 N]）
 */

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/lib/hooks/useAuth';
import { COPY } from '@/lib/ui/copy';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import { useOctoMood } from '@/lib/hooks/useOctoMood';
import { ArtifactRender } from '@/components/share/ArtifactRender';
import { SharedAgentChat } from './SharedAgentChat';
import type {
  PublicSharedAgent,
  ShareArtifactKind,
} from '@/lib/services/share-agent-service';

interface SharedAgentLandingProps {
  token: string;
}

/**
 * artifact 预览 —— v3.0 修正版：
 *   v0 只显示 summary 一行字，对方看不到产物本身——这是反裂变设计。
 *   现在用 ArtifactRender 真把 cheatsheet 6 区 / mindmap 树 / quiz 题面渲染出来，
 *   让对方第一眼就看到价值，再决定是否对话 / 领取。
 */
function ArtifactPreview({
  artifactKind,
  artifact,
}: {
  artifactKind: ShareArtifactKind;
  artifact?: unknown;
}) {
  const title = COPY.share.landing.artifactTitle(artifactKind);
  return (
    <section className="rounded-2xl border border-divider bg-card shadow-soft overflow-hidden">
      <div className="px-6 py-4 border-b border-divider/60 bg-paper">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-caps text-pine">
          {title}
        </p>
      </div>
      <div className="px-6 py-6">
        <ArtifactRender artifactKind={artifactKind} artifact={artifact} />
      </div>
    </section>
  );
}

export function SharedAgentLanding({ token }: SharedAgentLandingProps) {
  const searchParams = useSearchParams();
  // v7 Octo IP：分享落地页是"陌生访客在班级群点开"的场景。
  // ctx='shared-landing' = 默认 happy（学生分享了什么作品的 hero 表情），
  // 但凌晨自动切 sleeping（夜深了 AI 也在歇）——更人性化。
  // claim 成功瞬间触发 react('shared') → love（让 Octo 表达"被领取"的开心）
  const { mood: octoMoodLanding, react: octoReact } = useOctoMood({ ctx: 'shared-landing' });
  const { isAuthenticated, accessToken } = useAuth();
  const [share, setShare] = React.useState<PublicSharedAgent | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [notFound, setNotFound] = React.useState(false);
  const [claiming, setClaiming] = React.useState(false);
  const [claimed, setClaimed] = React.useState(false);
  const [claimedCaptureId, setClaimedCaptureId] = React.useState<string | null>(null);
  /** P0：从 ?autoClaim=1 触发的自动领取，与手动 claim 分开管理避免双调 */
  const autoClaimAttemptedRef = React.useRef(false);

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
    if (claimed) {
      const destination = claimedCaptureId
        ? `/app?claimedCapture=${encodeURIComponent(claimedCaptureId)}`
        : '/app';
      window.location.assign(destination);
      return;
    }
    if (!isAuthenticated || !accessToken) {
      // 未登录：跳到登录，登录后回到这页，URL 上带 autoClaim=1
      // 让落地页 effect 自动触发 claim，省一次手动点击
      const next = encodeURIComponent(`/share/${token}?autoClaim=1`);
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
      const data = (await res.json()) as {
        success: boolean;
        captureId: string;
        alreadyClaimed?: boolean;
      };
      setClaimed(true);
      setClaimedCaptureId(data.captureId);
      // v7 Octo IP：领取成功瞬间切到 love mood（被领取 = 被珍视 = 开心）
      octoReact('shared');
      toast.success(
        data.alreadyClaimed
          ? COPY.share.landing.claimAlready
          : COPY.share.landing.claimDone,
        {
          description: COPY.share.landing.claimRedirecting,
        },
      );
      // P0 闭环最后一步：领取成功 → 1.2 秒后跳工作台，让 B 从分享态自然进入
      // 自己的学习现场，看到刚领取的 capture
      window.setTimeout(() => {
        window.location.assign(`/app?claimedCapture=${encodeURIComponent(data.captureId)}`);
      }, 1200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '领取失败';
      toast.error(msg);
    } finally {
      setClaiming(false);
    }
  }, [accessToken, claimed, claimedCaptureId, isAuthenticated, octoReact, token]);

  /**
   * P0 自动 claim：
   * 当 URL 上有 ?autoClaim=1 (来自登录回流) 且当前已登录 + share 已加载 + 未在 claiming 中
   * → 自动触发一次 claim，并清掉 URL 参数避免刷新重复触发
   */
  React.useEffect(() => {
    if (autoClaimAttemptedRef.current) return;
    if (loading || !share) return;
    if (!isAuthenticated || !accessToken) return;
    if (searchParams?.get('autoClaim') !== '1') return;

    autoClaimAttemptedRef.current = true;

    // 清掉 URL 参数（用 history.replaceState 避免触发 next/navigation 重渲染）
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('autoClaim');
      window.history.replaceState({}, '', url.toString());
    }
    void handleClaim();
  }, [accessToken, handleClaim, isAuthenticated, loading, searchParams, share]);

  const handleReshare = React.useCallback(async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(COPY.share.creator.doneCopied);
    } catch {
      toast.error(COPY.share.landing.reshareFailed);
    }
  }, []);

  // ===== Loading 态：v7 仪式感 =====
  if (loading) {
    return (
      <main className="relative mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-4 py-10 text-center bg-paper">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            background:
              'radial-gradient(ellipse 60% 50% at 50% 40%, rgba(45,79,62,0.08), transparent 60%)',
          }}
        />
        <div className="relative z-10 flex flex-col items-center gap-4">
          <OctoAvatar mood={octoMoodLanding === 'sleeping' ? 'sleeping' : 'thinking'} size="xl" aura />
          <p className="font-mono text-xs uppercase tracking-caps text-ink-muted">
            {octoMoodLanding === 'sleeping' ? '夜深了 · 同学先打个盹' : COPY.loading.preparing}
          </p>
        </div>
      </main>
    );
  }

  // ===== 404 态 =====
  if (notFound || !share) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-4 py-10 text-center bg-paper">
        <OctoAvatar mood="surprised" size="xl" aura={false} />
        <h1 className="text-lg font-semibold tracking-h text-ink">
          {COPY.share.landing.notFoundTitle}
        </h1>
        <p className="text-sm leading-relaxed text-ink-secondary max-w-md">
          {COPY.share.landing.notFoundBody}
        </p>
        <Link
          href="/"
          className="mt-2 text-xs text-ink-muted underline-offset-4 hover:underline hover:text-pine transition-colors"
        >
          回 MeetMind 首页
        </Link>
      </main>
    );
  }

  const sharerNickname = share.sharerNickname?.trim() || '一位同学';

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-paper">
      {/* ===== 大气场背景（v7 唯一允许放飞）===== */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background: `
            radial-gradient(ellipse 60% 50% at 25% 25%, rgba(45,79,62,0.16) 0%, transparent 60%),
            radial-gradient(ellipse 60% 50% at 75% 70%, rgba(181,72,60,0.10) 0%, transparent 60%)
          `,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 opacity-50"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(28,27,25,0.04) 1px, transparent 0)',
          backgroundSize: '40px 40px',
        }}
      />

      <main className="relative z-10 mx-auto flex min-h-screen max-w-2xl flex-col gap-5 px-4 py-8 sm:py-12">

        {/* ===== Hero：分享者 + 课名 + Octo 主图 ===== */}
        <header className="flex flex-col items-center gap-5 text-center sm:gap-6 sm:py-4">
          {/* Octo 主图：大尺寸 + 呼吸光环 + 漂浮动画
               v7 Octo mood：默认按 ctx 是 happy，凌晨切 sleeping，
               claim 成功瞬间切 love（短暂 2.4s 然后回到 happy）。 */}
          <div className="relative">
            <div
              aria-hidden
              className="absolute inset-0 -m-8 rounded-full"
              style={{
                background:
                  'radial-gradient(circle, rgba(45,79,62,0.18) 0%, rgba(181,72,60,0.08) 50%, transparent 75%)',
                animation: 'octo-breath-v7 4s ease-in-out infinite',
              }}
            />
            <Image
              src={`/images/octo-buddy/${
                octoMoodLanding === 'love' ? 'love' :
                octoMoodLanding === 'sleeping' ? 'sleeping' :
                octoMoodLanding === 'happy' ? 'happy' :
                'original'
              }.png`}
              alt={`${sharerNickname} 的学习同桌`}
              width={160}
              height={160}
              className="relative z-10 size-32 sm:size-40 object-contain animate-hero-float"
              style={{ filter: 'drop-shadow(0 16px 40px rgba(45,79,62,0.18))' }}
              priority
              unoptimized
            />
          </div>

          {/* eyebrow + 标题 */}
          <div className="space-y-2 max-w-xl">
            <p className="inline-flex items-center gap-2 rounded-full bg-pine-mist px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-caps text-pine">
              <span className="size-1.5 rounded-full bg-pine animate-rec-pulse" />
              <span>
                {share.sharerNickname
                  ? COPY.share.landing.sharedBy(sharerNickname)
                  : COPY.share.landing.sharedByAnon}
              </span>
            </p>
            <h1 className="text-2xl font-semibold tracking-display text-ink sm:text-3xl leading-tight">
              {share.title}
            </h1>
            {share.subject ? (
              <p className="text-sm text-ink-secondary">{share.subject}</p>
            ) : null}
          </div>
        </header>

        {/* ===== 转录摘要（轻量陈列）=====
            不显示时间戳：访客没有原录音可跳，
            [00:01] 这种数字对她毫无意义，反而看起来像"半成品"。 */}
        {share.snapshot.transcriptDigest.segments.length > 0 ? (
          <section className="rounded-2xl border border-divider bg-card/80 backdrop-blur-sm px-5 py-5 shadow-soft">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-caps text-ink-muted">
              {COPY.share.landing.digestTitle}
            </p>
            <ul className="mt-3 flex flex-col gap-2 text-sm leading-loose text-ink">
              {share.snapshot.transcriptDigest.segments.slice(0, 6).map((seg, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span
                    aria-hidden
                    className="mt-2.5 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-pine-light"
                  />
                  <span className="min-w-0 flex-1">
                    {seg.speaker?.trim() ? (
                      <span className="text-ink-secondary font-medium">
                        {seg.speaker.trim()}：
                      </span>
                    ) : null}
                    {seg.text}
                  </span>
                </li>
              ))}
            </ul>
            {share.snapshot.transcriptDigest.segments.length > 6 ? (
              <p className="mt-3 text-xs text-ink-muted italic">
                另 {share.snapshot.transcriptDigest.segments.length - 6} 段在同学的记忆里。
              </p>
            ) : null}
          </section>
        ) : null}

        {/* ===== 产物预览 ===== */}
        <ArtifactPreview artifactKind={share.artifactKind} artifact={share.snapshot.artifact} />

        {/* ===== 对话面板 ===== */}
        {share.conversationEnabled ? (
          <SharedAgentChat
            shareToken={token}
            courseTitle={share.title}
            sharerNickname={sharerNickname}
            authToken={accessToken ?? undefined}
          />
        ) : null}

        {/* ===== 底部动作栏 · 玻璃态 sticky =====
             v7 仪式感：主 CTA 在未点击前用 pine ring 微光环吸引注意，
             点击后 ring 收紧 + scale；claim 成功瞬间 ring 变 vermilion 朱批闪光（"被领取"信号）。 */}
        <footer className="sticky bottom-3 mt-2 flex items-center gap-2 rounded-full border border-divider bg-card/95 backdrop-blur-md px-3 py-2 shadow-card">
          <button
            type="button"
            onClick={handleClaim}
            disabled={claiming}
            className={`group relative flex-1 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-white transition-all duration-200 ease-out hover:bg-pine-deep hover:-translate-y-px active:scale-[0.98] disabled:opacity-50 disabled:cursor-wait ${
              claimed
                ? 'ring-2 ring-vermilion/40 shadow-[0_0_0_4px_rgba(181,72,60,0.10)]'
                : claiming
                  ? 'ring-2 ring-pine/40'
                  : 'ring-1 ring-pine/0 hover:ring-pine/30 hover:shadow-[0_0_0_4px_rgba(45,79,62,0.08)]'
            }`}
          >
            {/* 极淡光带（claim 中流动） */}
            {claiming ? (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 overflow-hidden rounded-full"
                style={{
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer-fast 1.4s linear infinite',
                }}
              />
            ) : null}
            <span className="relative">
              {claimed
                ? COPY.share.landing.claimDone
                : claiming
                  ? COPY.share.landing.claiming
                  : isAuthenticated
                    ? COPY.share.landing.claimAction
                    : COPY.share.landing.claimGo}
            </span>
          </button>
          <button
            type="button"
            onClick={handleReshare}
            className="rounded-full border border-divider bg-card px-4 py-2.5 text-sm font-medium text-ink-secondary transition-all duration-150 ease-out hover:border-pine hover:text-pine hover:-translate-y-px"
          >
            {COPY.share.landing.reshareAction}
          </button>
        </footer>

        <p className="text-center font-mono text-[11px] text-ink-muted">
          {COPY.share.landing.viewCount(share.viewCount)}
        </p>
      </main>
    </div>
  );
}
