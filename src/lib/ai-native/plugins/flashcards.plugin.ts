import type { TranscriptSegment } from '@/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';
import { buildPromptAnchorContext, buildPromptTranscriptContext } from '../prompt-context';

const KEYWORDS = ['闪卡', '记忆', '背诵', '复习卡', '知识卡', 'flashcard'];
const TARGET_CARD_COUNT = 10;

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

function includesKeyword(intent: string): boolean {
  return KEYWORDS.some((keyword) => intent.includes(keyword));
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function pickEvidenceSegments(transcript: TranscriptSegment[], count: number): TranscriptSegment[] {
  if (transcript.length <= count) return transcript;
  const picked: TranscriptSegment[] = [];
  const step = (transcript.length - 1) / Math.max(1, count - 1);
  for (let index = 0; index < count; index += 1) {
    picked.push(transcript[Math.round(index * step)]);
  }
  return picked;
}

function toTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
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

function fallbackDraft(segment: TranscriptSegment): FlashcardDraft {
  const cleaned = segment.text.replace(/\s+/g, ' ').trim();
  const stem = cleaned.length > 38 ? `${cleaned.slice(0, 38)}...` : cleaned;
  return {
    question: `请复述并解释：${stem}`,
    answer: cleaned || '请回放该片段并完成复述。',
    hint: '先说定义，再说课堂例子，最后说应用场景。',
    startMs: segment.startMs,
    endMs: segment.endMs,
    difficulty: 'core',
  };
}

async function generateDeckWithLLM(
  context: AppExecutionContext,
  model: string,
  transcriptContext: string,
  anchorContext: string
): Promise<FlashcardLLMOutput | null> {
  const response = await chat(
    [
      {
        role: 'system',
        content:
          '你是一位认知科学学习教练。请把课堂内容设计成真正能促进理解和迁移的主动回忆闪卡。严格基于课堂证据，输出纯 JSON。',
      },
      {
        role: 'user',
        content: `学习目标：${context.goal.intent}
用户画像：刚完成一节课复习，需要通过主动回忆快速定位“懂了”和“没懂”。

请生成一组高质量闪卡。你可以自行决定题量、难度和组织方式，但要覆盖：核心概念、关键方法、易错点、迁移应用。

最小输出契约（仅字段约束）：
{
  "deckTitle": "闪卡标题",
  "overview": "训练建议",
  "cards": [
    {
      "question": "正面问题",
      "answer": "背面答案",
      "hint": "提示（可选）",
      "difficulty": "core|challenge（可选）",
      "startMs": 12000,
      "endMs": 21000
    }
  ]
}
说明：startMs/endMs 为可选证据定位字段，不确定可留空。

课堂原文：
${transcriptContext}

${anchorContext ? `学习者关注点：\n${anchorContext}` : ''}`,
      },
    ],
    model,
    { temperature: 0.3, maxTokens: 2200 }
  );

  return parseJsonResponse<FlashcardLLMOutput>(response.content);
}

function buildCards(
  tools: AppPluginTools,
  segments: TranscriptSegment[],
  llmOutput: FlashcardLLMOutput | null
): AppExecutionResult['cards'] {
  const cards: AppExecutionResult['cards'] = [];
  const overview =
    llmOutput?.overview?.trim() || tools.summarizeSegments(segments.slice(0, 2), 180) || '先做主动回忆，再查看答案与证据。';

  cards.push({
    id: 'flashcards-overview',
    type: 'insight',
    title: llmOutput?.deckTitle?.trim() || '课堂闪卡组',
    body: overview,
    priority: 'high',
  });

  const draftCards =
    Array.isArray(llmOutput?.cards) && llmOutput.cards.length > 0
      ? llmOutput.cards.slice(0, TARGET_CARD_COUNT)
      : segments.map((segment) => fallbackDraft(segment));

  draftCards.forEach((draftCard, index) => {
    const segment = segments[index % Math.max(1, segments.length)] || segments[0];
    const taskId = `flashcard-task-${index + 1}`;
    const draft =
      draftCard?.question?.trim() && draftCard?.answer?.trim()
        ? draftCard
        : fallbackDraft(
            segment || {
              id: `virtual-${index + 1}`,
              text: tools.summarizeSegments(segments, 120) || '请根据课堂内容完成复述。',
              startMs: 0,
              endMs: 8000,
              confidence: 1,
            }
          );

    const fallbackStart = segment?.startMs ?? 0;
    const fallbackEnd = segment?.endMs ?? fallbackStart + 8000;
    const startMs = toTimestamp(draft.startMs, fallbackStart);
    const endMs = toTimestamp(draft.endMs, fallbackEnd);
    const front = draft.question?.trim() || `请复述 ${formatTimestamp(segment.startMs)} 的核心内容`;
    const back = draft.answer?.trim() || segment.text.trim();
    const hint = draft.hint?.trim() || '回放证据后，先给结论再给依据。';

    cards.push({
      id: `flashcard-card-${index + 1}`,
      type: 'flashcard',
      title: `闪卡 ${index + 1}`,
      body: front,
      priority: index < 3 ? 'high' : 'medium',
      citations: [
        {
          startMs,
          endMs,
            snippet: segment.text.slice(0, 120),
        },
      ],
      actions: [
        {
          id: `seek-flashcard-${index + 1}`,
          label: `回放 ${formatTimestamp(startMs)}`,
          kind: 'seek',
          payload: { timestamp: startMs },
        },
        {
          id: `mark-flashcard-${index + 1}`,
          label: '标记掌握',
          kind: 'mark_done',
          payload: { taskId },
        },
      ],
      meta: {
        cardKind: 'flashcard',
        front,
        back,
        hint,
        difficulty: draft.difficulty || 'core',
      },
    });
  });

  return cards;
}

function buildTasks(segments: TranscriptSegment[]): AppExecutionResult['tasks'] {
  return segments.map((segment, index) => ({
    id: `flashcard-task-${index + 1}`,
    label: `完成闪卡 ${index + 1} 主动回忆`,
    reason: '先回忆再看答案，记忆保持时间更长。',
    estimatedMinutes: index < 3 ? 4 : 3,
    relatedTimestamp: segment.startMs,
  }));
}

export const flashcardsPlugin: AppPlugin = {
  manifest: {
    id: 'flashcards-lab',
    name: '闪卡训练',
    version: '0.1.0',
    description: '对齐 NotebookLM 的主动回忆体验，基于课堂证据生成可回放闪卡。',
    tags: ['student', 'flashcard', 'memory', 'active-recall'],
    capabilities: ['citation-card', 'seek-action', 'task-writeback'],
    enabledByDefault: true,
  },
  canHandle(context: AppExecutionContext): boolean {
    if (context.input.transcript.length === 0) return false;
    const intent = context.goal.intent.toLowerCase();
    return includesKeyword(intent) || context.goal.expectedOutput === 'cards';
  },
  async run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult> {
    const promptContext = buildPromptTranscriptContext(context.input.transcript, {
      maxChars: 22_000,
      includeIndex: true,
      includeTimestamp: false,
      minCharsPerSegment: 52,
    });
    const anchorContext = buildPromptAnchorContext(context.input.anchors, 12);
    const evidenceSegments = pickEvidenceSegments(
      context.input.transcript,
      Math.min(TARGET_CARD_COUNT, Math.max(4, Math.ceil(context.input.transcript.length / 3)))
    );
    const model = context.model || DEFAULT_MODEL_ID;

    let llmOutput: FlashcardLLMOutput | null = null;
    try {
      llmOutput = await generateDeckWithLLM(context, model, promptContext.text, anchorContext);
    } catch {
      llmOutput = null;
    }

    const cards = buildCards(tools, evidenceSegments, llmOutput);

    const deckCards = cards.filter((card) => card.meta?.cardKind === 'flashcard');

    return {
      pluginId: 'flashcards-lab',
      version: '0.1.0',
      model,
      trace: [
        `intent=${context.goal.intent}`,
        `model=${model}`,
        `transcript_segments=${context.input.transcript.length}`,
        `evidence_segments=${evidenceSegments.length}`,
        `prompt_segments=${promptContext.usedSegments}/${promptContext.totalSegments}`,
        `prompt_truncated=${promptContext.truncated ? 'yes' : 'no'}`,
        `llm=${llmOutput ? 'enabled' : 'fallback'}`,
      ],
      cards,
      tasks: buildTasks(deckCards.map((card, index) => ({
        id: card.id,
        text:
          typeof card.meta?.front === 'string'
            ? card.meta.front
            : typeof card.body === 'string'
              ? card.body
              : '',
        startMs: card.citations?.[0]?.startMs ?? evidenceSegments[index % evidenceSegments.length]?.startMs ?? 0,
        endMs: card.citations?.[0]?.endMs ?? evidenceSegments[index % evidenceSegments.length]?.endMs ?? 8000,
        confidence: 1,
      }))),
      render: {
        mode: 'flashcards',
        title: llmOutput?.deckTitle?.trim() || '课堂闪卡',
        description: llmOutput?.overview?.trim() || '先回忆再看答案，配合证据回放。',
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
      nextSuggestedPlugins: ['quiz-arena', 'knowledge-cards'],
      raw: {
        generatedAt: tools.now(),
      },
    };
  },
};
