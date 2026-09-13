'use client';

/**
 * 课堂页材料栏与课后页共用的两块：材料清单（有根：每篇一段预览、正文状态说人话、原文链接）与「继续看」。
 */

import * as React from 'react';
import { ZHIHU_COPY as C } from '@/lib/ui/copy-zhihu';
import type { LiveMaterialPack } from '@/lib/services/teach-live/live-materials';
import type { ContinueReadingGroup } from '@/lib/services/zhihu/zhihu-discovery-service';

function previewOf(excerpt: string, max = 120): string {
  const first = excerpt
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/[#>*`_]/g, '').replace(/\s+/g, ' ').trim())
    .find((p) => p.length > 0) ?? '';
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

export function MaterialsList({ pack, compact = false }: { pack: LiveMaterialPack; compact?: boolean }) {
  return (
    <div>
      <h2 className={`${compact ? 'text-[14px]' : 'text-[15px]'} font-medium`}>
        {pack.mode === 'single' ? C.materialsTitleSingle : pack.mode === 'theme' ? C.materialsTitleTheme(pack.items.length) : C.materialsTitle(pack.items.length)}
      </h2>
      {pack.pickReason && <p className="mt-1 text-[12.5px] leading-6 text-pine-deep">{C.startWhy(pack.pickReason)}</p>}
      <ol className="mt-3 space-y-3">
        {pack.items.map((item) => (
          <li key={item.ref} className="rounded-xl border border-divider bg-card px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-ink-muted">
              <span className="font-mono text-pine">{item.ref}</span>
              <span>{item.meta}</span>
            </div>
            <p className="mt-1 text-[14px] font-medium leading-6">{item.title}</p>
            {item.author && <p className="text-[12px] text-ink-secondary">{item.author}</p>}
            {!compact && <p className="mt-2 line-clamp-3 text-[13px] leading-6 text-ink-secondary">{previewOf(item.excerpt)}</p>}
            <p className={`mt-2 text-[12px] ${item.body === 'full' ? 'text-ink-muted' : 'text-cinnabar-deep'}`}>
              {item.body === 'full' ? (pack.mode === 'single' && !/^（全文 \d+ 字/.test(item.excerpt) ? C.materialsFullTextNote : C.materialsFullNote) : C.materialsSummaryNote}
            </p>
            <a className="mt-1 inline-block text-[12px] text-pine underline-offset-4 hover:underline" href={item.url} target="_blank" rel="noopener noreferrer">
              {C.openOriginal}
            </a>
          </li>
        ))}
      </ol>
      {pack.skipped && pack.skipped.length > 0 && (
        <p className="mt-4 text-[12px] leading-6 text-ink-muted">
          {C.materialsSkipped(pack.skipped.length)}：{pack.skipped.map((s) => `${s.title}（${s.reason}）`).join('；')}
        </p>
      )}
    </div>
  );
}

export function ContinueReadingPanel({
  weak,
  groups,
  busy,
  exhausted = false,
}: {
  weak: string[] | null;
  groups: ContinueReadingGroup[] | null;
  busy: boolean;
  exhausted?: boolean;
}) {
  return (
    <section className="space-y-4">
      {weak === null && <p className="text-[13px] leading-6 text-ink-secondary">{C.continueIntro}</p>}
      {weak && weak.length === 0 && <p className="text-[13px] leading-6 text-pine-deep">{C.continueAllGood}</p>}
      {weak && weak.length > 0 && <p className="text-[13px] leading-6 text-ink">{C.continueWeak(weak)}</p>}
      {busy && <p className="text-[13px] text-ink-muted">{C.continueLoading}</p>}
      {!busy && weak && weak.length > 0 && groups && groups.length === 0 && (
        <p className="text-[13px] text-ink-muted">{exhausted ? C.continueQuotaOut : C.continueEmpty}</p>
      )}
      {groups?.map((group) => (
        <div key={group.concept}>
          <h3 className="text-[13px] font-medium text-ink-secondary">{group.concept}</h3>
          <ul className="mt-2 space-y-2">
            {group.candidates.map((candidate) => (
              <li key={candidate.url} className="rounded-xl border border-divider bg-card px-4 py-3">
                <a className="text-[14px] font-medium leading-6 text-ink hover:text-pine" href={candidate.url} target="_blank" rel="noopener noreferrer">
                  {candidate.title}
                </a>
                <p className="mt-1 text-[12px] text-ink-muted">
                  {candidate.author}
                  {candidate.author ? ' · ' : ''}
                  {candidate.reason}
                </p>
                {candidate.snippet && <p className="mt-1 line-clamp-3 text-[13px] leading-6 text-ink-secondary">{candidate.snippet}</p>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
