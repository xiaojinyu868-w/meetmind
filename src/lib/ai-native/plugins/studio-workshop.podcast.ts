/**
 * Podcast pipeline for studio-workshop plugin.
 *
 * Handles: podcast plan generation, text assembly, timestamp pollution detection,
 * round card building, and narration sanitisation.
 */
import type { TranscriptSegment } from '@/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat } from '@/lib/services/llm-service';
import type { VolcPodcastResult } from '@/lib/services/volc-podcast';
import type { AppExecutionContext, AppExecutionResult } from '../types';
import { buildPromptAnchorContext } from '../prompt-context';
import {
  buildAudioOverviewChapterEvidence,
  buildAudioOverviewNarrationCorpus,
  buildAudioOverviewSystemPrompt,
  buildAudioOverviewUserPrompt,
} from '../app-prompts';
import type { PodcastPlan } from './studio-workshop.types';
import { formatTimestamp } from './studio-workshop.types';

// ── Constants ──────────────────────────────────────────────────────

const PODCAST_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.VOLCENGINE_PODCAST_TIMEOUT_MS || '240000', 10);
  if (!Number.isFinite(raw)) return 240000;
  return Math.min(900000, Math.max(30000, raw));
})();

const PODCAST_TIMESTAMP_PATTERN = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
const PODCAST_META_PATTERN = /\b(startMs|endMs)\s*=\s*\d+\b/gi;
const PODCAST_SEGMENT_LABEL_PATTERN = /片段\s*\d+/g;
const PODCAST_CHINESE_TIMESTAMP_PATTERN =
  /(?:零|一|二|三|四|五|六|七|八|九|十|百|两|\d)+点(?:零|一|二|三|四|五|六|七|八|九|十|百|两|\d)+(?:分(?:零|一|二|三|四|五|六|七|八|九|十|百|两|\d)*秒?|秒)|(?:零|一|二|三|四|五|六|七|八|九|十|百|两|\d)+分(?:零|一|二|三|四|五|六|七|八|九|十|百|两|\d)+秒/g;

// ── Text cleaning ──────────────────────────────────────────────────

export function resolvePodcastTimeoutMs(inputChars: number): number {
  const adaptive = 60000 + Math.max(0, inputChars) * 20;
  return Math.min(900000, Math.max(PODCAST_TIMEOUT_MS, adaptive));
}

function stripPodcastMetaNoise(text: string): string {
  return text
    .replace(PODCAST_META_PATTERN, ' ')
    .replace(PODCAST_SEGMENT_LABEL_PATTERN, ' ')
    .replace(/\[(?:\d{1,2}:)?\d{1,2}:\d{2}\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countTimestampHints(text: string): number {
  const western = text.match(PODCAST_TIMESTAMP_PATTERN)?.length || 0;
  const chinese = text.match(PODCAST_CHINESE_TIMESTAMP_PATTERN)?.length || 0;
  return western + chinese;
}

export function sanitizePodcastNarration(text: string): string {
  const noiseRemoved = stripPodcastMetaNoise(text);
  if (!noiseRemoved) return '';
  if (countTimestampHints(noiseRemoved) < 1) return noiseRemoved;
  return noiseRemoved
    .replace(PODCAST_TIMESTAMP_PATTERN, ' ')
    .replace(PODCAST_CHINESE_TIMESTAMP_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Corpus & speaker normalisation ─────────────────────────────────

export function buildPodcastTranscriptCorpus(transcript: TranscriptSegment[], maxChars: number = 48_000): string {
  const merged = buildAudioOverviewNarrationCorpus(transcript, maxChars)
    .split('\n')
    .map((line) => sanitizePodcastNarration(line))
    .filter(Boolean)
    .join('\n');

  if (merged.length <= maxChars) return merged;
  // 与朗读语料一致：保留头 60% + 尾 40%，结尾高潮不能丢
  const headChars = Math.max(0, Math.floor((maxChars - 3) * 0.6));
  const tailChars = Math.max(0, maxChars - 3 - headChars);
  return `${merged.slice(0, headChars)}...${merged.slice(merged.length - tailChars)}`;
}

export function normalizePodcastSpeaker(raw: string | undefined, index: number, mapping: Map<string, string>): string {
  const normalized = raw?.trim() || '';
  if (!normalized) return index % 2 === 0 ? 'Host A' : 'Host B';
  if (mapping.has(normalized)) return mapping.get(normalized)!;
  if (/^zh[_-]/i.test(normalized) || /^voice[_-]/i.test(normalized) || normalized.includes('bigtts')) {
    const alias = mapping.size % 2 === 0 ? 'Host A' : 'Host B';
    mapping.set(normalized, alias);
    return alias;
  }
  return normalized;
}

function toPodcastScript(value: unknown, maxLines: number = 40): Array<{ speaker: string; text: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item && typeof item === 'object' ? (item as { speaker?: unknown; text?: unknown }) : null))
    .filter((item): item is { speaker?: unknown; text?: unknown } => item !== null)
    .map((item) => ({
      speaker: typeof item.speaker === 'string' ? item.speaker.trim() : '',
      text: typeof item.text === 'string' ? item.text.trim() : '',
    }))
    .filter((item) => item.speaker && item.text)
    .slice(0, maxLines);
}

// ── Pollution detection ────────────────────────────────────────────

export function hasTimestampPollution(rounds: VolcPodcastResult['rounds']): boolean {
  if (!Array.isArray(rounds) || rounds.length === 0) return false;
  let polluted = 0;
  rounds.forEach((round) => {
    const text = round.text?.trim() || '';
    if (!text) return;
    const hits = countTimestampHints(text);
    const hasMeta = PODCAST_META_PATTERN.test(text) || PODCAST_SEGMENT_LABEL_PATTERN.test(text);
    if (hits > 0 || hasMeta) polluted += 1;
    PODCAST_META_PATTERN.lastIndex = 0;
    PODCAST_SEGMENT_LABEL_PATTERN.lastIndex = 0;
  });
  return polluted >= Math.max(2, Math.ceil(rounds.length * 0.25));
}

// ── LLM plan generation ───────────────────────────────────────────

export async function generatePodcastPlan(
  context: AppExecutionContext,
  model: string,
  systemPrompt = buildAudioOverviewSystemPrompt(),
): Promise<PodcastPlan | null> {
  const corpus = buildPodcastTranscriptCorpus(context.input.transcript, 48_000);
  if (!corpus) return null;
  const chapterEvidenceContext = buildAudioOverviewChapterEvidence(context.input.transcript);
  const anchorHints = buildPromptAnchorContext(context.input.anchors, 10);

  const response = await chat(
    [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: buildAudioOverviewUserPrompt({
          goalIntent: context.goal.intent,
          narrationCorpus: corpus,
          chapterEvidenceContext,
          anchorContext: anchorHints,
          terminologyHint: context.memory.terminologyHint,
        }),
      },
    ],
    model,
    { temperature: 0.5, maxTokens: 2600, responseFormat: 'json_object' }
  );

  return parseJsonResponse<PodcastPlan>(response.content);
}

// ── Input text assembly ────────────────────────────────────────────

function extractScriptLines(cards: AppExecutionResult['cards']): Array<{ speaker: string; line: string }> {
  return cards
    .flatMap((card) => {
      const dialogue = Array.isArray(card.meta?.dialogue) ? card.meta.dialogue : [];
      return dialogue
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const speaker =
            typeof (item as { speaker?: unknown }).speaker === 'string'
              ? (item as { speaker: string }).speaker
              : '';
          const line =
            typeof (item as { line?: unknown }).line === 'string' ? (item as { line: string }).line : '';
          if (!speaker || !line) return null;
          return { speaker, line };
        })
        .filter((item): item is { speaker: string; line: string } => Boolean(item));
    })
    .slice(0, 60);
}

export { extractScriptLines };

export function buildPodcastInputText(
  context: AppExecutionContext,
  output: { summary?: string } | null,
  evidenceSegments: TranscriptSegment[],
  cards: AppExecutionResult['cards'],
  podcastPlan: PodcastPlan | null,
  strictNoTimestamp: boolean = false
): string {
  const planScript = toPodcastScript(podcastPlan?.script, 42);
  const speakerMap = new Map<string, string>();
  const cardScript = extractScriptLines(cards).map((line, index) => ({
    speaker: normalizePodcastSpeaker(line.speaker, index, speakerMap),
    text: sanitizePodcastNarration(line.line),
  }));
  const scriptSource = planScript.length > 0 ? planScript : cardScript;

  const scriptSection = scriptSource
    .map((line) => `${line.speaker}: ${sanitizePodcastNarration(line.text)}`)
    .filter(Boolean)
    .join('\n');

  const evidenceSeed = evidenceSegments
    .map((segment) => sanitizePodcastNarration(segment.text))
    .filter(Boolean)
    .slice(0, 10)
    .join('\n');
  // 这里的语料进语音合成输入（整体硬上限 12000 字，见函数末尾），不能用 LLM 侧的 48000 预算
  const corpus = buildPodcastTranscriptCorpus(context.input.transcript, 9000);

  const planSection = podcastPlan
    ? [
        podcastPlan.title ? `Title: ${sanitizePodcastNarration(podcastPlan.title)}` : '',
        podcastPlan.opening ? `Opening: ${sanitizePodcastNarration(podcastPlan.opening)}` : '',
        Array.isArray(podcastPlan.keyTakeaways) && podcastPlan.keyTakeaways.length > 0
          ? `Takeaways: ${podcastPlan.keyTakeaways.map((item) => sanitizePodcastNarration(item)).join(' ; ')}`
          : '',
        Array.isArray(podcastPlan.structure) && podcastPlan.structure.length > 0
          ? `Structure:\n${podcastPlan.structure
              .slice(0, 6)
              .map((item, index) => {
                const title = sanitizePodcastNarration(item.title || `Segment ${index + 1}`);
                const focus = sanitizePodcastNarration(item.focus || '');
                return `${index + 1}. ${title}${focus ? ` - ${focus}` : ''}`;
              })
              .join('\n')}`
          : '',
        podcastPlan.tone ? `Tone: ${sanitizePodcastNarration(podcastPlan.tone)}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const learnerProfile =
    podcastPlan?.learnerProfile?.trim() ||
    (context.input.metadata?.studentName ? `Student profile: ${context.input.metadata.studentName}` : 'Student profile: efficient review learner');

  const text = [
    'Task: produce an engaging two-host Chinese learning podcast script for speech synthesis.',
    `Topic: ${sanitizePodcastNarration(context.goal.intent)}`,
    `Audience: ${sanitizePodcastNarration(learnerProfile)}`,
    'Requirements:',
    '- Keep natural back-and-forth conversation, not monologue.',
    '- Focus on why it matters, how it works, and how to apply it.',
    '- Output language should be natural Simplified Chinese.',
    '- Never include timestamps, segment IDs, startMs/endMs.',
    strictNoTimestamp ? '- Strict correction: if any time expression appears, regenerate without any time mentions.' : '',
    planSection ? `Podcast plan:\n${planSection}` : '',
    scriptSection ? `Preferred script draft:\n${scriptSection}` : '',
    output?.summary ? `Summary:\n${sanitizePodcastNarration(output.summary)}` : '',
    evidenceSeed ? `Key evidence:\n${evidenceSeed}` : '',
    corpus ? `Full class evidence:\n${corpus}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim();

  return text.length <= 12000 ? text : text.slice(0, 12000);
}

// ── Round cards builder ────────────────────────────────────────────

export function buildPodcastRoundCards(
  rounds: VolcPodcastResult['rounds'],
  evidenceSegments: TranscriptSegment[]
): AppExecutionResult['cards'] {
  if (!Array.isArray(rounds) || rounds.length === 0) return [];
  const safeEvidence = evidenceSegments.length > 0 ? evidenceSegments : [];
  const speakerAliasMap = new Map<string, string>();

  return rounds
    .filter((round) => typeof round.text === 'string' && round.text.trim().length > 0)
    .slice(0, 20)
    .map((round, index) => {
      const fallback = safeEvidence[index % Math.max(1, safeEvidence.length)];
      const startMs = fallback?.startMs ?? 0;
      const endMs = fallback?.endMs ?? startMs + 8000;
      const speaker = normalizePodcastSpeaker(round.speaker, index, speakerAliasMap);
      const rawLine = round.text?.trim() || '';
      const line = sanitizePodcastNarration(rawLine) || rawLine;

      return {
        id: `studio-podcast-round-${index + 1}`,
        type: 'timeline',
        title: `Round ${index + 1} ? ${speaker}`,
        body: line,
        priority: index < 4 ? 'high' : 'medium',
        citations: fallback
          ? [
              {
                startMs,
                endMs,
                snippet: fallback.text.slice(0, 120),
              },
            ]
          : undefined,
        actions: [
          {
            id: `seek-podcast-round-${index + 1}`,
            label: `Seek ${formatTimestamp(startMs)}`,
            kind: 'seek',
            payload: { timestamp: startMs },
          },
        ],
        meta: {
          cardKind: 'script',
          dialogue: [{ speaker, line }],
        },
      };
    });
}
