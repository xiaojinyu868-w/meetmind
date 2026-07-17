'use strict';

/**
 * Qwen-ASR Realtime 的 session.update 单一配置入口。
 * 只发送官方协议字段，避免未知字段被忽略或让会话校验失败。
 */
function buildQwenAsrSessionConfig({
  sampleRate,
  languageMode = 'auto',
  contextHint = '',
  vadThreshold,
  vadSilenceMs,
}) {
  const transcription = {};
  const normalizedContext = typeof contextHint === 'string' ? contextHint.trim().slice(0, 3000) : '';
  if (normalizedContext) {
    transcription.corpus = { text: normalizedContext };
  }
  if (languageMode === 'zh' || languageMode === 'en') {
    transcription.language = languageMode;
  }

  return {
    input_audio_format: 'pcm',
    sample_rate: sampleRate,
    input_audio_transcription: transcription,
    turn_detection: {
      type: 'server_vad',
      threshold: vadThreshold,
      silence_duration_ms: vadSilenceMs,
    },
  };
}

/**
 * VAD 模式结束录音的唯一合法事件。
 * input_audio_buffer.commit 仅属于 manual mode，在 server_vad 下会报错并吞掉尾句。
 */
function buildQwenAsrFinishEvent(eventId) {
  return {
    event_id: eventId,
    type: 'session.finish',
  };
}

module.exports = { buildQwenAsrSessionConfig, buildQwenAsrFinishEvent };
