import { NextRequest, NextResponse } from 'next/server';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { buildPromptTranscriptContext } from '@/lib/ai-native/prompt-context';
import type { TranscriptSegment } from '@/types';
import type { ClassCheckQuestionData } from '@/app/api/(meetmind-learning)/class-check/plan/route';

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

/** 按难度决定题数：简单出 1 道，中等 2 道，难出 3 道 */
function desiredQuestionCount(difficulty: number, override?: number): number {
  if (override && override >= 1 && override <= 3) return Math.floor(override);
  if (difficulty <= 2) return 1;
  if (difficulty >= 4) return 3;
  return 2;
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = await applyRateLimit(request, 'default');
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

    const windowSegments = sliceSegments(transcript, checkpoint.startMs, checkpoint.endMs);
    if (windowSegments.length === 0) {
      return NextResponse.json({ ok: false, error: '窗口内无转录内容' }, { status: 400 });
    }

    const model = body.model?.trim() || DEFAULT_MODEL_ID;
    const difficulty = Math.min(5, Math.max(1, Math.floor(checkpoint.difficulty ?? 3)));
    const count = desiredQuestionCount(difficulty, body.count);

    const transcriptContext = buildPromptTranscriptContext(windowSegments, {
      maxChars: 8_000,
      includeIndex: false,
      includeTimestamp: true,
      minCharsPerSegment: 20,
    });

    const response = await chat(
      [
        {
          role: 'system',
          content: `你是一位坐在学生旁边、和他一起听课的 AI 同桌。

你的任务：针对某个具体知识点，出 ${count} 道选择题。

你的出题风格：
- 像朋友聊天出题，不是考官审讯
- 题目检验真正理解，不是死记硬背
- 选项干扰项要合理，别太弱智
- 解析简短，点到为止

严格输出 JSON，不要输出其他文字。`,
        },
        {
          role: 'user',
          content: `以下是课堂中关于「${checkpoint.topic}」（难度 ${difficulty}/5）这个知识点的原始转录：

${transcriptContext.text}

请针对这个知识点出 ${count} 道选择题，输出 JSON：
{
  "questions": [
    {
      "stem": "题干",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A",
      "explanation": "简短解析"
    }
  ]
}

要求：
- 出 ${count} 道题，每道题 4 个选项，1 个正确答案
- 题目聚焦「${checkpoint.topic}」这个知识点本身
- 答案字段填选项字母（A/B/C/D）
- 不要编造转录里没有的内容`,
        },
      ],
      model,
      { temperature: 0.4, maxTokens: 1536, responseFormat: 'json_object' }
    );

    const parsed = parseJsonResponse<QuestionLLMOutput>(response.content);
    const questions: ClassCheckQuestionData[] = Array.isArray(parsed?.questions)
      ? parsed!.questions!
          .map((q) => normalizeQuestion(q))
          .filter((q): q is ClassCheckQuestionData => q !== null)
      : [];

    if (questions.length === 0) {
      return NextResponse.json({ ok: false, error: '题目解析失败' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, questions });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
