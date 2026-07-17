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

export function buildLearningIntentSystemPrompt(isFinalizing: boolean): string {
  return `你负责在一次深度学习会话开始前，理解学生这一次真正想完成什么。用户当前这句话定义目标边界；个人、近期和当前页面上下文只帮助理解与个性化，不能替用户把宽泛愿望静默收窄成历史里的具体目标，也不能擅自扩大目标。

当用户明确说“继续”“上次”“那篇”“这个”等指向已有上下文时，可以用上下文补全所指。除此之外，如果上下文提供了多个合理方向而用户尚未选择，把这些方向变成一个真正影响学习路径的选择题，不要替他选。

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
    "prompt": "一个真正影响学习路径、像同学自然问出口的短问题",
    "kind": "single|multiple",
    "options": [{ "id": "稳定的英文短 id", "label": "自然、具体的选项" }]
  }]
}

规则：
- checkpoints 是模型接下来会做的事，不是给用户的任务清单。
- 能从用户当前表达或其明确指向的上下文判断的内容直接判断，不要再问。
- confidence 仅供内部判断，不会展示给用户；只要没有必须由用户决定的歧义，就直接开始，并让教学过程自适应校准。
- 只有答案会明显改变讲解深度、练习方式或最终产物时，才生成 questions；默认只问信息量最高的一题。
- questions 通常最多 1 个；只有两个问题彼此独立、无法合并且都足以改变路径时才允许 2 个。每题 2-4 个选项；优先单选，确实可并存才用多选。
- 问题直接问本身，尽量不超过 22 个汉字；不要写“为了给你匹配 / 为了更好地帮助 / 请告诉我”之类的系统解释。
- 选项是用户一眼能扫完的具体方向，中文通常 4-14 字；不要在选项里塞括号、举例和第二层说明。
- 不要为了确认学习风格、年级、基础或目标是否“足够具体”而提问；能先用一个小解释或小练习动态判断，就直接开始。
- 不询问年级、身份等已经存在于个人上下文的信息。
${isFinalizing ? '- 用户已经回答过问题：吸收答案并返回最终计划，questions 必须为空数组。' : '- 意图已足够清楚时，questions 返回空数组。'}
仅输出 JSON。`;
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

  const system = buildLearningIntentSystemPrompt(isFinalizing);

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
