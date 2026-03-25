/**
 * Tutor 引导问题生成
 *
 * 职责：根据课堂上下文生成意图澄清选项，帮学生定位困惑点。
 * 两层策略：LLM 生成（主）→ 规则回退（备）。
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
}: GuidanceGenerationInput): Promise<GuidanceQuestion> {
  try {
    const llmQuestion = await generateLlmGuidanceQuestion({
      context,
      modelId,
      studentQuestion,
      selectedOptionId,
    });

    if (llmQuestion) {
      return llmQuestion;
    }
  } catch (error) {
    log.error('[Tutor API] Guidance generation fallback:', error);
  }

  return generateRuleBasedGuidanceQuestion(context, studentQuestion);
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

  if (compact.length <= 2200) return compact;
  return `${compact.slice(0, 900)}\n...\n${compact.slice(-1200)}`;
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

// ── 规则回退 ──

function generateRuleBasedGuidanceQuestion(context: string, studentQuestion?: string): GuidanceQuestion {
  const lines = context.split('\n').filter((l) => l.trim());

  const contentParts: Array<{ time: string; text: string }> = [];
  for (const line of lines) {
    const match = line.match(/\[(\d{1,2}:\d{2}-\d{1,2}:\d{2})\]\s*(.+)/);
    if (match) {
      contentParts.push({ time: match[1], text: match[2] });
    }
  }

  const fullText = contentParts.map((p) => p.text).join(' ').toLowerCase();

  // 场景1：英语听力/口语场景
  if (
    fullText.includes('name') ||
    fullText.includes('bond') ||
    fullText.includes('jane') ||
    fullText.includes('hello') ||
    fullText.includes('nice to meet')
  ) {
    return {
      id: 'guidance-english-name',
      question: '听到这段对话时，你是在哪个环节感到困惑的？',
      type: 'single_choice',
      options: [
        { id: 'opt-1', text: '不理解为什么名字会重复说两遍（如 "Jane, Jane Bond"）', category: 'comprehension' },
        { id: 'opt-2', text: '分不清昵称（first name）和全名（full name）的区别', category: 'concept' },
        { id: 'opt-3', text: '听不清具体发音，不确定说的是什么词', category: 'comprehension' },
        { id: 'opt-4', text: '不理解这种自我介绍的文化背景或语法结构', category: 'application' },
      ],
      hint: '选择最接近你困惑的选项，帮助我精准定位问题',
    };
  }

  // 场景2：数学公式场景
  if (
    fullText.includes('公式') ||
    fullText.includes('=') ||
    fullText.includes('²') ||
    fullText.includes('函数') ||
    fullText.includes('方程')
  ) {
    return {
      id: 'guidance-math-formula',
      question: '关于这个数学内容，你具体卡在哪个环节？',
      type: 'single_choice',
      options: [
        { id: 'opt-1', text: '不理解公式中字母/符号的含义', category: 'concept' },
        { id: 'opt-2', text: '不知道这个公式是怎么推导出来的', category: 'procedure' },
        { id: 'opt-3', text: '公式我懂，但不知道什么情况下该用它', category: 'application' },
        { id: 'opt-4', text: '代入计算时总是出错', category: 'calculation' },
      ],
      hint: '选择最接近你困惑的选项',
    };
  }

  // 场景3：图像/图形场景
  if (
    fullText.includes('图像') ||
    fullText.includes('图形') ||
    fullText.includes('抛物线') ||
    fullText.includes('开口') ||
    fullText.includes('坐标')
  ) {
    return {
      id: 'guidance-graph',
      question: '关于图像这部分，你是在哪里卡住了？',
      type: 'single_choice',
      options: [
        { id: 'opt-1', text: '不理解图像和公式之间的对应关系', category: 'concept' },
        { id: 'opt-2', text: '不知道怎么根据条件画出图像', category: 'procedure' },
        { id: 'opt-3', text: '看不懂图像上各个点/线的意义', category: 'comprehension' },
        { id: 'opt-4', text: '不理解参数变化对图像的影响', category: 'concept' },
      ],
      hint: '选择最接近你困惑的选项',
    };
  }

  // 场景4：物理/化学实验场景
  if (
    fullText.includes('实验') ||
    fullText.includes('反应') ||
    fullText.includes('现象') ||
    fullText.includes('能量') ||
    fullText.includes('力')
  ) {
    return {
      id: 'guidance-experiment',
      question: '关于这个知识点，你具体在哪里感到困惑？',
      type: 'single_choice',
      options: [
        { id: 'opt-1', text: '不理解基本概念或原理', category: 'concept' },
        { id: 'opt-2', text: '不知道实验步骤或操作方法', category: 'procedure' },
        { id: 'opt-3', text: '不理解为什么会出现这种现象', category: 'comprehension' },
        { id: 'opt-4', text: '不知道这个知识点在实际中怎么应用', category: 'application' },
      ],
      hint: '选择最接近你困惑的选项',
    };
  }

  // 场景5：阅读理解/语文场景
  if (
    fullText.includes('文章') ||
    fullText.includes('作者') ||
    fullText.includes('意思') ||
    fullText.includes('表达') ||
    fullText.includes('理解')
  ) {
    return {
      id: 'guidance-reading',
      question: '关于这段内容，你是在哪个层面感到困惑？',
      type: 'single_choice',
      options: [
        { id: 'opt-1', text: '有些词语/句子看不懂', category: 'comprehension' },
        { id: 'opt-2', text: '不理解作者想表达的意思', category: 'concept' },
        { id: 'opt-3', text: '不知道怎么分析文章结构', category: 'procedure' },
        { id: 'opt-4', text: '不会用自己的话总结/复述', category: 'application' },
      ],
      hint: '选择最接近你困惑的选项',
    };
  }

  if (studentQuestion?.trim()) {
    return {
      id: 'guidance-followup-default',
      question: '你更希望我顺着哪个角度继续帮你？',
      type: 'single_choice',
      options: [
        { id: 'opt-1', text: '先把核心概念讲透', category: 'concept' },
        { id: 'opt-2', text: '先按步骤带我推一遍', category: 'procedure' },
        { id: 'opt-3', text: '先用例子或应用解释', category: 'application' },
      ],
      hint: '选一个最接近你想继续展开的方向',
    };
  }

  // 默认场景：通用引导问题
  const keywords = extractKeywords(fullText);
  const keywordHint = keywords.length > 0 ? `（涉及：${keywords.slice(0, 3).join('、')}）` : '';

  return {
    id: 'guidance-default',
    question: `听到这段内容时${keywordHint}，你是在哪个环节感到困惑的？`,
    type: 'single_choice',
    options: [
      { id: 'opt-1', text: '基础概念不清楚，有知识漏洞', category: 'concept' },
      { id: 'opt-2', text: '老师讲得太快，没跟上思路', category: 'comprehension' },
      { id: 'opt-3', text: '步骤/方法太多，不知道怎么操作', category: 'procedure' },
      { id: 'opt-4', text: '其他原因，我想直接描述问题', category: 'application' },
    ],
    hint: '选择最接近你困惑的选项，帮助我更好地帮助你',
  };
}

// ── 关键词提取 ──

function extractKeywords(text: string): string[] {
  const keywords: string[] = [];

  const patterns = [
    /函数|方程|公式|定理|证明/g,
    /实验|反应|现象|能量|物质/g,
    /文章|作者|表达|意思|理解/g,
    /单词|语法|句子|发音|听力/g,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      keywords.push(...matches);
    }
  }

  return [...new Set(keywords)];
}
