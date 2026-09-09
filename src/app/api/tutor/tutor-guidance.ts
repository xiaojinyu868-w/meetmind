/**
 * Tutor 引导问题生成
 *
 * 职责：根据课堂上下文生成意图澄清选项，帮学生定位困惑点。
 * 只有模型一层（一次重试）。模型给不出可用的澄清题就返回 null，Tutor 正常回答、
 * 不弹澄清——之前这里有 180 行关键词规则题库（英语听力场景甚至硬编码了示例课里的
 * "Jane Bond"），学生看到的是一份和他这节课无关的问卷。
 */

import { chat, type ChatMessage } from '@/lib/services/llm-service';
import type { GuidanceOption, GuidanceQuestion } from '@/types/dify';
import { createLogger } from '@/lib/logger';

const log = createLogger('tutor-guidance');

// ── 类型 ──

export type GuidanceGenerationInput = {
  context: string;
  modelId: string;
  studentQuestion?: string;
  selectedOptionId?: string;
};

type GuidanceDraft = {
  id?: unknown;
  question?: unknown;
  hint?: unknown;
  options?: Array<{
    id?: unknown;
    text?: unknown;
    category?: unknown;
  }>;
};

const GUIDANCE_CATEGORIES: GuidanceOption['category'][] = [
  'concept',
  'procedure',
  'calculation',
  'comprehension',
  'application',
];

// ── 公共入口 ──

export async function generateGuidanceQuestion({
  context,
  modelId,
  studentQuestion,
  selectedOptionId,
}: GuidanceGenerationInput): Promise<GuidanceQuestion | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const llmQuestion = await generateLlmGuidanceQuestion({
        context,
        modelId,
        studentQuestion,
        selectedOptionId,
      });
      if (llmQuestion) return llmQuestion;
      log.warn('[Tutor API] guidance question unusable', { attempt: attempt + 1 });
    } catch (error) {
      log.warn('[Tutor API] guidance generation failed', {
        attempt: attempt + 1,
        message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
      });
    }
  }
  return null;
}

// ── LLM 生成 ──

async function generateLlmGuidanceQuestion({
  context,
  modelId,
  studentQuestion,
  selectedOptionId,
}: GuidanceGenerationInput): Promise<GuidanceQuestion | null> {
  const contextSnippet = buildGuidanceContextSnippet(context);
  const userSignal = (studentQuestion || '').trim();
  const isFollowup = Boolean(selectedOptionId || userSignal);

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `你是学习场景里的"意图澄清器"，你的任务不是回答问题，而是把学生当前模糊的诉求压缩成一个下一步最有价值的澄清问题。

请严格输出 JSON，不要输出 markdown，不要解释。

要求：
1. 只生成 1 个问题和 2-4 个可点击选项。
2. 问题必须自然、简短、像助教在继续追问，不要做成考试或问卷。
3. 选项必须短、明确、互相区分，适合做按钮，避免"其他""都可以"这类空话。
4. 如果已经有学生输入或已选方向，就继续往那个方向细化，不要重复第一轮分类。
5. 如果任务更像在选择讲解方式，就可以给"先讲直觉 / 先推公式 / 先看例子 / 先讲应用"这类选项。
6. category 只能是：concept、procedure、calculation、comprehension、application。

输出格式：
{
  "id": "guidance-xxx",
  "question": "一句追问",
  "hint": "可选，一句很短的提示",
  "options": [
    { "id": "opt-1", "text": "按钮文案", "category": "concept" }
  ]
}`,
    },
    {
      role: 'user',
      content: `【课堂上下文】
${contextSnippet}

【学生当前输入】
${userSignal || '（暂时还没有额外输入）'}

【当前阶段】
${isFollowup ? '继续细化，已经有学生方向或追问' : '第一轮澄清，先缩小问题范围'}

请输出最适合当前场景的一轮意图澄清题。`,
    },
  ];

  const response = await chat(messages, modelId, {
    temperature: 0.25,
    maxTokens: 480,
    responseFormat: 'json_object',
  });

  return normalizeGuidanceQuestion(parseJsonObject(response.content));
}

// ── 工具函数 ──

function buildGuidanceContextSnippet(context: string): string {
  const compact = context
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

  // 之前只给头 900 + 尾 1200 字：一节课中间讲了什么模型根本看不到，澄清题自然对不上。
  // 澄清题输出只有几百 token，输入多给一点是划算的。
  if (compact.length <= 9_000) return compact;
  return `${compact.slice(0, 4_000)}\n...\n${compact.slice(-5_000)}`;
}

function parseJsonObject(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const objectMatch = content.match(/\{[\s\S]*\}$/);
    if (!objectMatch) return null;
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }
}

function normalizeGuidanceQuestion(payload: unknown): GuidanceQuestion | null {
  if (!payload || typeof payload !== 'object') return null;

  const draft = payload as GuidanceDraft;
  const question = sanitizeGuidanceText(draft.question, 60);
  const hint = sanitizeGuidanceText(draft.hint, 48);
  const rawOptions = Array.isArray(draft.options) ? draft.options : [];

  const seenTexts = new Set<string>();
  const options = rawOptions
    .map((option, index) => {
      const text = sanitizeGuidanceText(option?.text, 28);
      if (!text) return null;

      const normalizedKey = text.toLowerCase();
      if (seenTexts.has(normalizedKey)) return null;
      seenTexts.add(normalizedKey);

      return {
        id: sanitizeGuidanceText(option?.id, 24) || `opt-${index + 1}`,
        text,
        category: normalizeGuidanceCategory(option?.category, text),
      } satisfies GuidanceOption;
    })
    .filter((option): option is GuidanceOption => Boolean(option))
    .slice(0, 4);

  if (!question || options.length < 2) return null;

  return {
    id: sanitizeGuidanceText(draft.id, 32) || 'guidance-clarify',
    question,
    type: 'single_choice',
    options,
    hint: hint || undefined,
  };
}

function sanitizeGuidanceText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  const normalized = value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^["'""'']+|["'""'']+$/g, '')
    .trim();

  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function normalizeGuidanceCategory(value: unknown, optionText: string): GuidanceOption['category'] {
  if (typeof value === 'string' && GUIDANCE_CATEGORIES.includes(value as GuidanceOption['category'])) {
    return value as GuidanceOption['category'];
  }

  if (/计算|代入|求值|算|公式/.test(optionText)) return 'calculation';
  if (/步骤|推导|过程|怎么做|拆开/.test(optionText)) return 'procedure';
  if (/应用|例子|场景|对比|未来|实际/.test(optionText)) return 'application';
  if (/听不清|读不懂|跟不上|框架|脉络|回顾/.test(optionText)) return 'comprehension';
  return 'concept';
}
