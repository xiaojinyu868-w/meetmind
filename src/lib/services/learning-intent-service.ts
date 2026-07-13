import { chat } from '@/lib/services/llm-service';
import { createLogger } from '@/lib/logger';
import type {
  ConfirmLearningIntentInput,
  LearningContextFocus,
  LearningIntentApproach,
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

export function sanitizeLearningIntentPlan(raw: unknown, query: string): LearningIntentPlan {
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
  return {
    title: compact(value.title, 64) || fallback.title,
    outcome: compact(value.outcome, 160) || fallback.outcome,
    approach,
    contextFocus,
    checkpoints: checkpoints.length > 0 ? checkpoints : fallback.checkpoints,
    confidence,
    clarification: confidence === 'low' ? compact(value.clarification, 100) || undefined : undefined,
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

  const system = `你负责在一次深度学习会话开始前，理解学生真正想完成什么。不要把用户的话机械改写，也不要擅自扩大目标。结合提供的个人、近期和当前上下文，生成一个可让用户确认或修改的学习意图。

输出 JSON：
{
  "title": "一句自然的会话标题",
  "outcome": "这次结束时学生应该能做到什么",
  "approach": "understand|practice|synthesize|create",
  "contextFocus": "personal|current|mixed",
  "checkpoints": ["最多三个自然检查点"],
  "confidence": "high|medium|low",
  "clarification": "只有 confidence=low 且误解会明显改变方向时，写一个最小澄清问题"
}

checkpoints 是模型接下来会做的事，不是给用户的任务清单。仅输出 JSON。`;

  try {
    const response = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: `${context ? `${context}\n\n` : ''}用户这次说：\n${query}` },
      ],
      undefined,
      { temperature: 0.25, maxTokens: 800, responseFormat: 'json_object' },
    );
    return sanitizeLearningIntentPlan(JSON.parse(response.content), query);
  } catch (error) {
    log.warn('intent confirmation fallback', {
      message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    });
    return fallbackPlan(query);
  }
}
