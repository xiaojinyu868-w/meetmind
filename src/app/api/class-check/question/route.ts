import { NextRequest, NextResponse } from 'next/server';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { buildPromptTranscriptContext } from '@/lib/ai-native/prompt-context';
import { createLogger } from '@/lib/logger';
import {
  normalizeQuestion,
  selectNearestTranscriptSegments,
  sliceSegmentsInWindow,
  type QuestionLLMRaw,
} from './question-window';
import type { TranscriptSegment } from '@/types';
import type { ClassCheckQuestionData } from '@/app/api/class-check/plan/route';

const log = createLogger('class-check/question');

/**
 * POST /api/class-check/question
 *
 * 【v2 拆分】按单个 checkpoint 生成 1-3 道题。
 *
 * 和 plan 接口配合：
 *   - plan 先出课堂骨架（checkpoints 不含题目）
 *   - 前端拿到 plan 后并发调用本接口，按 checkpoint 填题
 *   - 单次调用只处理一个 checkpoint、一段转录窗口，<1k tokens，5-10s 返回
 *   - 单个 checkpoint 失败不影响其他
 *
 * 契约（2026-09）：题目只来自模型。窗口里没片段就用时间上最近的几段照样问模型；
 * 模型一次重试后仍没给出可用的题 → `{ ok: true, questions: [] }`，客户端把该
 * checkpoint 安静跳过。这里不再有模板题——正确答案永远是 A 的方法论题对学生
 * 是噪音，对记忆积累是假事实。
 *
 * 输入：
 *   {
 *     transcript: TranscriptSegment[],  // 整段或窗口都可以，会按 startMs/endMs 裁剪
 *     checkpoint: { topic, difficulty, startMs, endMs },
 *     count?: number,   // 期望题数 1-3，默认按难度自适应
 *     model?: string,
 *   }
 *
 * 输出：{ ok: true, questions: ClassCheckQuestionData[] }（可能为空数组）
 */

interface QuestionLLMOutput {
  questions?: QuestionLLMRaw[];
}

interface RequestCheckpoint {
  topic: string;
  difficulty?: number;
  startMs: number;
  endMs: number;
}

/** 按难度决定题数：简单出 1 道，中等 2 道，难出 3 道 */
function desiredQuestionCount(difficulty: number, override?: number): number {
  if (override && override >= 1 && override <= 3) return Math.floor(override);
  if (difficulty <= 2) return 1;
  if (difficulty >= 4) return 3;
  return 2;
}

async function generateQuestions(params: {
  topic: string;
  difficulty: number;
  count: number;
  transcriptText: string;
  model: string;
}): Promise<ClassCheckQuestionData[]> {
  const response = await chat(
    [
      {
        role: 'system',
        content: '你是一位坐在学生旁边、和他一起听课的 AI 同桌。你刚和他一起听到课里的某个知识点，现在出几道选择题来确认他真的理解了。题目要让他用知识，不只是背知识；干扰项要有真正的迷惑性，是这个知识点常见的误解或相邻概念。题目和答案都必须能在给你的这段课堂原话里找到依据。',
      },
      {
        role: 'user',
        content: `知识点：${params.topic}（难度 ${params.difficulty}/5）

这个知识点对应的课堂转录：

${params.transcriptText}

出 ${params.count} 道选择题，输出 JSON：
{
  "questions": [
    { "stem": string, "options": string[], "answer": string, "explanation": string }
  ]
}

answer 用选项字母（A/B/C 等）；explanation 简短说明为什么对、其他选项错在哪。只输出 JSON。`,
      },
    ],
    params.model,
    { temperature: 0.4, maxTokens: 1500, responseFormat: 'json_object' },
  );

  const parsed = parseJsonResponse<QuestionLLMOutput>(response.content);
  return Array.isArray(parsed?.questions)
    ? parsed!.questions!
        .map((q) => normalizeQuestion(q))
        .filter((q): q is ClassCheckQuestionData => q !== null)
    : [];
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = await applyRateLimit(request, 'classCheck');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = (await request.json()) as {
      transcript?: TranscriptSegment[];
      checkpoint?: RequestCheckpoint;
      count?: number;
      model?: string;
    };

    const transcript = Array.isArray(body.transcript) ? body.transcript : [];
    const checkpoint = body.checkpoint;

    if (!checkpoint || typeof checkpoint.topic !== 'string' || !checkpoint.topic.trim()) {
      return NextResponse.json({ ok: false, error: '缺少 checkpoint 信息' }, { status: 400 });
    }
    if (transcript.length === 0) {
      return NextResponse.json({ ok: false, error: '转录为空' }, { status: 400 });
    }

    const difficulty = Math.min(5, Math.max(1, Math.floor(checkpoint.difficulty ?? 3)));
    const count = desiredQuestionCount(difficulty, body.count);
    const inWindow = sliceSegmentsInWindow(transcript, checkpoint.startMs, checkpoint.endMs);
    // plan 给的时间点漂出转录范围时，最近的几段仍是这节课的原话——照样让模型出题
    const windowSegments = inWindow.length > 0
      ? inWindow
      : selectNearestTranscriptSegments(transcript, checkpoint.startMs, checkpoint.endMs);

    const model = body.model?.trim() || DEFAULT_MODEL_ID;
    const transcriptContext = buildPromptTranscriptContext(windowSegments, {
      maxChars: 8_000,
      includeIndex: false,
      includeTimestamp: true,
      minCharsPerSegment: 20,
    });

    let questions: ClassCheckQuestionData[] = [];
    for (let attempt = 0; attempt < 2 && questions.length === 0; attempt += 1) {
      try {
        questions = await generateQuestions({
          topic: checkpoint.topic,
          difficulty,
          count,
          transcriptText: transcriptContext.text,
          model,
        });
      } catch (error) {
        log.warn('checkpoint question generation failed', {
          attempt: attempt + 1,
          topic: checkpoint.topic.slice(0, 60),
          message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
        });
      }
    }

    if (questions.length === 0) {
      log.info('checkpoint yielded no usable questions, skipping', {
        topic: checkpoint.topic.slice(0, 60),
        windowSegments: windowSegments.length,
        usedNearest: inWindow.length === 0,
      });
    }

    return NextResponse.json({ ok: true, questions });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
