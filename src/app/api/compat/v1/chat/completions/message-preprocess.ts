// 清小搭 chat/completions 消息预处理 — OpenAI messages → ModelMessage[]
//
// 从 route.ts 拆出（文件行数护栏）：content 多模态 part 拼接、input_audio
// 转写注入、角色降级。流式 / 非流式共用；含音频的流式请求通过 onAudioProgress
// 把转写阶段回报给 SSE 层发 reasoning 进度帧（见 route.ts 与 ../DOMAIN.md）。

import type { ModelMessage } from 'ai';
import {
  extractInputAudioRefs,
  transcribeInputAudio,
  type TranscribeProgress,
} from '../../audio-transcribe';

interface RawCompatMessage {
  role?: unknown;
  content?: unknown;
}

/** content 为 part 数组时只拼接 text part，其余（input_audio/image_url/file）另行处理或跳过。 */
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (part && typeof part === 'object') {
        const p = part as { type?: unknown; text?: unknown };
        if (p.type === 'text' && typeof p.text === 'string') return p.text;
      }
      return '';
    })
    .join('');
}

/** 请求 messages 里是否含 input_audio part（流式路径据此决定是否走流内转写 + 进度帧）。 */
export function containsInputAudio(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  return (raw as RawCompatMessage[]).some(
    (item) => item && typeof item === 'object' && extractInputAudioRefs(item.content).length > 0,
  );
}

/**
 * 一条消息的 content → 纯文本：text 在前，input_audio 转写块在后。
 * 多个 audio part 串行处理；单个失败只留降级说明，不影响其余 part。
 */
async function resolveMessageContent(
  content: unknown,
  onAudioProgress?: TranscribeProgress,
): Promise<string> {
  const text = extractTextContent(content);
  const audioRefs = extractInputAudioRefs(content);
  const blocks: string[] = [];
  for (const ref of audioRefs) {
    const outcome = await transcribeInputAudio(ref, onAudioProgress);
    blocks.push(outcome.ok ? `[语音试讲转写]\n${outcome.text}` : '[语音转写失败，已忽略]');
  }
  return [text, ...blocks].filter(Boolean).join('\n\n');
}

/**
 * OpenAI messages → ModelMessage[]（{role, content: string} 纯文本形态）。
 * system 一律丢弃（persona 由服务端固定）；tool 角色降级为 user（纯文本链路无 tool 协议）。
 * 流式 / 非流式共用本预处理（含 input_audio 转写）。
 */
export async function normalizeMessages(
  raw: unknown,
  onAudioProgress?: TranscribeProgress,
): Promise<ModelMessage[]> {
  if (!Array.isArray(raw)) return [];
  const out: ModelMessage[] = [];
  for (const item of raw as RawCompatMessage[]) {
    if (!item || typeof item !== 'object') continue;
    const role = item.role;
    if (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'tool') continue;
    if (role === 'system') continue; // 清小搭自己的 system 不入 prompt
    const text = (await resolveMessageContent(item.content, onAudioProgress)).trim();
    if (!text) continue;
    out.push({ role: role === 'tool' ? 'user' : role, content: text });
  }
  return out;
}
