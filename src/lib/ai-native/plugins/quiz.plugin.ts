import type { TranscriptSegment } from '@/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';
import { buildPromptAnchorContext, buildPromptTranscriptContext, buildTerminologyHintBlock } from '../prompt-context';

const KEYWORDS = ['测验', '自测', 'quiz', '测试', '练习题', '题目'];
const TARGET_QUESTION_COUNT = 8;

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

function normalizeOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
    .slice(0, 6);
}

function fallbackDraft(segment: TranscriptSegment): QuizDraft {
  const text = segment.text.replace(/\s+/g, ' ').trim();
  const ts = formatTimestamp(segment.startMs);
  // 从原文中提取一个关键短语用于构造有辨识度的干扰项
  const phrases = text.split(/[，。；！？,.\s]+/).filter((p) => p.length >= 4 && p.length <= 20);
  const keyPhrase = phrases[0] || text.slice(0, 20);
  const altPhrase = phrases[1] || phrases[0] || text.slice(0, 15);

  return {
    stem: `关于 ${ts} 附近讲述的内容，以下哪种理解最准确？`,
    options: [
      `该片段主要讨论了"${keyPhrase}"相关内容`,
      `该片段的重点是对"${altPhrase}"的否定`,
      `该片段跳过了这个话题，没有展开说明`,
      `该片段仅做了简单引用，未做实质分析`,
    ],
    answer: 'A',
    explanation: `回放 ${ts} 附近的课堂录音可以确认，该片段确实围绕"${keyPhrase}"展开。建议重新听一遍加深理解。`,
    startMs: segment.startMs,
    endMs: segment.endMs,
  };
}

async function generateQuizWithLLM(
  context: AppExecutionContext,
  model: string,
  transcriptContext: string,
  anchorContext: string
): Promise<QuizLLMOutput | null> {
  const response = await chat(
    [
      {
        role: 'system',
        content: `你是一位经验丰富的命题研究员，擅长设计能区分"真懂"和"以为自己懂"的测试题。
你的学生刚上完一堂课，想检验自己是否真正理解了课堂内容。好的测验能暴露理解偏差，而不仅仅检测记忆。
严格基于课堂内容出题，输出纯 JSON，不要输出任何其他文字。`,
      },
      {
        role: 'user',
        content: `学习目标：${context.goal.intent}
${anchorContext ? `学习者关注点：\n${anchorContext}\n` : ''}
课堂原文：
${transcriptContext}

请基于以上课堂内容，设计一组高质量测验题。

渲染契约（前端解析用，请严格遵守此 JSON 结构）：
{
  "title": "测验标题",
  "questions": [
    {
      "stem": "题干文本",
      "options": ["A. 选项一", "B. 选项二", "C. 选项三", "D. 选项四"],
      "answer": "A",
      "explanation": "解析：为什么正确，以及常见的理解误区"
    }
  ]
}

字段说明：
- stem：题干
- options：选项数组（每题至少 2 个选项）
- answer：正确答案（选项字母或选项原文均可）
- explanation：解析
- 其他你认为有价值的字段可以自行添加（如 startMs/endMs 对应课堂时间戳）

题型、题量、难度分布由你根据课堂内容的复杂度和知识点分布自行判断。${buildTerminologyHintBlock(context.memory.terminologyHint)}`,
      },
    ],
    model,
    { temperature: 0.3, maxTokens: 8192, responseFormat: 'json_object' }
  );

  const parsed = parseJsonResponse<QuizLLMOutput>(response.content);
  if (!parsed) {
    console.error('[quiz-plugin] parseJsonResponse failed, first 500 chars:', response.content.slice(0, 500));
  }
  return parsed;
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

  const questionDrafts =
    Array.isArray(llmOutput?.questions) && llmOutput.questions.length > 0
      ? llmOutput.questions.slice(0, TARGET_QUESTION_COUNT)
      : segments.map((segment) => fallbackDraft(segment));

  questionDrafts.forEach((questionDraft, index) => {
    const segment = segments[index % Math.max(1, segments.length)] || segments[0];
    const draft = questionDraft?.stem?.trim() ? questionDraft : fallbackDraft(segment);
    const stem = draft.stem?.trim() || `请根据 ${formatTimestamp(segment.startMs)} 片段作答`;
    const options = normalizeOptions(draft.options);
    const normalizedOptions = options.length >= 2
      ? options
      : fallbackDraft(segment).options || ['A', 'B', 'C', 'D'];
    const answer = (draft.answer || 'A').trim();
    const explanation = draft.explanation?.trim() || tools.summarizeSegments([segment], 120) || '请回放原片段核对关键概念。';
    const fallbackStart = segment?.startMs ?? 0;
    const fallbackEnd = segment?.endMs ?? fallbackStart + 8000;
    const startMs = toTimestamp(draft.startMs, fallbackStart);
    const endMs = toTimestamp(draft.endMs, fallbackEnd);

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
    const promptContext = buildPromptTranscriptContext(context.input.transcript, {
      maxChars: 22_000,
      includeIndex: true,
      includeTimestamp: false,
      minCharsPerSegment: 52,
    });
    const anchorContext = buildPromptAnchorContext(context.input.anchors, 12);
    const evidenceSegments = pickEvidenceSegments(
      context.input.transcript,
      Math.min(TARGET_QUESTION_COUNT, Math.max(4, Math.ceil(context.input.transcript.length / 4)))
    );
    const model = context.model || DEFAULT_MODEL_ID;

    let llmOutput: QuizLLMOutput | null = null;
    try {
      llmOutput = await generateQuizWithLLM(context, model, promptContext.text, anchorContext);
      if (!llmOutput) {
        console.warn('[quiz-plugin] LLM returned null (JSON parse failed). model=', model, 'transcript_chars=', promptContext.text.length);
      } else if (!Array.isArray(llmOutput.questions) || llmOutput.questions.length === 0) {
        console.warn('[quiz-plugin] LLM returned empty questions. model=', model, 'raw keys=', Object.keys(llmOutput));
      } else {
      }
    } catch (err) {
      console.error('[quiz-plugin] generateQuizWithLLM failed:', err instanceof Error ? err.message : err);
      llmOutput = null;
    }

    const cards = buildCards(tools, evidenceSegments, llmOutput);

    const questionCards = cards.filter((card) => card.meta?.cardKind === 'quiz');

    return {
      pluginId: 'quiz-arena',
      version: '0.1.0',
      model,
      trace: [
        `intent=${context.goal.intent}`,
        `model=${model}`,
        `transcript_segments=${context.input.transcript.length}`,
        `questions=${evidenceSegments.length}`,
        `prompt_segments=${promptContext.usedSegments}/${promptContext.totalSegments}`,
        `prompt_truncated=${promptContext.truncated ? 'yes' : 'no'}`,
        `llm=${llmOutput ? 'enabled' : 'fallback'}`,
      ],
      cards,
      tasks: questionCards.map((card, index) => ({
        id: `quiz-task-${index + 1}`,
        label: `完成测验 ${index + 1}`,
        reason: '测后回看证据，能快速定位理解偏差。',
        estimatedMinutes: 4,
        relatedTimestamp: card.citations?.[0]?.startMs ?? evidenceSegments[index % evidenceSegments.length]?.startMs,
      })),
      render: {
        mode: 'quiz',
        title: llmOutput?.title?.trim() || '课堂测验',
        description: llmOutput?.strategy?.trim() || '先作答，再核对答案与证据。',
        payload: {
          questions: questionCards.map((card) => ({
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
