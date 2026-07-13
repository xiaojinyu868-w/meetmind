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
      toast.error('应用窗口加载超时，请返回应用页重试。');
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
        toast.error(error instanceof Error ? error.message : '这节课内容加载失败');
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
      <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
        <div className="max-w-md rounded-2xl border border-divider bg-white p-6">
          <p className="text-lg font-semibold text-ink">应用不存在</p>
          <p className="mt-2 text-sm text-ink-secondary">该应用暂未启用。</p>
          <Link href="/app?workspace=apps" className="mt-4 inline-flex rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white">
            返回应用
          </Link>
        </div>
      </div>
    );
  }

  if (loadState === 'loading') {
    return <div className="flex min-h-screen items-center justify-center bg-canvas text-sm text-ink-muted">正在整理这节课...</div>;
  }

  if (loadState === 'empty') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
        <div className="max-w-lg rounded-2xl border border-divider bg-white p-6">
          <p className="text-lg font-semibold text-ink">暂无可用课堂数据</p>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">还没找到能使用的课堂内容。请先录一节课或导入视频后再进入应用。</p>
          <div className="mt-4 flex gap-2">
            <Link href="/app" className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white">
              去导入数据
            </Link>
            <Link href="/app?workspace=apps" className="rounded-lg border border-divider px-3 py-2 text-sm font-medium text-ink-secondary">
              返回应用
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (loadState === 'error') {
    return <div className="flex min-h-screen items-center justify-center bg-canvas text-sm text-danger-600">加载失败，请返回应用页重试。</div>;
  }

  if (app.key === 'infographic') {
    return (
      <div className="min-h-screen bg-canvas">
        <header className="sticky top-0 z-20 border-b border-divider bg-white">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
            <Link
              href="/app?workspace=apps"
              className="inline-flex items-center gap-1 rounded-full border border-divider bg-white px-3 py-1.5 text-sm text-ink-secondary hover:text-ink"
            >
              <span>←</span>
              <span>返回应用</span>
            </Link>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold text-ink">信息图结果</p>
              <p className="truncate text-xs text-ink-muted">独立结果页：优先看成品，可直接下载或继续修改。</p>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <AppRenderSurface
            appKey="infographic"
            sessionId={sessionId}
            result={execution.result}
            taskState={execution.taskState}
            contentContext={infographicContentContext}
            onGenerateDraft={() => (execution.hasResult ? execution.rerun() : execution.execute())}
            onResultUpdate={execution.updateResult}
          />
        </main>
      </div>
    );
  }

  return (
    <AppWindowShell
      app={app}
      taskState={execution.taskState}
      onRegenerate={() => {
        void execution.rerun();
      }}
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
        mindmapDefaultFullscreen
      />
    </AppWindowShell>
  );
}
