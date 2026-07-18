'use client';

import type { ReactNode } from 'react';
import {
  ArrowUpRight,
  BookMarked,
  Headphones,
  Image as ImageIcon,
  Layers,
  ListTodo,
  Network,
  Play,
  RotateCcw,
  RotateCw,
  Sparkles,
} from 'lucide-react';
import type { WorkshopAppCatalogItem, WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { COPY } from '@/lib/ui/copy';
import styles from './WorkshopYellowPage.module.css';

export type WorkshopCardStatus = 'idle' | 'running' | 'success' | 'error';

interface WorkshopAppCardProps {
  app: WorkshopAppCatalogItem;
  status: WorkshopCardStatus;
  available?: boolean;
  recommended?: boolean;
  recommendationReason?: string;
  progressLabel?: ReactNode;
  onStart: () => void;
  onOpen: () => void;
  onRetry: () => void;
  onRemake: () => void;
  onProgress: () => void;
  compact?: boolean;
  shareAction?: ReactNode;
  adminAction?: ReactNode;
}

const APP_ICONS: Record<WorkshopAppKey, typeof Layers> = {
  cheatsheet: BookMarked,
  flashcards: Layers,
  quiz: Sparkles,
  mindmap: Network,
  infographic: ImageIcon,
  'audio-overview': Headphones,
};

function statusLabel(status: WorkshopCardStatus, available: boolean): string {
  if (status === 'running') return COPY.apps.matrix.running;
  if (status === 'success') return COPY.apps.matrix.ready;
  if (status === 'error') return COPY.apps.matrix.failed;
  if (!available) return COPY.apps.matrix.notAvailable;
  return COPY.apps.matrix.waiting;
}

export function WorkshopAppCard({
  app,
  status,
  available = true,
  recommended = false,
  recommendationReason,
  progressLabel,
  onStart,
  onOpen,
  onRetry,
  onRemake,
  onProgress,
  compact = false,
  shareAction,
  adminAction,
}: WorkshopAppCardProps) {
  const Icon = APP_ICONS[app.key];
  const cardClassName = [
    styles.card,
    recommended ? styles.cardRecommended : '',
    status === 'success' ? styles.cardGenerated : '',
    status === 'running' ? styles.cardRunning : '',
    status === 'error' ? styles.cardFailed : '',
    compact ? styles.cardCompact : styles.cardFeatured,
  ].filter(Boolean).join(' ');

  return (
    <article className={cardClassName} data-testid={`workshop-card-${app.key}`}>
      <div className={styles.coverWrap} aria-hidden>
        <Icon size={24} strokeWidth={1.55} />
      </div>

      <div className={styles.cardBody}>
        <div className={styles.rowTop}>
          <div className={styles.titleGroup}>
            <div className={styles.cardLabelRow}>
              <span className={styles.learningAction}>{app.learningAction}</span>
            </div>
            <h3 className={styles.appName}>{app.name}</h3>
          </div>
          <span className={`${styles.statusDot} ${styles[`status${status}`]}`}>
            <span className={styles.statusDotCore} aria-hidden />
            <span className={styles.statusDotLabel}>
              {status === 'running' && progressLabel ? progressLabel : statusLabel(status, available)}
            </span>
          </span>
        </div>

        <p className={styles.fitLine}>{app.bestFor}</p>
        <p className={styles.cardMeta}>{app.timeLabel} · {app.outputType}</p>
        {recommended && recommendationReason ? (
          <p className={styles.recommendationReason}>{recommendationReason}</p>
        ) : null}
      </div>

      <div className={styles.actionRow}>
        {status === 'running' ? (
          <button
            type="button"
            className={styles.primaryAction}
            onClick={onProgress}
            aria-label={`${app.name}，${COPY.apps.matrix.progress}`}
            title={COPY.apps.matrix.progress}
            data-testid={`workshop-inline-progress-${app.key}`}
          >
            <ListTodo size={13} strokeWidth={1.75} />
            <span className={compact ? styles.compactActionText : undefined}>{COPY.apps.matrix.progress}</span>
          </button>
        ) : status === 'error' ? (
          <button
            type="button"
            className={styles.primaryAction}
            onClick={onRetry}
            disabled={!available}
            aria-label={`${app.name}，${COPY.apps.matrix.retry}`}
            title={COPY.apps.matrix.retry}
            data-testid={`workshop-inline-retry-${app.key}`}
          >
            <RotateCcw size={13} strokeWidth={1.75} />
            <span className={compact ? styles.compactActionText : undefined}>{COPY.apps.matrix.retry}</span>
          </button>
        ) : status === 'success' ? (
          <>
            <button
              type="button"
              className={styles.primaryAction}
              onClick={onOpen}
              aria-label={`${app.name}，${app.key === 'infographic' ? COPY.apps.matrix.openImage : COPY.apps.matrix.open}`}
              title={app.key === 'infographic' ? COPY.apps.matrix.openImage : COPY.apps.matrix.open}
              data-testid={`workshop-open-result-${app.key}`}
            >
              <ArrowUpRight size={13} strokeWidth={1.75} />
              <span className={compact ? styles.compactActionText : undefined}>
                {app.key === 'infographic' ? COPY.apps.matrix.openImage : COPY.apps.matrix.open}
              </span>
            </button>
            {shareAction}
            {!compact ? (
              <button type="button" className={styles.secondaryAction} onClick={onRemake} disabled={!available} data-testid={`workshop-bg-generate-${app.key}`}>
                <RotateCw size={13} strokeWidth={1.75} />
                {COPY.apps.matrix.remake}
              </button>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            className={styles.primaryAction}
            onClick={onStart}
            disabled={!available}
            aria-label={`${app.name}，${available ? COPY.apps.matrix.start : COPY.apps.matrix.notAvailable}`}
            title={available ? COPY.apps.matrix.start : COPY.apps.matrix.notAvailable}
            data-testid={`workshop-bg-generate-${app.key}`}
          >
            <Play size={13} strokeWidth={1.75} />
            <span className={compact ? styles.compactActionText : undefined}>
              {available ? COPY.apps.matrix.start : COPY.apps.matrix.notAvailable}
            </span>
          </button>
        )}
        {adminAction}
      </div>
    </article>
  );
}
