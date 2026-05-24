/**
 * Tutor tools - Vercel AI SDK v6 tool() wrappers around Workshop plugins.
 *
 * 设计原则（来自调研 #2）：
 *   1. 用 ai SDK 原生 tool() + zod schema，不引入 MCP（Workshop 是内部工具）
 *   2. Tool description 是"给 LLM 的 UX"——要让模型看得懂什么时候该调
 *   3. 工具执行层面封装 Workshop plugin 的 `run(context, tools)` 契约，
 *      不改 plugin 本身——保持 M3 改动范围最小
 *   4. 失败返回结构化 error，LLM 可以说"我暂时做不了"
 *
 * 可被 Tutor 调用的工具：
 *   - makeFlashcards    (对应 flashcards.plugin)
 *   - makeQuiz          (对应 quiz.plugin)
 *   - makeMindmap       (对应 mindmap.plugin)
 *   - makeCheatsheet    (对应 cheatsheet.plugin)
 *   - makeStudyReport   (对应 study-report.plugin)
 *   - lookupTranscript  (检索课堂转写片段，纯函数)
 *
 * 注意：调用 plugin 时必须显式传 appKey——agent-native 姿态，
 * 不再靠 intent 的关键词匹配去"猜"插件。
 */

import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { TranscriptSegment } from '@/types';
import type { AppExecutionContext, AppPlugin, AppPluginTools } from '../ai-native/types';
import { flashcardsPlugin } from '../ai-native/plugins/flashcards.plugin';
import { quizPlugin } from '../ai-native/plugins/quiz.plugin';
import { mindmapPlugin } from '../ai-native/plugins/mindmap.plugin';
import { cheatsheetPlugin } from '../ai-native/plugins/cheatsheet.plugin';
import { studyReportPlugin } from '../ai-native/plugins/study-report.plugin';

// ──────────────────────────────────────────────────────────────
// Shared plugin tools
// ──────────────────────────────────────────────────────────────

function createPluginTools(transcript: TranscriptSegment[]): AppPluginTools {
  return {
    searchTranscript(params) {
      const { query, limit = 20 } = params;
      if (!query.trim()) return params.transcript;
      const q = query.toLowerCase();
      return params.transcript
        .filter((s) => s.text.toLowerCase().includes(q))
        .slice(0, limit);
    },
    summarizeSegments(segments, maxChars = 1500) {
      return segments.map((s) => s.text).join(' ').slice(0, maxChars);
    },
    now() {
      return new Date().toISOString();
    },
  };
}

interface TutorToolContext {
  sessionId: string;
  transcript: TranscriptSegment[];
  subject?: string;
  model?: string;
  /** in-class 不暴露 native tools，课中轻产物走 open_app marker */
  mode?: 'in-class' | 'review';
}

async function invokePlugin(
  plugin: AppPlugin,
  ctx: TutorToolContext,
  intent: string,
  appKey: string,
): Promise<{
  ok: boolean;
  cards?: unknown[];
  render?: unknown;
  tasks?: unknown[];
  error?: string;
}> {
  try {
    const execCtx: AppExecutionContext = {
      input: {
        sessionId: ctx.sessionId,
        dataSource: 'live',
        transcript: ctx.transcript,
        anchors: [],
        metadata: ctx.subject ? { subject: ctx.subject } : undefined,
      },
      memory: {},
      goal: { intent, appKey },
      model: ctx.model,
    };
    const result = await plugin.run(execCtx, createPluginTools(ctx.transcript));
    return {
      ok: true,
      cards: result.cards,
      render: result.render,
      tasks: result.tasks,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ──────────────────────────────────────────────────────────────
// Tool factories
// ──────────────────────────────────────────────────────────────

export function createTutorTools(ctx: TutorToolContext): ToolSet {
  if (ctx.mode === 'in-class') {
    return {};
  }

  const postClassTrainingTools: ToolSet = {
    makeFlashcards: tool({
      description:
        '基于课堂转写生成闪卡。把是否需要闪卡交给模型结合上下文判断：学生可能直接说做闪卡，也可能表达想记住、复习、主动回忆某个知识点。' +
        '工具只是能力，不是流程；简单一句话能回答的问题直接回答。',
      inputSchema: z.object({
        topic: z
          .string()
          .describe('要做闪卡的知识点或主题，例如"反向传播"、"红细胞的作用"'),
        count: z.number().int().min(3).max(15).default(6).describe('生成多少张，默认 6 张'),
      }),
      async execute({ topic, count }) {
        const intent = `基于课堂生成 ${count} 张关于"${topic}"的闪卡`;
        return invokePlugin(flashcardsPlugin, ctx, intent, 'flashcards');
      },
    }),

    makeQuiz: tool({
      description:
        '基于课堂转写出题测试。把是否需要测验交给模型结合上下文判断：学生可能直接说考我一下，也可能表达想验证自己懂没懂、练一练。' +
        '工具只是能力，不是流程；单次只出一组题，每组默认 3-5 道。',
      inputSchema: z.object({
        topic: z.string().describe('测试范围'),
        count: z.number().int().min(1).max(10).default(4).describe('题数'),
        difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
      }),
      async execute({ topic, count, difficulty }) {
        const intent = `出 ${count} 道 ${difficulty} 难度的题目，围绕"${topic}"`;
        return invokePlugin(quizPlugin, ctx, intent, 'quiz');
      },
    }),
  };

  return {
    ...postClassTrainingTools,

    makeMindmap: tool({
      description:
        '基于课堂转写生成思维导图。把是否需要导图交给模型结合上下文判断：学生可能直接要画图，也可能是在找结构、主干、概念关系。' +
        '工具只是能力，不是流程。',
      inputSchema: z.object({
        rootTopic: z
          .string()
          .describe('根节点主题；如果学生没明说，可以用课堂的主要话题')
          .optional(),
      }),
      async execute({ rootTopic }) {
        const intent = rootTopic
          ? `围绕"${rootTopic}"生成思维导图`
          : `基于课堂主要内容生成思维导图`;
        return invokePlugin(mindmapPlugin, ctx, intent, 'mindmap');
      },
    }),

    makeCheatsheet: tool({
      description:
        '基于课堂转写生成"一页纸考试速查表"——把核心定义、关键公式、易错点等压成密集可打印卡片。' +
        '把是否需要速查表交给模型结合上下文判断：学生可能直接说速查表，也可能表达考前压缩、最后翻一遍、公式易错点汇总。' +
        '工具只是能力，不是流程；它比闪卡更密，比思维导图更聚焦应试。',
      inputSchema: z.object({
        topic: z
          .string()
          .describe('要覆盖的知识范围；留空则覆盖整节课')
          .optional(),
      }),
      async execute({ topic }) {
        const intent = topic
          ? `基于课堂生成关于"${topic}"的考试速查表`
          : `基于课堂生成一页考试速查表`;
        return invokePlugin(cheatsheetPlugin, ctx, intent, 'cheatsheet');
      },
    }),

    makeStudyReport: tool({
      description:
        '基于课堂转写生成给家长看的听课报告——这节课讲了什么、难度大概怎样、家长可以和孩子聊哪些具体话题。' +
        '把是否需要报告交给模型结合上下文判断：学生或家长可能直接要报告，也可能想知道今天学了什么、怎么和家里解释。' +
        '工具只是能力，不是流程；没有答题数据时不评价孩子掌握度，只分析课堂内容。',
      inputSchema: z.object({
        focus: z
          .string()
          .describe('报告的侧重点，如"家长视角 / 复盘重点"；留空则全面覆盖')
          .optional(),
      }),
      async execute({ focus }) {
        const intent = focus
          ? `生成听课报告，侧重${focus}`
          : `基于课堂生成家长视角的听课报告`;
        return invokePlugin(studyReportPlugin, ctx, intent, 'study-report');
      },
    }),

    lookupTranscript: tool({
      description:
        '在课堂转写里搜索某个关键词或片段。返回匹配的段落及其时间戳。' +
        '适合"老师什么时候讲到 XX / 那段在哪里"的问题。',
      inputSchema: z.object({
        query: z.string().describe('要搜索的关键词'),
        limit: z.number().int().min(1).max(10).default(3),
      }),
      async execute({ query, limit }) {
        const lower = query.toLowerCase();
        const matches = ctx.transcript
          .filter((s) => s.text.toLowerCase().includes(lower))
          .slice(0, limit)
          .map((s) => ({
            text: s.text,
            beginMs: s.startMs,
            endMs: s.endMs,
            citation: formatCitation(s.startMs),
          }));
        return { ok: true, matches, query };
      },
    }),
  };
}

function formatCitation(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '[t=??:??]';
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `[t=${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}]`;
}

export type TutorTools = ReturnType<typeof createTutorTools>;
