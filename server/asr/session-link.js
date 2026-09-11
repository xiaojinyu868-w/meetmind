/**
 * server/asr/session-link.js
 *
 * ASR 代理里"一条客户端连接"的链路守护纯函数（2026-09-11 实时字幕断连治理）：
 *
 *   1. 课堂时间轴偏移：客户端断线重连后，上游任务的句级时间戳从 0 重新计起；
 *      客户端在连接建立时发 `{type:'timeline-offset', offsetMs}` 告诉代理"这条连接第一帧音频
 *      在整节课的哪一毫秒"，代理把**上游 / 墙钟推出来的**时间戳平移回课堂时间轴。
 *      客户端 VAD 事件自带的时间本来就是课堂时间轴，不再平移。
 *   2. 上游就绪超时 / 客户端存活判定的阈值与判定函数：代理侧不再有"上游永远不 ready、
 *      客户端早死了但上游会话还开着"这两种悬挂。
 *
 * 全部 pure function，CommonJS 以匹配 server.js；`make test-server` 覆盖。
 */

'use strict';

/** 连上上游后多久没 ready 就放弃这条连接（客户端会重连）：覆盖 DashScope 冷启动，不让一次卡死拖成整节课没字幕 */
const UPSTREAM_READY_TIMEOUT_MS = 20_000;
/** 客户端每 15s 一次 ping；超过这个时长一条消息都没收到就当作半开连接，终止并收尾上游会话 */
const CLIENT_IDLE_TIMEOUT_MS = 60_000;
/** 存活检查节奏 */
const CLIENT_LIVENESS_CHECK_INTERVAL_MS = 15_000;

/**
 * 解析客户端的 timeline-offset 消息。非法值一律 0（不平移），上限 24 小时防脏数据。
 * @param {unknown} msg
 * @returns {number|null} 合法返回偏移毫秒数；不是这类消息返回 null
 */
function parseTimelineOffsetMessage(msg) {
  if (!msg || typeof msg !== 'object' || msg.type !== 'timeline-offset') return null;
  const value = Number(msg.offsetMs);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.round(value), 24 * 60 * 60 * 1000);
}

/**
 * 把一对上游 / 墙钟时间戳平移到课堂时间轴。
 * @param {{beginTime:number,endTime:number}} span
 * @param {number} offsetMs
 */
function shiftSpan(span, offsetMs) {
  const offset = Number.isFinite(offsetMs) && offsetMs > 0 ? offsetMs : 0;
  const beginTime = Math.max(0, Number(span.beginTime) || 0) + offset;
  const endTime = Math.max(beginTime, (Number(span.endTime) || 0) + offset);
  return { beginTime, endTime };
}

/**
 * 客户端是否已经不再说话（半开）：最后一条消息距今超过阈值。
 * @param {{lastClientMessageAt:number, now:number, timeoutMs?:number}} params
 */
function isClientIdle(params) {
  const timeoutMs = params.timeoutMs ?? CLIENT_IDLE_TIMEOUT_MS;
  return params.now - params.lastClientMessageAt > timeoutMs;
}

/** 句末静音（上游 VAD）与 interim 下发节流的允许区间：与 env 兜底同一把尺 */
const TURN_SILENCE_RANGE = { min: 200, max: 3000 };
const DRAFT_FLUSH_RANGE = { min: 200, max: 2500 };

/**
 * 一条连接的回合节奏：课堂录音要的是句子完整（静音 1s 断句、interim 800ms 一发就够），
 * 「讲给同桌听」要的是"你停下评委就接"（2026-09-11：静音 500ms 断句、interim 250ms 一发）。
 * 同一条 /api/asr-stream 通道，由客户端在 WS URL 查询串里按用途申明（`vadSilenceMs` / `draftFlushMs`），
 * 缺省或非法值回落 env / 默认；越界钳到区间内（上游 max_sentence_silence 只接受 [200, 6000]）。
 * @param {{query?: Record<string, unknown>, env?: Record<string, string|undefined>}} params
 * @returns {{turnSilenceMs:number, draftFlushMs:number}}
 */
function resolveTurnTuning(params = {}) {
  const query = params.query || {};
  const env = params.env || {};
  const pick = (queryValue, envValue, range, fallback) => {
    const fromQuery = typeof queryValue === 'string' && queryValue.trim() ? Number(queryValue) : NaN;
    const fromEnv = typeof envValue === 'string' && envValue.trim() ? Number(envValue) : NaN;
    const value = Number.isFinite(fromQuery) ? fromQuery : Number.isFinite(fromEnv) ? fromEnv : fallback;
    return Math.min(range.max, Math.max(range.min, Math.round(value)));
  };
  return {
    turnSilenceMs: pick(query.vadSilenceMs, env.DASHSCOPE_ASR_WS_VAD_SILENCE_MS, TURN_SILENCE_RANGE, 1000),
    draftFlushMs: pick(query.draftFlushMs, env.ASR_DRAFT_FLUSH_MS, DRAFT_FLUSH_RANGE, 800),
  };
}

module.exports = {
  UPSTREAM_READY_TIMEOUT_MS,
  CLIENT_IDLE_TIMEOUT_MS,
  CLIENT_LIVENESS_CHECK_INTERVAL_MS,
  parseTimelineOffsetMessage,
  shiftSpan,
  isClientIdle,
  resolveTurnTuning,
};
