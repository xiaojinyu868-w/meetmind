'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { COPY } from '@/lib/ui/copy';
import { handleSpotlightMove } from './landing-spotlight';
import pageStyles from './LandingPage.module.css';
import styles from './LandingAppsLine.module.css';

type AppsLineApp = (typeof COPY.landing.appsLine.apps)[number];

const EASE = [0.22, 1, 0.36, 1] as const;

function FlashcardsStage({ app }: { app: Extract<AppsLineApp, { key: 'flashcards' }> }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = app.cards[index];
  return (
    <div className={styles.flashcardsStage}>
      <button
        type="button"
        className={styles.flashcard}
        aria-pressed={flipped}
        onClick={() => setFlipped((v) => !v)}
      >
        <motion.span
          className={styles.flashcardInner}
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ type: 'spring', stiffness: 240, damping: 24 }}
        >
          <span className={styles.flashcardFront}>{card.front}</span>
          <span className={styles.flashcardBack}>{card.back}</span>
        </motion.span>
      </button>
      <div className={styles.flashcardsBar}>
        <span>{app.flipHint} · {index + 1} / {app.cards.length}</span>
        <button
          type="button"
          onClick={() => {
            setIndex((i) => (i + 1) % app.cards.length);
            setFlipped(false);
          }}
        >
          {app.nextLabel} →
        </button>
      </div>
    </div>
  );
}

function QuizStage({ app }: { app: Extract<AppsLineApp, { key: 'quiz' }> }) {
  const [chosen, setChosen] = useState<number | null>(null);
  return (
    <div className={styles.quizStage}>
      <p>{app.question}</p>
      <ul>
        {app.options.map((option, index) => (
          <li key={option}>
            <motion.button
              type="button"
              data-state={chosen === null ? 'idle' : index === app.answer ? 'correct' : index === chosen ? 'wrong' : 'idle'}
              disabled={chosen !== null}
              whileTap={chosen === null ? { scale: 0.985 } : undefined}
              onClick={() => setChosen(index)}
            >
              {option}
            </motion.button>
          </li>
        ))}
      </ul>
      <AnimatePresence>
        {chosen !== null && (
          <motion.div
            className={styles.quizFeedback}
            data-correct={chosen === app.answer}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          >
            <span>{chosen === app.answer ? app.correctNote : app.wrongNote}</span>
            <span className={styles.quizEvidence}>{app.evidence}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MindmapStage({ app }: { app: Extract<AppsLineApp, { key: 'mindmap' }> }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className={styles.mindmapStage}>
      <b>{app.root}</b>
      <ul>
        {app.branches.map((branch, index) => (
          <li data-open={open === index} key={branch.name}>
            <button type="button" onClick={() => setOpen(open === index ? null : index)}>
              {branch.name}
            </button>
            <AnimatePresence initial={false}>
              {open === index && (
                <motion.div
                  className={styles.mindmapChildren}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.28, ease: EASE }}
                >
                  {branch.children.map((child) => (
                    <span key={child}>{child}</span>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </li>
        ))}
      </ul>
      <small>{app.expandHint}</small>
    </div>
  );
}

const PODCAST_CHAPTER_STOPS = [0, 0.45, 0.8] as const;

function PodcastStage({ app }: { app: Extract<AppsLineApp, { key: 'audio-overview' }> }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [chapter, setChapter] = useState(0);

  const seekTo = (fraction: number, autoplay: boolean) => {
    const el = audioRef.current;
    if (!el) return;
    if (el.duration) el.currentTime = el.duration * fraction;
    if (autoplay) void el.play().catch(() => undefined);
  };

  return (
    <div className={styles.podcastStage}>
      {/* 真实音频：试听课 90 秒原声 */}
      <audio
        ref={audioRef}
        src="/demo-audio.mp3"
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onTimeUpdate={(event) => {
          const el = event.currentTarget;
          if (el.duration) setProgress(el.currentTime / el.duration);
        }}
      />
      <div className={styles.podcastTop}>
        <button
          type="button"
          className={styles.podcastPlay}
          aria-pressed={playing}
          aria-label={playing ? '暂停' : '播放'}
          onClick={() => {
            const el = audioRef.current;
            if (!el) return;
            if (playing) el.pause();
            else void el.play().catch(() => undefined);
          }}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <div>
          <strong>{app.episode}</strong>
          <em>{app.duration}</em>
        </div>
      </div>
      <div className={styles.podcastWave} data-playing={playing} aria-hidden="true">
        <i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
      </div>
      <div
        className={styles.podcastProgress}
        role="slider"
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        tabIndex={0}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          seekTo((event.clientX - rect.left) / rect.width, false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') seekTo(Math.min(1, progress + 0.05), false);
          if (event.key === 'ArrowLeft') seekTo(Math.max(0, progress - 0.05), false);
        }}
      >
        <i style={{ width: `${progress * 100}%` }} />
      </div>
      <div className={styles.podcastChapters}>
        {app.chapters.map((label, index) => (
          <button
            type="button"
            data-active={chapter === index}
            key={label}
            onClick={() => {
              setChapter(index);
              seekTo(PODCAST_CHAPTER_STOPS[index] ?? 0, true);
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CheatsheetStage({ app }: { app: Extract<AppsLineApp, { key: 'cheatsheet' }> }) {
  return (
    <div className={styles.cheatsheetStage}>
      <strong>{app.sheetTitle}</strong>
      <ul>
        {app.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function InfographicStage({ app }: { app: Extract<AppsLineApp, { key: 'infographic' }> }) {
  return (
    <div className={styles.infographicStage}>
      <small>{app.course}</small>
      <blockquote>{app.quote}</blockquote>
      <span>{app.summary}</span>
    </div>
  );
}

function TeachBackStage({ app }: { app: Extract<AppsLineApp, { key: 'teach-back' }> }) {
  const [showNote, setShowNote] = useState(false);
  return (
    <div className={styles.teachbackStage}>
      <p>{app.topic}</p>
      <ul>
        {app.passed.map((point) => (
          <li data-state="pass" key={point}>{point}</li>
        ))}
        <li data-state="blind">
          <button type="button" aria-expanded={showNote} onClick={() => setShowNote((v) => !v)}>
            {app.blind}
          </button>
        </li>
      </ul>
      <AnimatePresence>
        {showNote && (
          <motion.div
            className={styles.teachbackNote}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.25, ease: EASE }}
          >
            {app.blindNote}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AppStage({ app }: { app: AppsLineApp }) {
  switch (app.key) {
    case 'flashcards': return <FlashcardsStage app={app} />;
    case 'quiz': return <QuizStage app={app} />;
    case 'mindmap': return <MindmapStage app={app} />;
    case 'cheatsheet': return <CheatsheetStage app={app} />;
    case 'audio-overview': return <PodcastStage app={app} />;
    case 'infographic': return <InfographicStage app={app} />;
    case 'teach-back': return <TeachBackStage app={app} />;
  }
}

export function LandingAppsLine() {
  const copy = COPY.landing.appsLine;
  const apps = copy.apps;
  const [selected, setSelected] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [hoverPaused, setHoverPaused] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!autoPlay || hoverPaused) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      setSelected((current) => (current + 1) % apps.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [autoPlay, hoverPaused, apps.length]);

  const app = apps[selected];

  // 滑动指示丸：测量活跃 tab 的位置（比 layoutId 更确定，横竖排都成立）
  const tabsRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  useEffect(() => {
    const measure = () => {
      const button = tabsRef.current?.querySelectorAll('button')[selected];
      if (!button) return;
      setPill({ top: button.offsetTop, left: button.offsetLeft, width: button.offsetWidth, height: button.offsetHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [selected]);

  return (
    <section className={styles.appsLine} id="apps" aria-labelledby="apps-line-title">
      <div className={pageStyles.sectionHeading}>
        <span className={pageStyles.eyebrow} data-reveal>{copy.eyebrow}</span>
        <h2 id="apps-line-title" data-reveal style={{ transitionDelay: '80ms' }}>{copy.title}</h2>
        <p className={styles.appsLead} data-reveal style={{ transitionDelay: '160ms' }}>{copy.body}</p>
      </div>
      <div
        className={styles.switchboard}
        data-reveal
        style={{ transitionDelay: '240ms' }}
        onPointerEnter={() => setHoverPaused(true)}
        onPointerLeave={() => setHoverPaused(false)}
      >
        <div className={styles.appTabs} role="tablist" aria-label={copy.ariaLabel} ref={tabsRef}>
          {pill && <span className={styles.tabPill} aria-hidden="true" style={pill} />}
          {apps.map((item, index) => (
            <button
              type="button"
              role="tab"
              aria-selected={index === selected}
              data-active={index === selected}
              key={item.key}
              onMouseMove={handleSpotlightMove}
              onClick={() => {
                setSelected(index);
                setAutoPlay(false);
              }}
            >
              <strong>{item.name}</strong>
              <span>{item.tag}</span>
            </button>
          ))}
        </div>
        <div className={styles.appStage} role="tabpanel" onMouseMove={handleSpotlightMove}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              className={styles.stageMotion}
              key={app.key}
              initial={reducedMotion ? false : { opacity: 0, y: 16, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -12, filter: 'blur(6px)' }}
              transition={{ duration: 0.38, ease: EASE }}
            >
              <AppStage app={app} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
