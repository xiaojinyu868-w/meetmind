/**
 * MeetMind 缁熶竴绫诲瀷瀹氫箟
 */

// ==================== 鍩虹绫诲瀷 ====================

export type AnchorType = 'confusion' | 'important' | 'question';
export type SegmentType = 'lecture' | 'qa' | 'exercise';
export type SessionStatus = 'recording' | 'paused' | 'completed';
export type UserRole = 'student' | 'parent' | 'teacher';

// ==================== 鏍稿績瀹炰綋 ====================

/**
 * 鏂偣/閿氱偣 - 瀛︾敓鏍囪鐨勫洶鎯戠偣
 */
export interface Anchor {
  id: string;
  sessionId: string;
  studentId: string;
  timestamp: number;  // 璇惧爞鏃堕棿鎴筹紙姣锛?
  type: AnchorType;
  cancelled: boolean;
  resolved: boolean;
  createdAt: string;
  resolvedAt?: string;  // 瑙ｅ喅鏃堕棿
  note?: string;
}

/**
 * 鏁版嵁搴撳眰 Anchor锛堝吋瀹?db.ts 鐨勮嚜澧?ID锛?
 */
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

/**
 * 鍥版儜鐐圭姸鎬?
 */
export type AnchorStatus = 'active' | 'cancelled' | 'resolved';

/**
 * 瀛︾敓鍥版儜鐐硅褰曪紙鎵╁睍鐗堟湰锛岀敤浜庢暀甯堢锛?
 */
export interface StudentAnchor extends Anchor {
  studentName: string;           // 瀛︾敓鏄电О
  status: AnchorStatus;          // 鐘舵€?
  aiExplanation?: string;        // AI 瑙ｉ噴鍐呭
  transcriptContext?: string;    // 鍏宠仈鐨勮浆褰曟枃鏈笂涓嬫枃
  updatedAt: string;             // 鏇存柊鏃堕棿
}

/**
 * 鏂偣锛堝吋瀹规棫鎺ュ彛锛?
 * @deprecated 浣跨敤 Anchor 浠ｆ浛
 */
export interface Breakpoint {
  id: string;
  lessonId: string;
  studentId: string;
  timestamp: number;
  type: AnchorType;
  resolved: boolean;
  createdAt: string;
}

/**
 * 杞綍鐗囨锛堝簲鐢ㄥ眰浣跨敤锛?
 */
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

/**
 * 鏁版嵁搴撳眰杞綍鐗囨锛堝吋瀹?db.ts 鐨勮嚜澧?ID锛?
 */
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

/**
 * 杞崲 DB 灞傝浆褰曠墖娈靛埌搴旂敤灞?
 */
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

/**
 * 鏃堕棿杞寸墖娈碉紙鍖呭惈鏂偣鍏宠仈锛?
 */
export interface TimelineSegment extends TranscriptSegment {
  anchors: Anchor[];
  type: SegmentType;
}

/**
 * 涓婚/绔犺妭
 */
export interface Topic {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  segmentIds: string[];
}

/**
 * 璇惧爞浼氳瘽
 */
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

/**
 * 闊抽褰曢煶
 */
export interface AudioRecording {
  id: string;
  sessionId: string;
  filename: string;
  duration: number;  // 鏃堕暱锛堟绉掞級
  size: number;      // 鏂囦欢澶у皬锛堝瓧鑺傦級
  url?: string;
  createdAt: string;
}

/**
 * 璇惧爞鏃堕棿杞?
 */
export interface ClassTimeline {
  id: string;
  lessonId: string;
  date: string;
  subject: string;
  teacher: string;
  duration: number;  // 鎬绘椂闀匡紙姣锛?
  segments: TimelineSegment[];
  anchors: Anchor[];
  audioUrl?: string;
}

// ==================== AI 鐩稿叧 ====================

/**
 * AI 妯″瀷鎻愪緵鍟?
 */
export type ModelProvider = 'qwen' | 'gemini' | 'openai';

/**
 * 妯″瀷閰嶇疆
 */
export interface ModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  description: string;
  maxTokens: number;
  recommended?: boolean;
}

/**
 * 鑱婂ぉ娑堟伅
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * LLM 鍝嶅簲
 */
export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * AI 瀹舵暀鍝嶅簲
 */
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

// ==================== 琛屽姩椤?====================

export type ActionItemType = 'replay' | 'exercise' | 'review';

/**
 * 琛屽姩椤?
 */
export interface ActionItem {
  id: string;
  type: ActionItemType;
  title: string;
  description: string;
  estimatedMinutes: number;
  completed: boolean;
  relatedTimestamp?: number;
}

// ==================== 瀹堕暱绔?====================

/**
 * 鍥版儜鐐规憳瑕?
 */
export interface ConfusionPoint {
  id: string;
  subject: string;
  time: string;
  timestamp: number;
  summary: string;
  teacherQuote: string;
  audioClipUrl?: string;
}

/**
 * 瀹堕暱鏃ユ姤
 */
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

// ==================== 鏁欏笀绔?====================

/**
 * 鍥版儜鐑尯
 */
export interface ConfusionHotspot {
  startMs: number;
  endMs: number;
  count: number;
  anchors: Anchor[];
}

/**
 * 鏁欏笀鏃ユ姤
 */
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

// ==================== 鎼滅储鐩稿叧 ====================

/**
 * 鎼滅储缁撴灉
 */
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

// ==================== AI 绮鹃€夌墖娈?(Highlight Reels) ====================

/**
 * 涓婚鐢熸垚妯″紡
 */
export type TopicGenerationMode = 'smart' | 'fast';

/**
 * 閲嶈绋嬪害
 */
export type ImportanceLevel = 'high' | 'medium' | 'low';

/**
 * 绮鹃€夌墖娈垫椂闂磋寖鍥?
 */
export interface HighlightSegment {
  start: number;           // 寮€濮嬫椂闂达紙姣锛?
  end: number;             // 缁撴潫鏃堕棿锛堟绉掞級
  text: string;            // 鍘熸枃鍐呭
  startSegmentIdx?: number;
  endSegmentIdx?: number;
  startCharOffset?: number;
  endCharOffset?: number;
  confidence?: number;     // 鍖归厤缃俊搴?(0-1)
}

/**
 * 绮鹃€夌墖娈靛紩鐢?
 */
export interface HighlightQuote {
  timestamp: string;       // [MM:SS-MM:SS] 鏍煎紡
  text: string;            // 鍘熸枃寮曠敤
}

/**
 * AI 绮鹃€夌墖娈碉紙Highlight Reel锛?
 */
export interface HighlightTopic {
  id: string;
  sessionId: string;
  title: string;           // 鏍囬锛堟渶澶?0璇嶏級
  description?: string;    // 鍐呭鎽樿
  importance: ImportanceLevel;
  duration: number;        // 鐗囨鏃堕暱锛堟绉掞級
  segments: HighlightSegment[];
  keywords?: string[];
  quote?: HighlightQuote;
  createdAt: string;
  updatedAt: string;
}

/**
 * 涓婚鍊欓€夐」锛堢敤浜?Fast 妯″紡鐨勪腑闂寸粨鏋滐級
 */
export interface TopicCandidate {
  key: string;
  title: string;
  quote: HighlightQuote;
}

// ==================== 缁撴瀯鍖栨憳瑕?(Summary) ====================

/**
 * 鎽樿瑕佺偣
 */
export interface SummaryTakeaway {
  label: string;           // 鏍囬锛堟渶澶?0璇嶏級
  insight: string;         // 娲炲療锛?-2鍙ワ級
  timestamps: string[];    // 鏃堕棿鎴筹紙1-2涓級
}

/**
 * 璇惧爞缁撴瀯鍖栨憳瑕?
 */
export interface ClassSummary {
  id: string;
  sessionId: string;
  overview: string;        // 璇惧爞姒傝
  takeaways: SummaryTakeaway[];  // 涓昏鐭ヨ瘑鐐?
  keyDifficulties: string[];     // 閲嶇偣闅剧偣
  structure: string[];           // 璇惧爞缁撴瀯
  createdAt: string;
  updatedAt: string;
}

// ==================== 涓汉绗旇绯荤粺 ====================

/**
 * 绗旇鏉ユ簮绫诲瀷
 */
export type NoteSource = 'chat' | 'takeaways' | 'transcript' | 'custom' | 'anchor';

/**
 * 绗旇鍏冩暟鎹?
 */
export interface NoteMetadata {
  transcript?: {
    start: number;         // 寮€濮嬫椂闂达紙姣锛?
    end?: number;          // 缁撴潫鏃堕棿锛堟绉掞級
    segmentIndex?: number;
    topicId?: string;
  };
  chat?: {
    messageId: string;
    role: 'user' | 'assistant';
    timestamp?: string;
  };
  anchorId?: string;       // 鍏宠仈鐨勫洶鎯戠偣 ID
  timestamp?: number;      // 鏃堕棿鎴筹紙姣锛?
  selectedText?: string;   // 閫変腑鐨勫師鏂?
  selectionContext?: string;
  timestampLabel?: string;
  extra?: Record<string, unknown>;
}

/**
 * 涓汉绗旇
 */
export interface Note {
  id: string;
  sessionId: string;
  studentId: string;
  source: NoteSource;
  sourceId?: string;       // 鏉ユ簮 ID锛堝娑堟伅 ID銆佺墖娈?ID锛?
  text: string;            // 绗旇鍐呭
  metadata?: NoteMetadata;
  createdAt: string;
  updatedAt: string;
}

/**
 * 甯︿細璇濅俊鎭殑绗旇锛堢敤浜庤法璇剧▼绗旇绠＄悊锛?
 */
export interface NoteWithSession extends Note {
  session: {
    sessionId: string;
    subject?: string;
    topic?: string;
    date: string;
  } | null;
}

// ==================== 宸ュ叿鍑芥暟 ====================

/**
 * Anchor 杞?Breakpoint锛堝吋瀹规棫浠ｇ爜锛?
 */
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

/**
 * Breakpoint 杞?Anchor
 */
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
