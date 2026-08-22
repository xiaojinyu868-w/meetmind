// 清小搭 OpenAI 兼容适配层 — POST /api/compat/v1/chat/completions
//
// 平台网关对话入口。契约要点（详见 ../DOMAIN.md）：
//   - 鉴权：Authorization: Bearer <XIAODA_API_KEY>（与 /models 共用 ./auth）
//   - stream === true（严格 JSON 布尔）→ SSE；否则 → 非流式 JSON
//   - 入参 system 消息一律丢弃，persona 固定用 rehearsal-prompts 的「上场前」
//   - content 为多模态 part 数组时拼接 text part；input_audio 走 ../../audio-transcribe
//     转写后以 [语音试讲转写] 块注入该条消息（失败留 [语音转写失败，已忽略]，不打断主流程）；
//     image_url/file 仍优雅跳过
//   - 模型链路完全复用 Tutor 的 provider 解析（tutor-agent-provider.ts），thinking 显式关
//
// 消息预处理拆在 ./message-preprocess；SSE 公共件在 ./sse-frame。
// 含 input_audio 的流式请求走 ./audio-progress-stream：转写推迟到流内执行，
// 先下发 delta.reasoning 进度帧（接收 → 转写 → 分析），错误一律流内兜底。
// 讲稿产物（../../rehearsal-artifacts）：assistant 输出含【讲稿开始】/【讲稿结束】
// 标记时生成 docx 附件 + 在线上场包页——流式在 stop 帧前补一帧在线链接、stop 帧
// 顶层挂 x_soda.attachments；非流式把链接追加到 content、响应顶层挂同名结构。
// 每日成本闸在 ../../daily-cap：鉴权通过后 chat 计数，含音频时先做音频闸预检。
//
// 无音频 / 非流式 SSE 帧序：role 帧 → 增量帧* → stop 帧（带 usage）→ data: [DONE]
// 未产出任何内容前抛错 → HTTP 500 JSON；流式中途抛错 → 带 error 的 stop 帧 + [DONE]。

import { streamText } from 'ai';
import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { REHEARSAL_SYSTEM_PROMPT, PROMPT_VERSIONS } from '@/lib/prompts/rehearsal-prompts';
import {
  createTutorAgentChatModel,
  resolveTutorAgentProviderFallbacks,
} from '@/lib/utils/tutor-agent-provider';
import { checkXiaodaAuth } from '../../auth';
import {
  consumeChatQuota,
  dailyCapExceededResponse,
  isAudioCapExceeded,
} from '../../daily-cap';
import { buildDraftArtifacts, resolveBaseUrl } from '../../rehearsal-artifacts';
import { audioProgressStreamResponse } from './audio-progress-stream';
import { containsInputAudio, normalizeMessages } from './message-preprocess';
import { COMPAT_MODEL_ID, SSE_HEADERS, mapFinishReason, mapUsage, sseFrame } from './sse-frame';

const log = createLogger('xiaoda-compat');

export const runtime = 'nodejs';
export const maxDuration = 120;

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function upstreamError(message: string): Response {
  return jsonResponse(500, { error: { type: 'upstream_error', message } });
}

export async function POST(request: NextRequest) {
  const authError = checkXiaodaAuth(request);
  if (authError) return authError;

  // 每日成本闸：鉴权通过后、业务执行前计数（见 ../../daily-cap）
  const chatCapError = consumeChatQuota();
  if (chatCapError) return chatCapError;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { error: { type: 'bad_request', message: 'request body must be JSON' } });
  }

  const maxTokensRaw = Number(body?.max_tokens);
  const maxOutputTokens = Number.isFinite(maxTokensRaw) && maxTokensRaw > 0 ? Math.floor(maxTokensRaw) : undefined;
  const isStream = body?.stream === true;
  const hasAudio = containsInputAudio(body?.messages);
  // 音频闸预检（不计数）：确实有 input_audio 才挡；计数在进入转写时发生
  if (hasAudio && isAudioCapExceeded()) return dailyCapExceededResponse();
  const baseUrl = resolveBaseUrl(request.headers);

  // 含音频的流式请求：转写推迟到流内，reasoning 进度帧先行（详见 audio-progress-stream.ts）
  if (isStream && hasAudio) {
    const audioProviders = resolveTutorAgentProviderFallbacks(process.env, {});
    const audioProvider = audioProviders.find((p) => Boolean(p.apiKey));
    if (!audioProvider) {
      log.error('no LLM provider api key configured');
      return jsonResponse(500, { error: { type: 'config_error', message: 'LLM API key not configured' } });
    }
    return audioProgressStreamResponse({ provider: audioProvider, messagesRaw: body.messages, maxOutputTokens, baseUrl });
  }

  const messages = await normalizeMessages(body?.messages);
  if (messages.length === 0) {
    return jsonResponse(400, { error: { type: 'bad_request', message: 'messages must contain at least one non-system message with text or audio' } });
  }

  const providers = resolveTutorAgentProviderFallbacks(process.env, {});
  const provider = providers.find((p) => Boolean(p.apiKey));
  if (!provider) {
    log.error('no LLM provider api key configured');
    return jsonResponse(500, { error: { type: 'config_error', message: 'LLM API key not configured' } });
  }

  const model = createTutorAgentChatModel(provider, { thinking: false });
  log.debug('chat start', {
    model: provider.modelId,
    keySource: provider.keySource,
    stream: isStream,
    maxOutputTokens,
    messageCount: messages.length,
    promptVersion: PROMPT_VERSIONS.rehearsalSystem,
  });

  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  let result: ReturnType<typeof streamText>;
  try {
    result = streamText({
      model,
      system: REHEARSAL_SYSTEM_PROMPT,
      messages,
      maxOutputTokens,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('streamText init failed', { model: provider.modelId, err: message });
    return upstreamError(message);
  }

  if (!isStream) {
    // 非流式：拼全量文本后一次性返回 OpenAI JSON
    try {
      let content = '';
      for await (const delta of result.textStream) content += delta;
      const [usage, finishReason] = await Promise.all([result.usage, result.finishReason]);
      // 讲稿产物：有【讲稿开始】/【讲稿结束】标记 → docx 附件 + 在线上场包链接
      const artifacts = await buildDraftArtifacts(content, baseUrl);
      if (artifacts) content += artifacts.noteLine;
      log.debug('chat done', { model: provider.modelId, chars: content.length, usage: mapUsage(usage) });
      return jsonResponse(200, {
        id,
        object: 'chat.completion',
        created,
        model: COMPAT_MODEL_ID,
        choices: [{
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: mapFinishReason(finishReason),
        }],
        usage: mapUsage(usage),
        ...(artifacts ? { x_soda: artifacts.xSoda } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('upstream stream failed before any output', { model: provider.modelId, err: message });
      return upstreamError(message);
    }
  }

  // 流式：先探第一个增量——未产出任何内容就抛错时还能回 HTTP 500 JSON
  const iterator = result.textStream[Symbol.asyncIterator]();
  let first: IteratorResult<string>;
  try {
    first = await iterator.next();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('upstream failed before first token', { model: provider.modelId, err: message });
    return upstreamError(message);
  }

  const chunkBase = { id, object: 'chat.completion.chunk', created, model: COMPAT_MODEL_ID } as const;
  const stream = new ReadableStream<string>({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(sseFrame(payload));
      try {
        // 1. role 首帧
        send({ ...chunkBase, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
        // 2. 增量帧（同时累计全量文本，供讲稿 marker 解析）
        let fullText = '';
        if (!first.done && first.value) {
          fullText += first.value;
          send({ ...chunkBase, choices: [{ index: 0, delta: { content: first.value }, finish_reason: null }] });
        }
        let next = first.done ? first : await iterator.next();
        while (!next.done) {
          if (next.value) {
            fullText += next.value;
            send({ ...chunkBase, choices: [{ index: 0, delta: { content: next.value }, finish_reason: null }] });
          }
          next = await iterator.next();
        }
        // 3. 讲稿产物：有标记 → 先补一帧在线查看链接，stop 帧挂 x_soda.attachments
        const artifacts = await buildDraftArtifacts(fullText, baseUrl);
        if (artifacts) {
          send({ ...chunkBase, choices: [{ index: 0, delta: { content: artifacts.noteLine }, finish_reason: null }] });
        }
        // 4. stop 帧（带 usage）
        const [usage, finishReason] = await Promise.all([result.usage, result.finishReason]);
        send({
          ...chunkBase,
          choices: [{ index: 0, delta: {}, finish_reason: mapFinishReason(finishReason) }],
          usage: mapUsage(usage),
          ...(artifacts ? { x_soda: artifacts.xSoda } : {}),
        });
        log.debug('stream done', { model: provider.modelId, usage: mapUsage(usage) });
      } catch (err) {
        // 流式中途出错：补一个带 error 的 stop 帧，再正常收尾
        const message = err instanceof Error ? err.message : String(err);
        log.error('upstream stream error mid-flight', { model: provider.modelId, err: message });
        send({
          ...chunkBase,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          error: { type: 'upstream_error', message },
        });
      } finally {
        // 5. [DONE] 哨兵
        controller.enqueue('data: [DONE]\n\n');
        controller.close();
      }
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}
