import type { TranscriptSegment } from '@/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';
import { buildPromptAnchorContext, buildPromptTranscriptContext, buildTerminologyHintBlock } from '../prompt-context';

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
  const topic = summary.slice(0, 24) || '课堂核心概念';
  return {
    question: `请解释"${topic}"，并给出一个课堂中的应用例子。`,
    answer: cleanText(segment.text || '') || '请回放该证据并完成复述。',
    hint: '先说概念，再说方法，最后说应用。',
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
          '你是一位认知科学学习教练，擅长间隔重复和主动回忆技术。请把课堂内容转化为高质量主动回忆闪卡，帮助学生完成理解、复述和迁移。严格基于课堂证据，只输出 JSON。',
      },
      {
        role: 'user',
        content: `学习目标：${context.goal.intent}
用户画像：刚完成一节课复习，需要通过主动回忆快速定位"真懂/不懂"。

请生成一组高质量闪卡。卡片应涵盖三个难度层级：
- 基础层（core）：核心概念定义、关键术语，确保"知道是什么"
- 进阶层（challenge）：方法步骤、原理对比、易错点辨析，检验"理解为什么"
- 迁移层（transfer）：跨场景应用、变式问题、学科联系，考察"能用来做什么"

题量建议：6-12张，三个层级各覆盖至少1张。

最小输出契约（仅字段约束）：
{
  "deckTitle": "闪卡标题",
  "overview": "训练建议（一句话说明推荐的学习策略）",
  "cards": [
    {
      "question": "正面问题",
      "answer": "背面答案",
      "hint": "提示（可选）",
      "difficulty": "core|challenge|transfer",
      "startMs": 12000,
      "endMs": 21000
    }
  ]
}

few-shot 示例（仅供格式参考，内容应来自实际课堂）：
{
  "deckTitle": "机器学习基础概念闪卡",
  "overview": "建议先完成基础层，再逐步挑战进阶和迁移层。",
  "cards": [
    { "question": "什么是过拟合？用一句话定义。", "answer": "模型在训练集上表现好但在新数据上泛化差的现象，本质是学到了噪声而非规律。", "difficulty": "core", "startMs": 32000, "endMs": 45000 },
    { "question": "L1 正则化和 L2 正则化在权重收缩效果上有什么区别？", "answer": "L1 倾向产生稀疏权重（部分为0），实现特征选择；L2 倾向均匀缩小所有权重，不产生精确零值。", "hint": "想想它们的惩罚项形状", "difficulty": "challenge", "startMs": 120000, "endMs": 138000 },
    { "question": "如果你正在训练一个房价预测模型，发现验证集误差远大于训练集误差，你会采取哪些措施？", "answer": "1. 增加训练数据 2. 加入正则化(L1/L2/Dropout) 3. 降低模型复杂度 4. 使用早停法 5. 检查特征工程是否引入噪声", "difficulty": "transfer", "startMs": 200000, "endMs": 220000 }
  ]
}

质量要求：
- 题面必须具体可回答，避免模糊的"是什么"式提问（如"请解释X"→应改为"X和Y的关键区别是什么？"）
- 答案应简洁精准，一般2-4句话
- 避免"嗯/呃"等口头禅和时间戳表达
- 每张卡片应对应课堂中的具体知识点

课堂原文：
${transcriptContext}

${anchorContext ? `学习者关注点：\n${anchorContext}` : ''}${buildTerminologyHintBlock(context.memory.terminologyHint)}`,
      },
    ],
    model,
    { temperature: 0.3, maxTokens: 2800 }
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
    version: '0.3.0',
    description: '基于课堂证据生成可回放的主动回忆闪卡。',
    tags: ['student', 'flashcard', 'memory', 'active-recall'],
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
    const promptContext = buildPromptTranscriptContext(context.input.transcript, {
      maxChars: 24_000,
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
      version: '0.3.0',
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
      nextSuggestedPlugins: ['quiz-arena', 'knowledge-cards'],
      raw: {
        generatedAt: tools.now(),
      },
    };
  },
};
