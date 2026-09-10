'use client';

/**
 * LiveEntry —— 开课前的一屏：一句话问「今天想学什么」，一行输入，几颗建议，上过的课。
 * 点击「开始上课」是用户手势：这一下同时解锁了语音自动播放。
 */

import * as React from 'react';
import { TEACH_LIVE_COPY } from '@/lib/ui/copy-teach-live';
import { liveListThreads, type LiveThreadMeta } from './live-client';

interface LiveEntryProps {
  starting: boolean;
  error: string | null;
  onStart: (topic: string) => void;
  onResume: (threadId: string) => void;
}

function relativeDay(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function LiveEntry({ starting, error, onStart, onResume }: LiveEntryProps) {
  const [topic, setTopic] = React.useState('');
  const [recent, setRecent] = React.useState<LiveThreadMeta[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    liveListThreads()
      .then((list) => {
        if (!cancelled) setRecent(list.slice(0, 6));
      })
      .catch(() => {
        if (!cancelled) setRecent([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const start = (value: string) => {
    const clean = value.trim();
    if (!clean || starting) return;
    onStart(clean);
  };

  return (
    <div className="live-root">
      <div className="live-entry">
        <div className="live-entry-card">
          <div className="live-entry-eyebrow">{TEACH_LIVE_COPY.entryEyebrow}</div>
          <h1>{TEACH_LIVE_COPY.entryTitle}</h1>
          <p className="live-entry-hint">{TEACH_LIVE_COPY.entryHint}</p>
          <form
            className="live-entry-form"
            onSubmit={(e) => {
              e.preventDefault();
              start(topic);
            }}
          >
            <input
              autoFocus
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={TEACH_LIVE_COPY.entryPlaceholder}
              maxLength={100}
              aria-label={TEACH_LIVE_COPY.entryTitle}
            />
            <button type="submit" className="live-entry-start" disabled={starting || !topic.trim()}>
              {starting ? TEACH_LIVE_COPY.entryStarting : TEACH_LIVE_COPY.entryStart}
            </button>
          </form>
          {error ? <div className="live-error">{error}</div> : null}
          <div className="live-entry-suggestions">
            <p>{TEACH_LIVE_COPY.entrySuggestionsTitle}</p>
            <div className="live-chips">
              {TEACH_LIVE_COPY.entrySuggestions.map((s) => (
                <button key={s} type="button" className="live-chip" onClick={() => start(s)} disabled={starting}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="live-recent">
            <h2>{TEACH_LIVE_COPY.recentTitle}</h2>
            {recent === null ? null : recent.length === 0 ? (
              <div className="live-recent-empty">{TEACH_LIVE_COPY.recentEmpty}</div>
            ) : (
              <div className="live-recent-list">
                {recent.map((t) => (
                  <button key={t.id} type="button" className="live-recent-item" onClick={() => onResume(t.id)}>
                    <span>{t.title}</span>
                    <small>
                      {relativeDay(t.updatedAt)} · {TEACH_LIVE_COPY.resume}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
