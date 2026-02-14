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
const MATRIX_HOME_ID = '__matrix_home__';
const TASK_STATE_KEY_PREFIX = 'app_matrix_task_state:';
const LAST_RESULT_KEY_PREFIX = 'app_matrix_last_result:';
const PLUGIN_ORDER = ['knowledge-cards', 'gap-fill', 'confusion-drill', 'review-plan'];

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

function toLastResultKey(sessionId: string, pluginId: string): string {
  return `${LAST_RESULT_KEY_PREFIX}${sessionId}:${pluginId}`;
}

function normalizePluginList(plugins: AppPluginManifest[]): AppPluginManifest[] {
  const filtered = plugins.filter((plugin) => plugin.id !== 'fallback');
  return filtered.sort((left, right) => {
    const leftIndex = PLUGIN_ORDER.indexOf(left.id);
    const rightIndex = PLUGIN_ORDER.indexOf(right.id);
    const leftRank = leftIndex === -1 ? 999 : leftIndex;
    const rightRank = rightIndex === -1 ? 999 : rightIndex;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.name.localeCompare(right.name, 'zh-Hans-CN');
  });
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

function pluginDefaultIntent(pluginId: string, pluginName?: string): string {
  if (pluginId === 'knowledge-cards') return '复习模式：生成课堂证据知识卡片';
  if (pluginId === 'gap-fill') return '复习模式：剔除课上已讲内容后查漏补缺';
  if (pluginId === 'confusion-drill') return '复习模式：围绕困惑点做补救训练';
  if (pluginId === 'review-plan') return '复习模式：生成今晚可执行复习计划';
  return `复习模式：执行${pluginName || '学习应用'}`;
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
  const [activeTabId, setActiveTabId] = useState<string>(MATRIX_HOME_ID);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  const [isRunning, setIsRunning] = useState(false);
  const [resultByPlugin, setResultByPlugin] = useState<Record<string, AppExecutionResult>>({});
  const [taskState, setTaskState] = useState<Record<string, boolean>>({});

  const visiblePlugins = useMemo(() => normalizePluginList(plugins), [plugins]);
  const isHomeTab = activeTabId === MATRIX_HOME_ID;
  const activePlugin = visiblePlugins.find((plugin) => plugin.id === selectedPluginId);
  const activeResult = selectedPluginId ? resultByPlugin[selectedPluginId] || null : null;

  const tasks = useMemo<TaskCompletionItem[]>(() => {
    if (!activeResult?.tasks) return [];
    return activeResult.tasks.map((task) => ({
      ...task,
      completed: Boolean(taskState[task.id]),
    }));
  }, [activeResult, taskState]);

  const completedCount = tasks.filter((task) => task.completed).length;
  const completionPercent = tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100);
  const totalEstimatedMinutes = tasks.reduce((sum, task) => sum + (task.estimatedMinutes || 0), 0);
  const evidenceCardCount = activeResult?.cards.filter((card) => (card.citations?.length || 0) > 0).length || 0;
  const totalCardCount = activeResult?.cards.length || 0;
  const evidenceCoveragePercent = totalCardCount === 0 ? 0 : Math.round((evidenceCardCount / totalCardCount) * 100);
  const transcriptDurationMs = transcript.length > 0 ? transcript[transcript.length - 1].endMs : 0;
  const unresolvedAnchorCount = anchors.filter((anchor) => !anchor.cancelled && !anchor.resolved).length;
  const executedPluginCount = Object.keys(resultByPlugin).length;

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

  const executePlugin = useCallback(async (
    pluginId: string,
    options?: { switchTab?: boolean; toastOnSuccess?: boolean }
  ) => {
    if (!pluginId) return;
    if (transcript.length === 0) {
      toast.error('当前没有课堂转录，先采集课堂内容再运行应用。');
      return;
    }

    const targetPlugin = visiblePlugins.find((plugin) => plugin.id === pluginId);
    setIsRunning(true);
    if (options?.switchTab !== false) {
      setSelectedPluginId(pluginId);
      setActiveTabId(pluginId);
    }

    try {
      const response = await fetch('/api/apps/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pluginId,
          model: selectedModel,
          goal: {
            intent: pluginDefaultIntent(pluginId, targetPlugin?.name),
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

      const nextResult = payload.result;
      setResultByPlugin((prev) => ({
        ...prev,
        [nextResult.pluginId]: nextResult,
      }));
      setSelectedPluginId(nextResult.pluginId);
      await setPreference(toLastResultKey(sessionId, nextResult.pluginId), nextResult);

      const storedTaskState = await getPreference<Record<string, boolean>>(
        toTaskStateKey(sessionId, nextResult.pluginId),
        {}
      );
      setTaskState(storedTaskState);

      if (options?.toastOnSuccess !== false) {
        toast.success(`${targetPlugin?.name || '应用'}已生成`);
      }
    } catch (error) {
      console.error('Failed to run matrix plugin:', error);
      toast.error(error instanceof Error ? error.message : '应用运行失败');
    } finally {
      setIsRunning(false);
    }
  }, [
    anchors,
    dataSource,
    keyDifficulties,
    selectedModel,
    sessionId,
    summaryOverview,
    transcript,
    visiblePlugins,
  ]);

  useEffect(() => {
    void (async () => {
      const response = await fetch('/api/apps/plugins');
      const payload = (await response.json()) as { plugins?: AppPluginManifest[] };
      const nextPlugins = Array.isArray(payload.plugins) ? payload.plugins : [];
      const nextVisiblePlugins = normalizePluginList(nextPlugins);

      setPlugins(nextPlugins);
      setSelectedPluginId((prev) => {
        if (nextVisiblePlugins.length === 0) return '';
        if (nextVisiblePlugins.some((plugin) => plugin.id === prev)) return prev;
        return nextVisiblePlugins[0].id;
      });
    })().catch((error) => {
      console.error('Failed to load app matrix plugins:', error);
      toast.error('应用矩阵插件加载失败');
    });
  }, []);

  useEffect(() => {
    setResultByPlugin({});
    setTaskState({});
    setActiveTabId(MATRIX_HOME_ID);
  }, [sessionId]);

  useEffect(() => {
    if (!selectedPluginId) return;

    let cancelled = false;
    setTaskState({});

    void (async () => {
      const [cachedResult, storedTaskState] = await Promise.all([
        getPreference<AppExecutionResult | null>(toLastResultKey(sessionId, selectedPluginId), null),
        getPreference<Record<string, boolean>>(toTaskStateKey(sessionId, selectedPluginId), {}),
      ]);

      if (cancelled) return;
      if (cachedResult) {
        setResultByPlugin((prev) => ({
          ...prev,
          [selectedPluginId]: cachedResult,
        }));
        setActiveTabId((prev) => (prev === MATRIX_HOME_ID ? selectedPluginId : prev));
      }
      setTaskState(storedTaskState);
    })().catch((error) => {
      console.error('Failed to restore app matrix state:', error);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedPluginId, sessionId]);

  const toggleTask = useCallback(
    (taskId: string, forceComplete?: boolean) => {
      if (!activeResult || !selectedPluginId) return;
      setTaskState((prev) => {
        const nextCompleted = forceComplete === undefined ? !prev[taskId] : forceComplete;
        const next = { ...prev, [taskId]: nextCompleted };
        void setPreference(toTaskStateKey(sessionId, selectedPluginId), next).catch((error) => {
          console.error('Failed to persist app matrix task state:', error);
        });
        return next;
      });
    },
    [activeResult, selectedPluginId, sessionId]
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
            <h3 className={styles.title}>{isHomeTab ? '应用矩阵工作台' : `${activePlugin?.name || '学习应用'}工作台`}</h3>
            <p className={styles.subtitle}>
              {isHomeTab
                ? '先选应用再执行。知识卡片是其中一个应用，不再作为唯一首页。'
                : '每个应用都绑定课堂证据，支持一键回放、行动回写与学习闭环跟踪。'}
            </p>
            <p className={styles.pluginHint}>
              {isHomeTab
                ? '面向课堂上下文的插件式执行层，按目标选择应用，持续低熵上新。'
                : activePlugin?.description || '基于课堂上下文生成可执行学习任务。'}
            </p>
          </div>
          <div className={styles.controls}>
            <ModelSelector value={selectedModel} onChange={setSelectedModel} compact />
            <button
              type="button"
              onClick={() => void executePlugin(selectedPluginId)}
              disabled={isRunning || !selectedPluginId}
              data-testid="app-matrix-run"
              className={styles.runButton}
            >
              {isRunning
                ? '执行中...'
                : isHomeTab
                  ? `运行${activePlugin?.name || '当前应用'}`
                  : selectedPluginId === 'gap-fill'
                    ? '开始查漏补缺'
                    : '运行应用'}
            </button>
          </div>
        </div>

        <div className={styles.tabRow}>
          <button
            type="button"
            onClick={() => setActiveTabId(MATRIX_HOME_ID)}
            data-testid="app-matrix-tab-home"
            className={`${styles.tabButton} ${isHomeTab ? styles.tabButtonActive : ''}`}
          >
            应用总览
          </button>
          {visiblePlugins.map((plugin) => {
            const hasResult = Boolean(resultByPlugin[plugin.id]);
            const isActive = !isHomeTab && selectedPluginId === plugin.id;
            return (
              <button
                key={plugin.id}
                type="button"
                onClick={() => {
                  setSelectedPluginId(plugin.id);
                  setActiveTabId(plugin.id);
                }}
                data-testid={`app-matrix-tab-${plugin.id}`}
                className={`${styles.tabButton} ${isActive ? styles.tabButtonActive : ''}`}
              >
                {plugin.name}
                {hasResult && <span className={styles.tabBadge} />}
              </button>
            );
          })}
        </div>

        <div className={styles.metaRow}>
          <span className={styles.metaChip}>数据来源：{formatDataSourceLabel(dataSource)}</span>
          <span className={styles.metaChip}>课堂片段：{transcript.length} 条</span>
          <span className={styles.metaChip}>可用应用：{visiblePlugins.length} 个</span>
          <span className={styles.metaChip}>已运行应用：{executedPluginCount} 个</span>
          <span className={styles.metaChip}>未解决困惑：{unresolvedAnchorCount} 个</span>
          {!isHomeTab && activeResult?.model && <span className={styles.metaChip}>生成模型：{activeResult.model}</span>}
          {!isHomeTab && tasks.length > 0 && <span className={styles.metaChip}>预计耗时：{totalEstimatedMinutes} 分钟</span>}
          {!isHomeTab && evidenceCardCount > 0 && <span className={styles.metaChip}>证据卡：{evidenceCardCount} 张</span>}
          {!isHomeTab && totalCardCount > 0 && <span className={styles.metaChip}>证据覆盖：{evidenceCoveragePercent}%</span>}
        </div>
      </section>

      {isHomeTab && (
        <section className={`${styles.surface} ${styles.catalog}`}>
          <p className={styles.catalogTitle}>选择一个应用开始</p>
          <p className={styles.catalogSubtitle}>
            面向“课上听懂但想补漏洞”的场景，推荐优先试用「查漏补缺」；知识卡片用于证据沉淀与任务回写。
          </p>
          <div className={styles.catalogGrid}>
            {visiblePlugins.map((plugin) => {
              const hasResult = Boolean(resultByPlugin[plugin.id]);
              return (
                <article key={plugin.id} className={styles.catalogCard}>
                  <div className={styles.catalogHead}>
                    <h4 className={styles.catalogName}>{plugin.name}</h4>
                    {hasResult && <span className={styles.catalogDone}>已运行</span>}
                  </div>
                  <p className={styles.catalogDesc}>{plugin.description}</p>
                  <p className={styles.catalogMeta}>能力：{plugin.capabilities.join(' · ')}</p>
                  <div className={styles.catalogActions}>
                    <button
                      type="button"
                      className={styles.catalogPrimary}
                      onClick={() => {
                        setSelectedPluginId(plugin.id);
                        setActiveTabId(plugin.id);
                      }}
                    >
                      进入应用
                    </button>
                    <button
                      type="button"
                      className={styles.catalogSecondary}
                      disabled={isRunning || transcript.length === 0}
                      onClick={() => void executePlugin(plugin.id, { switchTab: true })}
                    >
                      一键运行
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {!isHomeTab && !activeResult && (
        <section className={`${styles.surface} ${styles.empty}`}>
          <p className={styles.emptyTitle}>先运行「{activePlugin?.name || '当前应用'}」</p>
          <p className={styles.emptySubtitle}>
            {selectedPluginId === 'gap-fill'
              ? '系统会先剔除课上已讲内容，再生成针对这一节课的查漏补缺任务。'
              : '点击“运行应用”，系统会基于课堂上下文生成可回放的证据卡和行动任务。'}
          </p>
        </section>
      )}

      {!isHomeTab && activeResult && (
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
                <p className={styles.taskEmpty}>当前应用未返回任务，你可以直接从右侧证据卡开始复习。</p>
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
            {activeResult.cards.length === 0 && (
              <article className={`${styles.card} ${styles.cardEmpty}`}>
                <p className={styles.cardEmptyTitle}>当前应用还没有生成卡片</p>
                <p className={styles.cardEmptyBody}>请点击上方“运行应用”，系统会自动生成课堂证据卡片。</p>
              </article>
            )}
            {activeResult.cards.map((card) => (
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
