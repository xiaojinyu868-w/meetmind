'use client';

import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Database, GraduationCap, Play, Trophy } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';
import styles from './TechnologyPage.module.css';

const ease = [0.22, 1, 0.36, 1] as const;

function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-70px' }}
      transition={{ duration: 0.85, delay, ease }}
    >
      {children}
    </motion.div>
  );
}

function TechMark() {
  return (
    <span className={styles.techMark} aria-hidden="true">
      <span /><span /><span />
    </span>
  );
}

function StackFlow() {
  const stack = COPY.technology.track.stack;
  return (
    <div className={styles.stackFlow}>
      {stack.map((node, index) => (
        <div className={styles.stackItem} key={node.en}>
          <Reveal className={styles.stackNode} delay={index * 0.15}>
            <strong>{node.en}</strong>
            <span>{node.cn}</span>
          </Reveal>
          {index < stack.length - 1 && (
            <div className={styles.stackLink} aria-hidden="true">
              <motion.i
                animate={{ x: ['0%', '100%'], opacity: [0, 1, 1, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 0.7, delay: index * 0.5, ease: 'easeInOut' }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Flywheel() {
  const copy = COPY.technology.flywheel;
  return (
    <div className={styles.flywheel}>
      <svg className={styles.flywheelRing} viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(23,23,19,.32)" strokeWidth="0.5" strokeDasharray="1.6 2.2" />
        <path d="M48 3.6 L48 6.4 L51.6 5 Z" fill="rgba(23,23,19,.6)" />
        <path d="M48 3.6 L48 6.4 L51.6 5 Z" fill="rgba(23,23,19,.6)" transform="rotate(120 50 50)" />
        <path d="M48 3.6 L48 6.4 L51.6 5 Z" fill="rgba(23,23,19,.6)" transform="rotate(240 50 50)" />
      </svg>
      <div className={styles.flywheelCenter}><em>{copy.center}</em></div>
      {copy.steps.map((step, index) => {
        const angle = index * 72 - 90;
        return (
          <Reveal
            key={step}
            className={styles.flywheelNode}
            delay={index * 0.12}
          >
            <div style={{ transform: `rotate(${angle}deg) translate(var(--fly-r)) rotate(${-angle}deg)` }}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <p>{step}</p>
            </div>
          </Reveal>
        );
      })}
    </div>
  );
}

export function TechnologyPage() {
  const copy = COPY.technology;

  return (
    <main className={styles.page}>
      {/* 1 · 定义赛道 */}
      <section className={styles.hero} aria-labelledby="technology-title">
        <Image className={styles.heroImage} src="/images/landing/classroom-hero.webp" alt={copy.imageAlt} fill priority sizes="100vw" />
        <div className={styles.heroShade} aria-hidden="true" />
        <header className={styles.header}>
          <Link className={styles.logo} href="/"><TechMark /><span>{COPY.identity.productName}</span><small>{copy.label}</small></Link>
          <nav aria-label={copy.navigation.gap}>
            <a href="#gap">{copy.navigation.gap}</a>
            <a href="#perception">{copy.navigation.perception}</a>
            <a href="#memory">{copy.navigation.memory}</a>
            <a href="#teacher">{copy.navigation.teacher}</a>
            <a href="#roadmap">{copy.navigation.roadmap}</a>
            <Link href="/"><ArrowLeft size={14} />{copy.navigation.product}</Link>
            <Link className={styles.navCta} href="/app?guest=1&entry=demo">{copy.navigation.openProduct}</Link>
          </nav>
        </header>
        <div className={styles.heroCopy}>
          <span>{copy.hero.eyebrow}</span>
          <h1 id="technology-title">{copy.hero.title}</h1>
          <p className={styles.heroSub}>{copy.hero.sub}</p>
          <em className={styles.heroPunch}>{copy.hero.punch}</em>
        </div>
        <div className={styles.heroBottom}>
          <a href="#track"><Play size={16} fill="currentColor" />{copy.hero.primaryAction}<ArrowRight size={17} /></a>
          <div><small>{copy.hero.statusLabel}</small><strong>{copy.hero.statusValue}</strong></div>
        </div>
      </section>

      <section className={styles.section} id="track">
        <Reveal className={styles.secHead}>
          <small>{copy.track.eyebrow}</small>
          <h2>{copy.track.title}</h2>
          <p>{copy.track.body}</p>
        </Reveal>
        <div className={styles.abilityGrid}>
          {copy.track.abilities.map((ability, index) => (
            <Reveal key={ability.title} delay={index * 0.12}>
              <article className={styles.abilityCard}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <h3>{ability.title}</h3>
                <p>{ability.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
        <Reveal className={styles.stackBand} delay={0.1}>
          <small>{copy.track.stackLabel}</small>
          <StackFlow />
        </Reveal>
      </section>

      {/* 2 · 技术缺口 */}
      <section className={`${styles.section} ${styles.gapSection}`} id="gap">
        <Reveal className={styles.secHead}>
          <small>{copy.gap.eyebrow}</small>
          <h2>{copy.gap.title}</h2>
        </Reveal>
        <div className={styles.pipelineCompare}>
          <Reveal className={styles.pipelineTraditional}>
            <small>{copy.gap.traditionalLabel}</small>
            <div>
              {copy.gap.traditional.map((step, index) => (
                <span key={step} className={styles.tradStep}>
                  {step}
                  {index < copy.gap.traditional.length - 1 && <ArrowRight size={14} aria-hidden="true" />}
                </span>
              ))}
            </div>
          </Reveal>
          <Reveal className={styles.pipelineOurs} delay={0.12}>
            <small>{copy.gap.oursLabel}</small>
            <ol>
              {copy.gap.loop.map((step, index) => (
                <li key={step}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{step}</strong>
                </li>
              ))}
            </ol>
            <div className={styles.loopBack}>
              <svg viewBox="0 0 600 26" preserveAspectRatio="none" aria-hidden="true">
                <path d="M596 4 L596 13 L10 13 L10 22" fill="none" stroke="rgba(255,100,36,.75)" strokeWidth="1.5" />
                <path d="M6 18 L10 25 L14 18" fill="none" stroke="rgba(255,100,36,.75)" strokeWidth="1.5" />
              </svg>
              <em>{copy.gap.loopBack}</em>
            </div>
          </Reveal>
        </div>
        <div className={styles.gapTable}>
          <Reveal className={styles.gapTableHead}>
            <span>{copy.gap.missCol}</span>
            <span>{copy.gap.oursCol}</span>
          </Reveal>
          {copy.gap.rows.map((row, index) => (
            <Reveal key={row.miss} className={styles.gapRow} delay={index * 0.1}>
              <p>{row.miss}</p>
              <ArrowRight size={16} aria-hidden="true" />
              <strong>{row.ours}</strong>
            </Reveal>
          ))}
        </div>
      </section>

      {/* 3 · MM-Perception */}
      <section className={`${styles.section} ${styles.perception}`} id="perception">
        <Reveal className={styles.secHead}>
          <small>{copy.perception.eyebrow}</small>
          <h2>{copy.perception.title}</h2>
        </Reveal>
        <div className={styles.perceptionGrid}>
          <Reveal className={styles.perceptionInputs}>
            <small>{copy.perception.inputLabel}</small>
            <div>
              {copy.perception.inputs.map((input, index) => (
                <motion.span
                  key={input}
                  initial={{ opacity: 0, scale: 0.85 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.05, duration: 0.5, ease }}
                >
                  {input}
                </motion.span>
              ))}
            </div>
          </Reveal>
          <svg className={styles.fusion} viewBox="0 0 120 200" aria-hidden="true">
            <path d="M0 30 C 62 30, 68 100, 120 100" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.2" />
            <path d="M0 77 C 62 77, 68 100, 120 100" fill="none" stroke="rgba(255,100,36,.85)" strokeWidth="1.4" />
            <path d="M0 123 C 62 123, 68 100, 120 100" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.2" />
            <path d="M0 170 C 62 170, 68 100, 120 100" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.2" />
            <path d="M112 94 L120 100 L112 106" fill="none" stroke="rgba(255,100,36,.85)" strokeWidth="1.4" />
          </svg>
          <Reveal className={styles.perceptionOutput} delay={0.15}>
            <small>{copy.perception.outputLabel}</small>
            <strong>{copy.perception.outputName}</strong>
            <div>
              {copy.perception.outputParts.map((part, index) => (
                <span key={part}>{index > 0 && <i>+</i>}{part}</span>
              ))}
            </div>
          </Reveal>
          <Reveal className={styles.perceptionTech} delay={0.2}>
            <small>{copy.perception.techLabel}</small>
            <ol>
              {copy.perception.tech.map((item, index) => (
                <li key={item}><span>{String(index + 1).padStart(2, '0')}</span>{item}</li>
              ))}
            </ol>
          </Reveal>
        </div>
        <Reveal className={styles.award} delay={0.1}>
          <Trophy size={22} aria-hidden="true" />
          <div>
            <strong>{copy.perception.award}</strong>
            <span>{copy.perception.awardDetail}</span>
          </div>
          <p>{copy.perception.awardNote}</p>
        </Reveal>
      </section>

      {/* 4 · MM-Memory */}
      <section className={`${styles.section} ${styles.memorySection}`} id="memory">
        <Reveal className={styles.secHead}>
          <small>{copy.memory.eyebrow}</small>
          <h2>{copy.memory.title}</h2>
        </Reveal>
        <div className={styles.memoryGrid}>
          <div>
            <Reveal className={styles.memoryInput}>
              <small>{copy.memory.inputLabel}</small>
              <p>{copy.memory.input}</p>
            </Reveal>
            <div className={styles.memoryLayers}>
              <small>{copy.memory.layersLabel}</small>
              {copy.memory.layers.map((layer, index) => (
                <Reveal key={layer.en} delay={index * 0.1}>
                  <article className={index === copy.memory.layers.length - 1 ? styles.evidenceLayer : undefined}>
                    <strong>{layer.en}<span>{layer.cn}</span></strong>
                    <p>{layer.body}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
          <div className={styles.memorySide}>
            <Reveal className={styles.memoryQuestions}>
              <small>{copy.memory.questionsLabel}</small>
              <ol>
                {copy.memory.questions.map((question) => <li key={question}>{question}</li>)}
              </ol>
              <em>{copy.memory.note}</em>
            </Reveal>
            <Reveal className={styles.memoryOutput} delay={0.15}>
              <small>{copy.memory.outputLabel}</small>
              <strong>{copy.memory.outputName}</strong>
              <p>{copy.memory.outputBody}</p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* 5 · MM-Teacher */}
      <section className={`${styles.section} ${styles.teacherSection}`} id="teacher">
        <Reveal className={styles.secHead}>
          <small>{copy.teacher.eyebrow}</small>
          <h2>{copy.teacher.title}</h2>
        </Reveal>
        <Reveal className={styles.teacherInputs}>
          <small>{copy.teacher.inputLabel}</small>
          {copy.teacher.inputs.map((input) => <span key={input}>{input}</span>)}
        </Reveal>
        <div className={styles.teacherActions}>
          <Reveal><small>{copy.teacher.actionsLabel}</small></Reveal>
          <div>
            {copy.teacher.actions.map((action, index) => (
              <motion.span
                key={action}
                className={action === '追问' ? styles.actionChosen : undefined}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.05, duration: 0.5, ease }}
              >
                {action}
              </motion.span>
            ))}
          </div>
        </div>
        <div className={styles.objectives}>
          <Reveal><small>{copy.teacher.objectivesLabel}</small></Reveal>
          {copy.teacher.objectives.map((objective, index) => (
            <Reveal key={objective.label} delay={index * 0.1}>
              <article className={index === copy.teacher.objectives.length - 1 ? styles.objectiveActive : undefined}>
                <span>{objective.label}</span>
                <strong>{objective.formula}</strong>
              </article>
            </Reveal>
          ))}
          <Reveal className={styles.objectivesNote} delay={0.2}><p>{copy.teacher.objectivesNote}</p></Reveal>
        </div>
        <Reveal className={styles.teacherOutput}>
          <small>{copy.teacher.outputLabel}</small>
          <strong>{copy.teacher.outputName}</strong>
          <p>{copy.teacher.outputBody}</p>
        </Reveal>
        <Reveal className={styles.punch}><p>{copy.teacher.punch}</p></Reveal>
      </section>

      {/* 6 · 训练闭环 */}
      <section className={`${styles.section} ${styles.flywheelSection}`} id="flywheel">
        <Reveal className={styles.secHead}>
          <small>{copy.flywheel.eyebrow}</small>
          <h2>{copy.flywheel.title}</h2>
        </Reveal>
        <div className={styles.flywheelGrid}>
          <Flywheel />
          <div className={styles.flywheelCopy}>
            <Reveal><p>{copy.flywheel.body}</p></Reveal>
            <Reveal delay={0.15}><em>{copy.flywheel.punch}</em></Reveal>
          </div>
        </div>
      </section>

      {/* 7 · 产品入口 */}
      <section className={`${styles.section} ${styles.productSection}`} id="product">
        <Reveal className={styles.secHead}>
          <small>{copy.product.eyebrow}</small>
          <h2>{copy.product.title}</h2>
        </Reveal>
        <div className={styles.productCols}>
          <Reveal className={styles.productCol}>
            <header><GraduationCap size={18} aria-hidden="true" /><small>{copy.product.userLabel}</small></header>
            <ol>{copy.product.userItems.map((item) => <li key={item}>{item}</li>)}</ol>
          </Reveal>
          <Reveal className={`${styles.productCol} ${styles.productColSystem}`} delay={0.15}>
            <header><Database size={18} aria-hidden="true" /><small>{copy.product.systemLabel}</small></header>
            <ol>{copy.product.systemItems.map((item) => <li key={item}>{item}</li>)}</ol>
          </Reveal>
        </div>
        <Reveal className={styles.productPunch}><strong>{copy.product.punch}</strong></Reveal>
      </section>

      {/* 8 · 技术壁垒 */}
      <section className={`${styles.section} ${styles.moatSection}`} id="moat">
        <Reveal className={styles.secHead}>
          <small>{copy.moat.eyebrow}</small>
          <h2>{copy.moat.title}</h2>
        </Reveal>
        <Reveal className={styles.moatFormula}>
          {copy.moat.formula.map((part) => <span key={part}>{part}</span>)}
          <i>=</i>
          <strong>{copy.moat.formulaResult}</strong>
        </Reveal>
        <div className={styles.moatGrid}>
          {copy.moat.items.map((item, index) => (
            <Reveal key={item.title} delay={index * 0.1}>
              <article>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* 9 · 路线图 */}
      <section className={`${styles.section} ${styles.roadmapSection}`} id="roadmap">
        <Reveal className={styles.secHead}>
          <small>{copy.roadmap.eyebrow}</small>
          <h2>{copy.roadmap.title}</h2>
        </Reveal>
        <div className={styles.roadmapTrack}>
          <motion.i
            aria-hidden="true"
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 1.6, ease }}
          />
          {copy.roadmap.phases.map((phase, index) => (
            <Reveal key={phase.phase} delay={0.2 + index * 0.18}>
              <article className={index === copy.roadmap.phases.length - 1 ? styles.phaseFinal : undefined}>
                <span>{phase.phase}</span>
                <h3>{phase.title}</h3>
              </article>
            </Reveal>
          ))}
        </div>
        <Reveal className={styles.punch}><p>{copy.roadmap.punch}</p></Reveal>
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
