// 清小搭 input_audio 流式进度 — 含音频的 stream:true 请求专用 SSE 流程
//
// 与 route.ts 主流式路径的差异：语音转写推迟到流内执行，先返回 HTTP 头打开
// SSE，转写各阶段立刻下发 delta.reasoning 进度帧（平台 L1 思考过程，前端渲染
// 为"思考中"动画），让用户在转写期间（最长约 60s）看到可见进度：
//   正在接收语音… → 正在转写语音… → 听完了，正在分析… → role 帧 → content 帧* → stop 帧 → [DONE]
//
// 注意：reasoning 帧发出后 HTTP 头已送，此后任何错误（转写后无有效消息、
// streamText 初始化失败、首增量前上游抛错、中途断流）一律走
// "带 error 的 stop 帧 + [DONE]"流内兜底，不再回 HTTP 500（清小搭 §5.6）。
// reasoning 是进度提示不是思维链：文案面向用户，不暴露转写服务 / URL 等细节。

import { streamText } from 'ai';
import { createLogger } from '@/lib/logger';
import { REHEARSAL_SYSTEM_PROMPT, PROMPT_VERSIONS } from '@/lib/prompts/rehearsal-prompts';
import {
  createTutorAgentChatModel,
  resolveTutorAgentProviderFallbacks,
} from '@/lib/utils/tutor-agent-provider';
import type { TranscribeProgress } from '../../audio-transcribe';
import { buildDraftArtifacts } from '../../rehearsal-artifacts';
import { normalizeMessages } from './message-preprocess';
import { COMPAT_MODEL_ID, SSE_HEADERS, mapFinishReason, mapUsage, sseFrame } from './sse-frame';

const log = createLogger('xiaoda-compat');

type ResolvedProvider = ReturnType<typeof resolveTutorAgentProviderFallbacks>[number];

export function audioProgressStreamResponse(options: {
  provider: ResolvedProvider;
  messagesRaw: unknown;
  maxOutputTokens?: number;
  baseUrl: string;
}): Response {
  const { provider, messagesRaw, maxOutputTokens, baseUrl } = options;
  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunkBase = { id, object: 'chat.completion.chunk', created, model: COMPAT_MODEL_ID } as const;

  const stream = new ReadableStream<string>({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(sseFrame(payload));
      // reasoning 进度帧：chunk 结构与 content 帧一致，仅 delta 字段不同
      const sendReasoning = (reasoning: string) =>
        send({ ...chunkBase, choices: [{ index: 0, delta: { reasoning }, finish_reason: null }] });
      const sendErrorStop = (type: string, message: string) =>
        send({
          ...chunkBase,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          error: { type, message },
        });

      // 转写阶段 → 用户可见进度文案（能拿到音频时长就带上，拿不到不带）
      const onAudioProgress: TranscribeProgress = (stage, info) => {
        if (stage === 'receiving') {
          sendReasoning('正在接收语音…');
        } else if (stage === 'transcribing') {
          sendReasoning('正在转写语音…');
        } else {
          const seconds = info?.audioMs ? Math.round(info.audioMs / 1000) : 0;
          sendReasoning(seconds > 0 ? `听完了（约 ${seconds} 秒），正在分析…` : '听完了，正在分析…');
        }
      };

      try {
        // 1. 流内转写：reasoning 进度帧随 transcribeInputAudio 的阶段回调即时下发
        const messages = await normalizeMessages(messagesRaw, onAudioProgress);
        if (messages.length === 0) {
          sendErrorStop('bad_request', 'messages must contain at least one non-system message with text or audio');
          return;
        }
        log.debug('chat start (audio, in-stream transcribe)', {
          model: provider.modelId,
          keySource: provider.keySource,
          maxOutputTokens,
          messageCount: messages.length,
          promptVersion: PROMPT_VERSIONS.rehearsalSystem,
        });

        // 2. 调模型：streamText 初始化与首增量探测都在流内，失败走兜底
        const model = createTutorAgentChatModel(provider, { thinking: false });
        const result = streamText({
          model,
          system: REHEARSAL_SYSTEM_PROMPT,
          messages,
          maxOutputTokens,
        });
        const iterator = result.textStream[Symbol.asyncIterator]();
        const first = await iterator.next();

        // 3. role 首帧
        send({ ...chunkBase, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
        // 4. 增量帧（同时累计全量文本，供讲稿 marker 解析）
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
        // 5. 讲稿产物：有标记 → 先补一帧在线查看链接，stop 帧挂 x_soda.attachments
        const artifacts = await buildDraftArtifacts(fullText, baseUrl);
        if (artifacts) {
          send({ ...chunkBase, choices: [{ index: 0, delta: { content: artifacts.noteLine }, finish_reason: null }] });
        }
        // 6. stop 帧（带 usage）
        const [usage, finishReason] = await Promise.all([result.usage, result.finishReason]);
        send({
          ...chunkBase,
          choices: [{ index: 0, delta: {}, finish_reason: mapFinishReason(finishReason) }],
          usage: mapUsage(usage),
          ...(artifacts ? { x_soda: artifacts.xSoda } : {}),
        });
        log.debug('stream done', { model: provider.modelId, usage: mapUsage(usage) });
      } catch (err) {
        // reasoning 帧已送出（HTTP 头已送）：一切错误收敛为流内 error stop 帧
        const message = err instanceof Error ? err.message : String(err);
        log.error('audio stream failed mid-flight', { model: provider.modelId, err: message });
        sendErrorStop('upstream_error', message);
      } finally {
        // 7. [DONE] 哨兵
        controller.enqueue('data: [DONE]\n\n');
        controller.close();
      }
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}
