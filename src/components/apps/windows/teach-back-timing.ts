/**
 * teach-back-timing — 「讲给同桌听」回合延迟的打点通道（对齐板书播放器 `board:timing` 的做法）。
 *
 * 用户对这条线的体感要求是"像通话"：你停下 → 听见评委开口 要压到 2.5s 以内。
 * 这个数字由四段组成（回合判定 → 模型首字 → 页面出字 → 首句 TTS 出声），哪一段慢了只有打点才知道。
 * hook 在每个关键时刻 dispatch 一个 `teach-back:timing` CustomEvent（detail = { kind, at, ...}），
 * 生产环境零开销（没有监听者的事件什么都不做）；延迟尺子（Playwright 假麦克风脚本，见
 * windows/DOMAIN.md「讲给同桌听」实测段）用它算分段耗时。不要在这里写业务逻辑，也不要 console.log。
 */

export const TEACH_BACK_TIMING_EVENT = 'teach-back:timing';

export type TeachBackTimingKind =
  /** ASR 事件到达（interim 只带字数；final 带文本，用来量"最后一帧有声 → 定稿到达"） */
  | 'asr-interim'
  | 'asr-final'
  /** 停了一下（≥ pauseHangoverMs）又接着讲：detail.silenceMs = 这次换气 / 想词的长度（客户端 VAD 眼里的） */
  | 'pause-resume'
  /** 一段讲完了，状态机提交回合（detail 带 lastVoiceAt = 最后一帧有声的时刻） */
  | 'turn-commit'
  /** 提交后 ASR 定稿把这段升级 */
  | 'turn-upgrade'
  /** POST /api/apps/teach-back/turn 发出（detail.prefetch = 停下 650ms 就发的预热请求，提交前不上屏） */
  | 'request-sent'
  /** 提交时接上了预热的请求（模型已经想了一会） / 预热文字对不上重新请求 */
  | 'prefetch-adopted'
  | 'prefetch-discarded'
  /** 响应头到了（SSE 开始） */
  | 'response-headers'
  /** 评委开口（judge 事件） */
  | 'judge-open'
  /** 第一个文字增量 */
  | 'first-delta'
  /** 第一句凑齐、送 TTS */
  | 'first-sentence'
  /** 评委说完（done） / 谁都不开口 / 出错 */
  | 'done'
  | 'silent'
  | 'error'
  /** 你开口把评委打断 */
  | 'interrupt'
  /** 一句 TTS 请求发出 / 首个可播字节到 / 开始出声 */
  | 'tts-request'
  | 'tts-first-byte'
  | 'audio-start';

export interface TeachBackTimingDetail {
  kind: TeachBackTimingKind;
  /** Date.now()，与状态机事件的 `at` 同一时钟 */
  at: number;
  [key: string]: unknown;
}

/** 打一个点。SSR / 无 window 时是空操作。 */
export function markTeachBackTiming(kind: TeachBackTimingKind, detail: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  const payload: TeachBackTimingDetail = { kind, at: Date.now(), ...detail };
  window.dispatchEvent(new CustomEvent(TEACH_BACK_TIMING_EVENT, { detail: payload }));
}
