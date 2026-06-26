'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSessionId } from '@/stores/session-store';
import { useFeedStream } from '@/hooks/data/useFeedStream';
import { useOpenBiliClawConnection } from '@/hooks/useOpenBiliClawConnection';
import {
  getRecommendations,
  submitBilibiliCookie,
  triggerInit,
  type OBRecommendation,
} from '@/lib/services/openbiliclaw-client';
import { FeedStream } from '@/components/FeedStream';
import { COPY } from '@/lib/ui/copy';
import type { TranscriptSegment } from '@/types';
import type { FeedItem } from '@/types';

interface FeedStreamPanelProps {
  segments: TranscriptSegment[];
  /** 跳到时间戳 */
  onSeek?: (timeMs: number) => void;
  /** 让同学解释 */
  onAskTutor?: (text: string) => void;
}

/**
 * 信息流面板 — 复习态 feed tab 内容。
 *
 * Phase 1: MeetMind 自带 LLM 信息流（所有用户）
 * Phase 2: OpenBiliClaw 在线时追加 B站视频卡片推荐（技术性学生）
 */
export function FeedStreamPanel({ segments, onSeek, onAskTutor }: FeedStreamPanelProps) {
  const sessionId = useSessionId();
  const hasGeneratedRef = useRef(false);

  // Phase 1: MeetMind 自带信息流
  const { items, isLoading, error, generate } = useFeedStream({
    sessionId,
    segments,
  });

  // Phase 2: OpenBiliClaw 连接检测 + B站推荐
  const { online: obOnline } = useOpenBiliClawConnection();
  const [obRecs, setObRecs] = useState<OBRecommendation[]>([]);
  const [obLoading, setObLoading] = useState(false);
  const [cookieInput, setCookieInput] = useState('');
  const [cookieStatus, setCookieStatus] = useState<'idle' | 'connecting' | 'success' | 'error'>('idle');
  const [needsCookie, setNeedsCookie] = useState(false);

  // 首次切到 feed tab 且有转录内容时自动生成 MeetMind 信息流
  useEffect(() => {
    if (segments.length > 0 && !hasGeneratedRef.current && !isLoading) {
      hasGeneratedRef.current = true;
      void generate();
    }
  }, [segments.length, isLoading, generate]);

  // OpenBiliClaw 在线时拉取推荐
  const refreshObRecs = useCallback(async () => {
    if (!obOnline) return;
    setObLoading(true);
    const recs = await getRecommendations(5);
    setObRecs(recs);
    setNeedsCookie(recs.length === 0);
    setObLoading(false);
  }, [obOnline]);

  useEffect(() => {
    if (obOnline) {
      void refreshObRecs();
    } else {
      setObRecs([]);
      setNeedsCookie(false);
    }
  }, [obOnline, refreshObRecs]);

  // Cookie 提交
  const handleSubmitCookie = async () => {
    if (!cookieInput.trim()) return;
    setCookieStatus('connecting');
    const result = await submitBilibiliCookie(cookieInput.trim());
    if (result.ok && result.authenticated) {
      setCookieStatus('success');
      setCookieInput('');
      // 触发 init 拉取历史 + 生成画像 + 首轮发现
      await triggerInit();
      // 等一会儿再刷新推荐
      setTimeout(() => void refreshObRecs(), 3000);
    } else {
      setCookieStatus('error');
    }
  };

  // MeetMind 信息流的动作处理
  const handleAction = (item: FeedItem) => {
    if (item.actionType === 'jump-timestamp' && item.timestamps?.[0] && onSeek) {
      const parts = item.timestamps[0].split(':');
      const mins = parseInt(parts[0] || '0', 10);
      const secs = parseInt(parts[1] || '0', 10);
      onSeek((mins * 60 + secs) * 1000);
    } else if (item.actionType === 'ask-tutor' && onAskTutor) {
      onAskTutor(item.title);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      {/* ── Phase 2: OpenBiliClaw B站视频推荐 ── */}
      {obOnline && (
        <div className="mb-5">
          <div className="mb-2.5 flex items-baseline gap-2">
            <h3 className="text-[14px] font-semibold text-pine">{COPY.feed.obSection}</h3>
            <span className="text-[11px] text-ink-muted">{COPY.feed.obSectionHint}</span>
          </div>

          {/* Cookie 填写入口（没有推荐时显示） */}
          {needsCookie && !obLoading && (
            <div className="rounded-xl border border-divider bg-paper p-4">
              <p className="mb-2 text-[13px] text-ink-secondary">{COPY.feed.obEmpty}</p>
              <textarea
                value={cookieInput}
                onChange={(e) => setCookieInput(e.target.value)}
                placeholder={COPY.feed.obCookiePlaceholder}
                className="mb-2 w-full rounded-lg border border-divider bg-card px-3 py-2 text-[12px] text-ink placeholder:text-ink-muted/60 focus:border-pine focus:outline-none"
                rows={2}
              />
              <button
                type="button"
                onClick={handleSubmitCookie}
                disabled={!cookieInput.trim() || cookieStatus === 'connecting'}
                className="rounded-lg bg-pine px-4 py-2 text-[12px] font-medium text-white transition-colors hover:bg-pine-deep disabled:opacity-50"
              >
                {cookieStatus === 'connecting' ? COPY.feed.obCookieConnecting : COPY.feed.obCookieSubmit}
              </button>
              {cookieStatus === 'success' && (
                <p className="mt-2 text-[11px] text-pine">{COPY.feed.obCookieSuccess}</p>
              )}
              {cookieStatus === 'error' && (
                <p className="mt-2 text-[11px] text-vermilion">{COPY.feed.obCookieError}</p>
              )}
            </div>
          )}

          {/* B站视频卡片列表 */}
          {obRecs.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {obRecs.map((rec) => (
                <BilibiliVideoCard key={rec.id} rec={rec} />
              ))}
            </div>
          )}

          {/* 加载中 */}
          {obLoading && (
            <div className="py-4 text-center">
              <div className="mx-auto h-1 w-20 animate-pulse rounded-full bg-pine-mist" />
              <p className="mt-2 text-[11px] text-ink-muted">{COPY.feed.obInitProgress}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Phase 1: MeetMind 自带信息流 ── */}
      <div>
        {obOnline && items.length > 0 && (
          <div className="mb-2.5 flex items-baseline gap-2">
            <h3 className="text-[14px] font-semibold text-ink">{COPY.feed.typeSummary}</h3>
          </div>
        )}
        <FeedStream
          items={items}
          isLoading={isLoading}
          error={error}
          onAction={handleAction}
          onRetry={generate}
        />
      </div>
    </div>
  );
}

// ─── B站视频卡片 ──────────────────────────────────────────────

function BilibiliVideoCard({ rec }: { rec: OBRecommendation }) {
  const bilibiliUrl = rec.content_url || `https://www.bilibili.com/video/${rec.bvid}`;

  return (
    <a
      href={bilibiliUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 rounded-xl border border-divider bg-card p-3 transition-colors hover:border-pine/30 hover:bg-paper"
    >
      {/* 封面 */}
      {rec.cover_url && (
        <img
          src={rec.cover_url}
          alt=""
          className="h-[60px] w-[106px] flex-shrink-0 rounded-lg object-cover"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}

      {/* 内容 */}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">
          {rec.title}
        </p>
        {rec.up_name && (
          <p className="mt-0.5 text-[11px] text-ink-muted">{rec.up_name}</p>
        )}
        {rec.expression && (
          <p className="mt-1 line-clamp-2 text-[11px] italic leading-relaxed text-pine-light">
            {rec.expression}
          </p>
        )}
        {rec.topic_label && (
          <span className="mt-1 inline-block rounded-md bg-pine-fog px-1.5 py-0.5 text-[10px] font-medium text-pine-deep">
            {rec.topic_label}
          </span>
        )}
      </div>
    </a>
  );
}
