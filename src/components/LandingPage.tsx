'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Download, ExternalLink } from 'lucide-react';
import { useEffect } from 'react';
import { COPY } from '@/lib/ui/copy';
import { DESKTOP_DOWNLOAD } from '@/lib/config/desktop-download.config';
import { LandingAppsLine } from './LandingAppsLine';
import { LandingClassroomLine } from './LandingClassroomLine';
import { LandingCollectionLine } from './LandingCollectionLine';
import { LandingContextLine } from './LandingContextLine';
import { handleSpotlightMove } from './landing-spotlight';
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

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.logoLink} href="/" aria-label={COPY.identity.productName}>
          <Brand />
        </Link>
        <nav className={styles.navigation} aria-label={copy.navigation.product}>
          <a href="#classroom">{copy.classroomLine.eyebrow}</a>
          <a href="#apps">{copy.appsLine.eyebrow}</a>
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
            <h1 id="landing-title" aria-label={copy.hero.title.replaceAll('\n', '')}>
              {(() => {
                let offset = 0;
                return copy.hero.title.split('\n').map((line) => {
                  const start = offset;
                  offset += line.length;
                  return (
                    <span className={styles.heroTitleLine} aria-hidden="true" key={line}>
                      {Array.from(line).map((char, index) => (
                        <span
                          className={styles.heroTitleChar}
                          style={{ animationDelay: `${(start + index) * 42 + 150}ms` }}
                          key={`${line}-${index}`}
                        >
                          {char}
                        </span>
                      ))}
                    </span>
                  );
                });
              })()}
            </h1>
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

      <LandingClassroomLine />

      <LandingAppsLine />

      <LandingCollectionLine />

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
              onMouseMove={handleSpotlightMove}
            >
              <span className={styles.outcomeOrbit} aria-hidden="true" />
              <small>{item.scope}</small>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <LandingContextLine />

      <section className={styles.liveSection}>
        <div className={styles.liveCopy}>
          <span className={styles.liveStatus}><i />{copy.livePreview.status}</span>
          <h2>{copy.livePreview.title}</h2>
          <div>
            <p>{copy.livePreview.body}</p>
            <Link href="/app?guest=1&entry=demo" target="_blank" rel="noopener noreferrer">{copy.livePreview.action}<ExternalLink size={15} /></Link>
          </div>
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
            <Link href="/help" className={`${styles.desktopSubLink} ${styles.desktopGuide}`}>{copy.desktop.guideAction}</Link>
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
