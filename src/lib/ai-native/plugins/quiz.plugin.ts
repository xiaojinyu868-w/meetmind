import type { TranscriptSegment } from '@/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';

const KEYWORDS = ['测验', '自测', 'quiz', '测试', '练习题', '题目'];
const TARGET_QUESTION_COUNT = 6;

interface QuizDraft {
  stem?: string;
  options?: string[];
  answer?: string;
  explanation?: string;
  startMs?: number | string;
  endMs?: number | string;
}

interface QuizLLMOutput {
  title?: string;
  strategy?: string;
  questions?: QuizDraft[];
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
    const numeric = Number(value.trim());
    if (Number.isFinite(numeric)) return Math.max(0, Math.floor(numeric));
  }
  return fallback;
}

function buildPrompt(segments: TranscriptSegment[]): string {
  return segments
    .map((segment, index) => {
      const start = formatTimestamp(segment.startMs);
      const end = formatTimestamp(segment.endMs);
      return `证据${index + 1} [${start}-${end}] startMs=${segment.startMs} endMs=${segment.endMs}\n${segment.text}`;
    })
    .join('\n\n');
}

function normalizeOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
    .slice(0, 4);
}

function fallbackDraft(segment: TranscriptSegment): QuizDraft {
  const summary = segment.text.replace(/\s+/g, ' ').trim();
  return {
    stem: `以下哪项最符合 ${formatTimestamp(segment.startMs)} 片段的核心内容？`,
    options: [
      summary.slice(0, 30) || '课堂核心概念',
      '与课堂无关的背景信息',
      '只需记结论不必理解过程',
      '跳过证据直接作答',
    ],
    answer: 'A',
    explanation: '正确选项直接对应课堂片段，其余选项与原文不一致。',
    startMs: segment.startMs,
    endMs: segment.endMs,
  };
}

async function generateQuizWithLLM(
  context: AppExecutionContext,
  model: string,
  segments: TranscriptSegment[]
): Promise<QuizLLMOutput | null> {
  const prompt = buildPrompt(segments);
  const response = await chat(
    [
      {
        role: 'system',
        content:
          '你是课堂测验设计助手。只能基于给定课堂证据出题，不允许编造。仅输出 JSON，不要输出额外解释。',
      },
      {
        role: 'user',
        content: `学习目标：${context.goal.intent}
请基于课堂证据生成 ${segments.length} 道单选题，每题 4 个选项，答案用 A/B/C/D。题目必须可由证据直接验证，并提供一句解析说明。
JSON 格式：{
  "title": "测验标题",
  "strategy": "建议先做题再看解析",
  "questions": [
    {
      "stem": "题干",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A",
      "explanation": "为什么 A 正确",
      "startMs": 12000,
      "endMs": 18000
    }
  ]
}

课堂证据：${prompt}`,
      },
    ],
    model,
    { temperature: 0.25, maxTokens: 2400 }
  );

  return parseJsonResponse<QuizLLMOutput>(response.content);
}

function buildCards(
  tools: AppPluginTools,
  segments: TranscriptSegment[],
  llmOutput: QuizLLMOutput | null
): AppExecutionResult['cards'] {
  const cards: AppExecutionResult['cards'] = [
    {
      id: 'quiz-overview',
      type: 'insight',
      title: llmOutput?.title?.trim() || '课堂自测',
      body: llmOutput?.strategy?.trim() || '先独立作答，再看答案与证据回放，最后做错因复盘。',
      priority: 'high',
    },
  ];

  segments.forEach((segment, index) => {
    const llmQuestion = llmOutput?.questions?.[index];
    const draft = llmQuestion?.stem?.trim() ? llmQuestion : fallbackDraft(segment);
    const stem = draft.stem?.trim() || `请根据 ${formatTimestamp(segment.startMs)} 片段作答`;
    const options = normalizeOptions(draft.options);
    const normalizedOptions = options.length === 4
      ? options
      : fallbackDraft(segment).options || ['A', 'B', 'C', 'D'];
    const answer = (draft.answer || 'A').trim().toUpperCase().slice(0, 1);
    const explanation = draft.explanation?.trim() || tools.summarizeSegments([segment], 120) || '请回放原片段核对关键概念。';
    const startMs = toTimestamp(draft.startMs, segment.startMs);
    const endMs = toTimestamp(draft.endMs, segment.endMs);

    cards.push({
      id: `quiz-card-${index + 1}`,
      type: 'quiz',
      title: `测验 ${index + 1}`,
      body: stem,
      priority: index < 2 ? 'high' : 'medium',
      citations: [
        {
          startMs,
          endMs,
          snippet: segment.text.slice(0, 120),
        },
      ],
      actions: [
        {
          id: `seek-quiz-${index + 1}`,
          label: `查看证据 ${formatTimestamp(startMs)}`,
          kind: 'seek',
          payload: { timestamp: startMs },
        },
      ],
      meta: {
        cardKind: 'quiz',
        stem,
        options: normalizedOptions,
        answer,
        explanation,
      },
    });
  });

  return cards;
}

export const quizPlugin: AppPlugin = {
  manifest: {
    id: 'quiz-arena',
    name: '测验工坊',
    version: '0.1.0',
    description: '对齐 NotebookLM 自测体验，自动生成带证据回放的课堂测验。',
    tags: ['student', 'quiz', 'assessment'],
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
      Math.min(TARGET_QUESTION_COUNT, Math.max(4, Math.ceil(context.input.transcript.length / 4)))
    );
    const model = context.model || DEFAULT_MODEL_ID;

    let llmOutput: QuizLLMOutput | null = null;
    try {
      llmOutput = await generateQuizWithLLM(context, model, evidenceSegments);
    } catch {
      llmOutput = null;
    }

    const cards = buildCards(tools, evidenceSegments, llmOutput);

    return {
      pluginId: 'quiz-arena',
      version: '0.1.0',
      model,
      trace: [
        `intent=${context.goal.intent}`,
        `model=${model}`,
        `transcript_segments=${context.input.transcript.length}`,
        `questions=${evidenceSegments.length}`,
        `llm=${llmOutput ? 'enabled' : 'fallback'}`,
      ],
      cards,
      tasks: evidenceSegments.map((segment, index) => ({
        id: `quiz-task-${index + 1}`,
        label: `完成测验 ${index + 1}`,
        reason: '测后回看证据，能快速定位理解偏差。',
        estimatedMinutes: 4,
        relatedTimestamp: segment.startMs,
      })),
      render: {
        mode: 'quiz',
        title: llmOutput?.title?.trim() || '课堂测验',
        description: llmOutput?.strategy?.trim() || '先作答，再核对答案与证据。',
        payload: {
          questions: cards
            .filter((card) => card.meta?.cardKind === 'quiz')
            .map((card) => ({
              id: card.id,
              title: card.title,
              stem: typeof card.meta?.stem === 'string' ? card.meta.stem : card.body,
              options: Array.isArray(card.meta?.options) ? card.meta.options : [],
              answer: typeof card.meta?.answer === 'string' ? card.meta.answer : 'A',
              explanation: typeof card.meta?.explanation === 'string' ? card.meta.explanation : '',
            })),
        },
      },
      nextSuggestedPlugins: ['flashcards-lab', 'review-plan'],
      raw: {
        generatedAt: tools.now(),
      },
    };
  },
};
