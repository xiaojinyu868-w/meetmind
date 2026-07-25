import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Play, ShieldCheck } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';
import styles from './TechnologyPage.module.css';

function TechMark() {
  return (
    <span className={styles.techMark} aria-hidden="true">
      <span /><span /><span />
    </span>
  );
}

function TracePreview() {
  const copy = COPY.technology.trace;

  return (
    <div className={styles.tracePreview}>
      <blockquote>{copy.question}</blockquote>
      <div className={styles.traceColumns}>
        <div>
          <strong><Check size={14} />{copy.usedTitle}</strong>
          {copy.usedItems.map((item) => <span key={item}>{item}</span>)}
        </div>
        <div>
          <strong><ShieldCheck size={14} />{copy.skippedTitle}</strong>
          {copy.skippedItems.map((item) => <span key={item}>{item}</span>)}
        </div>
      </div>
      <article><small>{copy.outputTitle}</small><p>{copy.output}</p><em>{copy.boundary}</em></article>
    </div>
  );
}

function AsrPreview() {
  const copy = COPY.technology.asr;

  return (
    <div className={styles.asrPreview}>
      <div className={styles.waveform} aria-hidden="true">
        {Array.from({ length: 34 }, (_, index) => <i key={index} />)}
      </div>
      <div className={styles.asrRows}>
        {copy.steps.map((step, index) => (
          <div key={step.label}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{step.label} · {step.title}</strong>
            <p>{step.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TechnologyPage() {
  const copy = COPY.technology;

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="technology-title">
        <Image className={styles.heroImage} src="/images/landing/classroom-hero.webp" alt={copy.imageAlt} fill priority sizes="100vw" />
        <div className={styles.heroShade} aria-hidden="true" />
        <header className={styles.header}>
          <Link className={styles.logo} href="/"><TechMark /><span>{COPY.identity.productName}</span><small>{copy.label}</small></Link>
          <nav aria-label={copy.navigation.architecture}>
            <a href="#architecture">{copy.navigation.architecture}</a>
            <a href="#evaluation">{copy.navigation.evaluation}</a>
            <a href="#questions">{copy.navigation.questions}</a>
            <Link href="/"><ArrowLeft size={14} />{copy.navigation.product}</Link>
            <Link className={styles.navCta} href="/app?guest=1&entry=demo">{copy.navigation.openProduct}</Link>
          </nav>
        </header>
        <div className={styles.heroCopy}>
          <span>{copy.hero.eyebrow}</span>
          <h1 id="technology-title">{copy.hero.title}</h1>
          <p>{copy.hero.body}</p>
        </div>
        <div className={styles.heroBottom}>
          <a href="#architecture"><Play size={16} fill="currentColor" />{copy.hero.primaryAction}<ArrowRight size={17} /></a>
          <div><small>{copy.hero.statusLabel}</small><strong>{copy.hero.statusValue}</strong></div>
        </div>
      </section>

      <section className={styles.architecture} id="architecture">
        <div className={styles.sectionHeading}><small>{copy.architecture.eyebrow}</small><h2>{copy.architecture.title}</h2></div>
        <div className={styles.architectureTrack}>
          {copy.architecture.stages.map((stage) => (
            <article key={stage.index}><span>{stage.index}</span><div><h3>{stage.title}</h3><p>{stage.body}</p></div></article>
          ))}
        </div>
      </section>

      <section className={styles.splitSection}>
        <div className={styles.splitVisual}><TracePreview /></div>
        <div className={styles.splitCopy}>
          <small>{copy.trace.eyebrow}</small>
          <h2>{copy.trace.title}</h2>
          <p>{copy.thesis.body}</p>
        </div>
      </section>

      <section className={`${styles.splitSection} ${styles.asrSection}`}>
        <div className={styles.splitVisual}><AsrPreview /></div>
        <div className={styles.splitCopy}>
          <small>{copy.asr.eyebrow}</small>
          <h2>{copy.asr.title}</h2>
          <p>{copy.asr.body}</p>
        </div>
      </section>

      <section className={styles.manifesto}>
        <div className={styles.manifestoSide} aria-hidden="true" />
        <article><small>{copy.thesis.eyebrow}</small><h2>{copy.thesis.title}</h2><p>{copy.thesis.body}</p></article>
        <div className={`${styles.manifestoSide} ${styles.manifestoSideRight}`} aria-hidden="true" />
      </section>

      <section className={styles.evaluation} id="evaluation">
        <div className={styles.sectionHeading}><small>{copy.evaluation.eyebrow}</small><h2>{copy.evaluation.title}</h2></div>
        <p className={styles.sectionIntro}>{copy.evaluation.body}</p>
        <div className={styles.metricTrack}>
          {copy.evaluation.metrics.map((metric, index) => (
            <article key={metric.code}><span>{String(index + 1).padStart(2, '0')}</span><small>{metric.code}</small><h3>{metric.title}</h3><p>{metric.body}</p></article>
          ))}
        </div>
      </section>

      <section className={styles.questions} id="questions">
        <div className={styles.sectionHeading}><small>{copy.questions.eyebrow}</small><h2>{copy.questions.title}</h2></div>
        <div className={styles.questionList}>
          {copy.questions.items.map((item, index) => (
            <details key={item.question} open={index === 0}>
              <summary><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.question}</strong><ChevronDown size={18} /></summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className={styles.finalCta}>
        <div><small>{copy.label}</small><h2>{copy.finalCta.title}</h2></div>
        <div>
          <p>{copy.finalCta.body}</p>
          <Link href="/app?guest=1&entry=demo">{copy.finalCta.productAction}<ArrowRight /></Link>
          <a href={copy.finalCta.contactHref}>{copy.finalCta.contactAction}<ArrowRight /></a>
        </div>
      </section>

      <footer className={styles.footer}>
        <div><TechMark /><strong>{copy.footer.label}</strong></div>
        <nav><Link href="/">{copy.footer.product}</Link><Link href="/app?guest=1">{copy.footer.app}</Link></nav>
        <span>{copy.footer.copyright}</span>
      </footer>
    </main>
  );
}
