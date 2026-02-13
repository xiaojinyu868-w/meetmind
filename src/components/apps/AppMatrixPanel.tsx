'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ModelSelector } from '@/components/ModelSelector';
import { DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import { getPreference, setPreference } from '@/lib/db';
import type { Anchor, TranscriptSegment } from '@/types';
import type {
  AppCard,
  AppExecutionResult,
  AppPluginManifest,
  DataSourceType,
} from '@/lib/ai-native/types';

const PRIMARY_PLUGIN_ID = 'knowledge-cards';
const TASK_STATE_KEY_PREFIX = 'app_matrix_task_state:';
const LAST_RESULT_KEY_PREFIX = 'app_matrix_last_result:';

interface AppMatrixPanelProps {
  sessionId: string;
  dataSource: DataSourceType;
  transcript: TranscriptSegment[];
  anchors: Anchor[];
  summaryOverview?: string;
  keyDifficulties?: string[];
  onSeek: (timeMs: number, autoPlay?: boolean) => void;
}

interface TaskCompletionItem {
  id: string;
  label: string;
  reason?: string;
  relatedTimestamp?: number;
  estimatedMinutes?: number;
  completed: boolean;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function toTaskStateKey(sessionId: string, pluginId: string): string {
  return `${TASK_STATE_KEY_PREFIX}${sessionId}:${pluginId}`;
}

function toLastResultKey(sessionId: string): string {
  return `${LAST_RESULT_KEY_PREFIX}${sessionId}`;
}

function normalizePluginList(plugins: AppPluginManifest[]): AppPluginManifest[] {
  const preferred = plugins.filter((plugin) => plugin.id === PRIMARY_PLUGIN_ID);
  if (preferred.length > 0) return preferred;
  return plugins.filter((plugin) => plugin.id !== 'fallback');
}

function normalizeCardActionPayload(payload: Record<string, unknown> | undefined): number | null {
  if (!payload) return null;
  const timestamp = payload.timestamp;
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    return timestamp;
  }
  return null;
}

function readTaskId(payload: Record<string, unknown> | undefined): string | null {
  if (!payload) return null;
  return typeof payload.taskId === 'string' ? payload.taskId : null;
}

export function AppMatrixPanel({
  sessionId,
  dataSource,
  transcript,
  anchors,
  summaryOverview,
  keyDifficulties,
  onSeek,
}: AppMatrixPanelProps) {
  const [plugins, setPlugins] = useState<AppPluginManifest[]>([]);
  const [selectedPluginId, setSelectedPluginId] = useState(PRIMARY_PLUGIN_ID);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<AppExecutionResult | null>(null);
  const [taskState, setTaskState] = useState<Record<string, boolean>>({});

  const visiblePlugins = useMemo(() => normalizePluginList(plugins), [plugins]);

  const tasks = useMemo<TaskCompletionItem[]>(() => {
    if (!result?.tasks) return [];
    return result.tasks.map((task) => ({
      ...task,
      completed: Boolean(taskState[task.id]),
    }));
  }, [result, taskState]);

  const completedCount = tasks.filter((task) => task.completed).length;
  const completionPercent = tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100);

  const restoreTaskState = useCallback(
    async (pluginId: string) => {
      const stored = await getPreference<Record<string, boolean>>(toTaskStateKey(sessionId, pluginId), {});
      setTaskState(stored);
    },
    [sessionId]
  );

  const fetchPlugins = useCallback(async () => {
    const response = await fetch('/api/apps/plugins');
    const payload = (await response.json()) as { plugins?: AppPluginManifest[] };
    const nextPlugins = Array.isArray(payload.plugins) ? payload.plugins : [];
    setPlugins(nextPlugins);

    const candidate = normalizePluginList(nextPlugins)[0];
    if (candidate) {
      setSelectedPluginId(candidate.id);
    }
  }, []);

  useEffect(() => {
    void fetchPlugins().catch((error) => {
      console.error('Failed to load app matrix plugins:', error);
      toast.error('应用矩阵插件加载失败');
    });
  }, [fetchPlugins]);

  useEffect(() => {
    setResult(null);
    setTaskState({});
    void (async () => {
      const cached = await getPreference<AppExecutionResult | null>(toLastResultKey(sessionId), null);
      if (!cached) return;
      setResult(cached);
      setSelectedPluginId(cached.pluginId);
      await restoreTaskState(cached.pluginId);
    })().catch((error) => {
      console.error('Failed to restore app matrix result:', error);
    });
  }, [restoreTaskState, sessionId]);

  const runPlugin = useCallback(async () => {
    if (transcript.length === 0) {
      toast.error('当前没有课堂转录，先采集课堂内容再生成卡片。');
      return;
    }

    setIsRunning(true);
    try {
      const response = await fetch('/api/apps/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pluginId: selectedPluginId,
          model: selectedModel,
          goal: {
            intent: '复习模式：生成课堂证据知识卡片',
            expectedOutput: 'mixed',
          },
          input: {
            sessionId,
            dataSource,
            transcript,
            anchors,
          },
          memory: {
            summary: summaryOverview,
            keyDifficulties,
          },
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        result?: AppExecutionResult;
        error?: string;
      };

      if (!response.ok || !payload.ok || !payload.result) {
        throw new Error(payload.error || '应用执行失败');
      }

      setResult(payload.result);
      setSelectedPluginId(payload.result.pluginId);
      await setPreference(toLastResultKey(sessionId), payload.result);
      await restoreTaskState(payload.result.pluginId);
      toast.success('知识卡片已生成');
    } catch (error) {
      console.error('Failed to run matrix plugin:', error);
      toast.error(error instanceof Error ? error.message : '知识卡片生成失败');
    } finally {
      setIsRunning(false);
    }
  }, [
    anchors,
    dataSource,
    keyDifficulties,
    restoreTaskState,
    selectedModel,
    selectedPluginId,
    sessionId,
    summaryOverview,
    transcript,
  ]);

  const toggleTask = useCallback(
    (taskId: string, forceComplete?: boolean) => {
      if (!result) return;
      const pluginId = result.pluginId;
      setTaskState((prev) => {
        const nextCompleted = forceComplete === undefined ? !prev[taskId] : forceComplete;
        const next = { ...prev, [taskId]: nextCompleted };
        void setPreference(toTaskStateKey(sessionId, pluginId), next).catch((error) => {
          console.error('Failed to persist app matrix task state:', error);
        });
        return next;
      });
    },
    [result, sessionId]
  );

  const handleCardAction = useCallback(
    (card: AppCard, action: NonNullable<AppCard['actions']>[number]) => {
      if (action.kind === 'seek') {
        const timestamp = normalizeCardActionPayload(action.payload);
        if (timestamp !== null) {
          onSeek(timestamp, true);
        }
        return;
      }

      if (action.kind === 'mark_done') {
        const taskId = readTaskId(action.payload);
        if (taskId) {
          toggleTask(taskId, true);
          toast.success(`已完成：${card.title}`);
        }
      }
    },
    [onSeek, toggleTask]
  );

  return (
    <div className="relative h-full overflow-y-auto p-4 sm:p-5 bg-gradient-to-br from-[#fffdf6] via-[#fff6ea] to-[#f9fbff]" data-testid="app-matrix-panel">
      <div className="pointer-events-none absolute -top-16 right-8 h-44 w-44 rounded-full bg-amber-300/30 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-48 w-48 rounded-full bg-sky-200/30 blur-3xl" />

      <div className="relative rounded-3xl border border-white/60 bg-white/65 p-4 backdrop-blur-xl shadow-[0_18px_40px_rgba(212,165,116,0.22)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-amber-600/90">App Matrix</p>
            <h3 className="mt-1 text-lg font-semibold text-[#294058]">知识卡片工作台</h3>
            <p className="mt-1 text-xs text-slate-500">课堂证据链优先，生成后可直接回放并勾选完成。</p>
          </div>
          <div className="flex items-center gap-2">
            <ModelSelector value={selectedModel} onChange={setSelectedModel} compact />
            <button
              type="button"
              onClick={runPlugin}
              disabled={isRunning}
              data-testid="app-matrix-run"
              className="rounded-2xl px-4 py-2 text-sm font-semibold text-[#5b3e14] transition-all disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                background: 'linear-gradient(145deg, #f9d58f, #efc16a)',
                boxShadow:
                  'inset 2px 2px 6px rgba(255,255,255,0.72), inset -2px -3px 6px rgba(178,126,46,0.32), 0 8px 16px rgba(212,165,116,0.35)',
              }}
            >
              {isRunning ? '生成中...' : '生成卡片'}
            </button>
          </div>
        </div>

        {visiblePlugins.length > 1 && (
          <div className="mt-3">
            <select
              value={selectedPluginId}
              onChange={(event) => setSelectedPluginId(event.target.value)}
              className="w-full rounded-xl border border-amber-200 bg-white/85 px-3 py-2 text-sm text-slate-700"
            >
              {visiblePlugins.map((plugin) => (
                <option key={plugin.id} value={plugin.id}>
                  {plugin.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!result && (
        <div className="mt-4 rounded-3xl border border-dashed border-amber-200 bg-white/80 p-8 text-center">
          <p className="text-sm text-slate-500">点击「生成卡片」，按课堂证据链生成复习卡片与行动清单。</p>
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-4">
          <div className="rounded-3xl bg-[#f4ead8] p-4 shadow-[inset_3px_3px_8px_rgba(255,255,255,0.85),inset_-4px_-4px_10px_rgba(177,136,82,0.24),0_10px_22px_rgba(212,165,116,0.16)]">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-[#5a4220]">行动清单</h4>
              <span className="text-xs text-[#7a6442]">
                {completedCount}/{tasks.length} 完成 · {completionPercent}%
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-300"
                style={{ width: `${completionPercent}%` }}
              />
            </div>
            <div className="mt-3 space-y-2">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  data-testid={`app-task-${task.id}`}
                  data-completed={task.completed ? 'true' : 'false'}
                  className={`flex items-start gap-3 rounded-2xl border px-3 py-2.5 transition-all ${
                    task.completed
                      ? 'border-emerald-200 bg-emerald-50/80'
                      : 'border-white/80 bg-white/80'
                  }`}
                >
                  <button
                    type="button"
                    data-testid={`app-task-toggle-${task.id}`}
                    onClick={() => toggleTask(task.id)}
                    className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border transition-all ${
                      task.completed ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300 bg-white'
                    }`}
                    aria-label={task.completed ? '标记未完成' : '标记完成'}
                  >
                    {task.completed && (
                      <svg className="mx-auto mt-0.5 h-3 w-3 text-white" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8.2 8.2a1 1 0 01-1.414 0L3.293 10.1a1 1 0 111.414-1.414l3.093 3.093 7.493-7.492a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${task.completed ? 'text-emerald-700 line-through' : 'text-slate-700'}`}>
                      {task.label}
                    </p>
                    {task.reason && <p className="mt-1 text-xs text-slate-500">{task.reason}</p>}
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-400">
                      {typeof task.relatedTimestamp === 'number' && <span>@ {formatTime(task.relatedTimestamp)}</span>}
                      {typeof task.estimatedMinutes === 'number' && <span>{task.estimatedMinutes} 分钟</span>}
                    </div>
                  </div>
                  {typeof task.relatedTimestamp === 'number' && (
                    <button
                      type="button"
                      onClick={() => onSeek(task.relatedTimestamp!, true)}
                      className="shrink-0 rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      回放
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {result.cards.map((card) => (
              <article
                key={card.id}
                data-testid={`app-card-${card.id}`}
                className="rounded-3xl border border-white/70 bg-white/70 p-4 backdrop-blur-xl shadow-[0_14px_28px_rgba(71,103,153,0.12)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-semibold text-[#2c415a]">{card.title}</h4>
                  {card.priority && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      {card.priority}
                    </span>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{card.body}</p>

                {card.citations && card.citations.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {card.citations.map((citation, index) => (
                      <button
                        key={`${card.id}-citation-${index}`}
                        type="button"
                        onClick={() => onSeek(citation.startMs, true)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-2.5 py-2 text-left text-xs text-slate-600 hover:bg-slate-100"
                      >
                        <span className="font-mono text-[11px] text-slate-400">
                          {formatTime(citation.startMs)} - {formatTime(citation.endMs)}
                        </span>
                        {citation.snippet && <p className="mt-1 line-clamp-2">{citation.snippet}</p>}
                      </button>
                    ))}
                  </div>
                )}

                {card.actions && card.actions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {card.actions.map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => handleCardAction(card, action)}
                        className="rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
