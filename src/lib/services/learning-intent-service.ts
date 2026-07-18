import { chat } from '@/lib/services/llm-service';
import { createLogger } from '@/lib/logger';
import { buildLearningIntentUserPrompt } from '@/lib/prompts/learning-understanding-prompts';
import { buildControlledLearningIntentPrompt } from '@/lib/services/ai-control-service';
import type {
  ConfirmLearningIntentInput,
  LearningContextFocus,
  LearningIntentApproach,
  LearningIntentQuestion,
  LearningIntentPlan,
} from '@/types/learning-intent';

const log = createLogger('learning-intent');
const APPROACHES = new Set<LearningIntentApproach>(['understand', 'practice', 'synthesize', 'create']);
const CONTEXT_FOCUSES = new Set<LearningContextFocus>(['personal', 'current', 'mixed']);

function compact(value: unknown, max: number): string {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(1, max - 1))}…`;
}

function fallbackPlan(query: string): LearningIntentPlan {
  const topic = compact(query, 54) || '这件事';
  return {
    title: topic,
    outcome: `把「${topic}」真正弄懂，并能用自己的话说清楚。`,
    approach: 'understand',
    contextFocus: 'mixed',
    checkpoints: ['先确认已经知道什么', '找到真正卡住的地方', '用一次复述或练习验证'],
    confidence: 'medium',
  };
}

function sanitizeQuestions(value: unknown): LearningIntentQuestion[] {
  if (!Array.isArray(value)) return [];
  const seenQuestionIds = new Set<string>();
  return value.slice(0, 2).flatMap((item, questionIndex) => {
    if (!item || typeof item !== 'object') return [];
    const question = item as Record<string, unknown>;
    const prompt = compact(question.prompt, 64);
    const seenOptionIds = new Set<string>();
    const options = Array.isArray(question.options)
      ? question.options.slice(0, 4).flatMap((option, optionIndex) => {
        if (typeof option === 'string') {
          const label = compact(option, 24);
          const id = `o${optionIndex + 1}`;
          if (!label || seenOptionIds.has(id)) return [];
          seenOptionIds.add(id);
          return [{ id, label }];
        }
        if (!option || typeof option !== 'object') return [];
        const optionValue = option as Record<string, unknown>;
        const label = compact(optionValue.label, 24);
        if (!label) return [];
        const id = compact(optionValue.id, 24) || `o${optionIndex + 1}`;
        if (seenOptionIds.has(id)) return [];
        seenOptionIds.add(id);
        return [{ id, label }];
      })
      : [];
    if (!prompt || options.length < 2) return [];
    const id = compact(question.id, 24) || `q${questionIndex + 1}`;
    if (seenQuestionIds.has(id)) return [];
    seenQuestionIds.add(id);
    return [{
      id,
      prompt,
      kind: question.kind === 'multiple' ? 'multiple' as const : 'single' as const,
      options,
    }];
  });
}

export function sanitizeLearningIntentPlan(
  raw: unknown,
  query: string,
  allowQuestions = true,
): LearningIntentPlan {
  const fallback = fallbackPlan(query);
  if (!raw || typeof raw !== 'object') return fallback;
  const value = raw as Record<string, unknown>;
  const approach = APPROACHES.has(value.approach as LearningIntentApproach)
    ? value.approach as LearningIntentApproach
    : fallback.approach;
  const contextFocus = CONTEXT_FOCUSES.has(value.contextFocus as LearningContextFocus)
    ? value.contextFocus as LearningContextFocus
    : fallback.contextFocus;
  const checkpoints = Array.isArray(value.checkpoints)
    ? value.checkpoints.map((item) => compact(item, 60)).filter(Boolean).slice(0, 3)
    : [];
  const confidence = value.confidence === 'high' || value.confidence === 'low'
    ? value.confidence
    : 'medium';
  const questions = allowQuestions ? sanitizeQuestions(value.questions) : [];
  return {
    title: compact(value.title, 64) || fallback.title,
    outcome: compact(value.outcome, 160) || fallback.outcome,
    approach,
    contextFocus,
    checkpoints: checkpoints.length > 0 ? checkpoints : fallback.checkpoints,
    confidence,
    ...(questions.length > 0 ? { questions } : {}),
  };
}

export { buildLearningIntentSystemPrompt } from '@/lib/prompts/learning-understanding-prompts';

export async function confirmLearningIntent(
  input: ConfirmLearningIntentInput,
): Promise<LearningIntentPlan> {
  const query = compact(input.query, 2_000);
  if (!query) return fallbackPlan(query);

  const learnerContext = compact(input.learnerContext, 2_500);
  const recentContext = compact(input.recentContext, 2_500);
  const activeContext = compact(input.activeContext, 3_500);

  const answered = input.answers?.flatMap((answer) => {
    const questionId = compact(answer.questionId, 24);
    const question = compact(answer.question, 100);
    const optionIds = answer.optionIds.map((optionId) => compact(optionId, 24)).filter(Boolean).slice(0, 4);
    const optionLabels = answer.optionLabels.map((label) => compact(label, 36)).filter(Boolean).slice(0, 4);
    return questionId && question && optionIds.length > 0 && optionLabels.length > 0
      ? [`${questionId}｜${question}：${optionLabels.join('、')} (${optionIds.join(', ')})`]
      : [];
  }).slice(0, 3) ?? [];
  const isFinalizing = answered.length > 0;

  try {
    const controlled = await buildControlledLearningIntentPrompt(isFinalizing);
    const response = await chat(
      [
        { role: 'system', content: controlled.systemPrompt },
        {
          role: 'user',
          content: buildLearningIntentUserPrompt({
            query,
            ...(learnerContext ? { learnerContext } : {}),
            ...(recentContext ? { recentContext } : {}),
            ...(activeContext ? { activeContext } : {}),
            answered,
          }),
        },
      ],
      controlled.modelId,
      { temperature: 0.25, maxTokens: 800, responseFormat: 'json_object' },
    );
    return sanitizeLearningIntentPlan(JSON.parse(response.content), query, !isFinalizing);
  } catch (error) {
    log.warn('intent confirmation fallback', {
      message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    });
    return fallbackPlan(query);
  }
}
