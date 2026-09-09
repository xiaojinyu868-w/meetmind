import type { TranscriptSegment } from '@/types';
import { formatLearnerContextForPrompt } from '@/lib/services/learner-context-service';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';
import { buildPromptAnchorContext, buildPromptTranscriptContext } from '../prompt-context';
import { resolveGroundedEvidence } from '../evidence-grounding';
import { buildFlashcardsSystemPrompt, buildFlashcardsUserPrompt } from '../app-prompts';

const TARGET_CARD_COUNT = 8;
/** 少于这个数就当这次没做出来：宁可诚实失败让人重试，也不用模板卡凑数 */
const MIN_CARD_COUNT = 2;
export const GENERATION_FAILED = 'GENERATION_FAILED';

interface FlashcardDraft {
  question?: string;
  answer?: string;
  hint?: string;
  startMs?: number | string;
  endMs?: number | string;
  difficulty?: 'core' | 'challenge' | string;
}

interface FlashcardLLMOutput {
  deckTitle?: string;
  overview?: string;
  cards?: FlashcardDraft[];
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function cleanText(value: string): string {
  return value
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isFillerOnly(value: string): boolean {
  const core = cleanText(value).replace(/[，。？！、,.!?：:；;'"""''()（）]/g, '').trim();
  if (!core) return true;
  return /^(嗯+|呃+|啊+|这个|那个|然后|就是|所以|好|行|对|是的?)$/i.test(core);
}


function toTimestamp(value: unknown, fallback: number, timelineEndMs = 0): number {
  const normalizeNumber = (raw: number): number => {
    const valueMs = Math.max(0, Math.floor(raw));
    // 模型偶尔把 startMs/endMs 返回为“秒”。当数字落在整节课秒数范围内时转回毫秒。
    const timelineEndSec = Math.ceil(timelineEndMs / 1000);
    if (timelineEndMs >= 1000 && valueMs > 0 && valueMs <= timelineEndSec + 2) return valueMs * 1000;
    return valueMs;
  };
  if (typeof value === 'number' && Number.isFinite(value)) return normalizeNumber(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) return normalizeNumber(parsed);
    }

    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (match) {
      const hour = match[3] ? Number(match[1]) : 0;
      const minute = match[3] ? Number(match[2]) : Number(match[1]);
      const second = match[3] ? Number(match[3]) : Number(match[2]);
      if ([hour, minute, second].every((item) => Number.isFinite(item) && item >= 0)) {
        return (hour * 3600 + minute * 60 + second) * 1000;
      }
    }
  }
  return fallback;
}

/**
 * 把闪卡重新落回真实原文。模型时间戳只能是候选，不能直接成为证据：
 * 先用题面+答案与原文做语义近似匹配，再用合法时间范围兜底。
 */
export function resolveFlashcardEvidenceSegment(
  draft: FlashcardDraft,
  segments: TranscriptSegment[],
  fallbackIndex = 0,
): TranscriptSegment | undefined {
  if (segments.length === 0) return undefined;
  const timelineEndMs = Math.max(...segments.map((segment) => segment.endMs ?? segment.startMs ?? 0));
  const candidateStartMs = toTimestamp(draft.startMs, -1, timelineEndMs);
  return resolveGroundedEvidence(
    `${draft.question ?? ''} ${draft.answer ?? ''}`,
    segments,
    candidateStartMs,
  ).segment ?? segments[fallbackIndex % segments.length];
}

/**
 * 2026-09-09 起没有兜底卡。此前 LLM 失败或某卡"证据落地"不通过时会换成
 * "用一句话区分「…」和你之前学过的相关概念"这类模板卡——对学生是敷衍，对记忆是污染。
 * 现在：模型的卡就是卡；落地只决定要不要给"回到原话"的跳转；整副没做出来就抛 GENERATION_FAILED。
 */
function isUsableCard(draft: FlashcardDraft | undefined): draft is FlashcardDraft {
  const front = cleanText(draft?.question?.trim() || '');
  const back = cleanText(draft?.answer?.trim() || '');
  return Boolean(front && back && !isFillerOnly(front) && !isFillerOnly(back));
}

async function generateDeckWithLLM(
  context: AppExecutionContext,
  model: string,
  transcriptContext: string,
  anchorContext: string,
  systemPrompt: string,
): Promise<FlashcardLLMOutput | null> {
  // 提示词哲学：描述用户和目标，不描述路径。
  // 难度分级、卡片数量、措辞风格——交给模型自己判断。
  const response = await chat(
    [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: buildFlashcardsUserPrompt({
          goalIntent: context.goal.intent,
          transcriptContext,
          anchorContext,
          terminologyHint: context.memory.terminologyHint,
          learnerContext: formatLearnerContextForPrompt(context.learner),
        }),
      },
    ],
    model,
    { temperature: 0.4, maxTokens: 2400, responseFormat: 'json_object' }
  );

  return parseJsonResponse<FlashcardLLMOutput>(response.content);
}

function buildCards(
  transcript: TranscriptSegment[],
  llmOutput: FlashcardLLMOutput | null
): AppExecutionResult['cards'] {
  const drafts = (Array.isArray(llmOutput?.cards) ? llmOutput.cards : []).filter(isUsableCard).slice(0, TARGET_CARD_COUNT);
  if (drafts.length < MIN_CARD_COUNT) throw new Error(GENERATION_FAILED);

  const cards: AppExecutionResult['cards'] = [];
  cards.push({
    id: 'flashcards-overview',
    type: 'insight',
    title: cleanText(llmOutput?.deckTitle?.trim() || '') || '课堂闪卡组',
    body: cleanText(llmOutput?.overview?.trim() || '') || '先做主动回忆，再看答案与证据。',
    priority: 'high',
  });

  const timelineEndMs = Math.max(...transcript.map((segment) => segment.endMs ?? segment.startMs ?? 0), 0);
  drafts.forEach((draftCard, index) => {
    const front = cleanText(draftCard.question!.trim());
    const back = cleanText(draftCard.answer!.trim());
    // 证据落地只决定"回到原话"跳到哪、以及要不要给——在整份转录里找，不再否决模型的卡
    const grounding = resolveGroundedEvidence(`${front} ${back}`, transcript, toTimestamp(draftCard.startMs, -1, timelineEndMs));
    const segment = grounding.supported || grounding.method === 'timestamp' ? grounding.segment : undefined;
    const taskId = `flashcard-task-${index + 1}`;
    const startMs = segment?.startMs;
    const endMs = segment ? (segment.endMs ?? segment.startMs + 8000) : undefined;

    cards.push({
      id: `flashcard-card-${index + 1}`,
      type: 'flashcard',
      title: `闪卡 ${index + 1}`,
      body: front,
      priority: index < 3 ? 'high' : 'medium',
      ...(segment && typeof startMs === 'number' && typeof endMs === 'number'
        ? { citations: [{ startMs, endMs, snippet: cleanText(segment.text || '').slice(0, 120) }] }
        : {}),
      actions: [
        ...(segment && typeof startMs === 'number'
          ? [{ id: `seek-flashcard-${index + 1}`, label: `回放 ${formatTimestamp(startMs)}`, kind: 'seek' as const, payload: { timestamp: startMs } }]
          : []),
        { id: `mark-flashcard-${index + 1}`, label: '标记掌握', kind: 'mark_done' as const, payload: { taskId } },
      ],
      meta: {
        cardKind: 'flashcard',
        front,
        back,
        hint: cleanText(draftCard.hint?.trim() || ''),
        difficulty: draftCard.difficulty || 'core',
        evidence: grounding.supported ? 'text' : grounding.method === 'timestamp' ? 'timestamp' : 'none',
      },
    });
  });

  return cards;
}

function buildTasks(cards: AppExecutionResult['cards']): AppExecutionResult['tasks'] {
  const flashcards = cards.filter((card) => card.meta?.cardKind === 'flashcard');
  return flashcards.map((card, index) => ({
    id: `flashcard-task-${index + 1}`,
    label: `完成闪卡 ${index + 1} 主动回忆`,
    reason: '先回忆再看答案，记忆保持更稳固。',
    estimatedMinutes: index < 3 ? 4 : 3,
    relatedTimestamp: card.citations?.[0]?.startMs,
  }));
}

export const flashcardsPlugin: AppPlugin = {
  manifest: {
    id: 'flashcards-lab',
    name: '闪卡训练',
    version: '0.4.0',
    description: '基于课堂证据生成可回放的主动回忆闪卡，单卡可独立分享。',
    tags: ['student', 'flashcard', 'memory', 'active-recall', 'shareable'],
    capabilities: ['citation-card', 'seek-action', 'task-writeback'],
    enabledByDefault: true,
  },
  canHandle(context: AppExecutionContext): boolean {
    // Agent-native 姿态：不再用 KEYWORDS 关键词匹配"猜"用户意图。
    // 分派权完全交给上游——agent 的 tool-calling 决定调用 makeFlashcards，
    // 或前端显式传 appKey='flashcards'。此处只做结构性守卫。
    if (context.input.transcript.length === 0) return false;
    return context.goal.appKey === 'flashcards' || context.goal.expectedOutput === 'cards';
  },
  async run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult> {
    // 48000 字对齐 cheatsheet：长课不再被稀释成残句（8000 是 180s LLM 超时时代的遗留）。
    // 上下文 > 指令，但上下文也要给得有节制。
    const promptContext = buildPromptTranscriptContext(context.input.transcript, {
      maxChars: 48_000,
      includeIndex: true,
      includeTimestamp: true,
      minCharsPerSegment: 48,
    });
    const anchorContext = buildPromptAnchorContext(context.input.anchors, 12);
    const systemPrompt = context.runtimeControl?.systemPrompt || buildFlashcardsSystemPrompt();
    const model = context.runtimeControl?.modelId || context.model || DEFAULT_MODEL_ID;

    // 一次重试：JSON 没解出来 / 卡片为空多数是瞬时或格式问题；两次都不行才诚实失败
    let llmOutput: FlashcardLLMOutput | null = null;
    let attempts = 0;
    while (attempts < 2 && !(Array.isArray(llmOutput?.cards) && llmOutput.cards.some(isUsableCard))) {
      attempts += 1;
      try {
        llmOutput = await generateDeckWithLLM(context, model, promptContext.text, anchorContext, systemPrompt);
        if (!Array.isArray(llmOutput?.cards) || !llmOutput.cards.some(isUsableCard)) {
          console.warn('[flashcards-plugin] LLM returned no usable cards. attempt=', attempts, 'model=', model);
        }
      } catch (err) {
        console.error('[flashcards-plugin] generateDeckWithLLM failed: attempt=', attempts, err instanceof Error ? err.message : err);
        llmOutput = null;
      }
    }

    const cards = buildCards(context.input.transcript, llmOutput);
    const deckCards = cards.filter((card) => card.meta?.cardKind === 'flashcard');

    return {
      pluginId: 'flashcards-lab',
      version: '0.4.0',
      model,
      trace: [
        `intent=${context.goal.intent}`,
        `model=${model}`,
        `transcript_segments=${context.input.transcript.length}`,
        `cards=${deckCards.length}`,
        `prompt_segments=${promptContext.usedSegments}/${promptContext.totalSegments}`,
        `prompt_truncated=${promptContext.truncated ? 'yes' : 'no'}`,
        `llm_attempts=${attempts}`,
        `grounded=${deckCards.filter((card) => card.meta?.evidence === 'text').length}/${deckCards.length}`,
      ],
      cards,
      tasks: buildTasks(cards),
      render: {
        mode: 'flashcards',
        title: cleanText(llmOutput?.deckTitle?.trim() || '') || '课堂闪卡',
        description: cleanText(llmOutput?.overview?.trim() || '') || '先回忆再看答案，配合证据回放。',
        payload: {
          cards: deckCards.map((card) => ({
            id: card.id,
            title: card.title,
            front: typeof card.meta?.front === 'string' ? card.meta.front : card.body,
            back: typeof card.meta?.back === 'string' ? card.meta.back : '',
            hint: typeof card.meta?.hint === 'string' ? card.meta.hint : '',
          })),
        },
      },
      raw: {
        generatedAt: tools.now(),
      },
    };
  },
};
