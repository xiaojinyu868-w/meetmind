'use client';

/**
 * MyShareList —— 我的分享管理面（v3.0 SharedAgent 闭环管理）
 *
 * 第一性原理：A 把分享递出去之后，要能回来看「现在被谁打开了几次 / 几个人聊过 /
 * 几个人领走」，并随时撤销。这是 A 对自己分享的**后悔权**和**透明度**。
 *
 * 列表项展示：
 * - 标题 + artifact 类型（速查表 / 测验 / 思维导图 ...）
 * - 状态徽章：已发布 / 已撤销
 * - 浏览数 / 对话数 / 领取数 三个数字
 * - 操作：看落地页 / 复制链接 / 撤销
 */

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useAuth } from '@/lib/hooks/useAuth';
import { OctoBuddySprite } from '@/components/classroom/OctoBuddy';
import { COPY } from '@/lib/ui/copy';
import type { MySharedAgentSummary } from '@/lib/services/share-agent-service';

const KIND_LABEL: Record<string, string> = {
  cheatsheet: '考前速查表',
  mindmap: '思维导图',
  quiz: '课堂测验',
  flashcards: '课堂闪卡',
  infographic: '课堂信息图',
  'audio-overview': '课堂播客',
  notes: '同学版笔记',
  'chat-only': '一段对话',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function MyShareList() {
  const { isAuthenticated, accessToken } = useAuth();
  const [shares, setShares] = React.useState<MySharedAgentSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [revoking, setRevoking] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch('/api/share/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { shares: MySharedAgentSummary[] };
      setShares(data.shares);
    } catch (err) {
      console.error('[my-shares] load failed', err);
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const handleRevoke = React.useCallback(
    async (token: string) => {
      if (!accessToken) return;
      if (!window.confirm('撤销之后这条分享对所有人都打不开了，已经领过的同学不受影响。要继续吗？')) {
        return;
      }
      setRevoking(token);
      try {
        const res = await fetch(`/api/share/${encodeURIComponent(token)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          throw new Error(detail.error || `HTTP ${res.status}`);
        }
        toast.success('已撤销');
        await reload();
      } catch (err) {
        const msg = err instanceof Error ? err.message : '撤销失败';
        toast.error(msg);
      } finally {
        setRevoking(null);
      }
    },
    [accessToken, reload],
  );

  const handleCopy = React.useCallback(async (token: string) => {
    const url = `${window.location.origin}/share/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(COPY.share.creator.doneCopied);
    } catch {
      toast.error('复制失败，请手动复制');
    }
  }, []);

  if (!isAuthenticated) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-3 px-4 text-center">
        <OctoBuddySprite mood="thinking" size="md" />
        <p className="text-[14px] text-ink-secondary">先登录看你的分享</p>
        <Link
          href="/login?next=/me/shares"
          className="rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-white"
        >
          去登录
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-8 sm:py-10">
      {/* 头部 */}
      <header className="flex items-center gap-4">
        <OctoBuddySprite mood="happy" size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] uppercase tracking-[0.18em] text-ink-muted">
            MY SHARES
          </p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-ink">
            我递出去的分享
          </h1>
          <p className="mt-0.5 text-[12.5px] text-ink-secondary">
            谁打开了 · 谁聊过 · 谁领走了。这里都看得到。
          </p>
        </div>
        <Link
          href="/app"
          className="rounded-full border border-divider bg-white px-4 py-2 text-[12.5px] text-ink-secondary transition hover:border-pine hover:text-pine"
        >
          回工作台
        </Link>
      </header>

      {/* 列表 */}
      {loading ? (
        <div className="flex flex-col items-center gap-3 py-20">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-divider border-t-ink/40" />
          <p className="text-[12.5px] text-ink-muted">{COPY.loading.preparing}</p>
        </div>
      ) : shares.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-divider bg-[#F2EDE3] px-8 py-16 text-center">
          <OctoBuddySprite mood="idle" size="md" />
          <p className="mt-4 text-[14px] text-ink">还没有分享出去过</p>
          <p className="mt-1.5 text-[12.5px] text-ink-secondary">
            录完一节课，到应用矩阵的「把这节课递给同学」那块，挑一个递出去
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {shares.map((s) => {
            const kindLabel = KIND_LABEL[s.artifactKind] ?? '一份分享';
            const isRevoked = s.status === 'revoked';
            return (
              <li
                key={s.token}
                className={`rounded-3xl border bg-white px-5 py-4 transition ${
                  isRevoked ? 'border-divider/40 opacity-60' : 'border-divider'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                          isRevoked
                            ? 'bg-paper-warm text-ink-muted'
                            : 'bg-pine-mist text-pine'
                        }`}
                      >
                        {isRevoked ? '已撤销' : '已发布'}
                      </span>
                      <span className="text-[11px] text-ink-muted">{kindLabel}</span>
                      <span className="text-[11px] text-ink-muted">·</span>
                      <span className="text-[11px] text-ink-muted">{formatDate(s.createdAt)}</span>
                    </div>
                    <h3 className="mt-1.5 truncate text-[15px] font-medium tracking-tight text-ink">
                      {s.title}
                    </h3>
                    <div className="mt-2 flex items-center gap-4 text-[12px] text-ink-secondary">
                      <span>
                        <span className="font-semibold text-ink">{s.viewCount}</span> 次打开
                      </span>
                      <span>
                        <span className="font-semibold text-ink">{s.chatCount}</span> 次对话
                      </span>
                      <span>
                        <span className="font-semibold text-ink">{s.claimCount}</span> 人领走
                      </span>
                    </div>
                  </div>
                </div>

                {!isRevoked ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Link
                      href={`/share/${s.token}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-divider bg-white px-3.5 py-1.5 text-[12px] text-ink-secondary transition hover:border-pine hover:text-pine"
                    >
                      看落地页
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleCopy(s.token)}
                      className="rounded-full border border-divider bg-white px-3.5 py-1.5 text-[12px] text-ink-secondary transition hover:border-pine hover:text-pine"
                    >
                      复制链接
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevoke(s.token)}
                      disabled={revoking === s.token}
                      className="ml-auto rounded-full border border-vermilion/40 bg-white px-3.5 py-1.5 text-[12px] text-vermilion transition hover:bg-vermilion-mist/60 disabled:opacity-50"
                    >
                      {revoking === s.token ? '撤销中…' : '撤销'}
                    </button>
                  </div>
                ) : (
                  <p className="mt-2 text-[11.5px] italic text-ink-muted">
                    访客打开会看到「这条分享暂时不可用」。
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* 隐私铁律提示 */}
      <p className="mt-2 text-center text-[11px] leading-6 text-ink-muted">
        分享只带这节课的内容和你挑的产物，不会带你的私人对话或答题数据。<br />
        撤销后已经领过的同学手里那份不变（snapshot 是当时刻一份）。
      </p>
    </main>
  );
}
