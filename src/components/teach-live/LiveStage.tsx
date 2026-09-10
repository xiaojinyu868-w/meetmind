'use client';

/**
 * LiveStage —— 上课中的整块屏：顶栏（课名 / 页签 / 声音 / 记录）→ 板 → 字幕 → 输入。
 *
 * 板只展示 activePage（学生手动翻的页优先，否则跟随老师演出到的页）；新块揭示后
 * 平滑滚到它；激光笔叠在板的滚动内容上。字幕在板下方的暗区，跟声音同步：
 * pending（合成中）半透明、speaking 全亮。
 */

import * as React from 'react';
import { ArrowLeft, ListTree, Volume2, VolumeX } from 'lucide-react';
import { TEACH_LIVE_COPY } from '@/lib/ui/copy-teach-live';
import { LiveBlockView } from './blocks/LiveBlockView';
import { LiveComposer } from './LiveComposer';
import { LivePointer } from './LivePointer';
import { activePage } from './live-model';
import type { LiveLessonController } from './useLiveLesson';

interface LiveStageProps {
  lesson: LiveLessonController;
  /** 历史课程打开后到首次真实流之前为 false：块直接终态 */
  live: boolean;
  onLeave: () => void;
}

export function LiveStage({ lesson, live, onLeave }: LiveStageProps) {
  const { state, caption, speaking, muted, setMuted, connection, pointer, busy, send, hush, viewPage } = lesson;
  const page = activePage(state);
  const isFollowing = state.viewingPageId === null;
  const boardInnerRef = React.useRef<HTMLDivElement>(null);
  const boardRef = React.useRef<HTMLDivElement>(null);
  const [transcriptOpen, setTranscriptOpen] = React.useState(false);

  // 新块揭示 / 图长出新元素 → 滚到最新处（学生正在看别的页时不打扰）
  const revealedCount = page.blockIds.filter((id) => state.blocks[id]?.segments.some((s) => s.revealed)).length;
  const [growTick, setGrowTick] = React.useState(0);
  const onGrow = React.useCallback(() => setGrowTick((t) => t + 1), []);
  React.useEffect(() => {
    if (!isFollowing || !live) return;
    const board = boardRef.current;
    if (!board) return;
    const id = requestAnimationFrame(() => {
      // 只在最新一块露不全时滚动（nearest），别把页首标题顶出去
      const blocks = board.querySelectorAll<HTMLElement>('.live-block');
      const last = blocks[blocks.length - 1];
      if (last) last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [revealedCount, growTick, isFollowing, live, page.id]);

  const statusText = (() => {
    if (connection === 'reconnecting') return TEACH_LIVE_COPY.statusReconnecting;
    if (speaking) return TEACH_LIVE_COPY.statusSpeaking;
    if (state.generating && !caption) return TEACH_LIVE_COPY.statusThinking;
    if (!busy && state.pendingAsk) return TEACH_LIVE_COPY.statusWaiting;
    return null;
  })();

  return (
    <div className="live-root">
      <header className="live-topbar">
        <div className="live-topbar-left">
          <button type="button" className="live-icon-btn" onClick={onLeave} aria-label={TEACH_LIVE_COPY.backToEntry} title={TEACH_LIVE_COPY.backToEntry}>
            <ArrowLeft />
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="live-topbar-eyebrow">{TEACH_LIVE_COPY.entryEyebrow}</div>
            <div className="live-lesson-title">{state.title || state.topic}</div>
          </div>
        </div>
        <nav className="live-pages" aria-label={TEACH_LIVE_COPY.pagesLabel}>
          {state.pages.map((p, i) => {
            const isActive = p.id === page.id;
            const isStage = p.id === state.stagePageId;
            const hasContent = p.blockIds.some((id) => state.blocks[id]?.segments.some((s) => s.revealed));
            if (!hasContent && !isStage) return null;
            return (
              <button
                key={p.id}
                type="button"
                className={`live-page-chip${isActive ? ' is-active' : ''}${isStage && busy ? ' is-live' : ''}`}
                onClick={() => viewPage(isStage ? null : p.id)}
                title={p.title}
              >
                {i + 1} · {p.title}
              </button>
            );
          })}
          {!isFollowing ? (
            <button type="button" className="live-page-chip" onClick={() => viewPage(null)}>
              {TEACH_LIVE_COPY.pageFollow}
            </button>
          ) : null}
        </nav>
        <div className="live-topbar-right">
          <button
            type="button"
            className={`live-icon-btn${transcriptOpen ? ' is-on' : ''}`}
            onClick={() => setTranscriptOpen((v) => !v)}
            aria-pressed={transcriptOpen}
          >
            <ListTree />
            {TEACH_LIVE_COPY.transcriptToggle}
          </button>
          <button type="button" className="live-icon-btn" onClick={() => setMuted(!muted)} aria-label={muted ? TEACH_LIVE_COPY.unmute : TEACH_LIVE_COPY.mute} title={muted ? TEACH_LIVE_COPY.unmute : TEACH_LIVE_COPY.mute}>
            {muted ? <VolumeX /> : <Volume2 />}
          </button>
        </div>
      </header>

      <div className="live-board-wrap">
        <div className="live-board" ref={boardRef}>
          <div className="live-board-inner" ref={boardInnerRef}>
            <div className="live-page" key={page.id}>
              <div className="live-page-heading">
                <span>{state.pages.findIndex((p) => p.id === page.id) + 1}</span>
                <strong>{page.title}</strong>
              </div>
              {revealedCount === 0 ? <div className="live-board-empty">{TEACH_LIVE_COPY.boardEmpty}</div> : null}
              {page.blockIds.map((id) => {
                const block = state.blocks[id];
                if (!block) return null;
                return <LiveBlockView key={id} block={block} animate={live} onGrow={onGrow} />;
              })}
            </div>
            <LivePointer target={pointer} containerRef={boardInnerRef} />
          </div>
        </div>
        {transcriptOpen ? (
          <aside className="live-drawer" aria-label={TEACH_LIVE_COPY.transcriptTitle}>
            <h3>{TEACH_LIVE_COPY.transcriptTitle}</h3>
            {state.transcript.length === 0 ? <div className="live-recent-empty">{TEACH_LIVE_COPY.transcriptEmpty}</div> : null}
            {state.transcript
              .filter((t) => t.text.trim())
              .map((t) => (
                <div key={t.id} className={`live-drawer-item${t.role === 'student' ? ' is-student' : ''}${t.kind === 'ask' ? ' is-ask' : ''}`}>
                  <span className="who">{t.role === 'student' ? TEACH_LIVE_COPY.transcriptYou : TEACH_LIVE_COPY.transcriptTeacher}</span>
                  <span className="what">{t.text}</span>
                </div>
              ))}
          </aside>
        ) : null}
      </div>

      <div className="live-captions" aria-live="polite">
        <div className={`live-avatar${speaking ? ' is-speaking' : ''}`} aria-hidden>
          板
        </div>
        {caption ? (
          <div className={`live-caption-text${caption.phase === 'pending' ? ' is-pending' : ''}${caption.ask ? ' is-ask' : ''}`}>{caption.text}</div>
        ) : (
          <div className="live-caption-idle">{statusText ?? (state.error ? TEACH_LIVE_COPY.errorGeneric : '')}</div>
        )}
        <div className={`live-eq${speaking ? ' is-on' : ''}`} aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>

      <LiveComposer teacherBusy={busy} pendingAsk={state.pendingAsk} onSend={send} onHush={hush} disabled={!state.threadId} />
    </div>
  );
}
