import { chat } from '@/lib/services/llm-service';
import { createLogger } from '@/lib/logger';
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
  return value.slice(0, 3).flatMap((item, questionIndex) => {
    if (!item || typeof item !== 'object') return [];
    const question = item as Record<string, unknown>;
    const prompt = compact(question.prompt, 100);
    const seenOptionIds = new Set<string>();
    const options = Array.isArray(question.options)
      ? question.options.slice(0, 4).flatMap((option, optionIndex) => {
        if (typeof option === 'string') {
          const label = compact(option, 36);
          const id = `o${optionIndex + 1}`;
          if (!label || seenOptionIds.has(id)) return [];
          seenOptionIds.add(id);
          return [{ id, label }];
        }
        if (!option || typeof option !== 'object') return [];
        const optionValue = option as Record<string, unknown>;
        const label = compact(optionValue.label, 36);
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

export async function confirmLearningIntent(
  input: ConfirmLearningIntentInput,
): Promise<LearningIntentPlan> {
  const query = compact(input.query, 2_000);
  if (!query) return fallbackPlan(query);

  const context = [
    input.learnerContext ? `长期个人上下文：\n${compact(input.learnerContext, 2_500)}` : '',
    input.recentContext ? `最近学习现场：\n${compact(input.recentContext, 2_500)}` : '',
    input.activeContext ? `当前页面上下文：\n${compact(input.activeContext, 3_500)}` : '',
  ].filter(Boolean).join('\n\n');

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

  const system = `你负责在一次深度学习会话开始前，理解学生真正想完成什么。不要把用户的话机械改写，也不要擅自扩大目标。结合提供的个人、近期和当前上下文，生成一个可以直接开始执行的学习意图。

输出 JSON：
{
  "title": "一句自然的会话标题",
  "outcome": "这次结束时学生应该能做到什么",
  "approach": "understand|practice|synthesize|create",
  "contextFocus": "personal|current|mixed",
  "checkpoints": ["最多三个自然检查点"],
  "confidence": "high|medium|low",
  "questions": [{
    "id": "稳定的英文短 id",
    "prompt": "一个真正影响学习路径的问题",
    "kind": "single|multiple",
    "options": [{ "id": "稳定的英文短 id", "label": "自然、具体的选项" }]
  }]
}

规则：
- checkpoints 是模型接下来会做的事，不是给用户的任务清单。
- 能从用户原话或上下文判断的内容直接判断，不要再问。
- 只有答案会明显改变讲解深度、练习方式或最终产物时，才生成 questions。
- questions 最多 3 个，每题 2-4 个选项；优先单选，确实可并存才用多选。
- 不询问年级、身份等已经存在于个人上下文的信息。
${isFinalizing ? '- 用户已经回答过问题：吸收答案并返回最终计划，questions 必须为空数组。' : '- 意图已足够清楚时，questions 返回空数组。'}
仅输出 JSON。`;

  try {
    const response = await chat(
      [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `${context ? `${context}\n\n` : ''}用户这次说：\n${query}${answered.length > 0 ? `\n\n用户对关键问题的选择：\n${answered.join('\n')}` : ''}`,
        },
      ],
      undefined,
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
