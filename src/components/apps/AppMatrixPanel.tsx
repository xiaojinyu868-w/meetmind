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

const LAST_RESULT_KEY_PREFIX = 'app_matrix_last_result:';
const TASK_STATE_KEY_PREFIX = 'app_matrix_task_state:';

const PLUGIN_ORDER = [
  'studio-workshop',
  'flashcards-lab',
  'quiz-arena',
  'mindmap-outline',
  'knowledge-cards',
  'confusion-drill',
  'review-plan',
];

interface AppMatrixPanelProps {
  sessionId: string;
  dataSource: DataSourceType;
  transcript: TranscriptSegment[];
  anchors: Anchor[];
  summaryOverview?: string;
  keyDifficulties?: string[];
  onSeek: (timeMs: number, autoPlay?: boolean) => void;
}

interface StudioAppDefinition {
  key: string;
  name: string;
  icon: string;
  pluginId: string;
  intent: string;
  description: string;
  outputType: string;
}

const STUDIO_APP_PRESETS: StudioAppDefinition[] = [
  {
    key: 'audio-overview',
    name: '课堂播客',
    icon: '声',
    pluginId: 'studio-workshop',
    intent: '生成双人课堂播客，输出可播放音频。',
    description: '适合课后复盘和通勤收听，重点是用对话节奏快速重建课堂脉络。',
    outputType: '真实播客音频',
  },
  {
    key: 'video-overview',
    name: '视频总览',
    icon: '影',
    pluginId: 'studio-workshop',
    intent: '生成视频总览，按时间轴输出章节、核心观点和回看提示。',
    description: '适合视频导入场景，突出分段理解和回放定位。',
    outputType: '章节摘要 + 时间锚点',
  },
  {
    key: 'mindmap',
    name: '思维导图',
    icon: '图',
    pluginId: 'mindmap-outline',
    intent: '生成课堂思维导图，输出主干、分支和支撑证据。',
    description: '适合梳理结构化知识，便于演讲、讲题和二次输出。',
    outputType: '主干结构 + 分支要点',
  },
  {
    key: 'report',
    name: '学习报告',
    icon: '报',
    pluginId: 'studio-workshop',
    intent: '生成学习报告，覆盖亮点、风险点和下一步行动。',
    description: '适合课后复盘与跟进计划，强调可执行建议。',
    outputType: '文档流 + 建议清单',
  },
  {
    key: 'flashcards',
    name: '闪卡训练',
    icon: '卡',
    pluginId: 'flashcards-lab',
    intent: '生成课堂闪卡，覆盖定义、方法、易错点和迁移应用。',
    description: '以主动回忆为核心，支持翻面查看答案和证据回放。',
    outputType: '问答训练',
  },
  {
    key: 'quiz',
    name: '测验工坊',
    icon: '测',
    pluginId: 'quiz-arena',
    intent: '生成课堂测验，输出选择题、答案和解析。',
    description: '先测后讲，快速识别理解偏差并回放证据。',
    outputType: '题组 + 解析',
  },
  {
    key: 'infographic',
    name: '信息图稿',
    icon: '信',
    pluginId: 'studio-workshop',
    intent: '生成信息图文案，提炼高密度、可视化表达的关键内容。',
    description: '适合海报、社媒图文和课堂总结图。',
    outputType: '图文结构化稿件',
  },
  {
    key: 'slide-deck',
    name: '幻灯片提纲',
    icon: '片',
    pluginId: 'studio-workshop',
    intent: '生成幻灯片提纲，按页输出标题与要点。',
    description: '适合复述、分享与讲解，按页浏览并附带讲解备注。',
    outputType: '可翻页幻灯片',
  },
  {
    key: 'data-table',
    name: '数据对照表',
    icon: '表',
    pluginId: 'studio-workshop',
    intent: '生成数据对照表，按维度输出可比较条目。',
    description: '适合知识点对比、方案比较和考试前速览。',
    outputType: '可对比数据表',
  },
];

interface FlashcardMeta {
  cardKind: 'flashcard';
  front: string;
  back: string;
  hint?: string;
}

interface QuizMeta {
  cardKind: 'quiz';
  stem: string;
  options: string[];
  answer: string;
  explanation?: string;
}

interface ParsedCard {
  card: AppCard;
  flashcardMeta: FlashcardMeta | null;
  quizMeta: QuizMeta | null;
  tableMeta: { columns: string[]; rows: string[][] } | null;
  dialogueItems: Array<{ speaker: string; line: string }>;
  bulletItems: string[];
  cardKind: string;
}

interface AudioRenderSpec {
  audioUrl: string;
  roundCount: number;
  audioBytes: number;
  usage: {
    inputTextTokens: number;
    outputAudioTokens: number;
  };
  error: string;
  lines: Array<{ speaker: string; line: string }>;
  sections: Array<{ id: string; title: string; body: string }>;
}

interface SlidesRenderSpec {
  pages: Array<{
    id: string;
    title: string;
    subtitle: string;
    bullets: string[];
    notes: string;
    relatedTimestamp: number | null;
  }>;
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
  if (dataSource === 'demo') return '多源资料';
  return '未知来源';
}

function toLastResultKey(sessionId: string, appKey: string): string {
  return `${LAST_RESULT_KEY_PREFIX}${sessionId}:${appKey}`;
}

function toTaskStateKey(sessionId: string, pluginId: string): string {
  return `${TASK_STATE_KEY_PREFIX}${sessionId}:${pluginId}`;
}

function normalizePluginList(plugins: AppPluginManifest[]): AppPluginManifest[] {
  const filtered = plugins.filter((plugin) => plugin.id !== 'fallback');
  return filtered.sort((a, b) => {
    const aIndex = PLUGIN_ORDER.indexOf(a.id);
    const bIndex = PLUGIN_ORDER.indexOf(b.id);
    const aScore = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
    const bScore = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
    return aScore - bScore || a.name.localeCompare(b.name, 'zh-Hans-CN');
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

function readFlashcardMeta(meta: Record<string, unknown> | undefined): FlashcardMeta | null {
  if (!meta || meta.cardKind !== 'flashcard') return null;
  if (typeof meta.front !== 'string' || typeof meta.back !== 'string') return null;
  return {
    cardKind: 'flashcard',
    front: meta.front,
    back: meta.back,
    hint: typeof meta.hint === 'string' ? meta.hint : undefined,
  };
}

function readQuizMeta(meta: Record<string, unknown> | undefined): QuizMeta | null {
  if (!meta || meta.cardKind !== 'quiz') return null;
  if (typeof meta.stem !== 'string') return null;
  if (!Array.isArray(meta.options)) return null;
  const options = meta.options
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 4);
  if (options.length < 2) return null;
  return {
    cardKind: 'quiz',
    stem: meta.stem,
    options,
    answer: typeof meta.answer === 'string' ? meta.answer.trim() : '',
    explanation: typeof meta.explanation === 'string' ? meta.explanation : undefined,
  };
}

function readStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, limit);
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readDialogue(meta: Record<string, unknown> | undefined): Array<{ speaker: string; line: string }> {
  if (!meta || !Array.isArray(meta.dialogue)) return [];
  return meta.dialogue
    .map((item) => (item && typeof item === 'object' ? item as Record<string, unknown> : null))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({
      speaker: typeof item.speaker === 'string' ? item.speaker.trim() : '',
      line: typeof item.line === 'string' ? item.line.trim() : '',
    }))
    .filter((item) => item.speaker && item.line)
    .slice(0, 16);
}

function readTable(meta: Record<string, unknown> | undefined): { columns: string[]; rows: string[][] } | null {
  if (!meta) return null;
  const columns = readStringList(meta.columns, 8);
  if (!Array.isArray(meta.rows)) return null;
  const rows = meta.rows
    .map((row) => (Array.isArray(row) ? row : []))
    .map((row) => row.map((cell) => (typeof cell === 'string' ? cell.trim() : '')).slice(0, columns.length || 8))
    .filter((row) => row.length > 0)
    .slice(0, 24);
  if (columns.length === 0 || rows.length === 0) return null;
  return { columns, rows };
}

function readBodyPoints(body: string, limit: number): string[] {
  if (!body) return [];
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[\d.\-•·、\s]+/, ''))
    .filter(Boolean)
    .slice(0, limit);
}

function readDialogueFromBody(body: string): Array<{ speaker: string; line: string }> {
  if (!body) return [];
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([^:：]{1,12})[:：]\s*(.+)$/);
      if (!match) return null;
      return { speaker: match[1].trim(), line: match[2].trim() };
    })
    .filter((item): item is { speaker: string; line: string } => Boolean(item))
    .slice(0, 24);
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
  const [selectedAppKey, setSelectedAppKey] = useState('flashcards');
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<AppExecutionResult | null>(null);
  const [taskState, setTaskState] = useState<Record<string, boolean>>({});
  const [revealedCards, setRevealedCards] = useState<Record<string, boolean>>({});
  const [slideCursor, setSlideCursor] = useState(0);

  const visiblePlugins = useMemo(() => normalizePluginList(plugins), [plugins]);

  const studioApps = useMemo(() => {
    const pluginMap = new Map(visiblePlugins.map((plugin) => [plugin.id, plugin] as const));
    const presets = STUDIO_APP_PRESETS.filter((preset) => pluginMap.has(preset.pluginId));
    if (presets.length > 0) return presets;

    return visiblePlugins.map((plugin) => ({
      key: plugin.id,
      name: plugin.name,
      icon: '用',
      pluginId: plugin.id,
      intent: `生成${plugin.name}`,
      description: plugin.description,
      outputType: '结构化内容',
    }));
  }, [visiblePlugins]);

  const activeStudioApp = studioApps.find((app) => app.key === selectedAppKey) || studioApps[0] || null;
  const activePlugin = visiblePlugins.find((plugin) => plugin.id === activeStudioApp?.pluginId);

  const activePluginDescription =
    activeStudioApp?.description ||
    activePlugin?.description ||
    '基于课堂上下文自动生成并渲染学习结果。';

  const activePluginName = activeStudioApp?.name || activePlugin?.name || '学习应用';
  const runButtonLabel = `生成${activePluginName}`;

  const evidenceCardCount = result?.cards.filter((card) => (card.citations?.length || 0) > 0).length || 0;
  const totalCardCount = result?.cards.length || 0;
  const evidenceCoveragePercent = totalCardCount === 0 ? 0 : Math.round((evidenceCardCount / totalCardCount) * 100);
  const transcriptDurationMs = transcript.length > 0 ? transcript[transcript.length - 1].endMs : 0;

  const parsedCards = useMemo<ParsedCard[]>(() => {
    if (!result) return [];
    return result.cards.map((card) => ({
      card,
      flashcardMeta: readFlashcardMeta(card.meta),
      quizMeta: readQuizMeta(card.meta),
      tableMeta: readTable(card.meta),
      dialogueItems: readDialogue(card.meta),
      bulletItems: readStringList(card.meta?.bullets, 12),
      cardKind: typeof card.meta?.cardKind === 'string' ? card.meta.cardKind : '',
    }));
  }, [result]);

  const tableAggregation = useMemo(() => {
    const tableItems = parsedCards.filter((item) => item.tableMeta !== null);
    if (tableItems.length === 0) return null;

    const baseColumns = tableItems[0].tableMeta?.columns || [];
    if (baseColumns.length === 0) return null;

    const appendSource = tableItems.length > 1;
    const columns = appendSource ? ['来源', ...baseColumns] : baseColumns;

    const rows = tableItems.flatMap((item) => {
      const data = item.tableMeta;
      if (!data) return [];
      return data.rows.map((rawRow) => {
        const normalized = baseColumns.map((_, index) => rawRow[index] || '-');
        return appendSource ? [item.card.title, ...normalized] : normalized;
      });
    });

    return {
      columns,
      rows,
      ids: tableItems.map((item) => item.card.id),
    };
  }, [parsedCards]);

  const dialogueAggregation = useMemo(() => {
    const fromMeta = parsedCards.flatMap((item) =>
      item.dialogueItems.map((dialogue) => ({ ...dialogue, sourceId: item.card.id }))
    );

    const fallback = fromMeta.length > 0
      ? fromMeta
      : parsedCards.flatMap((item) =>
          readDialogueFromBody(item.card.body).map((dialogue) => ({ ...dialogue, sourceId: item.card.id }))
        );

    if (fallback.length === 0) return null;

    const shouldUseDialogueView =
      activeStudioApp?.key === 'audio-overview' ||
      activeStudioApp?.key === 'video-overview' ||
      fallback.length >= 4;

    if (!shouldUseDialogueView) return null;

    return {
      lines: fallback.slice(0, 40),
      ids: Array.from(new Set(fallback.map((item) => item.sourceId))),
    };
  }, [activeStudioApp?.key, parsedCards]);

  const consumedIds = useMemo(() => {
    const set = new Set<string>();
    if (tableAggregation) {
      tableAggregation.ids.forEach((id) => set.add(id));
    }
    if (dialogueAggregation) {
      dialogueAggregation.ids.forEach((id) => set.add(id));
    }
    return set;
  }, [dialogueAggregation, tableAggregation]);

  const canvasCards = useMemo(
    () => parsedCards.filter((item) => !consumedIds.has(item.card.id)),
    [consumedIds, parsedCards]
  );

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

  useEffect(() => {
    if (studioApps.length === 0) return;
    if (!studioApps.some((app) => app.key === selectedAppKey)) {
      setSelectedAppKey(studioApps[0].key);
    }
  }, [selectedAppKey, studioApps]);

  useEffect(() => {
    setSlideCursor(0);
  }, [selectedAppKey, result?.render?.mode]);

  const fetchPlugins = useCallback(async () => {
    const response = await fetch('/api/apps/plugins');
    const payload = (await response.json()) as { plugins?: AppPluginManifest[] };
    const nextPlugins = Array.isArray(payload.plugins) ? payload.plugins : [];

    setPlugins(nextPlugins);

    const candidateApp = STUDIO_APP_PRESETS.find((preset) =>
      nextPlugins.some((plugin) => plugin.id === preset.pluginId)
    );

    if (candidateApp) {
      setSelectedAppKey(candidateApp.key);
      return;
    }

    const candidatePlugin = normalizePluginList(nextPlugins)[0];
    if (candidatePlugin) {
      setSelectedAppKey(candidatePlugin.id);
    }
  }, []);

  useEffect(() => {
    void fetchPlugins().catch((error) => {
      console.error('Failed to load app matrix plugins:', error);
      toast.error('应用加载失败，请稍后重试');
    });
  }, [fetchPlugins]);

  useEffect(() => {
    setResult(null);
    setTaskState({});
    setRevealedCards({});
    setSlideCursor(0);
  }, [sessionId]);

  useEffect(() => {
    if (!activeStudioApp) {
      setResult(null);
      setTaskState({});
      setRevealedCards({});
      setSlideCursor(0);
      return;
    }

    let cancelled = false;
    const appKey = activeStudioApp.key;

    setResult(null);
    setTaskState({});
    setRevealedCards({});
    setSlideCursor(0);

    void (async () => {
      const cached = await getPreference<AppExecutionResult | null>(toLastResultKey(sessionId, appKey), null);
      if (cancelled || !cached) return;

      setResult(cached);
      await restoreTaskState(cached.pluginId);
    })().catch((error) => {
      if (!cancelled) {
        console.error('Failed to restore app matrix result:', error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeStudioApp, restoreTaskState, sessionId]);

  const runPlugin = useCallback(async () => {
    if (transcript.length === 0) {
      toast.error('当前没有课堂文本，请先采集或导入内容');
      return;
    }

    if (!activeStudioApp) {
      toast.error('当前没有可用应用，请检查插件状态');
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
          pluginId: activeStudioApp.pluginId,
          model: selectedModel,
          goal: {
            intent: activeStudioApp.intent,
            expectedOutput: 'cards',
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
            custom: {
              studioAppKey: activeStudioApp.key,
              studioAppName: activeStudioApp.name,
            },
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

      const nextResult: AppExecutionResult = {
        ...payload.result,
        raw: {
          ...(payload.result.raw || {}),
          studioAppKey: activeStudioApp.key,
          studioAppName: activeStudioApp.name,
        },
      };

      setResult(nextResult);
      setTaskState({});
      setRevealedCards({});
      setSlideCursor(0);
      setSelectedAppKey(activeStudioApp.key);
      await setPreference(toLastResultKey(sessionId, activeStudioApp.key), nextResult);
      await restoreTaskState(nextResult.pluginId);
      toast.success(`${activePluginName}已生成`);
    } catch (error) {
      console.error('Failed to run matrix plugin:', error);
      toast.error(error instanceof Error ? error.message : '应用生成失败');
    } finally {
      setIsRunning(false);
    }
  }, [
    activePluginName,
    activeStudioApp,
    anchors,
    dataSource,
    keyDifficulties,
    selectedModel,
    sessionId,
    summaryOverview,
    transcript,
    restoreTaskState,
  ]);

  const toggleReveal = useCallback((cardId: string) => {
    setRevealedCards((prev) => ({ ...prev, [cardId]: !prev[cardId] }));
  }, []);

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
        }
        toast.success(`已记录：${card.title}`);
      }
    },
    [normalizeSeekTarget, onSeek, toggleTask]
  );

  const pluginDisplayName = activePlugin?.name || activeStudioApp?.pluginId || result?.pluginId || '未知插件';

  const specRenderMode = result?.render?.mode || null;

  const specTable = useMemo(() => {
    if (specRenderMode !== 'table' || !result?.render) return null;
    const payload = readObject(result.render.payload);
    if (!payload) return null;
    const columns = readStringList(payload.columns, 12);
    if (columns.length === 0) return null;
    if (!Array.isArray(payload.rows)) return null;
    const rows = payload.rows
      .map((row) => (Array.isArray(row) ? row : []))
      .map((row) => columns.map((_, index) => (typeof row[index] === 'string' ? row[index].trim() : '-')))
      .slice(0, 80);
    return rows.length > 0 ? { columns, rows } : null;
  }, [result, specRenderMode]);

  const specAudio = useMemo<AudioRenderSpec | null>(() => {
    if (specRenderMode !== 'audio' || !result?.render) return null;
    const payload = readObject(result.render.payload);
    if (!payload) return null;

    const audioUrl = typeof payload.audioUrl === 'string' ? payload.audioUrl.trim() : '';
    const roundCount = readNumber(payload.roundCount) ?? 0;
    const audioBytes = readNumber(payload.audioBytes) ?? 0;
    const error = typeof payload.error === 'string' ? payload.error.trim() : '';

    const usageObject = readObject(payload.usage);
    const usage = {
      inputTextTokens: readNumber(usageObject?.inputTextTokens) ?? 0,
      outputAudioTokens: readNumber(usageObject?.outputAudioTokens) ?? 0,
    };

    const lines = Array.isArray(payload.lines)
      ? payload.lines
          .map((item) => readObject(item))
          .filter((item): item is Record<string, unknown> => Boolean(item))
          .map((item) => ({
            speaker: typeof item.speaker === 'string' ? item.speaker.trim() : '',
            line: typeof item.line === 'string' ? item.line.trim() : '',
          }))
          .filter((item) => item.speaker && item.line)
          .slice(0, 60)
      : [];

    const sections = Array.isArray(payload.sections)
      ? payload.sections
          .map((item) => readObject(item))
          .filter((item): item is Record<string, unknown> => Boolean(item))
          .map((item, index) => ({
            id: typeof item.id === 'string' ? item.id : `audio-section-${index + 1}`,
            title: typeof item.title === 'string' ? item.title : `章节 ${index + 1}`,
            body: typeof item.body === 'string' ? item.body : '',
          }))
          .slice(0, 20)
      : [];

    if (!audioUrl && !error && lines.length === 0 && sections.length === 0) {
      return null;
    }

    return {
      audioUrl,
      roundCount,
      audioBytes,
      usage,
      error,
      lines,
      sections,
    };
  }, [result, specRenderMode]);

  const specSlides = useMemo<SlidesRenderSpec | null>(() => {
    if (specRenderMode !== 'slides' || !result?.render) return null;
    const payload = readObject(result.render.payload);
    if (!payload || !Array.isArray(payload.pages)) return null;

    const pages = payload.pages
      .map((item) => readObject(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item, index) => ({
        id: typeof item.id === 'string' ? item.id : `slide-${index + 1}`,
        title: typeof item.title === 'string' ? item.title.trim() : `第 ${index + 1} 页`,
        subtitle: typeof item.subtitle === 'string' ? item.subtitle.trim() : '',
        bullets: readStringList(item.bullets, 8),
        notes: typeof item.notes === 'string' ? item.notes.trim() : '',
        relatedTimestamp: readNumber(item.relatedTimestamp),
      }))
      .filter((page) => page.title || page.subtitle || page.bullets.length > 0 || page.notes)
      .slice(0, 20);

    return pages.length > 0 ? { pages } : null;
  }, [result, specRenderMode]);

  useEffect(() => {
    if (!specSlides) return;
    setSlideCursor((prev) => Math.min(prev, Math.max(0, specSlides.pages.length - 1)));
  }, [specSlides]);

  const specScript = useMemo(() => {
    if (specRenderMode !== 'script' || !result?.render) return null;
    const payload = readObject(result.render.payload);
    if (!payload) return null;
    const lines = Array.isArray(payload.lines)
      ? payload.lines
          .map((item) => readObject(item))
          .filter((item): item is Record<string, unknown> => Boolean(item))
          .map((item) => ({
            speaker: typeof item.speaker === 'string' ? item.speaker.trim() : '',
            line: typeof item.line === 'string' ? item.line.trim() : '',
          }))
          .filter((item) => item.speaker && item.line)
          .slice(0, 40)
      : [];
    const sections = Array.isArray(payload.sections)
      ? payload.sections
          .map((item) => readObject(item))
          .filter((item): item is Record<string, unknown> => Boolean(item))
          .map((item, index) => ({
            id: typeof item.id === 'string' ? item.id : `script-section-${index + 1}`,
            title: typeof item.title === 'string' ? item.title : `章节 ${index + 1}`,
            body: typeof item.body === 'string' ? item.body : '',
          }))
          .slice(0, 12)
      : [];
    return lines.length > 0 || sections.length > 0 ? { lines, sections } : null;
  }, [result, specRenderMode]);

  const specMindmap = useMemo(() => {
    if (specRenderMode !== 'mindmap' || !result?.render) return null;
    const payload = readObject(result.render.payload);
    if (!payload) return null;
    const root = typeof payload.root === 'string'
      ? payload.root.trim()
      : typeof result.render.title === 'string'
        ? result.render.title
        : '课堂知识结构';
    const branches = Array.isArray(payload.branches)
      ? payload.branches
          .map((item) => readObject(item))
          .filter((item): item is Record<string, unknown> => Boolean(item))
          .map((item, index) => ({
            id: typeof item.id === 'string' ? item.id : `branch-${index + 1}`,
            title: typeof item.title === 'string' ? item.title : `分支 ${index + 1}`,
            points: readStringList(item.points, 8),
            startMs: typeof item.startMs === 'number' ? item.startMs : undefined,
          }))
          .slice(0, 20)
      : [];
    return { root, branches };
  }, [result, specRenderMode]);

  const specFlashcards = useMemo(() => {
    if (specRenderMode !== 'flashcards' || !result?.render) return null;
    const payload = readObject(result.render.payload);
    if (!payload || !Array.isArray(payload.cards)) return null;
    const cards = payload.cards
      .map((item) => readObject(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item, index) => ({
        id: typeof item.id === 'string' ? item.id : `flashcard-${index + 1}`,
        title: typeof item.title === 'string' ? item.title : `闪卡 ${index + 1}`,
        front: typeof item.front === 'string' ? item.front : '',
        back: typeof item.back === 'string' ? item.back : '',
        hint: typeof item.hint === 'string' ? item.hint : '',
      }))
      .filter((item) => item.front && item.back)
      .slice(0, 30);
    return cards.length > 0 ? cards : null;
  }, [result, specRenderMode]);

  const specQuiz = useMemo(() => {
    if (specRenderMode !== 'quiz' || !result?.render) return null;
    const payload = readObject(result.render.payload);
    if (!payload || !Array.isArray(payload.questions)) return null;
    const questions = payload.questions
      .map((item) => readObject(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item, index) => ({
        id: typeof item.id === 'string' ? item.id : `quiz-${index + 1}`,
        title: typeof item.title === 'string' ? item.title : `测验 ${index + 1}`,
        stem: typeof item.stem === 'string' ? item.stem : '',
        options: readStringList(item.options, 4),
        answer: typeof item.answer === 'string' ? item.answer : 'A',
        explanation: typeof item.explanation === 'string' ? item.explanation : '',
      }))
      .filter((item) => item.stem && item.options.length >= 2)
      .slice(0, 30);
    return questions.length > 0 ? questions : null;
  }, [result, specRenderMode]);

  const specDocument = useMemo(() => {
    if ((specRenderMode !== 'document' && specRenderMode !== 'blocks') || !result?.render) return null;
    const payload = readObject(result.render.payload);
    if (!payload || !Array.isArray(payload.sections)) return null;
    const sections = payload.sections
      .map((item) => readObject(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item, index) => ({
        id: typeof item.id === 'string' ? item.id : `section-${index + 1}`,
        title: typeof item.title === 'string' ? item.title : `段落 ${index + 1}`,
        body: typeof item.body === 'string' ? item.body : '',
        bullets: readStringList(item.bullets, 10),
      }))
      .slice(0, 24);
    return sections.length > 0 ? sections : null;
  }, [result, specRenderMode]);

  const specCustomBlocks = useMemo(() => {
    if (specRenderMode !== 'custom' || !result?.render) return null;
    const payload = readObject(result.render.payload);
    if (!payload || !Array.isArray(payload.blocks)) return null;

    const blocks = payload.blocks
      .map((item) => readObject(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item, index) => ({
        id: typeof item.id === 'string' ? item.id : `custom-block-${index + 1}`,
        type: typeof item.type === 'string' ? item.type.toLowerCase() : 'text',
        title: typeof item.title === 'string' ? item.title : '',
        text: typeof item.text === 'string' ? item.text : '',
        src: typeof item.src === 'string' ? item.src : '',
        alt: typeof item.alt === 'string' ? item.alt : '',
        items: readStringList(item.items, 20),
        columns: readStringList(item.columns, 12),
        rows: Array.isArray(item.rows)
          ? item.rows
              .map((row) => (Array.isArray(row) ? row : []))
              .map((row) => row.map((cell) => (typeof cell === 'string' ? cell : '')))
              .slice(0, 80)
          : [],
      }))
      .slice(0, 40);

    return blocks.length > 0 ? blocks : null;
  }, [result, specRenderMode]);

  const renderSpecCanvas = () => {
    if (!result?.render) return null;

    if (specRenderMode === 'table' && specTable) {
      return (
        <article className={styles.canvasBlock}>
          <h5 className={styles.blockTitle}>{result.render.title || '数据总表'}</h5>
          <div className={styles.tableWrap}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  {specTable.columns.map((column, columnIndex) => (
                    <th key={`spec-table-column-${columnIndex}`}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {specTable.rows.map((row, rowIndex) => (
                  <tr key={`spec-table-row-${rowIndex}`}>
                    {specTable.columns.map((_, columnIndex) => (
                      <td key={`spec-table-cell-${rowIndex}-${columnIndex}`}>{row[columnIndex] || '-'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      );
    }

    if (specRenderMode === 'audio' && specAudio) {
      return (
        <article className={styles.canvasBlock}>
          <h5 className={styles.blockTitle}>{result.render.title || '课堂播客'}</h5>
          {specAudio.audioUrl ? (
            <div className={styles.audioPanel}>
              <audio controls preload="none" src={specAudio.audioUrl} className={styles.audioPlayer} />
              <div className={styles.audioActionRow}>
                <a
                  href={specAudio.audioUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.linkButton}
                >
                  新窗口打开音频
                </a>
                <a href={specAudio.audioUrl} download className={styles.linkButton}>
                  下载音频文件
                </a>
              </div>
            </div>
          ) : (
            <div className={styles.audioFallback}>
              <p className={styles.cardBody}>{specAudio.error || '播客音频尚未返回，请稍后重试。'}</p>
            </div>
          )}
        </article>
      );
    }

    if (specRenderMode === 'slides' && specSlides) {
      const total = specSlides.pages.length;
      const currentIndex = Math.min(slideCursor, Math.max(0, total - 1));
      const currentPage = specSlides.pages[currentIndex];

      return (
        <>
          <article className={styles.canvasBlock}>
            <div className={styles.slideToolbar}>
              <h5 className={styles.blockTitle}>{result.render.title || '幻灯片画布'}</h5>
              <div className={styles.slideControls}>
                <button
                  type="button"
                  className={styles.slideControlButton}
                  onClick={() => setSlideCursor((prev) => Math.max(0, prev - 1))}
                  disabled={currentIndex <= 0}
                >
                  上一页
                </button>
                <span className={styles.slideCounter}>
                  {currentIndex + 1} / {total}
                </span>
                <button
                  type="button"
                  className={styles.slideControlButton}
                  onClick={() => setSlideCursor((prev) => Math.min(total - 1, prev + 1))}
                  disabled={currentIndex >= total - 1}
                >
                  下一页
                </button>
              </div>
            </div>

            <div className={styles.slideStage}>
              <p className={styles.slidePageLabel}>第 {currentIndex + 1} 页</p>
              <h5 className={styles.slideTitle}>{currentPage.title}</h5>
              {currentPage.subtitle && <p className={styles.slideSubtitle}>{currentPage.subtitle}</p>}
              {currentPage.bullets.length > 0 && (
                <ul className={styles.bulletList}>
                  {currentPage.bullets.map((bullet, index) => (
                    <li key={`${currentPage.id}-bullet-${index}`}>{bullet}</li>
                  ))}
                </ul>
              )}
              {currentPage.notes && (
                <div className={styles.slideNoteBox}>
                  <p className={styles.cardTag}>讲解备注</p>
                  <p className={styles.cardBody}>{currentPage.notes}</p>
                </div>
              )}
              {typeof currentPage.relatedTimestamp === 'number' && (
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => {
                    const target = normalizeSeekTarget(currentPage.relatedTimestamp);
                    if (target !== null) onSeek(target, true);
                  }}
                >
                  回放 {formatTime(currentPage.relatedTimestamp)}
                </button>
              )}
            </div>
          </article>

          <article className={styles.canvasBlock}>
            <h5 className={styles.blockTitle}>页面索引</h5>
            <div className={styles.slideIndex}>
              {specSlides.pages.map((page, index) => (
                <button
                  key={page.id}
                  type="button"
                  className={`${styles.slideIndexItem} ${index === currentIndex ? styles.slideIndexItemActive : ''}`}
                  onClick={() => setSlideCursor(index)}
                >
                  <span className={styles.slideIndexNo}>{index + 1}</span>
                  <span className={styles.slideIndexTitle}>{page.title}</span>
                </button>
              ))}
            </div>
          </article>
        </>
      );
    }

    if (specRenderMode === 'script' && specScript) {
      return (
        <>
          {specScript.lines.length > 0 && (
            <article className={styles.canvasBlock}>
              <h5 className={styles.blockTitle}>{result.render.title || '脚本流'}</h5>
              <div className={styles.dialogueList}>
                {specScript.lines.map((line, index) => (
                  <div key={`spec-script-line-${index}`} className={styles.dialogueItem}>
                    <span className={styles.dialogueSpeaker}>{line.speaker}</span>
                    <span className={styles.dialogueLine}>{line.line}</span>
                  </div>
                ))}
              </div>
            </article>
          )}
          {specScript.sections.map((section) => (
            <article key={section.id} className={styles.canvasBlock}>
              <h5 className={styles.blockTitle}>{section.title}</h5>
              {section.body && <p className={styles.cardBody}>{section.body}</p>}
            </article>
          ))}
        </>
      );
    }

    if (specRenderMode === 'mindmap' && specMindmap) {
      return (
        <article className={styles.canvasBlock}>
          <h5 className={styles.blockTitle}>{specMindmap.root}</h5>
          <ul className={styles.bulletList}>
            {specMindmap.branches.map((branch) => (
              <li key={branch.id}>
                <span className={styles.dialogueSpeaker}>{branch.title}</span>
                <ul className={styles.bulletList}>
                  {branch.points.map((point, pointIndex) => (
                    <li key={`${branch.id}-point-${pointIndex}`}>{point}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </article>
      );
    }

    if (specRenderMode === 'flashcards' && specFlashcards) {
      return specFlashcards.map((item) => {
        const isRevealed = Boolean(revealedCards[item.id]);
        return (
          <article key={item.id} className={styles.canvasBlock}>
            <h5 className={styles.blockTitle}>{item.title}</h5>
            <p className={styles.cardTag}>正面问题</p>
            <p className={styles.cardBody}>{item.front}</p>
            {item.hint && <p className={styles.cardHint}>提示：{item.hint}</p>}
            <button type="button" className={styles.revealBtn} onClick={() => toggleReveal(item.id)}>
              {isRevealed ? '收起答案' : '显示答案'}
            </button>
            {isRevealed && (
              <div className={styles.answerPanel}>
                <p className={styles.cardTag}>背面答案</p>
                <p className={styles.cardBody}>{item.back}</p>
              </div>
            )}
          </article>
        );
      });
    }

    if (specRenderMode === 'quiz' && specQuiz) {
      return specQuiz.map((item) => {
        const isRevealed = Boolean(revealedCards[item.id]);
        return (
          <article key={item.id} className={styles.canvasBlock}>
            <h5 className={styles.blockTitle}>{item.title}</h5>
            <p className={styles.cardBody}>{item.stem}</p>
            <div className={styles.quizOptionList}>
              {item.options.map((option, index) => (
                <div key={`${item.id}-option-${index}`} className={styles.quizOption}>
                  <span className={styles.quizBadge}>{String.fromCharCode(65 + index)}</span>
                  <span>{option.replace(/^(?:[A-D][\.\s、，:：)）]*)/, '')}</span>
                </div>
              ))}
            </div>
            <button type="button" className={styles.revealBtn} onClick={() => toggleReveal(item.id)}>
              {isRevealed ? '隐藏答案' : '查看答案与解析'}
            </button>
            {isRevealed && (
              <div className={styles.answerPanel}>
                <p className={styles.cardHint}>正确答案：{item.answer || 'A'}</p>
                {item.explanation && <p className={styles.cardBody}>{item.explanation}</p>}
              </div>
            )}
          </article>
        );
      });
    }

    if ((specRenderMode === 'document' || specRenderMode === 'blocks') && specDocument) {
      return specDocument.map((section) => (
        <article key={section.id} className={styles.canvasBlock}>
          <h5 className={styles.blockTitle}>{section.title}</h5>
          {section.body && <p className={styles.cardBody}>{section.body}</p>}
          {section.bullets.length > 0 && (
            <ul className={styles.bulletList}>
              {section.bullets.map((bullet, index) => (
                <li key={`${section.id}-bullet-${index}`}>{bullet}</li>
              ))}
            </ul>
          )}
        </article>
      ));
    }

    if (specRenderMode === 'custom' && specCustomBlocks) {
      return (
        <>
          {specCustomBlocks.map((block) => (
            <article key={block.id} className={styles.canvasBlock}>
              {block.title && <h5 className={styles.blockTitle}>{block.title}</h5>}
              {(block.type === 'text' || block.type === 'markdown') && block.text && (
                <p className={styles.cardBody}>{block.text}</p>
              )}
              {block.type === 'list' && block.items.length > 0 && (
                <ul className={styles.bulletList}>
                  {block.items.map((item, index) => (
                    <li key={`${block.id}-item-${index}`}>{item}</li>
                  ))}
                </ul>
              )}
              {block.type === 'image' && block.src && (
                <img src={block.src} alt={block.alt || block.title || '生成图像'} className={styles.customImage} />
              )}
              {block.type === 'audio' && block.src && (
                <audio controls preload="none" src={block.src} className={styles.audioPlayer} />
              )}
              {block.type === 'table' && block.columns.length > 0 && block.rows.length > 0 && (
                <div className={styles.tableWrap}>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        {block.columns.map((column, columnIndex) => (
                          <th key={`${block.id}-column-${columnIndex}`}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, rowIndex) => (
                        <tr key={`${block.id}-row-${rowIndex}`}>
                          {block.columns.map((_, columnIndex) => (
                            <td key={`${block.id}-cell-${rowIndex}-${columnIndex}`}>{row[columnIndex] || '-'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          ))}
        </>
      );
    }

    if (specRenderMode === 'custom') {
      return (
        <article className={styles.canvasBlock}>
          <h5 className={styles.blockTitle}>{result.render.title || '自定义渲染数据'}</h5>
          <pre className={styles.rawPayload}>{JSON.stringify(result.render.payload, null, 2)}</pre>
        </article>
      );
    }

    return null;
  };

  const specCanvasContent = renderSpecCanvas();
  const hasAppWindow = Boolean(specCanvasContent);

  return (
    <div className={styles.root} data-testid="app-matrix-panel">
      <section className={`${styles.surface} ${styles.hero}`}>
        <div className={styles.heroTop}>
          <div>
            <p className={styles.eyebrow}>学习应用矩阵</p>
            <h3 className={styles.title}>学习应用工坊</h3>
            <p className={styles.subtitle}>最小流程：选择应用、生成内容、直接渲染。</p>
            <p className={styles.pluginHint}>{activePluginDescription}</p>
          </div>

          <div className={styles.controls}>
            <ModelSelector value={selectedModel} onChange={setSelectedModel} compact />
            <button
              type="button"
              onClick={runPlugin}
              disabled={isRunning || !activeStudioApp}
              data-testid="app-matrix-run"
              className={styles.runButton}
            >
              {isRunning ? '正在生成...' : runButtonLabel}
            </button>
          </div>
        </div>

        <div className={styles.metaRow}>
          <span className={styles.metaChip}>来源：{formatDataSourceLabel(dataSource)}</span>
          <span className={styles.metaChip}>课堂片段：{transcript.length} 条</span>
          <span className={styles.metaChip}>当前应用：{activePluginName}</span>
          <span className={styles.metaChip}>执行插件：{pluginDisplayName}</span>
          {result?.model && <span className={styles.metaChip}>模型：{result.model}</span>}
          {evidenceCardCount > 0 && <span className={styles.metaChip}>证据卡：{evidenceCardCount} 条</span>}
          {totalCardCount > 0 && <span className={styles.metaChip}>证据覆盖：{evidenceCoveragePercent}%</span>}
        </div>

        <div className={styles.appWorkbench}>
          <div className={styles.appGrid}>
            {studioApps.map((app) => (
              <button
                key={app.key}
                type="button"
                className={`${styles.appTile} ${selectedAppKey === app.key ? styles.appTileActive : ''}`}
                onClick={() => setSelectedAppKey(app.key)}
              >
                <span className={styles.appTileIcon}>{app.icon}</span>
                <span className={styles.appTileName}>{app.name}</span>
              </button>
            ))}
          </div>

          {activeStudioApp && (
            <div className={styles.appDetailPanel}>
              <p className={styles.appDetailTitle}>{activeStudioApp.name}</p>
              <p className={styles.appDetailDesc}>{activeStudioApp.description}</p>
              <div className={styles.appDetailMeta}>
                <span>输出形态：{activeStudioApp.outputType}</span>
                <span>驱动插件：{pluginDisplayName}</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {!result && (
        <section className={`${styles.surface} ${styles.empty}`}>
          <p className={styles.emptyTitle}>先运行一个应用</p>
          <p className={styles.emptySubtitle}>生成完成后会直接进入渲染画布，不再强制卡片网格。</p>
        </section>
      )}

      {result && (
        <section className={`${styles.surface} ${styles.canvas}`}>
          <div className={styles.canvasHeader}>
            <h4 className={styles.canvasTitle}>{activePluginName} · 渲染画布</h4>
            <p className={styles.canvasHint}>{hasAppWindow ? '独立应用窗口' : `共 ${result.cards.length} 个内容块`}</p>
          </div>

          {!hasAppWindow && result.tasks.length > 0 && (
            <div className={styles.taskRail}>
              {result.tasks.map((task) => {
                const completed = Boolean(taskState[task.id]);
                return (
                  <div
                    key={task.id}
                    data-testid={`app-task-${task.id}`}
                    data-completed={completed ? 'true' : 'false'}
                    className={`${styles.taskChip} ${completed ? styles.taskChipDone : ''}`}
                  >
                    <button
                      type="button"
                      data-testid={`app-task-toggle-${task.id}`}
                      className={styles.taskToggle}
                      onClick={() => toggleTask(task.id)}
                      aria-label={completed ? '标记未完成' : '标记完成'}
                    >
                      {completed ? '已完成' : '待完成'}
                    </button>
                    <span className={styles.taskLabelText}>{task.label}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className={styles.canvasFlow}>
            {hasAppWindow ? (
              specCanvasContent
            ) : (
              <>
                {tableAggregation && (
              <article className={styles.canvasBlock}>
                <h5 className={styles.blockTitle}>数据总表</h5>
                <div className={styles.tableWrap}>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        {tableAggregation.columns.map((column, columnIndex) => (
                          <th key={`table-column-${columnIndex}`}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableAggregation.rows.map((row, rowIndex) => (
                        <tr key={`table-row-${rowIndex}`}>
                          {tableAggregation.columns.map((_, columnIndex) => (
                            <td key={`table-cell-${rowIndex}-${columnIndex}`}>{row[columnIndex] || '-'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </article>
                )}

                {dialogueAggregation && (
              <article className={styles.canvasBlock}>
                <h5 className={styles.blockTitle}>脚本流</h5>
                <div className={styles.dialogueList}>
                  {dialogueAggregation.lines.map((line, index) => (
                    <div key={`script-${index}`} className={styles.dialogueItem}>
                      <span className={styles.dialogueSpeaker}>{line.speaker}</span>
                      <span className={styles.dialogueLine}>{line.line}</span>
                    </div>
                  ))}
                </div>
              </article>
                )}

                {canvasCards.length === 0 && !tableAggregation && !dialogueAggregation && (
              <article className={styles.canvasBlock}>
                <p className={styles.cardEmptyTitle}>本次没有可渲染内容</p>
                <p className={styles.cardEmptyBody}>请调整输入内容后重新生成。</p>
              </article>
                )}

                {canvasCards.map((item) => {
                  const { card, flashcardMeta, quizMeta, bulletItems, cardKind } = item;
                  const isRevealed = Boolean(revealedCards[card.id]);
                  const fallbackBullets = bulletItems.length > 0 ? bulletItems : readBodyPoints(card.body, 8);

                  return (
                    <article key={card.id} className={styles.canvasBlock} data-testid={`app-card-${card.id}`}>
                      <div className={styles.cardHead}>
                        <h5 className={styles.blockTitle}>{card.title}</h5>
                        {card.priority && <span className={styles.priority}>{card.priority}</span>}
                      </div>

                      {flashcardMeta ? (
                        <div className={styles.learningCardBlock}>
                          <p className={styles.cardTag}>正面问题</p>
                          <p className={styles.cardBody}>{flashcardMeta.front}</p>
                          {flashcardMeta.hint && <p className={styles.cardHint}>提示：{flashcardMeta.hint}</p>}
                          <button type="button" className={styles.revealBtn} onClick={() => toggleReveal(card.id)}>
                            {isRevealed ? '收起答案' : '显示答案'}
                          </button>
                          {isRevealed && (
                            <div className={styles.answerPanel}>
                              <p className={styles.cardTag}>背面答案</p>
                              <p className={styles.cardBody}>{flashcardMeta.back}</p>
                            </div>
                          )}
                        </div>
                      ) : quizMeta ? (
                        <div className={styles.learningCardBlock}>
                          <p className={styles.cardBody}>{quizMeta.stem}</p>
                          <div className={styles.quizOptionList}>
                            {quizMeta.options.map((option, index) => (
                              <div key={`${card.id}-option-${index}`} className={styles.quizOption}>
                                <span className={styles.quizBadge}>{String.fromCharCode(65 + index)}</span>
                                <span>{option.replace(/^(?:[A-D][\.\s、，:：)）]*)/, '')}</span>
                              </div>
                            ))}
                          </div>
                          <button type="button" className={styles.revealBtn} onClick={() => toggleReveal(card.id)}>
                            {isRevealed ? '隐藏答案' : '查看答案与解析'}
                          </button>
                          {isRevealed && (
                            <div className={styles.answerPanel}>
                              <p className={styles.cardHint}>正确答案：{quizMeta.answer || 'A'}</p>
                              {quizMeta.explanation && <p className={styles.cardBody}>{quizMeta.explanation}</p>}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className={styles.learningCardBlock}>
                          {card.body && <p className={styles.cardBody}>{card.body}</p>}
                          {(fallbackBullets.length > 0 || ['report', 'slide', 'infographic', 'mindmap'].includes(cardKind)) && (
                            <ul className={styles.bulletList}>
                              {fallbackBullets.map((bullet, index) => (
                                <li key={`${card.id}-bullet-${index}`}>{bullet}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}

                      {card.citations && card.citations.length > 0 && (
                        <div className={styles.citationList}>
                          {card.citations.slice(0, 3).map((citation, index) => (
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
                              className={styles.actionBtn}
                              onClick={() => handleCardAction(card, action)}
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
