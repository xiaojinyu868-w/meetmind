'use client';

import { COPY } from '@/lib/ui/copy';
import {
  normalizeStudyReportDocument,
  type NormalizedStudyReportTopic,
  type StudyReportListSection,
  type StudyReportPayload,
} from './study-report-document-model';

interface StudyReportDocumentProps {
  payload: StudyReportPayload;
}

function TopicBadge({ children }: { children: string }) {
  return (
    <span className="inline-flex shrink-0 rounded-full border border-divider bg-card px-2.5 py-1 text-[12px] leading-none text-ink-secondary">
      {children}
    </span>
  );
}

function LeadTopic({ topic }: { topic: NormalizedStudyReportTopic | null }) {
  if (!topic) {
    return (
      <div className="rounded-3xl border border-dashed border-divider bg-card px-6 py-8 text-center">
        <p className="text-[14px] leading-[1.8] text-ink-muted">{COPY.studyReport.emptyTopics}</p>
      </div>
    );
  }

  return (
    <section className="rounded-3xl border border-divider bg-card p-6 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-ink-muted">
          {COPY.studyReport.focusTitle}
        </p>
        <TopicBadge>{topic.difficulty}</TopicBadge>
      </div>
      <h3 className="mt-4 text-[22px] font-semibold leading-tight tracking-[-0.03em] text-ink sm:text-[26px]">
        {topic.name}
      </h3>
      {topic.gist ? (
        <p className="mt-4 max-w-[42rem] text-[15px] leading-[1.9] text-ink-secondary">
          {topic.gist}
        </p>
      ) : null}
    </section>
  );
}

function SupportingTopics({ topics }: { topics: NormalizedStudyReportTopic[] }) {
  if (topics.length === 0) return null;

  return (
    <section className="rounded-3xl border border-divider bg-card p-5 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h3 className="text-[14px] font-semibold text-ink">{COPY.studyReport.structureTitle}</h3>
        <span className="text-[12px] text-ink-muted">{COPY.studyReport.remainingTopics(topics.length)}</span>
      </div>
      <div className="grid gap-3">
        {topics.map((topic, index) => (
          <article key={`${topic.name}-${index}`} className="min-w-0 rounded-2xl border border-divider-light bg-canvas p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-medium tabular-nums text-white">
                {String(index + 2).padStart(2, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h4 className="min-w-0 break-words text-[15px] font-semibold leading-snug text-ink">{topic.name}</h4>
                  <TopicBadge>{topic.difficulty}</TopicBadge>
                </div>
                {topic.gist ? (
                  <p className="mt-2 break-words text-[13.5px] leading-[1.75] text-ink-secondary">{topic.gist}</p>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TextSection({ title, body }: { title: string; body: string }) {
  if (!body) return null;
  return (
    <section className="rounded-3xl border border-divider bg-card p-5 sm:p-6">
      <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
      <p className="mt-3 text-[14px] leading-[1.85] text-ink-secondary">{body}</p>
    </section>
  );
}

function ListSection({ section }: { section: StudyReportListSection }) {
  return (
    <section className="rounded-3xl border border-divider bg-card p-5 sm:p-6">
      <h3 className="text-[14px] font-semibold text-ink">{section.title}</h3>
      <ol className="mt-4 space-y-3">
        {section.items.map((item, index) => (
          <li key={`${item}-${index}`} className="grid grid-cols-[1.75rem_1fr] gap-3 text-[14px] leading-[1.75] text-ink-secondary">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-canvas text-[12px] font-medium tabular-nums text-ink-muted">
              {index + 1}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function StudyReportDocument({ payload }: StudyReportDocumentProps) {
  const document = normalizeStudyReportDocument(payload);

  return (
    <article className="flex h-full min-h-[440px] flex-col bg-canvas text-ink">
      <header className="border-b border-divider bg-card px-5 py-6 sm:px-8 sm:py-7">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-ink-muted">
              {COPY.studyReport.label}
            </p>
            <span className="rounded-full border border-divider bg-canvas px-3 py-1 text-[11px] text-ink-muted">
              {COPY.studyReport.topicCount(document.topicCount)}
            </span>
          </div>
          <h2 className="mt-3 max-w-[46rem] text-[24px] font-semibold leading-tight tracking-[-0.035em] text-ink sm:text-[30px]">
            {document.title}
          </h2>
          <p className="mt-4 max-w-[48rem] text-[15px] leading-[1.9] text-ink-secondary">
            {document.letterToParent}
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto grid w-full max-w-5xl gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.85fr)] xl:gap-6">
          <main className="space-y-5">
            <LeadTopic topic={document.leadTopic} />
            <SupportingTopics topics={document.supportingTopics} />
          </main>

          <aside className="space-y-5">
            <TextSection title={COPY.studyReport.confusionTitle} body={document.confusionAnalysis} />
            {document.sections.map((section) => (
              <ListSection key={section.title} section={section} />
            ))}
          </aside>
        </div>
      </div>
    </article>
  );
}
