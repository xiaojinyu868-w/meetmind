'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Download, ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { COPY } from '@/lib/ui/copy';
import { DESKTOP_DOWNLOAD } from '@/lib/config/desktop-download.config';
import styles from './LandingPage.module.css';

function Brand() {
  return (
    <span className={styles.brand}>
      <span className={styles.brandAvatar}>
        <Image src="/images/octo-buddy/idle.png" alt="" width={22} height={22} priority />
      </span>
      <span>{COPY.identity.productName}</span>
    </span>
  );
}

const STAGE_TONES = ['pine', 'sand', 'rose', 'sky', 'ink'] as const;

export function LandingPage() {
  const copy = COPY.landing;
  const stageRailRef = useRef<HTMLDivElement>(null);
  const [activeStage, setActiveStage] = useState(0);

  // 入场揭示：滚动到可视区后 stagger 浮现
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (reduced) {
      elements.forEach((el) => el.setAttribute('data-visible', 'true'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.setAttribute('data-visible', 'true');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.18 });
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // 课堂线 rail：滚动时同步活跃卡
  useEffect(() => {
    const rail = stageRailRef.current;
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
    const rail = stageRailRef.current;
    const card = rail?.querySelector<HTMLElement>(`[data-stage-index="${index}"]`);
    if (!rail || !card) return;
    rail.scrollTo({
      left: card.offsetLeft - (rail.clientWidth - card.clientWidth) / 2,
      behavior: 'smooth',
    });
  };

  // 课堂线 rail：自动循环滚动，悬停 / 触摸时暂停
  const [railPaused, setRailPaused] = useState(false);
  useEffect(() => {
    if (railPaused) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      setActiveStage((current) => {
        const next = (current + 1) % copy.classroomLine.stages.length;
        scrollToStage(next);
        return next;
      });
    }, 3600);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railPaused]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.logoLink} href="/" aria-label={COPY.identity.productName}>
          <Brand />
        </Link>
        <nav className={styles.navigation} aria-label={copy.navigation.product}>
          <a href="#classroom">{copy.classroomLine.eyebrow}</a>
          <a href="#collection">{copy.collectionLine.eyebrow}</a>
          <Link href="/technology">{copy.navigation.technology}</Link>
          <Link href="/login">{copy.navigation.signIn}</Link>
          <Link className={styles.navCta} href="/app?guest=1&entry=demo">{copy.hero.primaryAction}</Link>
        </nav>
      </header>

      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.heroStage}>
          <Image
            src="/images/landing/classroom-hero.webp"
            alt={copy.hero.imageAlt}
            fill
            priority
            sizes="100vw"
            className={styles.heroImage}
          />
          <div className={styles.heroShade} />
          <div className={styles.heroContent}>
            <span className={styles.heroEyebrow}>{copy.hero.eyebrow}</span>
            <h1 id="landing-title">{copy.hero.title}</h1>
            <p>{copy.hero.body}</p>
            <div className={styles.heroActions}>
              <Link className={styles.heroPrimary} href="/app?guest=1&entry=demo">
                {copy.hero.primaryAction}<ArrowRight size={16} />
              </Link>
              <a className={styles.heroSecondary} href="#classroom">{copy.hero.secondaryAction}</a>
            </div>
          </div>
          <div className={styles.heroContext} aria-hidden="true">
            <span className={styles.heroSheet} data-depth="1">{copy.bridge.parts[1]}</span>
            <span className={styles.heroSheet} data-depth="2">{copy.collectionLine.sinkLabel}</span>
            <span className={styles.heroSheet} data-depth="3">{copy.bridge.parts[0]}</span>
            <span className={styles.heroCore}><Image src="/images/octo-buddy/original.png" alt="" width={44} height={44} /></span>
          </div>
        </div>
      </section>

      <section className={styles.manifesto} aria-label={copy.manifesto.lineA}>
        <p data-reveal>{copy.manifesto.lineA}</p>
        <p data-reveal style={{ transitionDelay: '140ms' }}>
          <em>{copy.manifesto.lineB}</em>
        </p>
      </section>

      <section className={styles.classroomLine} id="classroom" aria-labelledby="classroom-line-title">
        <div className={styles.lineHeading}>
          <span className={styles.eyebrow} data-reveal>{copy.classroomLine.eyebrow}</span>
          <h2 id="classroom-line-title" data-reveal style={{ transitionDelay: '80ms' }}>{copy.classroomLine.title}</h2>
          <div className={styles.lineAside}>
            <p data-reveal style={{ transitionDelay: '160ms' }}>{copy.classroomLine.body}</p>
            <div className={styles.railControls} data-reveal style={{ transitionDelay: '220ms' }}>
              <button type="button" onClick={() => scrollToStage(activeStage - 1)} disabled={activeStage === 0} aria-label={copy.classroomLine.previous}>←</button>
              <span>{copy.classroomLine.stages[activeStage].step} / {String(copy.classroomLine.stages.length).padStart(2, '0')}</span>
              <button type="button" onClick={() => scrollToStage(activeStage + 1)} disabled={activeStage === copy.classroomLine.stages.length - 1} aria-label={copy.classroomLine.next}>→</button>
            </div>
          </div>
        </div>

        <div
          ref={stageRailRef}
          className={styles.stageRail}
          role="list"
          aria-label={copy.classroomLine.ariaLabel}
          onPointerEnter={() => setRailPaused(true)}
          onPointerLeave={() => setRailPaused(false)}
          onPointerDown={() => {
            setRailPaused(true);
            window.setTimeout(() => setRailPaused(false), 8000);
          }}
        >
          {copy.classroomLine.stages.map((stage, index) => (
            <article
              className={styles.stageCard}
              data-active={index === activeStage}
              data-stage-index={index}
              data-tone={STAGE_TONES[index % STAGE_TONES.length]}
              key={stage.step}
              role="listitem"
            >
              <span className={styles.stageOrbit} aria-hidden="true" />
              <span className={styles.stageVerb} aria-hidden="true">{stage.verb}</span>
              <div className={styles.stageCopy}>
                <span className={styles.stageStep}>{stage.step}</span>
                <h3>{stage.title}</h3>
                <p>{stage.body}</p>
              </div>
            </article>
          ))}
        </div>
        <div className={styles.railProgress} aria-hidden="true">
          {copy.classroomLine.stages.map((stage, index) => (
            <span data-active={index === activeStage} key={stage.step} />
          ))}
        </div>
      </section>

      <section className={styles.collectionLine} id="collection" aria-labelledby="collection-line-title">
        <div className={styles.collectionStage}>
          <div className={styles.collectionVisual} aria-hidden="true">
            <div className={styles.collectionThread}>
              {copy.collectionLine.samples.map((sample, index) => (
                <div
                  className={styles.collectionBubble}
                  data-kind={sample.kind}
                  key={sample.label}
                  style={{ animationDelay: `${index * 0.7}s` }}
                >
                  {sample.kind === 'voice' ? (
                    <span className={styles.bubbleVoice}>
                      <i /><i /><i /><i /><i /><i /><i />
                      <em>{sample.text}</em>
                    </span>
                  ) : sample.kind === 'image' ? (
                    <span className={styles.bubbleImage}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="m4 18 5-5 3 3 4-4 4 4" /></svg>
                      <em>{sample.text}</em>
                    </span>
                  ) : sample.kind === 'file' ? (
                    <span className={styles.bubbleFile}>
                      <b>PDF</b>
                      <em>{sample.text}</em>
                    </span>
                  ) : sample.kind === 'link' ? (
                    <span className={styles.bubbleLink}>
                      <i />
                      <em>{sample.text}</em>
                    </span>
                  ) : (
                    <span className={styles.bubbleText}>{sample.text}</span>
                  )}
                </div>
              ))}
            </div>
            <div className={styles.collectionStatus}>
              <i />
              <span>{copy.collectionLine.statusLabel}</span>
            </div>
          </div>
          <div className={styles.collectionCopy}>
            <span className={styles.eyebrow} data-reveal>{copy.collectionLine.eyebrow}</span>
            <h2 id="collection-line-title" data-reveal style={{ transitionDelay: '80ms' }}>{copy.collectionLine.title}</h2>
            <p data-reveal style={{ transitionDelay: '160ms' }}>{copy.collectionLine.body}</p>
            <p className={styles.collectionNote} data-reveal style={{ transitionDelay: '240ms' }}>
              <i />
              {copy.collectionLine.silentNote}
            </p>
          </div>
        </div>
      </section>

      <section className={styles.bridge} id="philosophy" aria-labelledby="bridge-title">
        <span className={styles.eyebrow} data-reveal>{copy.bridge.eyebrow}</span>
        <h2 id="bridge-title" className={styles.bridgeLead} data-reveal style={{ transitionDelay: '80ms' }}>{copy.bridge.lead}</h2>
        <div className={styles.bridgeFormula} data-reveal style={{ transitionDelay: '160ms' }}>
          {copy.bridge.parts.map((part, index) => (
            <div className={styles.bridgePart} key={part}>
              {index > 0 && <span className={styles.bridgePlus}>＋</span>}
              <div>
                <strong>{part}</strong>
                <small>{copy.bridge.partNotes[index]}</small>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.outcomes} aria-labelledby="outcomes-title">
        <div className={styles.sectionHeading}>
          <span className={styles.eyebrow} data-reveal>{copy.outcomes.eyebrow}</span>
          <h2 id="outcomes-title" data-reveal style={{ transitionDelay: '80ms' }}>{copy.outcomes.title}</h2>
        </div>
        <div className={styles.outcomeGrid}>
          {copy.outcomes.items.map((item, index) => (
            <article
              className={styles.outcome}
              data-tone={STAGE_TONES[(index * 2 + 1) % STAGE_TONES.length]}
              key={item.number}
              data-reveal
              style={{ transitionDelay: `${index * 110}ms` }}
            >
              <span className={styles.outcomeOrbit} aria-hidden="true" />
              <small>{item.scope}</small>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.contextControl} aria-labelledby="context-title">
        <div className={styles.contextPanel} data-reveal>
          <span className={styles.eyebrow}>{copy.context.eyebrow}</span>
          <h2 id="context-title">{copy.context.title}</h2>
          <p>{copy.context.body}</p>
          <div className={styles.contextFlow} aria-hidden="true">
            {copy.context.flow.map((node, index) => (
              <span key={node} data-final={index === copy.context.flow.length - 1}>{node}</span>
            ))}
          </div>
        </div>
        <div className={styles.controlCard} data-reveal style={{ transitionDelay: '160ms' }}>
          <h3>{copy.control.title}</h3>
          <p>{copy.control.body}</p>
          <ul>
            {copy.control.items.map((item) => (
              <li key={item}><i />{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.liveSection}>
        <div className={styles.liveCopy}>
          <span className={styles.liveStatus}><i />{copy.livePreview.status}</span>
          <h2>{copy.livePreview.title}</h2>
          <p>{copy.livePreview.body}</p>
          <Link href="/app?guest=1&entry=demo" target="_blank" rel="noopener noreferrer">{copy.livePreview.action}<ExternalLink size={15} /></Link>
        </div>
        <div className={styles.liveStage}>
          <iframe src="/app?guest=1&entry=demo" title={copy.livePreview.frameTitle} loading="lazy" tabIndex={-1} />
        </div>
      </section>

      {DESKTOP_DOWNLOAD.enabled && (
        <section className={styles.desktopSection} id="download" aria-labelledby="desktop-download-title">
          <div className={styles.desktopPanel} data-reveal>
            <span className={styles.eyebrow}>{copy.desktop.eyebrow}</span>
            <h2 id="desktop-download-title">{copy.desktop.title}</h2>
            <p>{copy.desktop.body}</p>
            <div className={styles.desktopCards}>
              <a className={styles.desktopCard} href={DESKTOP_DOWNLOAD.macArm64}>
                <Download size={18} aria-hidden="true" />
                <strong>{copy.desktop.macAction}</strong>
                <small>
                  {copy.desktop.macNote} ·{' '}
                  <span
                    role="link"
                    tabIndex={0}
                    className={styles.desktopSubLink}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      window.open(DESKTOP_DOWNLOAD.macIntel, '_blank', 'noopener');
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        event.stopPropagation();
                        window.open(DESKTOP_DOWNLOAD.macIntel, '_blank', 'noopener');
                      }
                    }}
                  >
                    {copy.desktop.macIntelNote}
                  </span>
                </small>
              </a>
              <a className={styles.desktopCard} href={DESKTOP_DOWNLOAD.windows}>
                <Download size={18} aria-hidden="true" />
                <strong>{copy.desktop.windowsAction}</strong>
                <small>{copy.desktop.windowsNote}</small>
              </a>
            </div>
            <span className={styles.desktopMeta}>{copy.desktop.hotkeyHint} · v{DESKTOP_DOWNLOAD.version}</span>
            <span className={styles.desktopUnsigned}>{copy.desktop.unsignedNote}</span>
          </div>
        </section>
      )}

      <section className={styles.finalCta}>
        <div className={styles.finalStage}>
          <Image className={styles.finalOcto} src="/images/octo-buddy/happy.png" alt="" width={92} height={76} />
          <span className={styles.eyebrow}>{copy.finalCta.eyebrow}</span>
          <h2>{copy.finalCta.title}</h2>
          <p>{copy.finalCta.body}</p>
          <div>
            <Link className={styles.finalPrimary} href="/app?guest=1&entry=demo">{copy.finalCta.primaryAction}<ArrowRight size={16} /></Link>
            <Link className={styles.finalSecondary} href="/login">{copy.finalCta.secondaryAction}</Link>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <Brand />
        <span>{copy.footer.tagline}</span>
        <nav>
          <a href="#classroom">{copy.footer.product}</a>
          <Link href="/technology">{copy.footer.technology}</Link>
          <Link href="/login">{copy.footer.login}</Link>
        </nav>
        <span>{copy.footer.copyright}</span>
      </footer>
    </main>
  );
}
