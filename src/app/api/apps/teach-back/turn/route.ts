import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@/lib/logger';
import { streamTeachBackPanel } from '@/lib/services/teach-back-panel-service';
import { applyRateLimit } from '@/lib/utils/rate-limit';

/**
 * POST /api/apps/teach-back/turn —— 「讲给同桌听」连续讲述版的评委回合（SSE）。
 *
 * 学生每停下来一段（客户端 VAD + ASR 句末判定）调一次：请求体携带讲述目标、课堂转录（证据由客户端携带，
 * 与 evaluate 同契约）、本场至今的记录、刚讲完的这一段；评委席（三位性格不同的 AI 同学）决定谁开口说什么，
 * 或者谁都不开口。响应是 `text/event-stream`，每条 `data: <json>`：
 *
 *   { type: 'judge',  judgeId }        谁开口（direct / guide / probe），先于正文
 *   { type: 'delta',  text }           这位评委的话，流式增量（客户端边收边显示、按句送 TTS）
 *   { type: 'done',   judgeId, text }  说完了（text 是完整全文）
 *   { type: 'silent' }                 谁都不开口（也是成功——让他继续讲）
 *   { type: 'error',  message }        评委这次没反应过来（客户端视同 silent，绝不打断讲述）
 *   data: [DONE]                       流结束
 *
 * 为什么不扩展 /api/apps/teach-back/respond：respond 是"同桌开口一句或安静"的 JSON 一问一答，
 * 评委回合要流式文字（气泡边说边长、首句即送 TTS）和"谁在说"，是另一种传输与契约；
 * respond 原样保留给半双工版回退，evaluate 契约与四象限语义不动。
 * 鉴权与限流照 respond 的写法（applyRateLimit），限流桶单独成 teachBackTurn（一场几十个回合）。
 */

const log = createLogger('teach-back-turn');

const EvidenceSchema = z.object({
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  snippet: z.string().max(600),
}).nullable();

const TargetSchema = z.object({
  id: z.string().min(1).max(60),
  point: z.string().min(1).max(120),
  why: z.string().max(200).optional(),
  evidence: EvidenceSchema,
});

const TurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().max(2_000),
  judgeId: z.enum(['direct', 'guide', 'probe']).optional(),
});

const SegmentSchema = z.object({
  text: z.string().max(2_000),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
}).passthrough();

const BodySchema = z.object({
  targets: z.array(TargetSchema).min(1).max(8),
  turns: z.array(TurnSchema).max(400),
  segment: z.string().max(2_000),
  transcript: z.array(SegmentSchema).max(2_000),
  metadata: z.object({
    title: z.string().max(200).optional(),
    subject: z.string().max(120).optional(),
  }).optional(),
  mode: z.enum(['turn', 'check-in']).default('turn'),
});

export async function POST(request: NextRequest) {
  const rateLimit = await applyRateLimit(request, 'teachBackTurn');
  if (rateLimit) return rateLimit;

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    log.warn('teach-back.turn.invalid_body', {
      issues: parsed.error.issues.slice(0, 5).map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message })),
    });
    return NextResponse.json({ ok: false, error: '请求内容不完整' }, { status: 400 });
  }
  const body = parsed.data;
  if (body.mode === 'turn' && !body.segment.trim()) {
    return NextResponse.json({ ok: false, error: '这一段是空的' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        const events = streamTeachBackPanel({
          targets: body.targets,
          turns: body.turns,
          segment: body.segment.trim(),
          transcript: body.transcript as never,
          metadata: body.metadata,
          mode: body.mode,
          signal: request.signal,
        });
        for await (const event of events) {
          if (request.signal.aborted) break;
          send(event);
        }
      } catch (error) {
        log.error('teach-back turn stream failed', error);
        send({ type: 'error', message: '评委这次没反应过来' });
      } finally {
        try {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch {
          /* 客户端已断开 */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
