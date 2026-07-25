'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, ExternalLink, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { COPY } from '@/lib/ui/copy';
import styles from './LandingPage.module.css';

const BENEFIT_SCENE_INDEXES = [0, 2, 4] as const;
type FeatureSceneId = (typeof COPY.landing.featureRail.scenes)[number]['id'];

const FEATURE_SCENE_VIDEOS: Record<FeatureSceneId, string> = {
  'live-class': '/videos/landing/scenes/01-live-class.mp4',
  'end-class': '/videos/landing/scenes/02-end-class.mp4',
  'evidence-review': '/videos/landing/scenes/03-evidence-review.mp4',
  'quiz-submit': '/videos/landing/scenes/04-quiz-submit.mp4',
  'evidence-jump': '/videos/landing/scenes/05-evidence-jump.mp4',
  'learning-methods': '/videos/landing/scenes/06-learning-methods.mp4',
  'complete-mindmap': '/videos/landing/scenes/07-complete-mindmap.mp4',
};

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

export function LandingPage() {
  const copy = COPY.landing;
  const filmRef = useRef<HTMLVideoElement>(null);
  const featureRailRef = useRef<HTMLDivElement>(null);
  const featureVideoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const [filmPaused, setFilmPaused] = useState(false);
  const [filmMuted, setFilmMuted] = useState(true);
  const [activeFeature, setActiveFeature] = useState(0);

  useEffect(() => {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    filmRef.current?.pause();
    setFilmPaused(true);
  }, []);

  useEffect(() => {
    const rail = featureRailRef.current;
    if (!rail) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cards = Array.from(rail.querySelectorAll<HTMLElement>('[data-feature-index]'));
    let animationFrame = 0;

    const updateActiveFeature = () => {
      const railCenter = rail.scrollLeft + rail.clientWidth / 2;
      let closestIndex = 0;
      let closestDistance = Number.POSITIVE_INFINITY;

      cards.forEach((card, index) => {
        const cardCenter = card.offsetLeft + card.clientWidth / 2;
        const distance = Math.abs(cardCenter - railCenter);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });

      setActiveFeature(closestIndex);
    };

    const handleScroll = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(updateActiveFeature);
    };

    const videoObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const index = Number((entry.target as HTMLElement).dataset.featureIndex);
        const video = featureVideoRefs.current[index];
        if (!video) return;

        if (!reducedMotion && entry.isIntersecting && entry.intersectionRatio >= 0.3) {
          void video.play().catch(() => undefined);
        } else {
          video.pause();
        }
      });
    }, { root: rail, threshold: [0, 0.3, 0.7] });

    cards.forEach((card) => videoObserver.observe(card));
    rail.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
    updateActiveFeature();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      videoObserver.disconnect();
      rail.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, []);

  const toggleFilm = async () => {
    const film = filmRef.current;
    if (!film) return;

    if (!film.paused) {
      film.pause();
      setFilmPaused(true);
      return;
    }

    try {
      await film.play();
      setFilmPaused(false);
    } catch {
      setFilmPaused(true);
    }
  };

  const toggleFilmSound = () => {
    const nextMuted = !filmMuted;
    if (filmRef.current) filmRef.current.muted = nextMuted;
    setFilmMuted(nextMuted);
  };

  const scrollToFeature = (index: number) => {
    const rail = featureRailRef.current;
    const card = rail?.querySelector<HTMLElement>(`[data-feature-index="${index}"]`);
    if (!rail || !card) return;

    rail.scrollTo({
      left: card.offsetLeft - (rail.clientWidth - card.clientWidth) / 2,
      behavior: 'smooth',
    });
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.logoLink} href="/" aria-label={COPY.identity.productName}>
          <Brand />
        </Link>
        <nav className={styles.navigation} aria-label={copy.navigation.product}>
          <a href="#product">{copy.navigation.product}</a>
          <a href="#philosophy">{copy.navigation.philosophy}</a>
          <Link href="/technology">{copy.navigation.technology}</Link>
          <Link href="/login">{copy.navigation.signIn}</Link>
          <Link className={styles.navCta} href="/app?guest=1&entry=demo">{copy.hero.primaryAction}</Link>
        </nav>
      </header>

      <section className={styles.hero} aria-labelledby="landing-title">
        <span className={styles.eyebrow}>{copy.hero.eyebrow}</span>
        <h1 id="landing-title">{copy.hero.title}</h1>
        <p className={styles.heroBody}>{copy.hero.body}</p>
        <div className={styles.heroActions}>
          <Link className={styles.primaryAction} href="/app?guest=1&entry=demo">
            {copy.hero.primaryAction}<ArrowRight size={17} />
          </Link>
          <a className={styles.textAction} href="#product">{copy.hero.secondaryAction}</a>
        </div>

        <div className={styles.filmBlock}>
          <div className={styles.filmMeta}>
            <span>{copy.hero.filmLabel}</span>
            <span>{copy.hero.filmDuration}</span>
          </div>
          <div className={styles.filmViewport}>
            <video
              ref={filmRef}
              aria-label={copy.hero.videoAlt}
              autoPlay
              loop
              muted={filmMuted}
              playsInline
              poster="/images/landing/real/product-film-recorded-poster.jpg"
              preload="metadata"
              onPlay={() => setFilmPaused(false)}
              onPause={() => setFilmPaused(true)}
            >
              <source src="/videos/landing/meetmind-product-film-recorded.mp4?cut=20260724-recorded1" type="video/mp4" />
              {copy.media.videoFallback}
            </video>
            <button className={styles.filmSoundControl} type="button" onClick={toggleFilmSound} aria-label={filmMuted ? copy.hero.unmuteFilm : copy.hero.muteFilm}>
              {filmMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
              <span>{filmMuted ? copy.hero.listenFilm : copy.hero.muteFilm}</span>
            </button>
            <button className={styles.filmControl} type="button" onClick={toggleFilm} aria-label={filmPaused ? copy.hero.playFilm : copy.hero.pauseFilm}>
              {filmPaused ? <Play size={17} fill="currentColor" /> : <Pause size={17} fill="currentColor" />}
            </button>
          </div>
        </div>
      </section>

      <section className={styles.featureShowcase} aria-labelledby="feature-showcase-title">
        <div className={styles.featureShowcaseHeading}>
          <div>
            <span className={styles.eyebrow}>{copy.featureRail.eyebrow}</span>
            <h2 id="feature-showcase-title">{copy.featureRail.title}</h2>
          </div>
          <div className={styles.featureShowcaseIntro}>
            <p>{copy.featureRail.body}</p>
            <div className={styles.featureControls}>
              <button
                type="button"
                onClick={() => scrollToFeature(activeFeature - 1)}
                disabled={activeFeature === 0}
                aria-label={copy.featureRail.previous}
              >
                <ArrowLeft size={17} />
              </button>
              <span>{copy.featureRail.scenes[activeFeature].step} / {String(copy.featureRail.scenes.length).padStart(2, '0')}</span>
              <button
                type="button"
                onClick={() => scrollToFeature(activeFeature + 1)}
                disabled={activeFeature === copy.featureRail.scenes.length - 1}
                aria-label={copy.featureRail.next}
              >
                <ArrowRight size={17} />
              </button>
            </div>
          </div>
        </div>

        <div ref={featureRailRef} className={styles.featureRail} role="list" aria-label={copy.featureRail.ariaLabel}>
          {copy.featureRail.scenes.map((scene, index) => (
            <article
              className={styles.featureCard}
              data-active={index === activeFeature}
              data-feature-index={index}
              key={scene.id}
              role="listitem"
            >
              <div className={styles.featureMedia}>
                <video
                  ref={(element) => { featureVideoRefs.current[index] = element; }}
                  aria-label={scene.videoAlt}
                  loop
                  muted
                  playsInline
                  preload={index < 2 ? 'auto' : 'metadata'}
                  src={FEATURE_SCENE_VIDEOS[scene.id]}
                />
                <span className={styles.featureMediaLabel}><i />{copy.media.realProduct}</span>
              </div>
              <div className={styles.featureCardCopy}>
                <span>{scene.step}</span>
                <div>
                  <h3>{scene.title}</h3>
                  <p>{scene.body}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className={styles.featureProgress} aria-hidden="true">
          {copy.featureRail.scenes.map((scene, index) => (
            <span data-active={index === activeFeature} key={scene.id} />
          ))}
        </div>
      </section>

      <section className={styles.productSection} id="product" aria-labelledby="product-title">
        <div className={styles.sectionHeading}>
          <span className={styles.eyebrow}>{copy.journey.eyebrow}</span>
          <h2 id="product-title">{copy.journey.title}</h2>
          <p>{copy.journey.body}</p>
        </div>
        <div className={styles.benefitGrid}>
          {BENEFIT_SCENE_INDEXES.map((sceneIndex, index) => {
            const scene = copy.journey.scenes[sceneIndex];
            return (
              <article className={styles.benefit} key={scene.id}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <small>{scene.kicker}</small>
                <h3>{scene.title}</h3>
                <p>{scene.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.thesisBand} id="philosophy">
        <div>
          <span className={styles.eyebrow}>{copy.belief.eyebrow}</span>
          <h2>{copy.belief.title}</h2>
        </div>
        <p>{copy.belief.body}</p>
      </section>

      <section className={styles.liveSection}>
        <div className={styles.liveCopy}>
          <span className={styles.liveStatus}><i />{copy.livePreview.status}</span>
          <span className={styles.eyebrow}>{copy.livePreview.eyebrow}</span>
          <h2>{copy.livePreview.title}</h2>
          <p>{copy.livePreview.body}</p>
          <Link href="/app?guest=1&entry=demo">{copy.livePreview.action}<ExternalLink size={16} /></Link>
        </div>
        <div className={styles.liveStage}>
          <iframe src="/app?guest=1&entry=demo" title={copy.livePreview.frameTitle} loading="lazy" tabIndex={-1} />
          <Link href="/app?guest=1&entry=demo" aria-label={copy.livePreview.action} />
        </div>
      </section>

      <section className={styles.finalCta}>
        <Image src="/images/octo-buddy/idle.png" alt="" width={62} height={52} />
        <span className={styles.eyebrow}>{copy.finalCta.eyebrow}</span>
        <h2>{copy.finalCta.title}</h2>
        <p>{copy.finalCta.body}</p>
        <div>
          <Link className={styles.primaryAction} href="/app?guest=1&entry=demo">{copy.finalCta.primaryAction}<ArrowRight size={17} /></Link>
          <Link className={styles.textAction} href="/login">{copy.finalCta.secondaryAction}</Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <Brand />
        <span>{copy.footer.tagline}</span>
        <nav>
          <a href="#product">{copy.footer.product}</a>
          <Link href="/technology">{copy.footer.technology}</Link>
          <Link href="/login">{copy.footer.login}</Link>
        </nav>
        <span>{copy.footer.copyright}</span>
      </footer>
    </main>
  );
}
