'use client';

/**
 * MobileLessonPath — 手机端课后学习页（课后学习页 v2 的手机形态）。
 *
 * 此前手机端是 8 个应用的平铺列表加一枚「推荐」角标；桌面端在 2026-09-08 改成了
 * 「先做这一件（带理由）→ 学习路径（检验 → 记住 → 讲出来 → 带走，带结果）→ 还可以这样学」。
 * 两端读同一份判断（lesson-path-model：recommendNextStep / summarizeSessionOutcomes）和同一份
 * 会话层结果（review-session-outcomes），所以在手机上做完闪卡回到这页，路径上的那一步就写着
 * "8 张记住 6"，「先做这一件」跟着换成"讲给同桌听"。
 *
 * 「已做好」按 useAppExecution 的本机结果缓存判定（readCachedAppResult）；返回本页时组件重挂载，
 * 缓存重新读一次即可，不需要订阅。
 */

import { useMemo } from 'react';
import { ArrowRight, Check, ChevronRight } from 'lucide-react';
import { WORKSHOP_APP_CATALOG, type WorkshopAppCatalogItem, type WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { COPY } from '@/lib/ui/copy';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { cn } from '@/lib/utils';
import type { Anchor, TranscriptSegment } from '@/types';
import {
  LEARNING_PATH,
  formatLessonMeta,
  formatOutcomeLine,
  isPathApp,
  recommendNextStep,
  summarizeSessionOutcomes,
} from '@/components/apps/lesson-path-model';
import { useSessionOutcomes } from '@/components/apps/review-session-outcomes';
import { readCachedAppResult } from '@/components/apps/hooks/useAppExecution';

interface MobileLessonPathProps {
  sessionId: string;
  title?: string;
  segments: readonly TranscriptSegment[];
  anchors: readonly Anchor[];
  keyDifficulties?: readonly string[];
  /** 当前层可用的应用（已按可用性过滤） */
  apps: readonly WorkshopAppCatalogItem[];
  /** 还没有任何结果时，模型按内容给的首选（读过内容，但没看过学生做题） */
  modelPick?: WorkshopAppKey | null;
  onOpen: (key: WorkshopAppKey) => void;
}

export function MobileLessonPath({ sessionId, title, segments, anchors, keyDifficulties, apps, modelPick, onOpen }: MobileLessonPathProps) {
  const copy = APPS_COPY.path;
  const outcomes = useSessionOutcomes(sessionId);
  const summary = useMemo(() => summarizeSessionOutcomes(outcomes), [outcomes]);
  const allowed = useMemo(() => new Set(apps.map((app) => app.key)), [apps]);
  // 结果缓存 + 会话层结果：两者任一存在都算"做过"
  const generated = useMemo(() => {
    const done = new Set<WorkshopAppKey>();
    for (const app of apps) {
      if (readCachedAppResult(sessionId, app.key)) done.add(app.key);
    }
    for (const item of outcomes) done.add(item.appKey as WorkshopAppKey);
    return done;
  }, [apps, outcomes, sessionId]);

  const next = useMemo(() => recommendNextStep({
    anchors,
    keyDifficulties,
    transcript: segments,
    outcomes: summary,
    generated,
    allowed,
  }), [allowed, anchors, generated, keyDifficulties, segments, summary]);

  // 模型按内容给的首选，只在课堂事实说不出具体理由时接手（与桌面 WorkshopYellowPage 同一规则）
  const pick = outcomes.length === 0 && !next.grounded && modelPick && allowed.has(modelPick) && !generated.has(modelPick) ? modelPick : null;
  const featuredKey = pick ?? next.key;
  const featured = featuredKey ? apps.find((app) => app.key === featuredKey) : undefined;
  const featuredReason = featuredKey === next.key ? next.reason : COPY.apps.matrix.recommendedByContent;

  const pathApps = LEARNING_PATH.map((key) => apps.find((app) => app.key === key)).filter((app): app is WorkshopAppCatalogItem => Boolean(app));
  const quietApps = apps.filter((app) => !isPathApp(app.key));
  const meta = formatLessonMeta(segments, anchors, keyDifficulties?.length ?? 0);

  return (
    <div className="flex flex-col gap-4" data-testid="mobile-lesson-path">
      {/* 这节课 */}
      <header className="px-1">
        <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-pine">{copy.lessonEyebrow}</p>
        {title ? <h2 className="mt-1.5 text-[19px] font-semibold leading-snug tracking-[-0.02em] text-ink">{title}</h2> : null}
        <p className="mt-1 text-[12px] text-ink-muted">{meta}</p>
      </header>

      {/* 先做这一件：页面唯一饱和主按钮，理由是学生能核对的事实 */}
      {featured && !next.completed ? (
        <button
          type="button"
          onClick={() => onOpen(featured.key)}
          data-testid={`mobile-featured-${featured.key}`}
          className="rounded-[22px] border border-pine/30 bg-white p-4 text-left shadow-soft ring-4 ring-pine/[0.06] transition active:scale-[0.99]"
        >
          <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-pine">{copy.nextTitle}</p>
          <p className="mt-2 text-[20px] font-semibold leading-tight tracking-[-0.02em] text-ink">{featured.name}</p>
          <p className="mt-2 text-[13px] leading-5 text-ink-secondary">{featuredReason}</p>
          <span className="mt-3.5 inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-pine px-5 text-[14px] font-semibold text-white">
            {COPY.apps.matrix.start}
            <ArrowRight size={14} strokeWidth={2.2} />
          </span>
        </button>
      ) : null}

      {/* 走完了 */}
      {next.completed ? (
        <section className="flex gap-3 rounded-[22px] border border-pine/25 bg-pine-mist/60 p-4" data-testid="mobile-path-complete">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pine text-white"><Check size={16} strokeWidth={2.6} /></span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-ink">{copy.wrap.title}</p>
            <p className="mt-1 text-[12.5px] leading-5 text-ink-secondary">{copy.wrap.body}</p>
            <ul className="mt-2 space-y-0.5 text-[12px] text-ink-muted">
              {pathApps.map((app) => {
                const line = formatOutcomeLine(app.key, summary);
                return line ? <li key={app.key}>{app.learningAction} · {line}</li> : null;
              })}
            </ul>
          </div>
        </section>
      ) : null}

      {/* 学习路径 */}
      {pathApps.length > 0 ? (
        <section aria-label={copy.pathTitle}>
          <h3 className="px-1 text-[13px] font-semibold text-ink">{copy.pathTitle}</h3>
          <ol className="mt-2 overflow-hidden rounded-[20px] border border-divider bg-white">
            {pathApps.map((app, index) => {
              const done = generated.has(app.key);
              const now = !next.completed && app.key === featuredKey;
              const outcome = formatOutcomeLine(app.key, summary);
              return (
                <li key={app.key} className={cn(index > 0 && 'border-t border-divider/70')}>
                  <button
                    type="button"
                    onClick={() => onOpen(app.key)}
                    data-testid={`mobile-step-${app.key}`}
                    className={cn('flex min-h-[64px] w-full items-center gap-3.5 px-4 py-3 text-left transition active:bg-paper-warm', now && 'bg-pine-mist/40')}
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold',
                        done ? 'bg-pine text-white' : now ? 'border-2 border-pine text-pine' : 'border border-divider text-ink-muted',
                      )}
                      aria-hidden
                    >
                      {done ? <Check size={13} strokeWidth={2.8} /> : index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-pine">{copy.stepLabels[app.key] ?? app.learningAction}</span>
                        {now ? <span className="rounded-full bg-vermilion-mist px-1.5 py-px text-[10px] font-semibold text-vermilion">{copy.nextTitle}</span> : null}
                      </span>
                      <span className="mt-0.5 block truncate text-[15px] font-semibold text-ink">{app.name}</span>
                      <span className="mt-0.5 block text-[12px] text-ink-muted">
                        {outcome ?? (done ? copy.ready : copy.notStarted)}
                      </span>
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-ink-muted" />
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {/* 还可以这样学：安静列表 */}
      {quietApps.length > 0 ? (
        <section aria-label={copy.quietTitle}>
          <h3 className="px-1 text-[13px] font-semibold text-ink">{copy.quietTitle}</h3>
          <ul className="mt-2 overflow-hidden rounded-[20px] border border-divider bg-white">
            {quietApps.map((app, index) => (
              <li key={app.key} className={cn(index > 0 && 'border-t border-divider/70')}>
                <button
                  type="button"
                  onClick={() => onOpen(app.key)}
                  className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left transition active:bg-paper-warm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">{app.name}</span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">{app.bestFor}</span>
                  </span>
                  <span className="shrink-0 text-[12px] font-medium text-pine">{generated.has(app.key) ? copy.ready : COPY.apps.matrix.start}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** 当前层可用的应用（class 层）。放在这里让 AppsScreen 只管导航。 */
export function classTierApps(): WorkshopAppCatalogItem[] {
  return WORKSHOP_APP_CATALOG.filter((app) => app.supportedTiers.includes('class'));
}
