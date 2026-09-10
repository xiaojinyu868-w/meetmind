'use client';

/**
 * AppWindowPlaceholder — 八个应用共用的进入态（等待 / 空 / 失败），一套版式（2026-09-10 重做）。
 *
 * 版式只有三层，三种状态都一样，成品落下来时形状变成真东西、位置不跳：
 *   1. 产物的形状（AppEntrySilhouette）——不看字就知道点开的是什么；等待时内容线呼吸、一处签名色明灭
 *   2. 一句话（≤14 字）——正在做什么 / 点一下会得到什么 / 刚才没做好
 *   3. 一个槽位——等待态放这节课的原话掠过（TranscriptDrift，有根的等待）；空态 / 失败态放唯一的动作
 *
 * 此前：章鱼 + 「在听这节课，给你课堂测验」+ 原话 + 「同学正在整理 · 01s」计数条 + 双色光晕；空态是虚线框 +
 * 标题 + 说明句 + 黑白两个按钮。用户原话"每一个应用的进入页面都挺难看"。计数器与光晕删掉；
 * 长等待仍诚实（30s / 60s 换一句话），只是不再数秒。
 */

import * as React from 'react';
import { COPY } from '@/lib/ui/copy';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { WORKSHOP_APP_CATALOG, type WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { AppEntrySilhouette } from './AppEntrySilhouette';
import { TranscriptDrift, type DriftLine } from './TranscriptDrift';

interface AppWindowPlaceholderProps {
  status: 'loading' | 'empty' | 'error';
  /** 应用 key：决定形状与一句话。不传时按 appName 在目录里反查（旧调用方只传名字） */
  appKey?: WorkshopAppKey;
  /** 应用中文名称（失败句用） */
  appName?: string;
  /** 这节课的转录（等待态）：真实原话按时间顺序掠过；不传就只有形状 + 一句话 */
  transcript?: ReadonlyArray<DriftLine>;
  errorMessage?: string;
  onRetry?: () => void;
  onBack?: () => void;
  /** 空态的一句话（缺省用该应用的进入句） */
  description?: string;
  /** 等待态的一句话（缺省用该应用的进入句） */
  loadingLabel?: string;
  /** 空态动作的名字（缺省「再做一版」） */
  actionLabel?: string;
  backLabel?: string;
}

const SLOW_AFTER_SEC = 30;
const VERY_SLOW_AFTER_SEC = 60;

/** 只为换句话计时，不再把秒数显示出来 */
function useElapsedSec(): number {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return seconds;
}

function resolveAppKey(appKey: WorkshopAppKey | undefined, appName: string | undefined): WorkshopAppKey | undefined {
  if (appKey) return appKey;
  return WORKSHOP_APP_CATALOG.find((item) => item.name === appName)?.key;
}

function entrySentence(appKey: WorkshopAppKey | undefined): string {
  return (appKey && APPS_COPY.entry.sentence[appKey]) || APPS_COPY.entry.generic;
}

/**
 * 服务端错误码 → 人话。课中内联卡把 `/api/apps/execute` 的 error 原样传进来，
 * 学生不该看到 `GENERATION_FAILED` 这种代码；Workshop 侧在 useAppExecution 已转过，
 * 这里兜住剩下的入口，让两条路径说同一句话。浏览器的网络错误原文（Failed to fetch / Load failed）同样不外露。
 */
export function describeAppExecutionError(raw: string | undefined): string | undefined {
  const code = raw?.trim();
  if (!code) return undefined;
  switch (code) {
    case 'GENERATION_FAILED':
    case '生成失败':
      return COPY.apps.matrix.executeGenerationFailed;
    case 'CONTENT_NOT_READY':
      return COPY.apps.matrix.executeNotReady;
    case 'APP_NOT_SUITABLE':
      return COPY.apps.matrix.executeNotSuitable;
    default:
      // 像错误码的全大写下划线串、浏览器 fetch 的英文原话一律不外露
      if (/^[A-Z][A-Z0-9_]{3,}$/.test(code)) return undefined;
      if (/^(Failed to fetch|Load failed|NetworkError|TypeError|fetch failed)/i.test(code)) return undefined;
      return code;
  }
}

/** 三种状态共用的三层版式 */
function EntryFrame({ status, children }: { status: 'loading' | 'empty' | 'error'; children: React.ReactNode }) {
  return (
    <div
      className="flex h-full min-h-[420px] flex-col items-center justify-center gap-6 px-6 py-10"
      data-app-placeholder={status}
      aria-busy={status === 'loading' || undefined}
    >
      {children}
    </div>
  );
}

const SHAPE_CLASS = 'w-[clamp(160px,28vw,250px)] drop-shadow-[0_6px_18px_rgba(32,49,42,0.06)]';
const SENTENCE_CLASS = 'text-center text-[15px] font-medium tracking-[-0.01em] text-ink';
const TEXT_ACTION_CLASS = 'mm-focus rounded text-[12.5px] text-ink-muted transition hover:text-ink';
const PRIMARY_ACTION_CLASS = 'mm-press mm-focus rounded-full bg-ink px-5 py-2 text-[13px] font-medium text-white shadow-soft hover:opacity-85';

function ListeningLoading({ appKey, loadingLabel, transcript }: { appKey?: WorkshopAppKey; loadingLabel?: string; transcript?: ReadonlyArray<DriftLine> }) {
  const seconds = useElapsedSec();
  const sentence = seconds > VERY_SLOW_AFTER_SEC
    ? APPS_COPY.entry.verySlow
    : seconds > SLOW_AFTER_SEC
      ? APPS_COPY.entry.slow
      : loadingLabel || entrySentence(appKey);
  const hasDrift = Boolean(transcript && transcript.length >= 3);
  return (
    <EntryFrame status="loading">
      <AppEntrySilhouette appKey={appKey} live className={SHAPE_CLASS} />
      <p className={SENTENCE_CLASS}>{sentence}</p>
      {hasDrift ? <TranscriptDrift transcript={transcript!} className="-mt-2 max-w-[400px]" /> : null}
    </EntryFrame>
  );
}

function EmptyGuide({ appKey, description, actionLabel, onRetry, onBack, backLabel }: {
  appKey?: WorkshopAppKey;
  description?: string;
  actionLabel?: string;
  onRetry?: () => void;
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <EntryFrame status="empty">
      <AppEntrySilhouette appKey={appKey} className={SHAPE_CLASS} />
      <p className={SENTENCE_CLASS}>{description || entrySentence(appKey)}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className={PRIMARY_ACTION_CLASS}>
          {actionLabel || APPS_COPY.placeholder.remake}
        </button>
      ) : null}
      {onBack ? (
        <button type="button" onClick={onBack} className={`${TEXT_ACTION_CLASS} -mt-3`}>
          {backLabel || APPS_COPY.placeholder.back}
        </button>
      ) : null}
    </EntryFrame>
  );
}

/**
 * 失败态只有一句话和一个按钮。服务端给出的具体原因（积分 / 材料不足）比通用句更有用时用它，
 * 否则就是「{应用}刚才没做好」；返回退成一行文字链接，不与主动作抢。形状留在原位，签名色换朱砂。
 */
function ErrorState({ appKey, appName, errorMessage, onRetry, onBack, backLabel }: {
  appKey?: WorkshopAppKey;
  appName: string;
  errorMessage?: string;
  onRetry?: () => void;
  onBack?: () => void;
  backLabel?: string;
}) {
  const shownMessage = describeAppExecutionError(errorMessage);
  const generic = !shownMessage
    || shownMessage === COPY.apps.matrix.executeGenerationFailed
    || shownMessage === COPY.apps.matrix.generateFailed
    || shownMessage === '应用执行失败';
  const sentence = shownMessage && !generic
    ? (shownMessage.length > 80 ? `${shownMessage.slice(0, 80)}…` : shownMessage)
    : APPS_COPY.placeholder.failedTitle(appName);
  return (
    <EntryFrame status="error">
      <AppEntrySilhouette appKey={appKey} tone="vermilion" className={SHAPE_CLASS} />
      <p className={`${SENTENCE_CLASS} max-w-sm leading-relaxed`} title={shownMessage}>{sentence}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className={PRIMARY_ACTION_CLASS}>
          {APPS_COPY.placeholder.retry}
        </button>
      ) : null}
      {onBack ? (
        <button type="button" onClick={onBack} className={`${TEXT_ACTION_CLASS} -mt-3`}>
          {backLabel || APPS_COPY.placeholder.back}
        </button>
      ) : null}
    </EntryFrame>
  );
}

export function AppWindowPlaceholder(props: AppWindowPlaceholderProps) {
  const {
    status,
    appName = APPS_COPY.placeholder.defaultAppName,
    errorMessage,
    onRetry,
    onBack,
    description,
    loadingLabel,
    actionLabel,
    backLabel,
    transcript,
  } = props;
  const appKey = resolveAppKey(props.appKey, appName);

  if (status === 'loading') {
    return <ListeningLoading appKey={appKey} loadingLabel={loadingLabel} transcript={transcript} />;
  }
  if (status === 'error') {
    return <ErrorState appKey={appKey} appName={appName} errorMessage={errorMessage} onRetry={onRetry} onBack={onBack} backLabel={backLabel} />;
  }
  return <EmptyGuide appKey={appKey} description={description} actionLabel={actionLabel} onRetry={onRetry} onBack={onBack} backLabel={backLabel} />;
}
