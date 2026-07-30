'use client';

import { useState } from 'react';
import { COPY } from '@/lib/ui/copy';
import { handleSpotlightMove } from './landing-spotlight';
import pageStyles from './LandingPage.module.css';
import styles from './LandingContextLine.module.css';

type Memory = (typeof COPY.landing.context.memories)[number];

function MemoryRow({ memory }: { memory: Memory }) {
  const copy = COPY.landing.context;
  const [paused, setPaused] = useState(false);
  const [forgotten, setForgotten] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState<string>(memory.text);

  return (
    <li className={styles.memoryRow} data-paused={paused} data-forgotten={forgotten}>
      <span className={styles.kind} data-kind={memory.kind}>{memory.kind}</span>
      <div className={styles.memoryMain}>
        {editing ? (
          <input
            className={styles.memoryInput}
            value={text}
            autoFocus
            onChange={(event) => setText(event.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
              if (event.key === 'Escape') {
                setText(memory.text);
                setEditing(false);
              }
            }}
          />
        ) : (
          <strong>{text}</strong>
        )}
        <small>{paused ? copy.pausedLabel : memory.source}</small>
      </div>
      <div className={styles.memoryActions}>
        <button type="button" onClick={() => setEditing(true)}>{copy.actions.correct}</button>
        <button type="button" onClick={() => setPaused((v) => !v)}>
          {paused ? copy.actions.resume : copy.actions.pause}
        </button>
        <button type="button" className={styles.forget} onClick={() => setForgotten(true)}>
          {copy.actions.forget}
        </button>
      </div>
    </li>
  );
}

export function LandingContextLine() {
  const copy = COPY.landing.context;
  return (
    <section className={styles.contextLine} id="context" aria-labelledby="context-title">
      <div className={pageStyles.sectionHeading}>
        <span className={pageStyles.eyebrow} data-reveal>{copy.eyebrow}</span>
        <h2 id="context-title" data-reveal style={{ transitionDelay: '80ms' }}>{copy.title}</h2>
        <p className={styles.lead} data-reveal style={{ transitionDelay: '160ms' }}>{copy.body}</p>
      </div>
      <div className={styles.memoryPanel} data-reveal style={{ transitionDelay: '240ms' }} onMouseMove={handleSpotlightMove}>
        <header>{copy.panelTitle}</header>
        <ul>
          {copy.memories.map((memory) => (
            <MemoryRow memory={memory} key={memory.text} />
          ))}
        </ul>
        <footer>
          <i />
          {copy.note}
        </footer>
      </div>
    </section>
  );
}
