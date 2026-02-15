import type { Anchor, TranscriptSegment } from '@/types';

export type DataSourceType = 'live' | 'video' | 'demo' | 'unknown';

export interface InputLayerContext {
  sessionId: string;
  dataSource: DataSourceType;
  transcript: TranscriptSegment[];
  anchors: Anchor[];
  metadata?: {
    subject?: string;
    teacher?: string;
    studentId?: string;
    studentName?: string;
    locale?: string;
    [key: string]: unknown;
  };
}

export interface MemoryLayerSnapshot {
  summary?: string;
  notes?: string[];
  keyDifficulties?: string[];
  timeline?: {
    durationMs: number;
    segmentCount: number;
    unresolvedAnchorCount: number;
  };
  custom?: Record<string, unknown>;
}

export interface ApplicationGoal {
  intent: string;
  constraints?: string[];
  expectedOutput?: 'chat' | 'cards' | 'tasks' | 'mixed';
  appKey?: string;
}

export interface AppExecutionContext {
  input: InputLayerContext;
  memory: MemoryLayerSnapshot;
  goal: ApplicationGoal;
  model?: string;
}

export type CardPriority = 'high' | 'medium' | 'low';
export type AppCardType = 'insight' | 'task' | 'question' | 'timeline' | 'flashcard' | 'quiz' | 'mindmap';

export interface AppCardCitation {
  startMs: number;
  endMs: number;
  snippet?: string;
}

export interface AppCardAction {
  id: string;
  label: string;
  kind: 'seek' | 'ask' | 'mark_done' | 'open';
  payload?: Record<string, unknown>;
}

export interface AppCard {
  id: string;
  type: AppCardType;
  title: string;
  body: string;
  priority?: CardPriority;
  citations?: AppCardCitation[];
  actions?: AppCardAction[];
  meta?: Record<string, unknown>;
}

export interface AppTask {
  id: string;
  label: string;
  reason?: string;
  estimatedMinutes?: number;
  relatedTimestamp?: number;
}

export type AppRenderMode =
  | 'document'
  | 'table'
  | 'script'
  | 'audio'
  | 'image'
  | 'slides'
  | 'mindmap'
  | 'flashcards'
  | 'quiz'
  | 'blocks'
  | 'custom';

export interface AppRenderSpec {
  mode: AppRenderMode;
  title?: string;
  description?: string;
  payload: unknown;
}

export interface AppExecutionResult {
  pluginId: string;
  version: string;
  model?: string;
  cards: AppCard[];
  tasks: AppTask[];
  trace: string[];
  render?: AppRenderSpec;
  nextSuggestedPlugins?: string[];
  raw?: Record<string, unknown>;
}

export interface AppPluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  capabilities: string[];
  enabledByDefault?: boolean;
}

export interface SearchTranscriptParams {
  transcript: TranscriptSegment[];
  query: string;
  limit?: number;
}

export interface AppPluginTools {
  searchTranscript(params: SearchTranscriptParams): TranscriptSegment[];
  summarizeSegments(segments: TranscriptSegment[], maxChars?: number): string;
  now(): string;
}

export interface AppPlugin {
  manifest: AppPluginManifest;
  canHandle(context: AppExecutionContext): boolean;
  run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult>;
}

export interface AppExecuteRequest {
  appKey?: string;
  pluginId?: string;
  model?: string;
  goal: ApplicationGoal | string;
  input: {
    sessionId?: string;
    dataSource?: DataSourceType;
    transcript: TranscriptSegment[];
    anchors?: Anchor[];
    metadata?: InputLayerContext['metadata'];
  };
  memory?: Partial<MemoryLayerSnapshot>;
}
