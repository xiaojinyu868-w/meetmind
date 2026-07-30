'use client';

import { useEffect, useRef, useState } from 'react';
import { COPY } from '@/lib/ui/copy';
import styles from './LandingClassroomLine.module.css';

type Stage = (typeof COPY.landing.classroomLine.stages)[number];
type StageMock = Stage['mock'];

function StageMoment({ mock }: { mock: StageMock }) {
  switch (mock.kind) {
    case 'live':
      return (
        <div className={styles.mockLive}>
          <div className={styles.mockLiveHead}>
            <span className={styles.liveDot} />
            <span>LIVE</span>
          </div>
          <div className={styles.mockLiveRoll}>
            <ul>
              {[...mock.lines, ...mock.lines].map((line, index) => (
                <li key={`${line}-${index}`}>{line}</li>
              ))}
            </ul>
          </div>
          <div className={styles.mockChips}>
            {mock.chips.map((chip) => (
              <span key={chip}>{chip}</span>
            ))}
          </div>
        </div>
      );
    case 'ask':
      return (
        <div className={styles.mockAsk}>
          <div className={styles.mockQuestion}>{mock.question}</div>
          <div className={styles.mockAnswer}>
            {mock.answer}
            <span className={styles.mockCite}>{mock.cite}</span>
          </div>
        </div>
      );
    case 'card':
      return (
        <div className={styles.mockFlashcard}>
          <div className={styles.mockFlip} aria-hidden="true">
            <span className={styles.mockFlipFace} data-face="front">{mock.front}</span>
            <span className={styles.mockFlipFace} data-face="back">{mock.back}</span>
          </div>
          <footer>
            <i />
            <em>{mock.progress}</em>
          </footer>
        </div>
      );
    case 'evidence':
      return (
        <div className={styles.mockEvidence}>
          <p>{mock.answer}</p>
          <span className={styles.mockEvidenceChip}>{mock.evidence}</span>
          <blockquote>“{mock.quote}”</blockquote>
        </div>
      );
    case 'sheet':
      return (
        <div className={styles.mockSheet}>
          <strong>{mock.sheetTitle}</strong>
          <ul>
            {mock.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      );
  }
}

export function LandingClassroomLine() {
  const copy = COPY.landing.classroomLine;
  const railRef = useRef<HTMLDivElement>(null);
  const [activeStage, setActiveStage] = useState(0);
  const [railPaused, setRailPaused] = useState(false);

  // 滚动时同步活跃卡
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const cards = Array.from(rail.querySelectorAll<HTMLElement>('[data-stage-index]'));
    let animationFrame = 0;
    const update = () => {
      const center = rail.scrollLeft + rail.clientWidth / 2;
      let closest = 0;
      let closestDistance = Number.POSITIVE_INFINITY;
      cards.forEach((card, index) => {
        const distance = Math.abs(card.offsetLeft + card.clientWidth / 2 - center);
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = index;
        }
      });
      setActiveStage(closest);
    };
    const onScroll = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(update);
    };
    rail.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
    return () => {
      window.cancelAnimationFrame(animationFrame);
      rail.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const scrollToStage = (index: number) => {
    const rail = railRef.current;
    const card = rail?.querySelector<HTMLElement>(`[data-stage-index="${index}"]`);
    if (!rail || !card) return;
    rail.scrollTo({
      left: card.offsetLeft - (rail.clientWidth - card.clientWidth) / 2,
      behavior: 'smooth',
    });
  };

  // 自动循环滚动，悬停 / 触摸时暂停
  useEffect(() => {
    if (railPaused) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      setActiveStage((current) => {
        const next = (current + 1) % copy.stages.length;
        scrollToStage(next);
        return next;
      });
    }, 3600);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railPaused]);

  return (
    <section className={styles.classroomLine} id="classroom" aria-labelledby="classroom-line-title">
      <div className={styles.lineHeading}>
        <span className={styles.eyebrow} data-reveal>{copy.eyebrow}</span>
        <h2 id="classroom-line-title" data-reveal style={{ transitionDelay: '80ms' }}>{copy.title}</h2>
        <div className={styles.lineAside}>
          <p data-reveal style={{ transitionDelay: '160ms' }}>{copy.body}</p>
          <div className={styles.railControls} data-reveal style={{ transitionDelay: '220ms' }}>
            <button type="button" onClick={() => scrollToStage(activeStage - 1)} disabled={activeStage === 0} aria-label={copy.previous}>←</button>
            <span>{copy.stages[activeStage].step} / {String(copy.stages.length).padStart(2, '0')}</span>
            <button type="button" onClick={() => scrollToStage(activeStage + 1)} disabled={activeStage === copy.stages.length - 1} aria-label={copy.next}>→</button>
          </div>
        </div>
      </div>

      <div
        ref={railRef}
        className={styles.stageRail}
        role="list"
        aria-label={copy.ariaLabel}
        onPointerEnter={() => setRailPaused(true)}
        onPointerLeave={() => setRailPaused(false)}
        onPointerDown={() => {
          setRailPaused(true);
          window.setTimeout(() => setRailPaused(false), 8000);
        }}
      >
        {copy.stages.map((stage, index) => (
          <article
            className={styles.stageCard}
            data-active={index === activeStage}
            data-stage-index={index}
            key={stage.step}
            role="listitem"
          >
            <header className={styles.stageHead}>
              <span className={styles.stageTime}>
                <i />
                {stage.time}
              </span>
              <span className={styles.stageVerb}>{stage.verb}</span>
            </header>
            <div className={styles.stageMoment}>
              <StageMoment mock={stage.mock} />
            </div>
            <div className={styles.stageCopy}>
              <span className={styles.stageStep}>{stage.step}</span>
              <h3>{stage.title}</h3>
              <p>{stage.body}</p>
            </div>
          </article>
        ))}
      </div>
      <div className={styles.railProgress} aria-hidden="true">
        {copy.stages.map((stage, index) => (
          <span data-active={index === activeStage} key={stage.step} />
        ))}
      </div>
    </section>
  );
}
