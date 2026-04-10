import { NextRequest, NextResponse } from 'next/server';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { buildPromptTranscriptContext } from '@/lib/ai-native/prompt-context';
import type { TranscriptSegment } from '@/types';

/**
 * POST /api/class-check/plan
 *
 * 一次 LLM 调用，同时输出：
 *   1. 知识点 checkpoints（含每个 checkpoint 的题目）
 *   2. 课堂精选片段 highlights
 *
 * 前端拿到 plan 后无需再调第二次 API，播放到点直接弹已有题目。
 *
 * 输入：{ transcript: TranscriptSegment[], model?: string }
 * 输出：{ ok: true, plan: ClassCheckPlan }
 */

export interface ClassCheckQuestionData {
  /** 题干 */
  stem: string;
  /** 选项 */
  options: string[];
  /** 正确答案（选项字母或原文） */
  answer: string;
  /** 解析 */
  explanation: string;
}

export interface ClassCheckCheckpoint {
  /** 检验触发时间点（ms），对应知识点讲完的位置 */
  triggerMs: number;
  /** 该知识点覆盖的转录起始时间（ms） */
  startMs: number;
  /** 该知识点覆盖的转录结束时间（ms） */
  endMs: number;
  /** 知识点主题 */
  topic: string;
  /** 难度 1-5 */
  difficulty: number;
  /** 打招呼（和刚才内容相关的一句话） */
  greeting: string;
  /** 答完后的鼓励语 */
  encouragement: string;
  /** 预生成的题目列表 */
  questions: ClassCheckQuestionData[];
}

/** 课堂精选片段 */
export interface ClassCheckHighlight {
  /** 片段标题（≤15 字） */
  title: string;
  /** 精选片段的起始时间（ms） */
  startMs: number;
  /** 精选片段的结束时间（ms） */
  endMs: number;
  /** 原文引用 */
  quote: string;
  /** 关联的 checkpoint 索引（可选） */
  checkpointIndex?: number;
}

export interface ClassCheckPlan {
  /** 课堂主题 */
  title: string;
  /** 全课概要（一句话） */
  summary: string;
  /** 知识点检验点列表（按时间排序，含题目） */
  checkpoints: ClassCheckCheckpoint[];
  /** 课堂精选片段 */
  highlights: ClassCheckHighlight[];
}

// ── LLM 原始输出类型 ──

interface PlanLLMQuestion {
  stem?: string;
  options?: string[];
  answer?: string;
  explanation?: string;
}

interface PlanLLMCheckpoint {
  triggerMs?: number;
  startMs?: number;
  endMs?: number;
  topic?: string;
  difficulty?: number;
  greeting?: string;
  encouragement?: string;
  questions?: PlanLLMQuestion[];
}

interface PlanLLMHighlight {
  title?: string;
  startMs?: number;
  endMs?: number;
  quote?: string;
  checkpointIndex?: number;
}

interface PlanLLMOutput {
  title?: string;
  summary?: string;
  checkpoints?: PlanLLMCheckpoint[];
  highlights?: PlanLLMHighlight[];
}

// ── 工具函数 ──

function toMs(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  return fallback;
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(max, Math.max(min, Math.floor(value)));
  }
  return fallback;
}

function normalizeOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
    .slice(0, 6);
}

function normalizeQuestion(raw: PlanLLMQuestion): ClassCheckQuestionData | null {
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

function normalizePlan(raw: PlanLLMOutput | null, segments: TranscriptSegment[]): ClassCheckPlan | null {
  if (!raw || !Array.isArray(raw.checkpoints) || raw.checkpoints.length === 0) return null;

  const totalDurationMs = segments.length > 0
    ? segments.reduce((max, s) => Math.max(max, s.endMs), 0)
    : 0;

  const checkpoints: ClassCheckCheckpoint[] = raw.checkpoints
    .filter((cp) => cp.topic && typeof cp.topic === 'string')
    .map((cp, index) => {
      // 解析该 checkpoint 的题目
      const questions: ClassCheckQuestionData[] = (Array.isArray(cp.questions) ? cp.questions : [])
        .map((q) => normalizeQuestion(q))
        .filter((q): q is ClassCheckQuestionData => q !== null);

      return {
        triggerMs: toMs(cp.triggerMs, toMs(cp.endMs, (index + 1) * 300_000)),
        startMs: toMs(cp.startMs, index === 0 ? 0 : toMs(raw.checkpoints![index - 1]?.endMs, 0)),
        endMs: toMs(cp.endMs, toMs(cp.triggerMs, (index + 1) * 300_000)),
        topic: cp.topic!.trim(),
        difficulty: toInt(cp.difficulty, 3, 1, 5),
        greeting: typeof cp.greeting === 'string' ? cp.greeting.trim() : '',
        encouragement: typeof cp.encouragement === 'string' ? cp.encouragement.trim() : '',
        questions,
      };
    })
    // 必须有至少 1 道题
    .filter((cp) => cp.triggerMs > 0 && cp.triggerMs <= totalDurationMs + 60_000 && cp.questions.length > 0)
    .sort((a, b) => a.triggerMs - b.triggerMs);

  if (checkpoints.length === 0) return null;

  // 解析精选片段
  const highlights: ClassCheckHighlight[] = (Array.isArray(raw.highlights) ? raw.highlights : [])
    .filter((h) => h.title && typeof h.title === 'string' && typeof h.startMs === 'number')
    .map((h, index) => ({
      title: h.title!.trim().slice(0, 30),
      startMs: toMs(h.startMs, checkpoints[index]?.startMs ?? 0),
      endMs: toMs(h.endMs, checkpoints[index]?.endMs ?? 0),
      quote: typeof h.quote === 'string' ? h.quote.trim() : '',
      checkpointIndex: typeof h.checkpointIndex === 'number' ? h.checkpointIndex : index,
    }))
    .filter((h) => h.startMs >= 0 && h.endMs > h.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  return {
    title: typeof raw.title === 'string' ? raw.title.trim() : '课堂学习',
    summary: typeof raw.summary === 'string' ? raw.summary.trim() : '',
    checkpoints,
    highlights,
  };
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = await applyRateLimit(request, 'default');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json() as {
      transcript?: TranscriptSegment[];
      model?: string;
    };

    const transcript = Array.isArray(body.transcript) ? body.transcript : [];
    if (transcript.length < 3) {
      return NextResponse.json({ ok: false, error: '转录内容不足' }, { status: 400 });
    }

    const model = body.model?.trim() || DEFAULT_MODEL_ID;

    const transcriptContext = buildPromptTranscriptContext(transcript, {
      maxChars: 28_000,
      includeIndex: false,
      includeTimestamp: true,
      minCharsPerSegment: 40,
    });

    const response = await chat(
      [
        {
          role: 'system',
          content: `你是一位坐在学生旁边、和他一起听完整节课的 AI 同桌。

你的任务：分析课堂转录，一次性输出三样东西：
1. 知识点检验计划（checkpoints）——在哪些时间点暂停
2. 每个知识点的题目——直接出好，不需要二次生成
3. 课堂精选片段（highlights）——最有价值的原文片段

你的出题风格：
- 像朋友聊天，不是考官审讯
- greeting 要和刚才的内容相关，让学生觉得你在认真听
- 题目检验真正理解，不是死记硬背
- 解析简短，点到为止
- encouragement 自然，不要套话

严格输出 JSON，不要输出其他文字。`,
        },
        {
          role: 'user',
          content: `以下是一节课的完整转录，带时间戳：

${transcriptContext.text}

请分析这节课，输出 JSON：
{
  "title": "课堂主题",
  "summary": "一句话概括",
  "checkpoints": [
    {
      "triggerMs": 270000,
      "startMs": 0,
      "endMs": 270000,
      "topic": "知识点主题",
      "difficulty": 2,
      "greeting": "一句和刚才内容相关的自然开场白",
      "encouragement": "答完后的一句鼓励或提醒",
      "questions": [
        {
          "stem": "题干",
          "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
          "answer": "A",
          "explanation": "简短解析"
        }
      ]
    }
  ],
  "highlights": [
    {
      "title": "片段标题（≤15字）",
      "startMs": 30000,
      "endMs": 90000,
      "quote": "转录原文引用",
      "checkpointIndex": 0
    }
  ]
}

要求：
- checkpoints 3-7 个，找自然断点
- 每个 checkpoint 出 1-3 道选择题（简单知识点 1 道，难的 2-3 道）
- 每道题 4 个选项，1 个正确答案
- highlights 数量 ≥ checkpoints，每个知识点至少一个精选片段
- triggerMs 必须对应转录中真实的时间点
- quote 必须是转录原文`,
        },
      ],
      model,
      { temperature: 0.3, maxTokens: 8192, responseFormat: 'json_object' }
    );

    const parsed = parseJsonResponse<PlanLLMOutput>(response.content);
    const plan = normalizePlan(parsed, transcript);

    if (!plan) {
      return NextResponse.json({ ok: false, error: '预规划解析失败' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
