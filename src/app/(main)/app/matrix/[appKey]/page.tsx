'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { db, getPreference, setPreference, getSessionSummary } from '@/lib/db';
import { classroomDataService } from '@/lib/services/classroom-data-service';
import { runMemoryMigration } from '@/lib/services/memory-migration';
import type { Anchor, TranscriptSegment } from '@/types';
import type { DataSourceType } from '@/lib/ai-native/types';
import { getWorkshopAppByKey, isWorkshopAppKey, type WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { useAppExecution } from '@/components/apps/hooks/useAppExecution';
import { AppWindowShell } from '@/components/apps/windows/AppWindowShell';
import { AppRenderSurface } from '@/components/apps/windows/AppRenderSurface';
import { COPY } from '@/lib/ui/copy';

const WORKSHOP_MODEL_PREFERENCE = 'ai_workshop_model';

function toDataSource(value: string | null): DataSourceType {
  if (value === 'live' || value === 'video' || value === 'demo') return value;
  return 'unknown';
}

function mapTranscriptRows(
  rows: Array<{
    id?: number;
    text: string;
    startMs: number;
    endMs: number;
    confidence: number;
    speakerId?: string;
    isFinal: boolean;
  }>
): TranscriptSegment[] {
  return rows.map((row, index) => ({
    id: String(row.id ?? `seg-${index + 1}`),
    text: row.text,
    startMs: row.startMs,
    endMs: row.endMs,
    confidence: row.confidence,
    speakerId: row.speakerId,
    isFinal: row.isFinal,
  }));
}

function mapAnchorRows(
  sessionId: string,
  rows: Array<{
    id?: number;
    timestamp: number;
    type: Anchor['type'];
    status: 'active' | 'resolved';
    note?: string;
    aiExplanation?: string;
    createdAt: Date;
    resolvedAt?: Date;
  }>
): Anchor[] {
  return rows.map((row, index) => ({
    id: `db-anchor-${row.id ?? index + 1}`,
    sessionId,
    studentId: 'local-student',
    timestamp: row.timestamp,
    type: row.type,
    cancelled: false,
    resolved: row.status === 'resolved',
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString(),
    note: row.note,
    aiExplanation: row.aiExplanation,
  }));
}

function mapDemoAnchors(sessionId: string): Anchor[] {
  return classroomDataService.getDemoAnchors().map((anchor, index) => ({
    id: anchor.id || `demo-anchor-${index + 1}`,
    sessionId,
    studentId: anchor.studentId,
    studentName: anchor.studentName,
    timestamp: anchor.timestamp,
    type: anchor.type,
    cancelled: anchor.cancelled,
    resolved: anchor.resolved,
    createdAt: anchor.createdAt,
    resolvedAt: anchor.resolvedAt,
    note: anchor.note,
    aiExplanation: anchor.aiExplanation,
  }));
}

type LoadState = 'loading' | 'ready' | 'empty' | 'error';
const LOAD_TIMEOUT_MS = 12000;

function MatrixRouteState({
  title,
  body,
  primaryHref,
  primaryLabel,
  secondaryHref,
}: {
  title: string;
  body?: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <section className="w-full max-w-md rounded-2xl border border-divider bg-white p-6 text-center">
        <p className="text-lg font-semibold text-ink">{title}</p>
        {body ? <p className="mt-2 text-sm leading-6 text-ink-secondary">{body}</p> : null}
        {primaryHref && primaryLabel ? (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link href={primaryHref} className="inline-flex min-h-10 items-center rounded-full bg-pine px-4 text-sm font-medium text-white">
              {primaryLabel}
            </Link>
            {secondaryHref ? (
              <Link href={secondaryHref} className="inline-flex min-h-10 items-center rounded-full border border-divider px-4 text-sm font-medium text-ink-secondary">
                {COPY.apps.matrix.backToMatrix}
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function buildInfographicContentContext(summaryOverview: string, transcript: TranscriptSegment[]): string {
  const normalizedSummary = summaryOverview.trim();
  if (normalizedSummary) return normalizedSummary;
  return transcript
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 1400);
}

export default function AppMatrixWindowPage() {
  const params = useParams<{ appKey: string }>();
  const searchParams = useSearchParams();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [sessionId, setSessionId] = useState('');
  const [dataSource, setDataSource] = useState<DataSourceType>('unknown');
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [summaryOverview, setSummaryOverview] = useState('');
  const [keyDifficulties, setKeyDifficulties] = useState<string[]>([]);
  const [model, setModel] = useState('');

  const rawAppKey = params?.appKey;
  const appKey = Array.isArray(rawAppKey) ? rawAppKey[0] : rawAppKey || '';
  const app = useMemo(() => (isWorkshopAppKey(appKey) ? getWorkshopAppByKey(appKey) : undefined), [appKey]);
  const backHref = useMemo(
    () => `/app?workspace=apps${searchParams.get('guest') === '1' ? '&guest=1' : ''}`,
    [searchParams],
  );
  const classroomHref = useMemo(
    () => `/app${searchParams.get('guest') === '1' ? '?guest=1' : ''}`,
    [searchParams],
  );

  useEffect(() => {
    void runMemoryMigration().catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      // 真相源：服务端 /api/llm/models（前端拿不到 server env，不能自己判断可用性）。
      const data = await fetch('/api/llm/models')
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
      const available: string[] = Array.isArray(data?.models) ? data.models.map((m: { id: string }) => m.id) : [];
      const serverDefault: string = (data?.workshopModel || data?.defaultModel || '').trim();
      const saved = await getPreference<string>(WORKSHOP_MODEL_PREFERENCE, '').catch(() => '');
      if (cancelled) return;
      // 只有当存储的偏好仍在服务端可用列表里才采用，否则回落服务端默认。
      const resolved = saved && (available.length === 0 || available.includes(saved)) ? saved : serverDefault;
      setModel(resolved);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!model) return;
    void setPreference(WORKSHOP_MODEL_PREFERENCE, model).catch(() => undefined);
  }, [model]);

  useEffect(() => {
    if (!app) {
      setLoadState('error');
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      setLoadState('error');
      toast.error(COPY.apps.matrix.windowLoadTimeout);
    }, LOAD_TIMEOUT_MS);
    const run = async () => {
      setLoadState('loading');
      const querySessionId = (searchParams.get('sessionId') || '').trim();
      const queryDataSource = toDataSource(searchParams.get('dataSource'));

      const resolveLatestSession = async (): Promise<string> => {
        const latest = await db.audioSessions.orderBy('createdAt').last();
        return latest?.sessionId || '';
      };

      let targetSessionId = querySessionId;
      if (!targetSessionId) {
        targetSessionId = await resolveLatestSession();
      }

      if (!targetSessionId) {
        if (queryDataSource === 'demo') {
          targetSessionId = classroomDataService.getDemoSessionId();
        }
      }

      if (!targetSessionId) {
        if (!cancelled) {
          setLoadState('empty');
          window.clearTimeout(timeout);
        }
        return;
      }

      const [transcriptRows, anchorRows, summary] = await Promise.all([
        db.transcripts.where('sessionId').equals(targetSessionId).sortBy('startMs'),
        db.anchors.where('sessionId').equals(targetSessionId).sortBy('timestamp'),
        getSessionSummary(targetSessionId),
      ]);

      if (transcriptRows.length === 0 && !querySessionId) {
        const fallbackSessionId = await resolveLatestSession();
        if (fallbackSessionId && fallbackSessionId !== targetSessionId) {
          targetSessionId = fallbackSessionId;
        }
      }

      const [finalTranscriptRows, finalAnchorRows, finalSummary] = targetSessionId === querySessionId
        ? [transcriptRows, anchorRows, summary]
        : await Promise.all([
            db.transcripts.where('sessionId').equals(targetSessionId).sortBy('startMs'),
            db.anchors.where('sessionId').equals(targetSessionId).sortBy('timestamp'),
            getSessionSummary(targetSessionId),
          ]);

      if (cancelled) return;

      if (finalTranscriptRows.length === 0) {
        const shouldUseDemoFallback =
          queryDataSource === 'demo' || targetSessionId === classroomDataService.getDemoSessionId();
        if (shouldUseDemoFallback) {
          const demoSessionId = classroomDataService.getDemoSessionId();
          setSessionId(demoSessionId);
          setDataSource('demo');
          setTranscript(classroomDataService.getDemoTranscripts());
          setAnchors(mapDemoAnchors(demoSessionId));
          setSummaryOverview('');
          setKeyDifficulties([]);
          setLoadState('ready');
          window.clearTimeout(timeout);
          return;
        }

        setLoadState('empty');
        window.clearTimeout(timeout);
        return;
      }

      setSessionId(targetSessionId);
      setDataSource(queryDataSource);
      setTranscript(mapTranscriptRows(finalTranscriptRows));
      setAnchors(mapAnchorRows(targetSessionId, finalAnchorRows));
      setSummaryOverview(finalSummary?.overview || '');
      setKeyDifficulties(Array.isArray(finalSummary?.keyDifficulties) ? finalSummary.keyDifficulties : []);
      setLoadState('ready');
      window.clearTimeout(timeout);
    };

    void run().catch((error) => {
      if (!cancelled) {
        window.clearTimeout(timeout);
        setLoadState('error');
        toast.error(error instanceof Error ? error.message : COPY.apps.matrix.windowLoadFailed);
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [app, searchParams]);

  const infographicContentContext = useMemo(
    () => buildInfographicContentContext(summaryOverview, transcript),
    [summaryOverview, transcript]
  );

  const execution = useAppExecution({
    app: app || getWorkshopAppByKey('audio-overview' as WorkshopAppKey)!,
    sessionId: sessionId || 'empty-session',
    dataSource,
    transcript,
    anchors,
    summaryOverview,
    keyDifficulties,
    model,
    autoRun: loadState === 'ready' && Boolean(app) && app?.key !== 'infographic',
  });

  if (!app) {
    return (
      <MatrixRouteState
        title={COPY.apps.matrix.windowUnavailableTitle}
        body={COPY.apps.matrix.windowUnavailableBody}
        primaryHref={backHref}
        primaryLabel={COPY.apps.matrix.backToMatrix}
      />
    );
  }

  if (loadState === 'loading') {
    return <MatrixRouteState title={COPY.apps.matrix.windowLoading} />;
  }

  if (loadState === 'empty') {
    return (
      <MatrixRouteState
        title={COPY.apps.matrix.windowEmptyTitle}
        body={COPY.apps.matrix.windowEmptyBody}
        primaryHref={classroomHref}
        primaryLabel={COPY.apps.matrix.windowBackToClassroom}
        secondaryHref={backHref}
      />
    );
  }

  if (loadState === 'error') {
    return (
      <MatrixRouteState
        title={COPY.apps.matrix.windowErrorTitle}
        body={COPY.apps.matrix.windowErrorBody}
        primaryHref={backHref}
        primaryLabel={COPY.apps.matrix.backToMatrix}
      />
    );
  }

  if (app.key === 'infographic') {
    return (
      <AppWindowShell
        app={app}
        taskState={execution.taskState}
        onRegenerate={() => void execution.rerun()}
        showPrimaryAction={false}
        backHref={backHref}
      >
        <AppRenderSurface
          appKey="infographic"
          sessionId={sessionId}
          result={execution.result}
          taskState={execution.taskState}
          contentContext={infographicContentContext}
          onGenerateDraft={() => (execution.hasResult ? execution.rerun() : execution.execute())}
          onResultUpdate={execution.updateResult}
        />
      </AppWindowShell>
    );
  }

  return (
    <AppWindowShell
      app={app}
      taskState={execution.taskState}
      onRegenerate={() => {
        void execution.rerun();
      }}
      backHref={backHref}
    >
      <AppRenderSurface
        appKey={app.key}
        result={execution.result}
        transcript={transcript}
        taskState={execution.taskState}
        sessionId={sessionId}
        contentContext={infographicContentContext}
        onRegenerate={() => void execution.rerun()}
        onGenerateDraft={() => (execution.hasResult ? execution.rerun() : execution.execute())}
        onResultUpdate={execution.updateResult}
      />
    </AppWindowShell>
  );
}
