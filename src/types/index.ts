
export type AnchorType = 'confusion' | 'important' | 'question';
export type SegmentType = 'lecture' | 'qa' | 'exercise';
export type SessionStatus = 'recording' | 'paused' | 'completed';
export type UserRole = 'student' | 'parent' | 'teacher';

export interface Anchor {
  id: string;
  sessionId: string;
  studentId: string;
  timestamp: number;
  type: AnchorType;
  cancelled: boolean;
  resolved: boolean;
  createdAt: string;
  resolvedAt?: string;
  note?: string;
}

export interface DBAnchor {
  id?: number;
  sessionId: string;
  timestamp: number;
  type: AnchorType;
  status: 'active' | 'resolved';
  note?: string;
  aiExplanation?: string;
  createdAt: Date;
  resolvedAt?: Date;
}

export type AnchorStatus = 'active' | 'cancelled' | 'resolved';

export interface StudentAnchor extends Anchor {
  studentName: string;
  status: AnchorStatus;
  aiExplanation?: string;
  transcriptContext?: string;
  updatedAt: string;
}

export interface Breakpoint {
  id: string;
  lessonId: string;
  studentId: string;
  timestamp: number;
  type: AnchorType;
  resolved: boolean;
  createdAt: string;
}

export interface TranscriptSegment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  speakerId?: string;
  isFinal?: boolean;
  provisional?: boolean;
  lockedByUser?: boolean;
  correctionLevel?: 'rule' | 'lexicon' | 'llm' | 'none';
  rawText?: string;
  originalText?: string;
  sourceItemId?: string;
}

export type VideoSourceMode = 'bili-native' | 'bili-subtitle' | 'yt-dlp' | 'direct';

export interface VideoImportTraceEntry {
  stage: string;
  ok: boolean;
  code?: string;
  detail?: string;
}

export interface ImportedVideoSource {
  provider: string;
  providerLabel: string;
  originalUrl: string;
  resolvedUrl?: string;
  embedUrl?: string;
  playableUrl?: string;
  title?: string;
  durationSec?: number;
  thumbnailUrl?: string;
  audioUrl?: string;
  sourceMode?: VideoSourceMode;
  bvid?: string;
  cid?: number;
  importTrace?: VideoImportTraceEntry[];
}

export interface ImportedVideoResult {
  segments: TranscriptSegment[];
  source: ImportedVideoSource;
  sourceMode?: VideoSourceMode;
  trace?: VideoImportTraceEntry[];
}

export interface DBTranscriptSegment {
  id?: number;
  sessionId: string;
  text: string;
  startMs: number;
  endMs: number;
  speakerId?: string;
  confidence: number;
  isFinal: boolean;
}

export function dbToTranscriptSegment(dbSeg: DBTranscriptSegment): TranscriptSegment {
  return {
    id: String(dbSeg.id ?? ''),
    text: dbSeg.text,
    startMs: dbSeg.startMs,
    endMs: dbSeg.endMs,
    confidence: dbSeg.confidence,
    speakerId: dbSeg.speakerId,
    isFinal: dbSeg.isFinal,
  };
}

export interface TimelineSegment extends TranscriptSegment {
  anchors: Anchor[];
  type: SegmentType;
}

export interface Topic {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  segmentIds: string[];
}

export interface Session {
  id: string;
  studentId: string;
  subject: string;
  teacher: string;
  date: string;
  status: SessionStatus;
  audioUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AudioRecording {
  id: string;
  sessionId: string;
  filename: string;
  duration: number;
  size: number;
  url?: string;
  createdAt: string;
}

export interface ClassTimeline {
  id: string;
  lessonId: string;
  date: string;
  subject: string;
  teacher: string;
  duration: number;
  segments: TimelineSegment[];
  anchors: Anchor[];
  audioUrl?: string;
}

export type ModelProvider = 'qwen' | 'gemini' | 'openai';

export interface ModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  description: string;
  maxTokens: number;
  recommended?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface TutorResponse {
  explanation: {
    teacherSaid: string;
    citation: {
      text: string;
      timeRange: string;
      startMs: number;
      endMs: number;
    };
    possibleStuckPoints: string[];
    followUpQuestion: string;
  };
  actionItems: ActionItem[];
  rawContent: string;
  model: string;
  usage?: LLMResponse['usage'];
}

export type ActionItemType = 'replay' | 'exercise' | 'review';

export interface ActionItem {
  id: string;
  type: ActionItemType;
  title: string;
  description: string;
  estimatedMinutes: number;
  completed: boolean;
  relatedTimestamp?: number;
}

export interface ConfusionPoint {
  id: string;
  subject: string;
  time: string;
  timestamp: number;
  summary: string;
  teacherQuote: string;
  audioClipUrl?: string;
}

export interface ParentDailyReport {
  date: string;
  studentName: string;
  totalLessons: number;
  totalBreakpoints: number;
  unresolvedBreakpoints: number;
  confusionPoints: ConfusionPoint[];
  actionScript: string;
  estimatedMinutes: number;
  completionStatus: Array<{
    taskId: string;
    title: string;
    completed: boolean;
  }>;
}

export interface ConfusionHotspot {
  startMs: number;
  endMs: number;
  count: number;
  anchors: Anchor[];
}

export interface TeacherDailyReport {
  date: string;
  className: string;
  subject: string;
  totalStudents: number;
  studentsWithConfusion: number;
  hotspots: ConfusionHotspot[];
  aiReflection: string;
  suggestions: string[];
}

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  source: string;
  metadata?: {
    timestamp?: number;
    sourceId?: string;
    type?: string;
  };
}

export type TopicGenerationMode = 'smart' | 'fast';

export type ImportanceLevel = 'high' | 'medium' | 'low';

export interface HighlightSegment {
  start: number;
  end: number;
  text: string;
  startSegmentIdx?: number;
  endSegmentIdx?: number;
  startCharOffset?: number;
  endCharOffset?: number;
  confidence?: number;
}

export interface HighlightQuote {
  timestamp: string;
  text: string;
}

export interface HighlightTopic {
  id: string;
  sessionId: string;
  title: string;
  description?: string;
  importance: ImportanceLevel;
  duration: number;
  segments: HighlightSegment[];
  keywords?: string[];
  quote?: HighlightQuote;
  createdAt: string;
  updatedAt: string;
}

export interface TopicCandidate {
  key: string;
  title: string;
  quote: HighlightQuote;
}

export interface SummaryTakeaway {
  label: string;
  insight: string;
  timestamps: string[];
}

export interface ClassSummary {
  id: string;
  sessionId: string;
  overview: string;
  takeaways: SummaryTakeaway[];
  keyDifficulties: string[];
  structure: string[];
  createdAt: string;
  updatedAt: string;
}

export type NoteSource = 'chat' | 'takeaways' | 'transcript' | 'custom' | 'anchor';

export interface NoteMetadata {
  transcript?: {
    start: number;
    end?: number;
    segmentIndex?: number;
    topicId?: string;
  };
  chat?: {
    messageId: string;
    role: 'user' | 'assistant';
    timestamp?: string;
  };
  anchorId?: string;
  timestamp?: number;
  selectedText?: string;
  selectionContext?: string;
  timestampLabel?: string;
  extra?: Record<string, unknown>;
}

export interface Note {
  id: string;
  sessionId: string;
  studentId: string;
  source: NoteSource;
  sourceId?: string;
  text: string;
  metadata?: NoteMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface NoteWithSession extends Note {
  session: {
    sessionId: string;
    subject?: string;
    topic?: string;
    date: string;
  } | null;
}

export function anchorToBreakpoint(anchor: Anchor): Breakpoint {
  return {
    id: anchor.id,
    lessonId: anchor.sessionId,
    studentId: anchor.studentId,
    timestamp: anchor.timestamp,
    type: anchor.type,
    resolved: anchor.resolved,
    createdAt: anchor.createdAt,
  };
}

export function breakpointToAnchor(bp: Breakpoint): Anchor {
  return {
    id: bp.id,
    sessionId: bp.lessonId,
    studentId: bp.studentId,
    timestamp: bp.timestamp,
    type: bp.type,
    cancelled: false,
    resolved: bp.resolved,
    createdAt: bp.createdAt,
  };
}
