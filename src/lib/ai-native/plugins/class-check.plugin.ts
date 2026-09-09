/**
 * Class Check Plugin — 随堂检验（智能版）
 *
 * 基于预规划的 checkpoint 出题，而非机械计时。
 * 接收：
 *   - 该知识点对应的转录片段
 *   - checkpoint 的 strategy（预规划指令）
 *   - 前轮答题结果（错题信息）
 *   - 依赖知识点信息
 * 输出：
 *   - 针对性题目（2-3 道）
 *   - 知识点间的引导语
 */

import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import { createLogger } from '@/lib/logger';
import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';
import { buildPromptTranscriptContext, buildTerminologyHintBlock } from '../prompt-context';
import { resolveGroundedEvidence } from '../evidence-grounding';
import { normalizeQuizOptions, resolveAnswerIndex } from '../quiz-answer';

const log = createLogger('class-check-plugin');

interface ClassCheckMeta {
  /** 当前知识点主题 */
  topic?: string;
  /** 难度 1-5 */
  difficulty?: number;
  /** 预规划给出的出题策略 */
  strategy?: string;
  /** 建议题量 */
  questionCount?: number;
  /** 前轮答题结果摘要（错题信息） */
  previousErrors?: string;
  /** 依赖的知识点主题列表 */
  dependentTopics?: string[];
  /** 下一段的预告提示 */
  nextHint?: string;
}

interface QuizDraft {
  stem?: string;
  options?: string[];
  answer?: string;
  explanation?: string;
}

interface ClassCheckLLMOutput {
  greeting?: string;
  questions?: QuizDraft[];
  encouragement?: string;
  nextPreview?: string;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface UsableQuestion {
  stem: string;
  options: string[];
  answer: string;
  explanation: string;
}

/**
 * 模型输出 → 可用题。题干 / ≥2 选项 / 能解析到选项的答案，三者缺一就丢掉这道题。
 * 没有兜底题：之前这里会用最近一段原话切出个"关键短语"拼一道"以下哪种理解最准确"，
 * 正确答案永远是 A——学生答对没有含金量，答错还会当成真实薄弱点进记忆。
 */
export function normalizeClassCheckQuestion(draft: QuizDraft | undefined): UsableQuestion | null {
  const stem = typeof draft?.stem === 'string' ? draft.stem.trim() : '';
  if (!stem) return null;
  const options = normalizeQuizOptions(draft?.options);
  if (options.length < 2) return null;
  const answerIndex = resolveAnswerIndex(draft?.answer, options);
  if (answerIndex < 0) return null;
  return {
    stem,
    options,
    answer: String.fromCharCode(65 + answerIndex),
    explanation: typeof draft?.explanation === 'string' ? draft.explanation.trim() : '',
  };
}

async function generateWithLLM(
  context: AppExecutionContext,
  model: string,
  transcriptContext: string,
  meta: ClassCheckMeta
): Promise<ClassCheckLLMOutput | null> {
  const previousErrorsBlock = meta.previousErrors
    ? `\n【学生前轮薄弱点】\n${meta.previousErrors}\n请在本轮出题中适当关联这些薄弱点，帮助学生巩固。`
    : '';

  const dependentBlock = meta.dependentTopics && meta.dependentTopics.length > 0
    ? `\n【前置知识点】本知识点依赖：${meta.dependentTopics.join('、')}。如果学生前面这些都掌握了，可以出更有挑战性的题；如果有薄弱点，题目要更基础。`
    : '';

  const response = await chat(
    [
      {
        role: 'system',
        content: `你是一位坐在学生旁边、刚刚和他一起看完这段视频的 AI 同桌。

你的风格：
- 像朋友一样自然，不是考官
- 先说一句和刚才内容相关的话（greeting），让学生知道你在关注
- 出题检验理解，题目要有针对性
- 答完后给一句鼓励或提醒（encouragement）
- 如果知道接下来的内容，给一句预告（nextPreview）

严格输出 JSON。`,
      },
      {
        role: 'user',
        content: `【当前知识点】${meta.topic || '课堂内容'}
【难度】${meta.difficulty || 3}/5
【出题策略】${meta.strategy || '检验核心概念理解'}
【建议题量】${meta.questionCount || 2} 道
${previousErrorsBlock}${dependentBlock}

课堂原文（刚才播放的内容）：
${transcriptContext}

请输出：
{
  "greeting": "一句自然的开场白（和刚才内容相关，像朋友一样）",
  "questions": [
    {
      "stem": "题干",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A",
      "explanation": "解析（简短，点到为止）"
    }
  ],
  "encouragement": "答完后的一句话（根据题目难度和数量调整）",
  "nextPreview": "${meta.nextHint || '（如果没有下一段预告信息则留空）'}"
}${buildTerminologyHintBlock(context.memory.terminologyHint)}`,
      },
    ],
    model,
    { temperature: 0.35, maxTokens: 2048, responseFormat: 'json_object' }
  );

  return parseJsonResponse<ClassCheckLLMOutput>(response.content);
}

export const classCheckPlugin: AppPlugin = {
  manifest: {
    id: 'class-check',
    name: '随堂检验',
    version: '0.2.0',
    description: '基于知识点结构的智能随堂检验，像 AI 同桌一样陪你看课。',
    tags: ['student', 'class-check', 'realtime-quiz'],
    capabilities: ['citation-card', 'seek-action', 'adaptive'],
    enabledByDefault: true,
  },
  canHandle(context: AppExecutionContext): boolean {
    // Agent-native 姿态：不再用 intent.includes('随堂') 关键词匹配"猜"用户意图。
    // 分派权完全交给上游——agent 的 tool-calling 决定调用 classCheck，
    // 或前端显式传 appKey='class-check'。此处只做结构性守卫。
    if (context.input.transcript.length === 0) return false;
    return context.goal.appKey === 'class-check';
  },
  async run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult> {
    const meta: ClassCheckMeta = (context.goal as unknown as Record<string, unknown>).classCheckMeta as ClassCheckMeta || {};

    const promptContext = buildPromptTranscriptContext(context.input.transcript, {
      maxChars: 48_000,
      includeIndex: false,
      includeTimestamp: true,
      minCharsPerSegment: 40,
    });
    const model = context.model || DEFAULT_MODEL_ID;

    // 模型一次重试；仍没有可用的题就诚实失败（execute 路由返回 GENERATION_FAILED，
    // 窗口体给"再试一次"）。不用原话切片拼题，不缓存，不写记忆。
    let llmOutput: ClassCheckLLMOutput | null = null;
    let questions: UsableQuestion[] = [];
    for (let attempt = 0; attempt < 2 && questions.length === 0; attempt += 1) {
      try {
        llmOutput = await generateWithLLM(context, model, promptContext.text, meta);
      } catch (error) {
        llmOutput = null;
        log.warn('class-check generation failed', {
          attempt: attempt + 1,
          message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
        });
      }
      questions = (Array.isArray(llmOutput?.questions) ? llmOutput.questions : [])
        .map((draft) => normalizeClassCheckQuestion(draft))
        .filter((q): q is UsableQuestion => q !== null)
        .slice(0, meta.questionCount || 3);
    }
    if (questions.length === 0) throw new Error('GENERATION_FAILED');

    const cards: AppExecutionResult['cards'] = [];
    questions.forEach((question, index) => {
      // 证据落地只决定「回放」跳到哪、要不要给跳转；在整份转录里找，落地不到就没有跳转按钮
      const grounding = resolveGroundedEvidence(
        `${question.stem} ${question.options[question.answer.charCodeAt(0) - 65] ?? ''} ${question.explanation}`,
        context.input.transcript,
      );
      const segment = grounding.supported || grounding.method === 'timestamp' ? grounding.segment : undefined;

      cards.push({
        id: `class-check-${index + 1}`,
        type: 'quiz',
        title: `第 ${index + 1} 题`,
        body: question.stem,
        priority: 'high',
        ...(segment
          ? {
            citations: [{ startMs: segment.startMs, endMs: segment.endMs, snippet: segment.text.slice(0, 120) }],
            actions: [{
              id: `seek-class-check-${index + 1}`,
              label: `回放 ${formatTimestamp(segment.startMs)}`,
              kind: 'seek' as const,
              payload: { timestamp: segment.startMs },
            }],
          }
          : {}),
        meta: {
          cardKind: 'quiz',
          stem: question.stem,
          options: question.options,
          answer: question.answer,
          explanation: question.explanation,
          evidence: grounding.supported ? 'text' : grounding.method === 'timestamp' ? 'timestamp' : 'none',
        },
      });
    });

    return {
      pluginId: 'class-check',
      version: '0.2.0',
      model,
      trace: [
        `intent=${context.goal.intent}`,
        `model=${model}`,
        `topic=${meta.topic || 'unknown'}`,
        `difficulty=${meta.difficulty || 'auto'}`,
        `transcript_segments=${context.input.transcript.length}`,
        `questions=${cards.length}`,
        `has_previous_errors=${Boolean(meta.previousErrors)}`,
        `grounded=${cards.filter((card) => card.meta?.evidence !== 'none').length}/${cards.length}`,
      ],
      cards,
      tasks: [],
      render: {
        mode: 'quiz',
        title: meta.topic || '随堂检验',
        description: llmOutput?.greeting || '',
        payload: {
          greeting: llmOutput?.greeting || '',
          encouragement: llmOutput?.encouragement || '',
          nextPreview: llmOutput?.nextPreview || meta.nextHint || '',
          questions: cards.map((card, index) => ({
            id: card.id,
            title: card.title,
            stem: questions[index].stem,
            options: questions[index].options,
            answer: questions[index].answer,
            explanation: questions[index].explanation,
          })),
        },
      },
      raw: {
        generatedAt: tools.now(),
      },
    };
  },
};
