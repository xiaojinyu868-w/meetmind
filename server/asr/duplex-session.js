'use strict';

/**
 * Qwen-Audio-3.0-ASR / Fun-ASR 新一代模型的 duplex 任务协议构造器。
 *
 * 协议来源（以官方 API reference 为准，不要发明字段）：
 *   - 实时用户指南: https://help.aliyun.com/zh/model-studio/real-time-speech-recognition-user-guide
 *   - 客户端事件:   https://help.aliyun.com/en/model-studio/fun-asr-client-events
 *
 * 与旧 Qwen3-ASR-Flash-Realtime（Omni Realtime 协议）的差异：
 *   - 上游地址 /api-ws/v1/inference（不带 ?model=），鉴权头 `Authorization: bearer <key>`
 *   - 连接后发送 run-task（JSON），收到 task-started 后直接发二进制 PCM 帧（不再 base64 包 JSON）
 *   - 结果事件 result-generated，文本在 payload.output.sentence（含 begin_time/end_time/sentence_end/words）
 *   - 结束发 finish-task；收尾事件 task-finished；失败 task-failed（header.error_message）
 *   - 支持 continue-task 在任务进行中更新上下文
 */

const crypto = require('crypto');

/** 新协议上游默认地址（经典域名；可用 DASHSCOPE_ASR_WS_URL 整体覆盖，如 WorkspaceId 专属域名） */
const DUPLEX_WSS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
/** 旧 Omni Realtime 协议上游默认地址 */
const LEGACY_WSS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';

/**
 * 按模型族选择协议：qwen-audio-3.0* / fun-asr* 走 duplex 任务协议，
 * qwen3-asr* 走旧 Omni Realtime 协议。
 */
function isDuplexAsrModel(model) {
  return /^(qwen-audio-3\.0|fun-asr)/i.test(String(model || '').trim());
}

/**
 * 解析实时上游 WS 地址。env 显式覆盖优先；否则按模型族选择默认域名路径。
 * 旧族需要在 query 上带 ?model=，新族模型名在 run-task 的 payload.model 里。
 */
function resolveAsrWsUrl(model, envOverride) {
  if (envOverride && String(envOverride).trim()) {
    return String(envOverride).trim();
  }
  return isDuplexAsrModel(model) ? DUPLEX_WSS_URL : `${LEGACY_WSS_URL}?model=${encodeURIComponent(model)}`;
}

/** 官方示例：32 位 hex task_id（UUID 去横线） */
function generateDuplexTaskId() {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * 上下文增强：context 是消息数组，放在 payload.input.context。
 * 官方限制：input_text 类型消息最多 5 条，每轮 user+assistant 合计 ≤ 400 字符（超出从尾部截断）。
 * 课堂术语表是单向的 user 词表，因此把长 hint 按 400 字符切成最多 5 条 user 消息。
 */
const DUPLEX_CONTEXT_MAX_MESSAGES = 5;
const DUPLEX_CONTEXT_MAX_CHARS_PER_MESSAGE = 400;

function buildDuplexContextMessages(contextHint) {
  const text = typeof contextHint === 'string' ? contextHint.trim() : '';
  if (!text) return [];

  const messages = [];
  for (
    let offset = 0;
    offset < text.length && messages.length < DUPLEX_CONTEXT_MAX_MESSAGES;
    offset += DUPLEX_CONTEXT_MAX_CHARS_PER_MESSAGE
  ) {
    const chunk = text.slice(offset, offset + DUPLEX_CONTEXT_MAX_CHARS_PER_MESSAGE);
    if (!chunk) break;
    messages.push({
      role: 'user',
      content: [{ type: 'input_text', text: chunk }],
    });
  }
  return messages;
}

/**
 * run-task 消息。
 * 参数映射（旧 Omni Realtime → 新 duplex）：
 *   - turn_detection.silence_duration_ms → parameters.max_sentence_silence（VAD 断句静音阈值，[200,6000]，默认 1300）
 *   - input_audio_transcription.corpus.text → input.context（input_text 消息数组）
 *   - input_audio_transcription.language → parameters.language_hints（数组，zh/en；auto 省略让模型自动识别）
 *   - turn_detection.threshold → 无对应参数（新协议的 speech_noise_threshold 语义不同，不映射）
 * heartbeat: true —— 默认连接在连续静音音频下 60 秒也会被服务端断开，课堂常有长静音段，必须开心跳。
 */
function buildDuplexRunTask({ taskId, model, sampleRate, languageMode = 'auto', contextHint = '', maxSentenceSilenceMs }) {
  const parameters = {
    format: 'pcm',
    sample_rate: sampleRate,
    heartbeat: true,
  };

  if (Number.isFinite(maxSentenceSilenceMs)) {
    parameters.max_sentence_silence = Math.min(6000, Math.max(200, Math.round(maxSentenceSilenceMs)));
  }

  if (languageMode === 'zh' || languageMode === 'en') {
    parameters.language_hints = [languageMode];
  }

  const context = buildDuplexContextMessages(contextHint);

  return {
    header: {
      action: 'run-task',
      task_id: taskId,
      streaming: 'duplex',
    },
    payload: {
      task_group: 'audio',
      task: 'asr',
      function: 'recognition',
      model,
      parameters,
      input: context.length > 0 ? { context } : {},
    },
  };
}

/** continue-task：任务进行中更新上下文（旧协议不支持二次 session.update，新协议用这个替代） */
function buildDuplexContinueTask({ taskId, contextHint }) {
  return {
    header: {
      action: 'continue-task',
      task_id: taskId,
      streaming: 'duplex',
    },
    payload: {
      input: {
        context: buildDuplexContextMessages(contextHint),
      },
    },
  };
}

/** finish-task：音频全部发完后通知服务端收尾，等价旧协议的 session.finish */
function buildDuplexFinishTask(taskId) {
  return {
    header: {
      action: 'finish-task',
      task_id: taskId,
      streaming: 'duplex',
    },
    payload: {
      input: {},
    },
  };
}

/**
 * 解析服务端事件为统一形状：
 *   { event: 'task-started' | 'result-generated' | 'task-finished' | 'task-failed' | string,
 *     sentence?: { text, beginTime, endTime, isFinal, words },
 *     errorMessage?: string }
 * sentence 时间戳单位毫秒；中间结果（sentence_end=false）end_time 可能为 null。
 */
function parseDuplexServerEvent(msg) {
  const event = msg && msg.header && msg.header.event ? msg.header.event : '';
  const parsed = { event };

  if (event === 'result-generated') {
    const raw = msg.payload && msg.payload.output && msg.payload.output.sentence;
    if (raw && typeof raw === 'object') {
      parsed.sentence = {
        text: typeof raw.text === 'string' ? raw.text : '',
        beginTime: typeof raw.begin_time === 'number' ? raw.begin_time : null,
        endTime: typeof raw.end_time === 'number' ? raw.end_time : null,
        isFinal: raw.sentence_end === true,
        words: Array.isArray(raw.words) ? raw.words : [],
      };
    }
  }

  if (event === 'task-failed') {
    const header = msg.header || {};
    parsed.errorMessage = [header.error_code, header.error_message].filter(Boolean).join(': ') || 'task failed';
  }

  return parsed;
}

module.exports = {
  DUPLEX_WSS_URL,
  LEGACY_WSS_URL,
  isDuplexAsrModel,
  resolveAsrWsUrl,
  generateDuplexTaskId,
  buildDuplexContextMessages,
  buildDuplexRunTask,
  buildDuplexContinueTask,
  buildDuplexFinishTask,
  parseDuplexServerEvent,
};
