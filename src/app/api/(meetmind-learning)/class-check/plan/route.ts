import { NextRequest, NextResponse } from 'next/server';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { buildPromptTranscriptContext } from '@/lib/ai-native/prompt-context';
import type { TranscriptSegment } from '@/types';

/**
 * POST /api/class-check/plan
 *
 * 【v2】轻量版 plan 接口——只产出课堂结构骨架，不再生成题目。
 *   1. title / summary —— 课堂元信息
 *   2. checkpoints     —— 知识点断点（不含题目）
 *   3. highlights      —— 课堂精选片段
 *
 * 题目由前端拿到 plan 后按 checkpoint 并发调用 /api/class-check/question 填充。
 * 这样单次 LLM 调用从 ~8k tokens 降到 ~1.5k tokens，延迟从 60-180s 降到 15-30s。
 *
 * 输入：{ transcript: TranscriptSegment[], model?: string }
 * 输出：{ ok: true, plan: ClassCheckPlan }（plan.checkpoints[].questions = []）
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
  /** 题目列表（plan 阶段为空数组，由 /api/class-check/question 按需填充） */
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
  /** 知识点检验点列表（按时间排序；题目待按需生成） */
  checkpoints: ClassCheckCheckpoint[];
  /** 课堂精选片段 */
  highlights: ClassCheckHighlight[];
}

// ── LLM 原始输出类型 ──

interface PlanLLMCheckpoint {
  triggerMs?: number;
  startMs?: number;
  endMs?: number;
  topic?: string;
  difficulty?: number;
  greeting?: string;
  encouragement?: string;
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

function normalizePlan(raw: PlanLLMOutput | null, segments: TranscriptSegment[]): ClassCheckPlan | null {
  if (!raw || !Array.isArray(raw.checkpoints) || raw.checkpoints.length === 0) return null;

  const totalDurationMs = segments.length > 0
    ? segments.reduce((max, s) => Math.max(max, s.endMs), 0)
    : 0;

  const rawCheckpoints = raw.checkpoints;

  const checkpoints: ClassCheckCheckpoint[] = rawCheckpoints
    .filter((cp) => cp.topic && typeof cp.topic === 'string')
    .map((cp, index) => ({
      triggerMs: toMs(cp.triggerMs, toMs(cp.endMs, (index + 1) * 300_000)),
      startMs: toMs(cp.startMs, index === 0 ? 0 : toMs(rawCheckpoints[index - 1]?.endMs, 0)),
      endMs: toMs(cp.endMs, toMs(cp.triggerMs, (index + 1) * 300_000)),
      topic: cp.topic!.trim(),
      difficulty: toInt(cp.difficulty, 3, 1, 5),
      greeting: typeof cp.greeting === 'string' ? cp.greeting.trim() : '',
      encouragement: typeof cp.encouragement === 'string' ? cp.encouragement.trim() : '',
      questions: [], // 题目按需生成
    }))
    .filter((cp) => cp.triggerMs > 0 && cp.triggerMs <= totalDurationMs + 60_000)
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

你的任务：快速梳理课堂结构，输出两样东西：
1. 知识点检验计划（checkpoints）——在哪些时间点可以暂停、主题是什么
2. 课堂精选片段（highlights）——最有价值的原文片段

注意：不要出题。题目由另一个接口按 checkpoint 单独生成。

你的风格：
- 像朋友聊天，不是考官审讯
- greeting 要和刚才的内容相关，让学生觉得你在认真听
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
      "encouragement": "答完后的一句鼓励或提醒"
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
- highlights 数量 ≥ checkpoints，每个知识点至少一个精选片段
- triggerMs 必须对应转录中真实的时间点
- quote 必须是转录原文
- 不要输出 questions 字段`,
        },
      ],
      model,
      { temperature: 0.3, maxTokens: 3072, responseFormat: 'json_object' }
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
