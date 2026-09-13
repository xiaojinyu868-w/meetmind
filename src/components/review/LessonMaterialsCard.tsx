'use client';

/**
 * 复习页左栏顶部：这节课（同学讲的）讲的是哪几篇——有根。
 * 与来源无关：只读 LessonRecord。来源特有的动作（如知乎的「继续看」）由宿主用 `extra` 插槽塞进来。
 * 安静：一张小卡、一行一篇、动作只有「接着讲」和「看原文」。
 */

import * as React from 'react';
import Link from 'next/link';
import { LESSON_COPY as C } from '@/lib/ui/copy-lesson';
import type { LessonRecord } from '@/lib/services/teach-live/lesson-record';

function coverageText(coverage: 'full-text' | 'outline' | 'summary'): string {
  if (coverage === 'full-text') return C.coverageFull;
  if (coverage === 'outline') return C.coverageOutline;
  return C.coverageSummary;
}

export function LessonMaterialsCard({ record, extra }: { record: LessonRecord; extra?: React.ReactNode }) {
  const materials = record.materials;
  const [open, setOpen] = React.useState(true);
  if (!materials || materials.items.length === 0) return null;
  const taught = materials.mode === 'single' ? C.taughtSingle : materials.mode === 'theme' ? C.taughtTheme(materials.items.length) : C.taughtFavlist(materials.items.length);
  return (
    <section className="border-b border-divider-light bg-paper-warm/60 px-5 py-3.5" aria-label={C.cardEyebrow}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] tracking-wide text-ink-muted">
          {C.cardEyebrow} · {C.cardFrom(materials.title)}
          {record.pages.length > 0 ? ` · ${C.pagesTaught(record.pages.length)}` : ''}
        </p>
        <button type="button" className="text-[11px] text-ink-muted hover:text-ink" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? '收起' : '展开'}
        </button>
      </div>
      {open && (
        <>
          <p className="mt-1.5 text-[13px] text-ink-secondary">{taught}</p>
          {materials.pickReason && <p className="mt-0.5 text-[12.5px] leading-6 text-pine-deep">{C.pickedBecause(materials.pickReason)}</p>}
          <ol className="mt-2 space-y-1.5">
            {materials.items.map((item) => (
              <li key={item.ref} className="text-[13px] leading-6">
                <span className="mr-1.5 font-mono text-[11px] text-pine">{item.ref}</span>
                <a className="font-medium text-ink hover:text-pine" href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.title}
                </a>
                <span className="ml-1.5 text-[12px] text-ink-muted">
                  {item.author ? `${item.author} · ` : ''}
                  {coverageText(item.coverage)}
                  {item.mentioned ? '' : ` · ${C.notMentioned}`}
                </span>
              </li>
            ))}
          </ol>
          {record.priorLessons.length > 0 && <p className="mt-2 text-[12px] text-ink-muted">{C.priorLessons(record.priorLessons.length)}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link href={record.stageHref} className="rounded-full bg-pine px-3.5 py-1.5 text-[12.5px] text-white hover:bg-pine-deep" title={C.continueTeachingHint}>
              {C.continueTeaching} →
            </Link>
            {!record.settled && <span className="text-[12px] text-ink-muted">{C.unsettled}</span>}
          </div>
          {extra}
        </>
      )}
    </section>
  );
}
