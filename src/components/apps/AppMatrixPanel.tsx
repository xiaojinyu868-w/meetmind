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
import styles from './AppMatrixPanel.module.css';

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

function formatDataSourceLabel(dataSource: DataSourceType): string {
  if (dataSource === 'video') return '视频导入';
  if (dataSource === 'live') return '实时录音';
  if (dataSource === 'demo') return '演示数据';
  return '未知来源';
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
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) return timestamp;
  if (typeof timestamp === 'string') {
    const trimmed = timestamp.trim();
    const clockMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (clockMatch) {
      const hourPart = clockMatch[3] ? Number(clockMatch[1]) : 0;
      const minutePart = clockMatch[3] ? Number(clockMatch[2]) : Number(clockMatch[1]);
      const secondPart = clockMatch[3] ? Number(clockMatch[3]) : Number(clockMatch[2]);
      if ([hourPart, minutePart, secondPart].every((value) => Number.isFinite(value) && value >= 0)) {
        return ((hourPart * 60 + minutePart) * 60 + secondPart) * 1000;
      }
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
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
  const totalEstimatedMinutes = tasks.reduce((sum, task) => sum + (task.estimatedMinutes || 0), 0);
  const activePlugin = visiblePlugins.find((plugin) => plugin.id === selectedPluginId);
  const activePluginDescription = activePlugin?.description || '基于课堂上下文生成证据链卡片与行动任务。';
  const evidenceCardCount = result?.cards.filter((card) => (card.citations?.length || 0) > 0).length || 0;
  const totalCardCount = result?.cards.length || 0;
  const evidenceCoveragePercent = totalCardCount === 0 ? 0 : Math.round((evidenceCardCount / totalCardCount) * 100);
  const transcriptDurationMs = transcript.length > 0 ? transcript[transcript.length - 1].endMs : 0;

  const normalizeSeekTarget = useCallback((rawValue: unknown): number | null => {
    const raw =
      typeof rawValue === 'number'
        ? rawValue
        : typeof rawValue === 'string'
          ? normalizeCardActionPayload({ timestamp: rawValue })
          : null;
    if (raw === null || !Number.isFinite(raw)) return null;

    let next = raw;
    if (next > 0 && next < 1000 && transcriptDurationMs >= 30000) {
      next *= 1000;
    }
    next = Math.max(0, Math.floor(next));
    if (transcriptDurationMs > 0) {
      next = Math.min(next, transcriptDurationMs);
    }
    return next;
  }, [transcriptDurationMs]);

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
        const timestamp = normalizeSeekTarget(normalizeCardActionPayload(action.payload));
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
    [normalizeSeekTarget, onSeek, toggleTask]
  );

  return (
    <div className={styles.root} data-testid="app-matrix-panel">
      <section className={`${styles.surface} ${styles.hero}`}>
        <div className={styles.heroTop}>
          <div>
            <p className={styles.eyebrow}>Classroom-native App Matrix</p>
            <h3 className={styles.title}>知识卡片工作台</h3>
            <p className={styles.subtitle}>每张卡都绑定课堂证据，支持一键回放、行动回写与学习闭环跟踪。</p>
            <p className={styles.pluginHint}>{activePluginDescription}</p>
          </div>
          <div className={styles.controls}>
            <ModelSelector value={selectedModel} onChange={setSelectedModel} compact />
            <button
              type="button"
              onClick={runPlugin}
              disabled={isRunning}
              data-testid="app-matrix-run"
              className={styles.runButton}
            >
              {isRunning ? '生成中...' : '生成卡片'}
            </button>
          </div>
        </div>

        <div className={styles.metaRow}>
          <span className={styles.metaChip}>数据来源：{formatDataSourceLabel(dataSource)}</span>
          <span className={styles.metaChip}>课堂片段：{transcript.length} 条</span>
          <span className={styles.metaChip}>当前插件：{activePlugin?.name || selectedPluginId}</span>
          {result?.model && <span className={styles.metaChip}>生成模型：{result.model}</span>}
          {tasks.length > 0 && <span className={styles.metaChip}>预计耗时：{totalEstimatedMinutes} 分钟</span>}
          {evidenceCardCount > 0 && <span className={styles.metaChip}>证据卡：{evidenceCardCount} 张</span>}
          {totalCardCount > 0 && <span className={styles.metaChip}>证据覆盖：{evidenceCoveragePercent}%</span>}
        </div>

        {visiblePlugins.length > 1 && (
          <select
            value={selectedPluginId}
            onChange={(event) => setSelectedPluginId(event.target.value)}
            className={styles.pluginSelect}
          >
            {visiblePlugins.map((plugin) => (
              <option key={plugin.id} value={plugin.id}>
                {plugin.name}
              </option>
            ))}
          </select>
        )}
      </section>

      {!result && (
        <section className={`${styles.surface} ${styles.empty}`}>
          <p className={styles.emptyTitle}>先生成一组课堂证据卡片</p>
          <p className={styles.emptySubtitle}>系统会自动绑定时间戳与行动任务，让学生在最短路径内完成复习闭环。</p>
        </section>
      )}

      {result && (
        <section className={`${styles.surface} ${styles.board}`}>
          <aside className={styles.taskBoard}>
            <div className={styles.taskHeader}>
              <h4 className={styles.taskTitle}>行动清单</h4>
              <p className={styles.taskHint}>
                {completedCount}/{tasks.length} 完成 · {completionPercent}%
              </p>
            </div>
            <div className={styles.progressRail}>
              <div className={styles.progressFill} style={{ width: `${completionPercent}%` }} />
            </div>
            <div className={styles.taskList}>
              {tasks.length === 0 && (
                <p className={styles.taskEmpty}>本次没有拆分行动任务，你可以直接从右侧证据卡片开始复习。</p>
              )}
              {tasks.map((task) => (
                <div
                  key={task.id}
                  data-testid={`app-task-${task.id}`}
                  data-completed={task.completed ? 'true' : 'false'}
                  className={`${styles.taskItem} ${task.completed ? styles.taskItemDone : ''}`}
                >
                  <button
                    type="button"
                    data-testid={`app-task-toggle-${task.id}`}
                    onClick={() => toggleTask(task.id)}
                    className={`${styles.checkButton} ${task.completed ? styles.checkButtonDone : ''}`}
                    aria-label={task.completed ? '标记未完成' : '标记完成'}
                  >
                    {task.completed && (
                      <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8.2 8.2a1 1 0 01-1.414 0L3.293 10.1a1 1 0 111.414-1.414l3.093 3.093 7.493-7.492a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>
                  <div className={styles.taskContent}>
                    <p className={`${styles.taskLabel} ${task.completed ? styles.taskLabelDone : ''}`}>{task.label}</p>
                    {task.reason && <p className={styles.taskReason}>{task.reason}</p>}
                    <div className={styles.taskMeta}>
                      {typeof task.relatedTimestamp === 'number' && <span>@ {formatTime(task.relatedTimestamp)}</span>}
                      {typeof task.estimatedMinutes === 'number' && <span>{task.estimatedMinutes} 分钟</span>}
                    </div>
                  </div>
                  {typeof task.relatedTimestamp === 'number' && (
                    <button
                      type="button"
                      onClick={() => {
                        const target = normalizeSeekTarget(task.relatedTimestamp);
                        if (target !== null) onSeek(target, true);
                      }}
                      className={styles.seekMini}
                    >
                      回放
                    </button>
                  )}
                </div>
              ))}
            </div>
          </aside>

          <div className={styles.cardGrid}>
            {result.cards.length === 0 && (
              <article className={`${styles.card} ${styles.cardEmpty}`}>
                <p className={styles.cardEmptyTitle}>还没有生成卡片内容</p>
                <p className={styles.cardEmptyBody}>请先点击“生成卡片”，系统会自动从课堂上下文抽取证据并整理为复习卡。</p>
              </article>
            )}
            {result.cards.map((card) => (
              <article key={card.id} data-testid={`app-card-${card.id}`} className={styles.card}>
                <div className={styles.cardHead}>
                  <h4 className={styles.cardTitle}>{card.title}</h4>
                  {card.priority && <span className={styles.priority}>{card.priority}</span>}
                </div>
                <p className={styles.cardBody}>{card.body}</p>

                {card.citations && card.citations.length > 0 && (
                  <div className={styles.citationList}>
                    {card.citations.map((citation, index) => (
                      <button
                        key={`${card.id}-citation-${index}`}
                        type="button"
                        onClick={() => {
                          const target = normalizeSeekTarget(citation.startMs);
                          if (target !== null) onSeek(target, true);
                        }}
                        className={styles.citationBtn}
                      >
                        <span className={styles.citationTime}>
                          {formatTime(citation.startMs)} - {formatTime(citation.endMs)}
                        </span>
                        {citation.snippet && <p className={styles.citationText}>{citation.snippet}</p>}
                      </button>
                    ))}
                  </div>
                )}

                {card.actions && card.actions.length > 0 && (
                  <div className={styles.actionRow}>
                    {card.actions.map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => handleCardAction(card, action)}
                        className={styles.actionBtn}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
