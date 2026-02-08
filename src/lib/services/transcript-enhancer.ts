import type { TranscriptSegment } from '@/types';
import {
  getTranscriptLexicon,
  seedTranscriptLexicon,
  type TranscriptScope,
} from '@/lib/db/lexicon';

export type EnhanceStatus = 'pending' | 'enhancing' | 'enhanced' | 'failed';
export type CorrectionStrategy = 'layered' | 'rule-only';

export interface EnhancedTranscriptSegment extends TranscriptSegment {
  originalText?: string;
  rawText?: string;
  correctionLevel?: 'rule' | 'lexicon' | 'llm' | 'none';
  enhanceStatus: EnhanceStatus;
  enhancedAt?: string;
}

export interface EnhanceResponse {
  segments: EnhancedTranscriptSegment[];
  success: boolean;
  error?: string;
}

export interface EnhanceRequestOptions {
  model?: string;
  fallbackModel?: string;
  strategy?: CorrectionStrategy;
  lexiconScope?: TranscriptScope;
  lexiconTerms?: Array<{
    term: string;
    canonical: string;
    aliases?: string[];
    scope?: TranscriptScope;
    status?: 'pending' | 'active' | 'disabled';
  }>;
}

const DEFAULT_MODEL = 'qwen-turbo';
const DEFAULT_FALLBACK_MODEL = 'qwen-plus';
const DEFAULT_STRATEGY: CorrectionStrategy = 'layered';
let hasSeededLexicon = false;

async function loadLexicon(
  scope: TranscriptScope,
  explicitTerms?: EnhanceRequestOptions['lexiconTerms']
): Promise<EnhanceRequestOptions['lexiconTerms']> {
  if (explicitTerms && explicitTerms.length > 0) {
    return explicitTerms;
  }

  if (typeof window === 'undefined') {
    return [];
  }

  try {
    if (!hasSeededLexicon) {
      await seedTranscriptLexicon();
      hasSeededLexicon = true;
    }

    const terms = await getTranscriptLexicon(scope);
    return terms.map((term) => ({
      term: term.term,
      canonical: term.canonical,
      aliases: term.aliases,
      scope: term.scope,
      status: term.status,
    }));
  } catch (error) {
    console.warn('[TranscriptEnhancer] Failed to load lexicon:', error);
    return [];
  }
}

export async function enhanceTranscript(
  segments: TranscriptSegment[],
  options?: EnhanceRequestOptions,
): Promise<EnhanceResponse> {
  if (segments.length === 0) {
    return { segments: [], success: true };
  }

  const model = options?.model || process.env.NEXT_PUBLIC_TRANSCRIPT_LIGHT_MODEL || DEFAULT_MODEL;
  const fallbackModel = options?.fallbackModel || process.env.NEXT_PUBLIC_TRANSCRIPT_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;
  const strategy = options?.strategy || DEFAULT_STRATEGY;
  const lexiconScope = options?.lexiconScope || 'classroom';

  try {
    const lexiconTerms = await loadLexicon(lexiconScope, options?.lexiconTerms);

    const response = await fetch('/api/transcript-enhance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        segments,
        model,
        fallbackModel,
        strategy,
        lexiconTerms,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.success || !Array.isArray(data.segments)) {
      throw new Error(data.error || 'Invalid enhancement response');
    }

    return {
      segments: data.segments as EnhancedTranscriptSegment[],
      success: true,
    };
  } catch (error) {
    console.error('[TranscriptEnhancer] Error:', error);

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Transcript enhancement failed',
      segments: segments.map((segment) => ({
        ...segment,
        enhanceStatus: 'failed',
      })),
    };
  }
}

export class TranscriptEnhanceManager {
  private pendingSegments: TranscriptSegment[] = [];
  private enhancedSegments: Map<string, EnhancedTranscriptSegment> = new Map();
  private isEnhancing = false;
  private lastActivityTime = Date.now();
  private silenceCheckTimer: NodeJS.Timeout | null = null;

  private readonly config = {
    minBatchSize: 3,
    silenceThreshold: 2000,
    model: DEFAULT_MODEL,
    fallbackModel: DEFAULT_FALLBACK_MODEL,
    strategy: DEFAULT_STRATEGY as CorrectionStrategy,
    lexiconScope: 'classroom' as TranscriptScope,
  };

  private onEnhanced?: (segments: EnhancedTranscriptSegment[]) => void;

  constructor(options?: {
    minBatchSize?: number;
    silenceThreshold?: number;
    model?: string;
    fallbackModel?: string;
    strategy?: CorrectionStrategy;
    lexiconScope?: TranscriptScope;
    onEnhanced?: (segments: EnhancedTranscriptSegment[]) => void;
  }) {
    if (options?.minBatchSize) this.config.minBatchSize = options.minBatchSize;
    if (options?.silenceThreshold !== undefined) this.config.silenceThreshold = options.silenceThreshold;
    if (options?.model) this.config.model = options.model;
    if (options?.fallbackModel) this.config.fallbackModel = options.fallbackModel;
    if (options?.strategy) this.config.strategy = options.strategy;
    if (options?.lexiconScope) this.config.lexiconScope = options.lexiconScope;
    if (options?.onEnhanced) this.onEnhanced = options.onEnhanced;
  }

  addSegment(segment: TranscriptSegment): void {
    this.pendingSegments.push(segment);
    this.lastActivityTime = Date.now();
    this.startSilenceCheck();
  }

  updateActivity(): void {
    this.lastActivityTime = Date.now();
  }

  private startSilenceCheck(): void {
    if (this.silenceCheckTimer) return;

    this.silenceCheckTimer = setInterval(() => {
      const silenceDuration = Date.now() - this.lastActivityTime;

      if (
        silenceDuration >= this.config.silenceThreshold &&
        this.pendingSegments.length >= this.config.minBatchSize &&
        !this.isEnhancing
      ) {
        void this.enhancePending();
      }
    }, 500);
  }

  private stopSilenceCheck(): void {
    if (this.silenceCheckTimer) {
      clearInterval(this.silenceCheckTimer);
      this.silenceCheckTimer = null;
    }
  }

  async enhancePending(): Promise<EnhancedTranscriptSegment[]> {
    if (this.pendingSegments.length === 0 || this.isEnhancing) {
      return [];
    }

    this.isEnhancing = true;
    const segmentsToEnhance = [...this.pendingSegments];
    this.pendingSegments = [];

    try {
      const result = await enhanceTranscript(segmentsToEnhance, {
        model: this.config.model,
        fallbackModel: this.config.fallbackModel,
        strategy: this.config.strategy,
        lexiconScope: this.config.lexiconScope,
      });

      for (const segment of result.segments) {
        this.enhancedSegments.set(segment.id, segment);
      }

      if (this.onEnhanced) {
        this.onEnhanced(result.segments);
      }

      return result.segments;
    } finally {
      this.isEnhancing = false;
    }
  }

  async finalize(): Promise<EnhancedTranscriptSegment[]> {
    this.stopSilenceCheck();

    if (this.pendingSegments.length > 0) {
      return this.enhancePending();
    }

    return [];
  }

  getEnhanced(segmentId: string): EnhancedTranscriptSegment | undefined {
    return this.enhancedSegments.get(segmentId);
  }

  getAllEnhanced(): EnhancedTranscriptSegment[] {
    return Array.from(this.enhancedSegments.values());
  }

  dispose(): void {
    this.stopSilenceCheck();
    this.pendingSegments = [];
    this.enhancedSegments.clear();
  }
}

export default TranscriptEnhanceManager;

