export interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
  translatedText?: string;
}

export interface Topic {
  id: string;
  title: string;
  translatedTitle?: string;
  description?: string;
  translatedDescription?: string;
  duration: number;
  segments: {
    start: number;
    end: number;
    text: string;
    translatedText?: string;
    startSegmentIdx?: number;
    endSegmentIdx?: number;
    startCharOffset?: number;
    endCharOffset?: number;
    hasCompleteSentences?: boolean;
    confidence?: number;
  }[];
  keywords?: string[];
  translatedKeywords?: string[];
  quote?: {
    timestamp: string;
    text: string;
    translatedText?: string;
  };
  isCitationReel?: boolean;
  autoPlay?: boolean;
}

export interface TopicCandidate {
  key: string;
  title: string;
  translatedTitle?: string;
  quote: {
    timestamp: string;
    text: string;
    translatedText?: string;
  };
}

export type TopicGenerationMode = 'smart' | 'fast';

export interface VideoData {
  videoId: string;
  title: string;
  transcript: TranscriptSegment[];
  topics: Topic[];
}

export interface Citation {
  number: number;
  text: string;
  start: number;
  end: number;
  startSegmentIdx: number;
  endSegmentIdx: number;
  startCharOffset: number;
  endCharOffset: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  timestamp: Date;
  imageUrl?: string;
  imageMetadata?: {
    modelUsed?: string;
    aspectRatio?: string;
    imageSize?: string;
    style?: string;
  };
}

export type NoteSource = 'chat' | 'takeaways' | 'transcript' | 'custom';

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
  selectedText?: string;
  selectionContext?: string;
  timestampLabel?: string;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Note {
  id: string;
  userId: string;
  videoId: string;
  source: NoteSource;
  sourceId?: string | null;
  text: string;
  metadata?: NoteMetadata | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteWithVideo extends Note {
  video: {
    youtubeId: string;
    title: string;
    author: string;
    thumbnailUrl: string;
    duration: number;
    slug?: string | null;
  } | null;
}

export interface VideoInfo {
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
  duration: number | null;
  description?: string;
  tags?: string[];
  language?: string;
  availableLanguages?: string[];
}

export type PlaybackCommandType = 'SEEK' | 'PLAY_TOPIC' | 'PLAY_SEGMENT' | 'PLAY' | 'PAUSE' | 'PLAY_ALL' | 'PLAY_CITATIONS';

export interface PlaybackCommand {
  type: PlaybackCommandType;
  time?: number;
  topic?: Topic;
  segment?: TranscriptSegment;
  citations?: Citation[];
  autoPlay?: boolean;
}

export interface TranslationState {
  enabled: boolean;
  targetLanguage: string;
  cache: Map<string, string>;
}

export type TranslationScenario = 'transcript' | 'chat' | 'topic' | 'general';

export type TranslationRequestHandler = (
  text: string,
  cacheKey: string,
  scenario?: TranslationScenario,
  targetLanguage?: string
) => Promise<string>;
