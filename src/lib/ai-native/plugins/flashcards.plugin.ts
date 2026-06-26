import type { TranscriptSegment } from '@/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';
import { buildPromptAnchorContext, buildPromptTranscriptContext, buildTerminologyHintBlock } from '../prompt-context';

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

function pickEvidenceSegments(transcript: TranscriptSegment[], count: number): TranscriptSegment[] {
  const source = transcript.filter((segment) => cleanText(segment.text || '').length > 0);
  if (source.length === 0) return transcript.slice(0, count);
  if (source.length <= count) return source;
  const picked: TranscriptSegment[] = [];
  const step = (source.length - 1) / Math.max(1, count - 1);
  for (let index = 0; index < count; index += 1) {
    picked.push(source[Math.round(index * step)]);
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

function fallbackDraft(segment: TranscriptSegment, tools: AppPluginTools): FlashcardDraft {
  const summary = cleanText(tools.summarizeSegments([segment], 88) || segment.text || '');
  // 优先用术语+对比的方式构造题面，避免"请解释 X"那种空白式提问
  const topic = summary.slice(0, 24) || '本课核心概念';
  return {
    question: `用一句话区分"${topic}"和你之前学过的相关概念。`,
    answer: cleanText(segment.text || '') || '请回放该证据并完成复述。',
    hint: '先说定义差异，再说应用差异。',
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
  // 提示词哲学：描述用户和目标，不描述路径。
  // 难度分级、卡片数量、措辞风格——交给模型自己判断。
  const response = await chat(
    [
      {
        role: 'system',
        content:
          '你是一位深谙认知科学和间隔重复理论的学习教练。学生刚上完一节课，需要通过主动回忆来真正记住核心知识，而不仅仅是机械背诵。把这节课的内容转化为一组让他"看到题就能在脑子里把答案重建出来"的闪卡。',
      },
      {
        role: 'user',
        content: `${context.goal.intent ? `他的学习目标：${context.goal.intent}\n\n` : ''}${anchorContext ? `他听课时的困惑点（这些地方更容易出问题，值得多覆盖）：\n${anchorContext}\n\n` : ''}课堂原文：
${transcriptContext}

输出 JSON：
{
  "deckTitle": string,
  "overview": string,
  "cards": [
    { "question": string, "answer": string, "startMs": number, "endMs": number, "hint"?: string, "difficulty"?: "core"|"challenge"|"transfer" }
  ]
}

只输出 JSON，不解释。${buildTerminologyHintBlock(context.memory.terminologyHint)}`,
      },
    ],
    model,
    { temperature: 0.4, maxTokens: 2400 }
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
    cleanText(llmOutput?.overview?.trim() || '') ||
    cleanText(tools.summarizeSegments(segments.slice(0, 2), 180) || '') ||
    '先做主动回忆，再看答案与证据。';

  cards.push({
    id: 'flashcards-overview',
    type: 'insight',
    title: cleanText(llmOutput?.deckTitle?.trim() || '') || '课堂闪卡组',
    body: overview,
    priority: 'high',
  });

  const draftCards =
    Array.isArray(llmOutput?.cards) && llmOutput.cards.length > 0
      ? llmOutput.cards.slice(0, TARGET_CARD_COUNT)
      : segments.map((segment) => fallbackDraft(segment, tools));

  draftCards.forEach((draftCard, index) => {
    const segment =
      segments[index % Math.max(1, segments.length)] ||
      ({
        id: `virtual-${index + 1}`,
        text: tools.summarizeSegments(segments, 120) || '请根据课堂内容完成复述。',
        startMs: 0,
        endMs: 8000,
        confidence: 1,
      } as TranscriptSegment);
    const taskId = `flashcard-task-${index + 1}`;
    const base = fallbackDraft(segment, tools);
    const front = cleanText(draftCard?.question?.trim() || '');
    const back = cleanText(draftCard?.answer?.trim() || '');
    const useFallback = !front || !back || isFillerOnly(front) || isFillerOnly(back);

    const finalFront = useFallback ? cleanText(base.question || '') : front;
    const finalBack = useFallback ? cleanText(base.answer || '') : back;
    const finalHint = cleanText(draftCard?.hint?.trim() || '') || cleanText(base.hint || '');

    const fallbackStart = segment.startMs ?? 0;
    const fallbackEnd = segment.endMs ?? fallbackStart + 8000;
    const startMs = toTimestamp(draftCard?.startMs, fallbackStart);
    const endMs = toTimestamp(draftCard?.endMs, fallbackEnd);

    cards.push({
      id: `flashcard-card-${index + 1}`,
      type: 'flashcard',
      title: `闪卡 ${index + 1}`,
      body: finalFront || `请复述 ${formatTimestamp(startMs)} 的核心内容`,
      priority: index < 3 ? 'high' : 'medium',
      citations: [
        {
          startMs,
          endMs,
          snippet: cleanText(segment.text || '').slice(0, 120),
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
        front: finalFront,
        back: finalBack,
        hint: finalHint,
        difficulty: draftCard?.difficulty || base.difficulty || 'core',
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
    relatedTimestamp: card.citations?.[0]?.startMs ?? 0,
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
    // 8000 字 ≈ 12-16k input tokens ≈ 15-20 分钟课堂内容。
    // 长课时 prompt 会让 step-3.7-flash 等高速模型在 prefill 阶段就吃满 100s+，
    // 加上 JSON 输出 ~1500 tokens，整体撞 180s 服务端超时。
    // 上下文 > 指令，但上下文也要给得有节制。
    const promptContext = buildPromptTranscriptContext(context.input.transcript, {
      maxChars: 8_000,
      includeIndex: true,
      includeTimestamp: false,
      minCharsPerSegment: 48,
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
      version: '0.4.0',
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
