import { NextRequest, NextResponse } from 'next/server';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { buildPromptTranscriptContext } from '@/lib/ai-native/prompt-context';
import { buildFallbackCheckpointQuestions } from './question-fallback';
import type { TranscriptSegment } from '@/types';
import type { ClassCheckQuestionData } from '@/app/api/class-check/plan/route';

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
 * 输入：
 *   {
 *     transcript: TranscriptSegment[],  // 整段或窗口都可以，会按 startMs/endMs 裁剪
 *     checkpoint: {
 *       topic: string;
 *       difficulty: number;
 *       startMs: number;
 *       endMs: number;
 *     },
 *     count?: number,   // 期望题数 1-3，默认按难度自适应
 *     model?: string,
 *   }
 *
 * 输出：{ ok: true, questions: ClassCheckQuestionData[] }
 */

interface QuestionLLMRaw {
  stem?: string;
  options?: string[];
  answer?: string;
  explanation?: string;
}

interface QuestionLLMOutput {
  questions?: QuestionLLMRaw[];
}

interface RequestCheckpoint {
  topic: string;
  difficulty?: number;
  startMs: number;
  endMs: number;
}

function normalizeOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
    .slice(0, 6);
}

function normalizeQuestion(raw: QuestionLLMRaw): ClassCheckQuestionData | null {
  const stem = typeof raw.stem === 'string' ? raw.stem.trim() : '';
  if (!stem) return null;
  const options = normalizeOptions(raw.options);
  if (options.length < 2) return null;
  return {
    stem,
    options,
    answer: typeof raw.answer === 'string' ? raw.answer.trim() : 'A',
    explanation: typeof raw.explanation === 'string' ? raw.explanation.trim() : '',
  };
}

/** 仅保留该 checkpoint 时间窗内的转录片段，并在前后各多留 10s 余量 */
function sliceSegments(
  segments: TranscriptSegment[],
  startMs: number,
  endMs: number
): TranscriptSegment[] {
  const PAD_MS = 10_000;
  const lo = Math.max(0, startMs - PAD_MS);
  const hi = endMs + PAD_MS;
  return segments.filter((s) => s.endMs >= lo && s.startMs <= hi);
}

/** 流式转录还没走到 checkpoint 时，取时间上最接近的少量证据做诚实兜底。 */
export function selectNearestTranscriptSegments(
  segments: TranscriptSegment[],
  startMs: number,
  endMs: number,
  limit = 3
): TranscriptSegment[] {
  const midpoint = (startMs + endMs) / 2;
  return [...segments]
    .sort((a, b) => {
      const aMidpoint = (a.startMs + a.endMs) / 2;
      const bMidpoint = (b.startMs + b.endMs) / 2;
      return Math.abs(aMidpoint - midpoint) - Math.abs(bMidpoint - midpoint);
    })
    .slice(0, Math.max(1, limit))
    .sort((a, b) => a.startMs - b.startMs);
}

/** 按难度决定题数：简单出 1 道，中等 2 道，难出 3 道 */
function desiredQuestionCount(difficulty: number, override?: number): number {
  if (override && override >= 1 && override <= 3) return Math.floor(override);
  if (difficulty <= 2) return 1;
  if (difficulty >= 4) return 3;
  return 2;
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
    const windowSegments = sliceSegments(transcript, checkpoint.startMs, checkpoint.endMs);
    if (windowSegments.length === 0) {
      const nearestSegments = selectNearestTranscriptSegments(
        transcript,
        checkpoint.startMs,
        checkpoint.endMs
      );
      return NextResponse.json({
        ok: true,
        questions: buildFallbackCheckpointQuestions({
          checkpoint,
          windowSegments: nearestSegments,
          count,
        }),
        fallback: true,
      });
    }

    const model = body.model?.trim() || DEFAULT_MODEL_ID;

    const transcriptContext = buildPromptTranscriptContext(windowSegments, {
      maxChars: 8_000,
      includeIndex: false,
      includeTimestamp: true,
      minCharsPerSegment: 20,
    });

    let questions: ClassCheckQuestionData[] = [];

    try {
      const response = await chat(
        [
          {
            role: 'system',
            content: '你是一位坐在学生旁边、和他一起听课的 AI 同桌。你刚和他一起听到课里的某个知识点，现在出几道选择题来确认他真的理解了。题目要让他用知识，不只是背知识；干扰项要有真正的迷惑性，是这个知识点常见的误解或相邻概念。',
          },
          {
            role: 'user',
            content: `知识点：${checkpoint.topic}（难度 ${difficulty}/5）

这个知识点对应的课堂转录：

${transcriptContext.text}

出 ${count} 道选择题，输出 JSON：
{
  "questions": [
    { "stem": string, "options": string[], "answer": string, "explanation": string }
  ]
}

answer 用选项字母（A/B/C 等）；explanation 简短说明为什么对、其他选项错在哪。只输出 JSON。`,
          },
        ],
        model,
        { temperature: 0.4, maxTokens: 1500, responseFormat: 'json_object' }
      );

      const parsed = parseJsonResponse<QuestionLLMOutput>(response.content);
      questions = Array.isArray(parsed?.questions)
        ? parsed!.questions!
            .map((q) => normalizeQuestion(q))
            .filter((q): q is ClassCheckQuestionData => q !== null)
        : [];
    } catch {
      questions = [];
    }

    if (questions.length === 0) {
      questions = buildFallbackCheckpointQuestions({ checkpoint, windowSegments, count });
    }

    return NextResponse.json({ ok: true, questions });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
