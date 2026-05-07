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
 *   - lookupTranscript  (检索课堂转写片段，纯函数)
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { TranscriptSegment } from '@/types';
import type { AppExecutionContext, AppPlugin, AppPluginTools } from '../ai-native/types';
import { flashcardsPlugin } from '../ai-native/plugins/flashcards.plugin';
import { quizPlugin } from '../ai-native/plugins/quiz.plugin';
import { mindmapPlugin } from '../ai-native/plugins/mindmap.plugin';

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
}

async function invokePlugin(
  plugin: AppPlugin,
  ctx: TutorToolContext,
  intent: string,
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
      goal: { intent },
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

export function createTutorTools(ctx: TutorToolContext) {
  return {
    makeFlashcards: tool({
      description:
        '基于课堂转写生成闪卡，适合"学生想通过卡片方式记忆"或"有很多概念需要记忆"的场景。' +
        '不要用于简单一句话能回答的问题。',
      inputSchema: z.object({
        topic: z
          .string()
          .describe('要做闪卡的知识点或主题，例如"反向传播"、"红细胞的作用"'),
        count: z.number().int().min(3).max(15).default(6).describe('生成多少张，默认 6 张'),
      }),
      async execute({ topic, count }) {
        const intent = `基于课堂生成 ${count} 张关于"${topic}"的闪卡`;
        return invokePlugin(flashcardsPlugin, ctx, intent);
      },
    }),

    makeQuiz: tool({
      description:
        '基于课堂转写出题测试。适合学生说"考我一下 / 出几道题 / 我想练一练"的场景。' +
        '单次只出一组题，每组默认 3-5 道。',
      inputSchema: z.object({
        topic: z.string().describe('测试范围'),
        count: z.number().int().min(1).max(10).default(4).describe('题数'),
        difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
      }),
      async execute({ topic, count, difficulty }) {
        const intent = `出 ${count} 道 ${difficulty} 难度的题目，围绕"${topic}"`;
        return invokePlugin(quizPlugin, ctx, intent);
      },
    }),

    makeMindmap: tool({
      description:
        '基于课堂转写生成思维导图。适合学生问"这节课讲了什么 / 帮我梳理结构 / 画个图看看"。',
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
        return invokePlugin(mindmapPlugin, ctx, intent);
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
