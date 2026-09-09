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

// 没有模板计划。之前模型失败会返回「把「X」真正弄懂，并能用自己的话说清楚」+ 三条通用
// checkpoint 当成"确认好的目标"——它会被写进用户的学习线程（LearningThreadEntry）成为
// 长期状态。目标是用户和模型一起定的；模型这次没理解好，就告诉用户再试一次。

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

/**
 * 模型输出 → 计划。字段缺失宁缺毋滥：标题缺就用用户自己那句话（那是用户的原话，不是编的），
 * outcome / checkpoints 缺就留空——不整包替换成模板。整个对象都不成立返回 null。
 */
export function sanitizeLearningIntentPlan(
  raw: unknown,
  query: string,
  allowQuestions = true,
): LearningIntentPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const title = compact(value.title, 64) || compact(query, 54);
  if (!title) return null;
  const approach = APPROACHES.has(value.approach as LearningIntentApproach)
    ? value.approach as LearningIntentApproach
    : 'understand';
  const contextFocus = CONTEXT_FOCUSES.has(value.contextFocus as LearningContextFocus)
    ? value.contextFocus as LearningContextFocus
    : 'mixed';
  const checkpoints = Array.isArray(value.checkpoints)
    ? value.checkpoints.map((item) => compact(item, 60)).filter(Boolean).slice(0, 3)
    : [];
  const confidence = value.confidence === 'high' || value.confidence === 'low'
    ? value.confidence
    : 'medium';
  const questions = allowQuestions ? sanitizeQuestions(value.questions) : [];
  return {
    title,
    outcome: compact(value.outcome, 160),
    approach,
    contextFocus,
    checkpoints,
    confidence,
    ...(questions.length > 0 ? { questions } : {}),
  };
}

export { buildLearningIntentSystemPrompt } from '@/lib/prompts/learning-understanding-prompts';

/** 模型一次重试后仍给不出可用计划 → 抛 INTENT_UNAVAILABLE，路由返回「再试一次」 */
export async function confirmLearningIntent(
  input: ConfirmLearningIntentInput,
): Promise<LearningIntentPlan> {
  const query = compact(input.query, 2_000);
  if (!query) throw new Error('INTENT_QUERY_REQUIRED');

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

  const controlled = await buildControlledLearningIntentPrompt(isFinalizing);
  const messages = [
    { role: 'system' as const, content: controlled.systemPrompt },
    {
      role: 'user' as const,
      content: buildLearningIntentUserPrompt({
        query,
        ...(learnerContext ? { learnerContext } : {}),
        ...(recentContext ? { recentContext } : {}),
        ...(activeContext ? { activeContext } : {}),
        answered,
      }),
    },
  ];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await chat(messages, controlled.modelId, {
        temperature: 0.25,
        maxTokens: 800,
        responseFormat: 'json_object',
      });
      const plan = sanitizeLearningIntentPlan(JSON.parse(response.content), query, !isFinalizing);
      if (plan) return plan;
      log.warn('intent confirmation returned no usable plan', { attempt: attempt + 1 });
    } catch (error) {
      log.warn('intent confirmation attempt failed', {
        attempt: attempt + 1,
        message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
      });
    }
  }
  throw new Error('INTENT_UNAVAILABLE');
}
