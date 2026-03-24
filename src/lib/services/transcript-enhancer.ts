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
  /** Course topic / hot-word context for better LLM correction */
  contextHint?: string;
  /** Recent confirmed transcript text for LLM to infer course topic & terminology */
  recentContext?: string;
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
        contextHint: options?.contextHint || '',
        recentContext: options?.recentContext || '',
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

  /**
   * Sliding window of LLM-corrected transcript texts (post-enhancement).
   * Fed to the LLM as context so it can infer course topic & terminology
   * without any explicit term extraction step.
   * Only populated after each batch completes enhancement, so the first
   * batch has no context (cold start), and subsequent batches get
   * progressively better context.
   * Capped at ~2500 chars (≈ 3–4 min of speech).
   */
  private recentConfirmedTexts: string[] = [];
  private static readonly RECENT_CONTEXT_MAX_CHARS = 2500;

  /**
   * Full history of all enhanced texts for term discovery.
   * Unlike recentConfirmedTexts (sliding window for batch context),
   * this accumulates everything so the term extraction LLM sees the full picture.
   */
  private allEnhancedTexts: string[] = [];
  private allEnhancedChars = 0;

  /**
   * Delayed term discovery state.
   * After MIN_TIME_MS + MIN_CHARS of enhanced text, we call /api/extract-terms
   * with the full enhanced transcript. The extracted term mappings get injected
   * into contextHint for all subsequent batches.
   */
  private recordingStartTime = Date.now();
  private termDiscoveryDone = false;
  private termDiscoveryInFlight = false;
  private lastTermDiscoveryTime = 0;
  private lastTermDiscoveryChars = 0;
  private discoveredTermsHint = '';
  private discoveredLexiconTerms: Array<{
    term: string;
    canonical: string;
    aliases?: string[];
    scope?: TranscriptScope;
    status?: 'pending' | 'active' | 'disabled';
  }> = [];

  private static readonly TERM_DISCOVERY_MIN_TIME_MS = 3 * 60 * 1000; // 3 minutes
  private static readonly TERM_DISCOVERY_MIN_CHARS = 500;
  private static readonly TERM_DISCOVERY_REFRESH_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly TERM_DISCOVERY_REFRESH_CHARS = 1000;

  /** Callback when auto-discovered terms are available (for ASR context update) */
  private onTermsDiscovered?: (termsHint: string) => void;

  private readonly config = {
    minBatchSize: 3,
    silenceThreshold: 2000,
    model: DEFAULT_MODEL,
    fallbackModel: DEFAULT_FALLBACK_MODEL,
    strategy: DEFAULT_STRATEGY as CorrectionStrategy,
    lexiconScope: 'classroom' as TranscriptScope,
    contextHint: '',
  };

  private onEnhanced?: (segments: EnhancedTranscriptSegment[]) => void;

  constructor(options?: {
    minBatchSize?: number;
    silenceThreshold?: number;
    model?: string;
    fallbackModel?: string;
    strategy?: CorrectionStrategy;
    lexiconScope?: TranscriptScope;
    contextHint?: string;
    onEnhanced?: (segments: EnhancedTranscriptSegment[]) => void;
    onTermsDiscovered?: (termsHint: string) => void;
  }) {
    if (options?.minBatchSize) this.config.minBatchSize = options.minBatchSize;
    if (options?.silenceThreshold !== undefined) this.config.silenceThreshold = options.silenceThreshold;
    if (options?.model) this.config.model = options.model;
    if (options?.fallbackModel) this.config.fallbackModel = options.fallbackModel;
    if (options?.strategy) this.config.strategy = options.strategy;
    if (options?.lexiconScope) this.config.lexiconScope = options.lexiconScope;
    if (options?.contextHint) this.config.contextHint = options.contextHint;
    if (options?.onEnhanced) this.onEnhanced = options.onEnhanced;
    if (options?.onTermsDiscovered) this.onTermsDiscovered = options.onTermsDiscovered;
    this.recordingStartTime = Date.now();
  }

  addSegment(segment: TranscriptSegment): void {
    this.pendingSegments.push(segment);
    this.lastActivityTime = Date.now();
    this.startSilenceCheck();
  }

  updateActivity(): void {
    this.lastActivityTime = Date.now();
  }

  /** Dynamically update context hint during recording (e.g., from auto-extracted terms) */
  updateContextHint(hint: string): void {
    this.config.contextHint = hint;
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
      // Use only previously-enhanced text as context (excludes current batch)
      const contextSnapshot = this.recentConfirmedTexts.join(' ');

      // Merge user-provided contextHint with auto-discovered terms
      const mergedHint = this.getMergedContextHint();

      const result = await enhanceTranscript(segmentsToEnhance, {
        model: this.config.model,
        fallbackModel: this.config.fallbackModel,
        strategy: this.config.strategy,
        lexiconScope: this.config.lexiconScope,
        lexiconTerms: this.discoveredLexiconTerms.length > 0 ? this.discoveredLexiconTerms : undefined,
        contextHint: mergedHint,
        recentContext: contextSnapshot,
      });

      // After enhancement, add corrected texts to both windows
      // Only include successfully enhanced segments — failed ones retain noisy ASR text
      // which would pollute the context window.
      for (const segment of result.segments) {
        this.enhancedSegments.set(segment.id, segment);
        if (segment.enhanceStatus === 'enhanced') {
          const text = segment.text?.trim();
          if (text) {
            this.recentConfirmedTexts.push(text);
            this.allEnhancedTexts.push(text);
            this.allEnhancedChars += text.length;
          }
        }
      }
      // Trim sliding window from front when total exceeds cap
      let total = this.recentConfirmedTexts.reduce((sum, t) => sum + t.length, 0);
      while (total > TranscriptEnhanceManager.RECENT_CONTEXT_MAX_CHARS && this.recentConfirmedTexts.length > 1) {
        total -= this.recentConfirmedTexts.shift()!.length;
      }

      if (this.onEnhanced) {
        this.onEnhanced(result.segments);
      }

      // Check if we should trigger term discovery (async, non-blocking)
      this.maybeRunTermDiscovery();

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

  /** Merge user-provided contextHint with auto-discovered terms */
  private getMergedContextHint(): string {
    const parts: string[] = [];
    if (this.config.contextHint?.trim()) {
      parts.push(this.config.contextHint.trim());
    }
    if (this.discoveredTermsHint?.trim()) {
      parts.push(this.discoveredTermsHint.trim());
    }
    return parts.join('\n\n');
  }

  /** Check if conditions are met for term discovery and trigger it */
  private maybeRunTermDiscovery(): void {
    if (this.termDiscoveryInFlight) return;

    const elapsed = Date.now() - this.recordingStartTime;
    const chars = this.allEnhancedChars;

    // First discovery: need MIN_TIME + MIN_CHARS
    if (!this.termDiscoveryDone) {
      if (
        elapsed >= TranscriptEnhanceManager.TERM_DISCOVERY_MIN_TIME_MS &&
        chars >= TranscriptEnhanceManager.TERM_DISCOVERY_MIN_CHARS
      ) {
        void this.runTermDiscovery();
      }
      return;
    }

    // Refresh: need REFRESH_MS since last discovery AND REFRESH_CHARS of new text
    const timeSinceLast = Date.now() - this.lastTermDiscoveryTime;
    const charsSinceLast = chars - this.lastTermDiscoveryChars;

    if (
      timeSinceLast >= TranscriptEnhanceManager.TERM_DISCOVERY_REFRESH_MS &&
      charsSinceLast >= TranscriptEnhanceManager.TERM_DISCOVERY_REFRESH_CHARS
    ) {
      void this.runTermDiscovery();
    }
  }

  /** Call /api/extract-terms with enhanced transcript to discover term variant mappings */
  private async runTermDiscovery(): Promise<void> {
    this.termDiscoveryInFlight = true;

    try {
      // Use full enhanced text so early variants are not missed.
      // Cap at 6000 chars to stay within LLM context limits.
      const fullText = this.allEnhancedTexts.join(' ');
      const sample = fullText.length > 6000
        ? fullText.slice(fullText.length - 6000)
        : fullText;

      const response = await fetch('/api/extract-terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: this.config.contextHint || undefined,
          recentTranscript: sample,
        }),
      });

      if (!response.ok) {
        console.warn('[TermDiscovery] API returned', response.status);
        return;
      }

      const data = await response.json();
      if (data.success && data.contextHint) {
        this.discoveredTermsHint = data.contextHint;

        // Build deterministic lexicon entries from discovered term→variant mappings.
        // These feed into applyLexiconLayer for 100% reliable replacement
        // of known ASR variants in subsequent batches.
        if (Array.isArray(data.terms) && data.terms.length > 0) {
          const lexicon: typeof this.discoveredLexiconTerms = [];
          for (const t of data.terms) {
            if (!t.term || !Array.isArray(t.phonetic_variants) || t.phonetic_variants.length === 0) continue;
            // Each variant becomes a lexicon entry mapping to the canonical term
            for (const variant of t.phonetic_variants) {
              if (!variant || typeof variant !== 'string') continue;
              const trimmed = variant.trim();
              if (!trimmed || trimmed === t.term) continue;
              lexicon.push({
                term: trimmed,
                canonical: t.term,
                aliases: [],
                scope: 'classroom',
                status: 'active',
              });
            }
          }
          this.discoveredLexiconTerms = lexicon;
        }

        // Notify parent (e.g., to update ASR context)
        if (this.onTermsDiscovered) {
          this.onTermsDiscovered(data.contextHint);
        }
      }

      this.termDiscoveryDone = true;
      this.lastTermDiscoveryTime = Date.now();
      this.lastTermDiscoveryChars = this.allEnhancedChars;
    } catch (err) {
      console.warn('[TermDiscovery] Failed:', err);
    } finally {
      this.termDiscoveryInFlight = false;
    }
  }

  dispose(): void {
    this.stopSilenceCheck();
    this.pendingSegments = [];
    this.enhancedSegments.clear();
    this.recentConfirmedTexts = [];
    this.allEnhancedTexts = [];
    this.allEnhancedChars = 0;
    this.termDiscoveryDone = false;
    this.termDiscoveryInFlight = false;
    this.discoveredTermsHint = '';
    this.discoveredLexiconTerms = [];
  }
}

export default TranscriptEnhanceManager;
