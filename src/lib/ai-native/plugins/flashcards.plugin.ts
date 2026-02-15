import type { TranscriptSegment } from '@/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';

const KEYWORDS = ['闪卡', '记忆', '背诵', '复习卡', '知识卡', 'flashcard'];
const TARGET_CARD_COUNT = 8;

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

function buildEvidencePrompt(segments: TranscriptSegment[]): string {
  return segments
    .map((segment, index) => {
      const start = formatTimestamp(segment.startMs);
      const end = formatTimestamp(segment.endMs);
      return `片段${index + 1} [${start}-${end}] startMs=${segment.startMs} endMs=${segment.endMs}\n${segment.text}`;
    })
    .join('\n\n');
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
  segments: TranscriptSegment[]
): Promise<FlashcardLLMOutput | null> {
  const evidencePrompt = buildEvidencePrompt(segments);
  const response = await chat(
    [
      {
        role: 'system',
        content:
          '你是课堂闪卡教练。只能基于给定课堂片段生成闪卡，禁止编造未出现事实。仅输出 JSON，不要输出额外说明。',
      },
      {
        role: 'user',
        content: `学习目标：${context.goal.intent}
请生成 ${segments.length} 张闪卡，覆盖定义、方法、易错点和迁移应用。每张闪卡必须包含 question/answer/hint，并尽量填写 startMs/endMs。
JSON 输出格式：{
  "deckTitle": "闪卡标题",
  "overview": "使用建议，1句话",
  "cards": [
    {
      "question": "正面问题",
      "answer": "背面答案",
      "hint": "提示",
      "difficulty": "core 或 challenge",
      "startMs": 12000,
      "endMs": 21000
    }
  ]
}

课堂证据：${evidencePrompt}`,
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

  segments.forEach((segment, index) => {
    const taskId = `flashcard-task-${index + 1}`;
    const llmCard = llmOutput?.cards?.[index];
    const draft = llmCard?.question?.trim() && llmCard?.answer?.trim() ? llmCard : fallbackDraft(segment);

    const startMs = toTimestamp(draft.startMs, segment.startMs);
    const endMs = toTimestamp(draft.endMs, segment.endMs);
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
    const evidenceSegments = pickEvidenceSegments(
      context.input.transcript,
      Math.min(TARGET_CARD_COUNT, Math.max(4, Math.ceil(context.input.transcript.length / 3)))
    );
    const model = context.model || DEFAULT_MODEL_ID;

    let llmOutput: FlashcardLLMOutput | null = null;
    try {
      llmOutput = await generateDeckWithLLM(context, model, evidenceSegments);
    } catch {
      llmOutput = null;
    }

    const cards = buildCards(tools, evidenceSegments, llmOutput);

    return {
      pluginId: 'flashcards-lab',
      version: '0.1.0',
      model,
      trace: [
        `intent=${context.goal.intent}`,
        `model=${model}`,
        `transcript_segments=${context.input.transcript.length}`,
        `evidence_segments=${evidenceSegments.length}`,
        `llm=${llmOutput ? 'enabled' : 'fallback'}`,
      ],
      cards,
      tasks: buildTasks(evidenceSegments),
      render: {
        mode: 'flashcards',
        title: llmOutput?.deckTitle?.trim() || '课堂闪卡',
        description: llmOutput?.overview?.trim() || '先回忆再看答案，配合证据回放。',
        payload: {
          cards: cards
            .filter((card) => card.meta?.cardKind === 'flashcard')
            .map((card) => ({
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
