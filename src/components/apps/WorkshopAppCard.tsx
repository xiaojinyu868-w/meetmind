'use client';

import type { ReactNode } from 'react';
import {
  ArrowUpRight,
  BookMarked,
  BookOpen,
  Headphones,
  Image as ImageIcon,
  Layers,
  ListTodo,
  Mic,
  Network,
  Play,
  RotateCcw,
  RotateCw,
  Sparkles,
} from 'lucide-react';
import type { WorkshopAppCatalogItem, WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { COPY } from '@/lib/ui/copy';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import styles from './WorkshopYellowPage.module.css';

export type WorkshopCardStatus = 'idle' | 'running' | 'success' | 'error';

const STAMP_PATTERN = /(\d{1,2}:\d{2}(?::\d{2})?)/g;

/**
 * 推荐理由里的时间点（「你在 0:30、1:12 留了标记」）渲染成朱批 [MM:SS] 引用——
 * 「有根」是这页的 DNA，理由指向课堂里具体的一刻，就该长得像一处引用而不是普通文字。
 */
function renderReasonWithStamps(text: string): ReactNode {
  const parts = text.split(STAMP_PATTERN);
  if (parts.length === 1) return text;
  return parts.map((part, index) =>
    /^\d{1,2}:\d{2}(?::\d{2})?$/.test(part)
      ? <span key={`${part}-${index}`} className="cite-ts mono" style={{ fontSize: '11px', padding: '0 5px', margin: '0 1px', verticalAlign: '1px' }}>{part}</span>
      : part,
  );
}

/**
 * 三种形态，三级视觉重量（课后学习页 v2）：
 * - featured：「先做这一件」——页面唯一饱和主按钮，带理由，surface-ai 式 pine ring
 * - step：学习路径的一步——步骤号 + 动作词 + 状态 / 结果摘要，主按钮为 ghost
 * - quiet：「还可以这样学」——一行式，ghost 按钮
 */
export type WorkshopCardVariant = 'featured' | 'step' | 'quiet';

interface WorkshopAppCardProps {
  app: WorkshopAppCatalogItem;
  status: WorkshopCardStatus;
  variant?: WorkshopCardVariant;
  /** step 形态：1 起的步骤号与动作词（检验 / 记住 / 讲出来 / 带走） */
  stepIndex?: number;
  stepLabel?: string;
  /** featured 形态的推荐理由；step 形态上标"先做这个" */
  recommended?: boolean;
  recommendationReason?: string;
  /** 会话内结果摘要（"5 题对 3"）；有则替代状态词 */
  outcomeLine?: string;
  /** 结果之后的再做提示（"再做一版，带上刚错的 2 处"） */
  redoHint?: string;
  progressLabel?: ReactNode;
  onStart: () => void;
  onOpen: () => void;
  onRetry: () => void;
  onRemake: () => void;
  onProgress: () => void;
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
  'teach-back': Mic,
  explainer: BookOpen,
};

function statusLabel(status: WorkshopCardStatus): string {
  if (status === 'running') return APPS_COPY.path.running;
  if (status === 'success') return APPS_COPY.path.ready;
  if (status === 'error') return APPS_COPY.path.failed;
  return APPS_COPY.path.notStarted;
}

export function WorkshopAppCard({
  app,
  status,
  variant = 'quiet',
  stepIndex,
  stepLabel,
  recommended = false,
  recommendationReason,
  outcomeLine,
  redoHint,
  progressLabel,
  onStart,
  onOpen,
  onRetry,
  onRemake,
  onProgress,
  shareAction,
  adminAction,
}: WorkshopAppCardProps) {
  const Icon = APP_ICONS[app.key];
  const featured = variant === 'featured';
  const step = variant === 'step';
  const cardClassName = [
    styles.card,
    featured ? styles.cardFeatured : '',
    step ? styles.cardStep : '',
    variant === 'quiet' ? styles.cardQuiet : '',
    featured ? styles.cardRecommended : '',
    status === 'success' ? styles.cardGenerated : '',
    status === 'running' ? styles.cardRunning : '',
    status === 'error' ? styles.cardFailed : '',
  ].filter(Boolean).join(' ');
  const primaryClass = featured ? styles.primaryAction : styles.ghostAction;
  // 同一应用可能同时出现在「先做这一件」与路径里：featured 用独立 test id，避免测试选择器撞车
  const tid = (base: string) => (featured ? `workshop-featured-${base}` : `workshop-${base}`);
  const openLabel = app.key === 'infographic' ? COPY.apps.matrix.openImage : COPY.apps.matrix.open;

  const statusNode = status === 'running' && progressLabel
    ? progressLabel
    : outcomeLine && status === 'success'
      ? <span className={styles.outcomeText}>{outcomeLine}</span>
      : statusLabel(status);

  const actions = (
    <div className={styles.actionRow}>
      {status === 'running' ? (
        <button
          type="button"
          className={primaryClass}
          onClick={onProgress}
          aria-label={`${app.name}，${COPY.apps.matrix.progress}`}
          data-testid={tid(`inline-progress-${app.key}`)}
        >
          <ListTodo size={13} strokeWidth={1.75} />
          {COPY.apps.matrix.progress}
        </button>
      ) : status === 'error' ? (
        <button
          type="button"
          className={primaryClass}
          onClick={onRetry}
          aria-label={`${app.name}，${COPY.apps.matrix.retry}`}
          data-testid={tid(`inline-retry-${app.key}`)}
        >
          <RotateCcw size={13} strokeWidth={1.75} />
          {COPY.apps.matrix.retry}
        </button>
      ) : status === 'success' ? (
        <>
          <button
            type="button"
            className={primaryClass}
            onClick={onOpen}
            aria-label={`${app.name}，${openLabel}`}
            data-testid={tid(`open-result-${app.key}`)}
          >
            <ArrowUpRight size={13} strokeWidth={1.75} />
            {openLabel}
          </button>
          {shareAction}
          {featured || step ? (
            <button
              type="button"
              className={styles.secondaryAction}
              onClick={onRemake}
              title={redoHint ?? COPY.apps.matrix.remake}
              data-testid={tid(`bg-generate-${app.key}`)}
            >
              <RotateCw size={13} strokeWidth={1.75} />
              {redoHint ?? COPY.apps.matrix.remake}
            </button>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          className={primaryClass}
          onClick={onStart}
          aria-label={`${app.name}，${COPY.apps.matrix.start}`}
          data-testid={tid(`bg-generate-${app.key}`)}
        >
          <Play size={13} strokeWidth={1.75} />
          {COPY.apps.matrix.start}
        </button>
      )}
      {adminAction}
    </div>
  );

  if (variant === 'quiet') {
    return (
      <article className={cardClassName} data-app={app.key} data-testid={tid(`card-${app.key}`)}>
        <div className={styles.quietIcon} aria-hidden><Icon size={18} strokeWidth={1.6} /></div>
        <div className={styles.quietBody}>
          <p className={styles.quietTitle}>
            <span className={styles.quietAction}>{app.learningAction}</span>
            <span className={styles.quietName}>{app.name}</span>
          </p>
          <p className={styles.quietFit}>{app.bestFor} · {app.timeLabel}</p>
        </div>
        <span className={`${styles.statusDot} ${styles[`status${status}`]}`}>
          <span className={styles.statusDotCore} aria-hidden />
          <span className={styles.statusDotLabel}>{statusNode}</span>
        </span>
        {actions}
      </article>
    );
  }

  return (
    <article className={cardClassName} data-app={app.key} data-testid={tid(`card-${app.key}`)}>
      {step ? (
        <div className={styles.stepHead}>
          <span className={styles.stepIndex}>{stepIndex}</span>
          <span className={styles.stepLabel}>{stepLabel ?? app.learningAction}</span>
          {recommended ? <span className={styles.stepNow}>{COPY.apps.matrix.recommended}</span> : null}
        </div>
      ) : null}
      <div className={styles.cardMain}>
        <div className={styles.coverWrap} aria-hidden>
          <Icon size={featured ? 24 : 20} strokeWidth={1.55} />
        </div>
        <div className={styles.cardBody}>
          <div className={styles.rowTop}>
            <div className={styles.titleGroup}>
              {featured ? <span className={styles.learningAction}>{app.learningAction}</span> : null}
              <h3 className={styles.appName}>{app.name}</h3>
            </div>
            <span className={`${styles.statusDot} ${styles[`status${status}`]}`}>
              <span className={styles.statusDotCore} aria-hidden />
              <span className={styles.statusDotLabel}>{statusNode}</span>
            </span>
          </div>
          {featured && recommendationReason ? (
            <p className={styles.recommendationReason}>{renderReasonWithStamps(recommendationReason)}</p>
          ) : (
            <p className={styles.fitLine}>{app.bestFor}</p>
          )}
          <p className={styles.cardMeta}>{app.timeLabel}{featured ? ` · ${app.outputType}` : ''}</p>
        </div>
      </div>
      {actions}
    </article>
  );
}
