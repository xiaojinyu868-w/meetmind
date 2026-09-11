import { createLogger, track } from '@/lib/logger';
import { fullJitterDelay } from '@/lib/services/asr/text-utils';
import { buildAsrWebSocketCandidates } from '@/lib/services/asr/ws-url';
const log = createLogger('dashscope-asr');

export interface ASRSentence {
  id: string;
  text: string;
  beginTime: number;
  endTime: number | null;
  isFinal: boolean;
  confidence?: number;
  itemId?: string;
  provisional?: boolean;
  replaces?: string[];
  /** 说话人标识（腾讯云说话人分离返回，0-9） */
  speakerId?: string;
}

export interface ASRInterim {
  itemId?: string;
  text: string;
  stableText?: string;
  unstableText?: string;
  provisional?: boolean;
  beginTime?: number;
  endTime?: number;
}

/**
 * 实时字幕链路的对外状态（给录课界面的一行状态用，与内部 status 解耦）：
 *   connecting   首次连接中，还没失败过——正常一两秒，不打扰用户
 *   live         已就绪，字幕在流
 *   reconnecting 首次连接失败过 / 会话中断线，正在按退避重试；录音不受影响
 *   offline      终态失败（密钥失效、额度用完、重试次数用尽），本节课不会再有实时字幕
 */
export type ASRLinkState = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface ASRLinkInfo {
  state: ASRLinkState;
  /** 连续失败的连接轮数（live 时为 0） */
  attempts: number;
  /** 这次断开（或首次连接开始）的时刻；live 时 undefined */
  downSince?: number;
}

export interface DashScopeASRCallbacks {
  onSentence?: (sentence: ASRSentence) => void;
  onInterim?: (interim: ASRInterim) => void;
  onError?: (error: string) => void;
  onStatusChange?: (status: 'connecting' | 'connected' | 'transcribing' | 'stopped' | 'error') => void;
  onTaskStarted?: () => void;
  onTaskFinished?: () => void;
  /** 实时字幕链路状态变化（connecting → live → reconnecting → live / offline） */
  onLinkStateChange?: (info: ASRLinkInfo) => void;
  /**
   * 断连缓冲溢出导致音频帧被丢弃时上报（累计值，含代理侧）。
   * 单遍化架构下 realtime 即定稿，丢帧 = 这节课永久少一段——绝不能静默。
   */
  onAudioDropped?: (info: { droppedMsTotal: number }) => void;
}

export interface DashScopeASROptions {
  model?: string;
  sampleRate?: number;
  format?: string;
  language?: string[];
  initialContextHint?: string;
  initialLanguageMode?: 'auto' | 'zh' | 'en';
  /**
   * 首次 ready 之前允许的连接轮数（每轮把所有候选地址各试一次）。默认 1：一轮不通 `start()` 就返回 false，
   * 适合语音输入 / 讲给同桌听这类短用途。课堂 Recorder 传 Infinity——录音已经在进行，字幕晚到总比整节课没有好。
   */
  connectAttempts?: number;
  /** 会话中断线后允许的重连轮数，默认 8；课堂 Recorder 传 Infinity（录到结束为止一直试） */
  maxReconnectAttempts?: number;
  /** 重连的 base 延迟（ms），Full Jitter 的底数。默认 500 */
  reconnectBaseMs?: number;
  /** 重连延迟上限（ms），默认 10000 */
  reconnectCapMs?: number;
  /** 重连期间允许保留的音频上限（ms）；超过则丢弃最早的帧并通过 onAudioDropped 上报。默认 120000（2 分钟，覆盖锁屏/电梯/隧道场景） */
  reconnectAudioBufferMs?: number;
  /** WebSocket 握手（CONNECTING）超时基数，随失败轮数增长，默认 8000 → 上限 20000 */
  handshakeTimeoutMs?: number;
  /** 握手成功到收到 ready（代理连上上游）的超时基数，随失败轮数增长，默认 15000 → 上限 30000 */
  readyTimeoutMs?: number;
}

type ConnectOutcome = 'ready' | 'failed' | 'terminal';

/** 连接握手超时：第 n 轮 = base + n × 4s，封顶 20s（弱网首次握手慢不该等同于"整节课没字幕"） */
export function resolveHandshakeTimeoutMs(round: number, baseMs = 8_000): number {
  return Math.min(20_000, baseMs + Math.max(0, round) * 4_000);
}

/** 连上代理到上游就绪的超时：第 n 轮 = base + n × 5s，封顶 30s */
export function resolveReadyTimeoutMs(round: number, baseMs = 15_000): number {
  return Math.min(30_000, baseMs + Math.max(0, round) * 5_000);
}

/** 候选地址按轮数轮转：主地址若一直握手挂起，下一轮先试备用端口，而不是每轮都先在主地址上耗满超时 */
export function rotateCandidates<T>(candidates: T[], round: number): T[] {
  if (candidates.length <= 1) return candidates;
  const shift = Math.max(0, round) % candidates.length;
  return [...candidates.slice(shift), ...candidates.slice(0, shift)];
}

/** 这些错误重连没有意义：额度 / 密钥 / 服务未配置，立刻终止并把原因交给 UI */
export function isTerminalAsrError(message: string): boolean {
  return /ASR_QUOTA_EXCEEDED|GUEST_DAILY_ASR_CAP|API Key 未配置|密钥失效/i.test(message);
}

/** 存活判定：代理每 15s 回一次 pong，超过这个时长一条消息都没有就当作半开连接主动重连 */
const LINK_IDLE_TIMEOUT_MS = 45_000;
const KEEP_ALIVE_INTERVAL_MS = 15_000;

export class DashScopeASRClient {
  private callbacks: DashScopeASRCallbacks;
  private options: DashScopeASROptions;

  private ws: WebSocket | null = null;
  private status: 'idle' | 'connecting' | 'connected' | 'transcribing' | 'stopped' | 'error' = 'idle';
  private sentenceIndex = 0;
  private connectionGeneration = 0;
  private isReady = false;
  private audioQueue: ArrayBuffer[] = [];
  private audioQueueBytes = 0;
  /** 本会话累计送进来的 PCM 字节数（含已丢弃的）：课堂时间轴上"现在录到哪了" */
  private enqueuedAudioBytes = 0;
  // 断连丢帧统计：本地队列与代理侧队列分开记，合计对外上报。
  private localDroppedAudioMs = 0;
  private proxyDroppedAudioMs = 0;
  private lastDropNotifiedMs = 0;
  // 客户端 → ASR-proxy 这一段理论不限速，但 ASR-proxy → DashScope 有限速（2560KB/s）。
  // 累积的 chunks 在 ready/reconnect 后同步 flush 会让 ASR-proxy 瞬时大量 send → DashScope 1007。
  // 客户端也加节流，避免 ASR-proxy 缓冲瞬时过载。
  private static readonly FLUSH_BATCH_SIZE = 60;
  private static readonly FLUSH_INTERVAL_MS = 100;
  private isFlushing = false;

  /** 16kHz 16bit 单声道 PCM：每毫秒 32 字节 */
  private bytesPerMs(): number {
    return ((this.options.sampleRate ?? 16000) * 2) / 1000;
  }

  /** 断连缓冲预算（字节）：由 reconnectAudioBufferMs 推导，默认 120 秒 ≈ 3.84MB */
  private audioQueueBudgetBytes(): number {
    return (this.options.reconnectAudioBufferMs ?? 120_000) * this.bytesPerMs();
  }

  private noteLocalAudioDropped(droppedBytes: number): void {
    this.localDroppedAudioMs += droppedBytes / this.bytesPerMs();
    this.maybeNotifyAudioDropped();
  }

  private maybeNotifyAudioDropped(): void {
    const total = Math.round(this.localDroppedAudioMs + this.proxyDroppedAudioMs);
    // 首次丢失立即上报，之后每累计 1 秒再报，避免刷屏
    if (total >= 500 && total - this.lastDropNotifiedMs >= 1000) {
      this.lastDropNotifiedMs = total;
      this.callbacks.onAudioDropped?.({ droppedMsTotal: total });
    }
  }

  /** 本次会话累计丢弃的音频时长（ms），停录总结/提示用 */
  getDroppedAudioMs(): number {
    return Math.round(this.localDroppedAudioMs + this.proxyDroppedAudioMs);
  }

  /**
   * 当前队列头那一帧在课堂时间轴上的位置（ms）。
   * 重连后上游任务的时间戳从 0 重新计起，客户端在连接建立时把这个偏移告诉代理，
   * 代理把句级时间戳平移回整节课的时间轴（丢帧只从队头丢，所以队列永远是时间轴上连续的尾段）。
   */
  private timelineOffsetMs(): number {
    return Math.max(0, Math.round((this.enqueuedAudioBytes - this.audioQueueBytes) / this.bytesPerMs()));
  }

  private sessionStartTime = 0;

  // ── 连接状态机 ──
  private userStopRequested = false;
  /** 终态：密钥 / 额度 / 重试次数用尽，不再重连 */
  private terminal = false;
  private started = false;
  private startResolver: ((ok: boolean) => void) | null = null;
  /** 连续失败的连接轮数（ready 后清零） */
  private connectRound = 0;
  /** 本会话是否曾经 ready 过（决定用 connectAttempts 还是 maxReconnectAttempts 作上限） */
  private hasBeenReady = false;
  private downSince = 0;
  private lastInboundAt = 0;
  private linkState: ASRLinkState | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private stopFinishedResolver: (() => void) | null = null;
  private readonly sessionId = `asr-realtime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  constructor(
    _apiKey: string,
    callbacks: DashScopeASRCallbacks = {},
    options: DashScopeASROptions = {}
  ) {
    this.callbacks = callbacks;
    this.options = {
      model: 'qwen3-asr-flash-realtime-2026-02-10',
      sampleRate: 16000,
      format: 'pcm',
      language: ['zh'],
      ...options,
    };
  }

  private normalizeErrorMessage(error: unknown, fallback = '识别错误'): string {
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
  }

  private isIgnorableStopError(error: string): boolean {
    if (typeof error !== 'string') return false;
    return this.status === 'stopped' && /error committing input audio buffer/i.test(error);
  }

  private isIgnorableSessionUpdateError(error: string): boolean {
    if (typeof error !== 'string') return false;
    return /session already started or finished or failed/i.test(error);
  }

  /**
   * 开始连接。resolve(true) = 首次 ready；resolve(false) = 终态失败或在 ready 前被 stop()。
   * 首次连接失败不再直接放弃：按 connectAttempts 轮数退避重试，期间 PCM 继续有界排队。
   */
  async start(): Promise<boolean> {
    if (this.started) {
      log.warn('[DashScopeASR] Already started');
      return this.hasBeenReady && !this.terminal;
    }
    this.started = true;
    this.userStopRequested = false;
    this.terminal = false;
    this.connectRound = 0;
    this.hasBeenReady = false;
    this.sentenceIndex = 0;
    this.audioQueue = [];
    this.audioQueueBytes = 0;
    this.enqueuedAudioBytes = 0;
    this.sessionStartTime = 0;
    this.downSince = Date.now();

    const promise = new Promise<boolean>((resolve) => {
      this.startResolver = resolve;
    });
    this.updateStatus('connecting');
    this.setLink('connecting');
    void this.runConnectRound();
    return promise;
  }

  private settleStart(ok: boolean): void {
    const resolve = this.startResolver;
    this.startResolver = null;
    resolve?.(ok);
  }

  private setLink(state: ASRLinkState): void {
    if (this.linkState === state && state !== 'reconnecting') return;
    this.linkState = state;
    this.callbacks.onLinkStateChange?.({
      state,
      attempts: this.connectRound,
      downSince: state === 'live' ? undefined : (this.downSince || undefined),
    });
  }

  /** 一轮连接：把候选地址按轮数轮转后依次试；整轮失败按 Full Jitter 退避再来一轮 */
  private async runConnectRound(): Promise<void> {
    if (this.userStopRequested || this.terminal) return;
    const round = this.connectRound;
    const candidates = rotateCandidates(buildAsrWebSocketCandidates(window.location.href), round);
    const handshakeTimeoutMs = resolveHandshakeTimeoutMs(round, this.options.handshakeTimeoutMs);
    const readyTimeoutMs = resolveReadyTimeoutMs(round, this.options.readyTimeoutMs);

    for (const url of candidates) {
      if (this.userStopRequested || this.terminal) return;
      let outcome: ConnectOutcome;
      try {
        outcome = await this.openSocket(url, { handshakeTimeoutMs, readyTimeoutMs });
      } catch (error) {
        log.error('[DashScopeASR] Failed to open socket:', error);
        outcome = 'failed';
      }
      if (outcome === 'ready' || outcome === 'terminal') return;
    }
    if (this.userStopRequested || this.terminal) return;

    // 整轮都没连上
    this.connectRound += 1;
    const limit = this.hasBeenReady
      ? (this.options.maxReconnectAttempts ?? 8)
      : (this.options.connectAttempts ?? 1);
    if (this.connectRound >= limit) {
      this.failTerminal(
        this.hasBeenReady ? '实时转写连接断开，请重新开始录音。' : '所有连接端口均失败',
        this.hasBeenReady ? 'RECONNECT_EXHAUSTED' : 'CONNECT_EXHAUSTED',
      );
      return;
    }
    const delay = fullJitterDelay(
      this.connectRound - 1,
      this.options.reconnectBaseMs ?? 500,
      this.options.reconnectCapMs ?? 10000,
    );
    // 前几轮逐条记，之后每 5 轮记一次：长时间断网时不用几十条同样的日志刷屏
    if (this.connectRound <= 3 || this.connectRound % 5 === 0) {
      log.warn(`[DashScopeASR] connect round ${this.connectRound} failed, retrying in ${delay}ms`, {
        hasBeenReady: this.hasBeenReady,
        downForMs: this.downSince ? Date.now() - this.downSince : 0,
      });
    }
    this.updateStatus('connecting');
    this.setLink('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.runConnectRound();
    }, delay);
  }

  /** 打开一条 WebSocket 并等到 ready / 失败 / 终态。会话中断线在这里的 onclose 里转入重连。 */
  private openSocket(
    wsUrl: string,
    timeouts: { handshakeTimeoutMs: number; readyTimeoutMs: number },
  ): Promise<ConnectOutcome> {
    return new Promise<ConnectOutcome>((resolve) => {
      // 积分 Phase 2：浏览器 WebSocket 不能带 Authorization 头，
      // JWT 走 ?token= 查询参数；server.js 在连接关闭时结算原样回传。
      // 未登录（guest）不带 token，服务端只记影子流水不扣分。
      const authToken = typeof window !== 'undefined'
        ? window.localStorage.getItem('meetmind_access_token') || window.localStorage.getItem('auth_token')
        : null;
      const wsUrlWithAuth = authToken
        ? `${wsUrl}${wsUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(authToken)}`
        : wsUrl;

      this.isReady = false;
      this.connectionGeneration += 1;
      const ws = new WebSocket(wsUrlWithAuth);
      this.ws = ws;

      let settled = false;
      let becameReady = false;
      let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
      let readyTimer: ReturnType<typeof setTimeout> | null = null;
      const clearTimers = () => {
        if (handshakeTimer) { clearTimeout(handshakeTimer); handshakeTimer = null; }
        if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
      };
      const settle = (outcome: ConnectOutcome) => {
        if (settled) return;
        settled = true;
        clearTimers();
        resolve(outcome);
      };
      const closeQuietly = () => {
        try { ws.close(); } catch { /* ignore */ }
      };

      // 握手挂起（弱网 / 代理对同一 endpoint 的连接锁）：到点关掉换下一个候选，不再是死等 5s 后整体放弃
      handshakeTimer = setTimeout(() => {
        if (this.ws === ws && ws.readyState === WebSocket.CONNECTING) {
          log.warn(`[DashScopeASR] handshake timeout after ${timeouts.handshakeTimeoutMs}ms: ${wsUrl}`);
          closeQuietly();
        }
      }, timeouts.handshakeTimeoutMs);
      // 连上代理但上游一直不就绪（DashScope 慢 / 额度预检卡住）：同样算这次失败
      readyTimer = setTimeout(() => {
        if (this.ws === ws && !becameReady) {
          log.warn(`[DashScopeASR] ready timeout after ${timeouts.readyTimeoutMs}ms: ${wsUrl}`);
          closeQuietly();
        }
      }, timeouts.readyTimeoutMs);

      ws.onopen = () => {
        if (this.ws !== ws) return;
        this.lastInboundAt = Date.now();
        this.updateStatus('connected');
        // 先告诉代理这条连接的音频从课堂时间轴的哪一毫秒开始（重连后上游时间戳从 0 计起）
        this.sendTimelineOffset();
        this.sendContextHint(
          this.options.initialContextHint || '',
          this.options.initialLanguageMode || 'auto'
        );
      };

      ws.onmessage = (event) => {
        if (this.ws !== ws) return;
        this.lastInboundAt = Date.now();
        const wasReady = this.isReady;
        this.handleMessage(event.data);
        if (this.terminal) {
          settle('terminal');
          return;
        }
        if (!wasReady && this.isReady) {
          becameReady = true;
          this.onReady();
          settle('ready');
        }
      };

      ws.onerror = () => {
        // onclose 一定跟着来，重试决策在那里做；这里不刷日志
      };

      ws.onclose = (event) => {
        if (this.ws === ws) this.ws = null;
        clearTimers();
        this.stopKeepAlive();
        this.isReady = false;
        this.resolveStopFinished();

        // 4401 = 服务端标记的鉴权失败，重连无意义，立刻给用户清晰提示
        if (event.code === 4401) {
          this.failTerminal('实时转写服务密钥失效，请联系管理员更新 DashScope 密钥后重试', 'AUTH_FAILED');
          settle('terminal');
          return;
        }
        if (this.terminal) {
          settle('terminal');
          return;
        }
        if (this.userStopRequested) {
          if (this.status !== 'stopped') this.updateStatus('stopped');
          settle('failed');
          return;
        }
        if (becameReady) {
          // 会话中断线：这条 promise 早已 resolve('ready')，这里转入重连
          this.onSessionDropped(event.code, event.reason);
          return;
        }
        settle('failed');
      };
    });
  }

  private onReady(): void {
    const wasDown = this.hasBeenReady && this.downSince > 0;
    const downForMs = this.downSince > 0 ? Date.now() - this.downSince : 0;
    this.hasBeenReady = true;
    this.connectRound = 0;
    this.downSince = 0;
    this.startKeepAlive();
    this.setLink('live');
    this.settleStart(true);
    if (wasDown) {
      log.info('[DashScopeASR] Reconnected, replaying buffered audio', {
        downForMs,
        bufferedChunks: this.audioQueue.length,
        bufferedMs: Math.round(this.audioQueueBytes / this.bytesPerMs()),
        droppedMs: this.getDroppedAudioMs(),
      });
      track({
        kind: 'asr.success',
        mode: 'realtime-reconnect',
        sessionId: this.sessionId,
        durationMs: downForMs,
      });
    }
  }

  /** 会话中断线（曾 ready 过）：立刻按退避重连；音频继续在有界队列里等 */
  private onSessionDropped(code: number, reason: string): void {
    if (this.userStopRequested || this.terminal) return;
    this.downSince = this.downSince || Date.now();
    this.connectRound = 0;
    log.warn(`[DashScopeASR] Unexpected close (code=${code}, reason=${reason || '-'}), reconnecting`);
    this.updateStatus('connecting');
    this.setLink('reconnecting');
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = fullJitterDelay(0, this.options.reconnectBaseMs ?? 500, this.options.reconnectCapMs ?? 10000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.runConnectRound();
    }, delay);
  }

  private failTerminal(message: string, errorCode: string): void {
    if (this.terminal) return;
    this.terminal = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopKeepAlive();
    this.isReady = false;
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    track({
      kind: 'asr.fail',
      mode: this.hasBeenReady ? 'realtime-reconnect' : 'realtime-connect',
      sessionId: this.sessionId,
      durationMs: this.downSince ? Date.now() - this.downSince : 0,
      errorCode,
      errorMsg: message,
    });
    this.updateStatus('error');
    this.setLink('offline');
    this.callbacks.onError?.(message);
    this.settleStart(false);
  }

  private handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data);

      if (msg.error) {
        const errorMessage = this.normalizeErrorMessage(msg.error);
        this.handleErrorMessage(errorMessage);
        return;
      }

      switch (msg.event) {
        case 'ready':
          this.isReady = true;
          this.sessionStartTime = Date.now();
          this.updateStatus('transcribing');
          this.callbacks.onTaskStarted?.();
          // 队头还是同一帧：再发一次偏移（onopen 那次可能落在代理挂处理器之前），紧接着补送音频
          this.sendTimelineOffset();
          this.flushAudioQueue();
          break;

        // 服务端检测到 DashScope 401/403 时下发 auth_failed：鉴权失败重连无意义，立刻终止
        case 'auth_failed': {
          const reason = typeof msg.error === 'string' ? msg.error : '识别服务密钥失效';
          this.failTerminal(`${reason}（请联系管理员更新 DashScope 密钥）`, 'AUTH_FAILED');
          break;
        }

        case 'result':
          this.handleResult(msg.sentence, msg.replaces, msg.provisional, msg.speakerId);
          break;

        case 'interim': {
          const payload: ASRInterim = {
            itemId: typeof msg.itemId === 'string' ? this.namespaceRemoteId(msg.itemId) : undefined,
            text: typeof msg.text === 'string' ? msg.text : '',
            stableText: typeof msg.stableText === 'string' ? msg.stableText : undefined,
            unstableText: typeof msg.unstableText === 'string' ? msg.unstableText : undefined,
            provisional: msg.provisional !== false,
            beginTime: typeof msg.beginTime === 'number' ? msg.beginTime : undefined,
            endTime: typeof msg.endTime === 'number' ? msg.endTime : undefined,
          };

          if (payload.text || payload.itemId) {
            this.callbacks.onInterim?.(payload);
          }
          break;
        }

        case 'finished':
          if (this.userStopRequested) {
            this.updateStatus('stopped');
            this.callbacks.onTaskFinished?.();
            this.resolveStopFinished();
          } else {
            // 不是我们要求的结束：上游任务自己收尾了（长静音 / 上游异常），这条连接后面的音频只会被代理丢掉。
            // 主动关掉，onclose 会按会话断线重连，队列里的音频重连后补送。
            log.warn('[DashScopeASR] upstream finished mid-session, forcing reconnect');
            this.forceReconnect('upstream-finished');
          }
          break;

        // 代理侧（proxy→DashScope 段）缓冲溢出丢帧：取代理上报的累计值
        case 'audio-dropped': {
          const proxyTotal = typeof msg.droppedMsTotal === 'number' ? msg.droppedMsTotal : 0;
          if (proxyTotal > this.proxyDroppedAudioMs) {
            this.proxyDroppedAudioMs = proxyTotal;
            this.maybeNotifyAudioDropped();
          }
          break;
        }

        case 'error': {
          const errorMessage = this.normalizeErrorMessage(msg.error ?? msg.message);
          this.handleErrorMessage(errorMessage);
          break;
        }

        case 'closed':
          if (this.userStopRequested) {
            this.updateStatus('stopped');
            this.resolveStopFinished();
          } else if (this.isReady) {
            this.forceReconnect('upstream-closed');
          }
          break;
      }
    } catch (error) {
      log.error('[DashScopeASR] Failed to parse message:', error);
    }
  }

  private handleErrorMessage(errorMessage: string): void {
    if (this.isIgnorableStopError(errorMessage)) {
      log.warn('[DashScopeASR] Ignore stop-time commit error:', errorMessage);
      return;
    }
    if (this.isIgnorableSessionUpdateError(errorMessage)) {
      log.warn('[DashScopeASR] Ignore session update error (non-fatal):', errorMessage);
      return;
    }
    if (isTerminalAsrError(errorMessage)) {
      this.failTerminal(errorMessage, 'TERMINAL_ERROR');
      return;
    }
    // 瞬时错误（上游连接错误 / task-failed）：告诉 UI，但不进终态——代理随后会关连接，onclose 走重连
    log.warn('[DashScopeASR] transient error:', errorMessage);
    this.callbacks.onError?.(errorMessage);
  }

  /** 连接名义上还开着但已经没用了（上游收尾 / 长时间无消息）：关掉让 onclose 走正常重连 */
  private forceReconnect(reason: string): void {
    const ws = this.ws;
    if (!ws) return;
    log.warn(`[DashScopeASR] force reconnect (${reason})`);
    try { ws.close(); } catch { /* ignore */ }
  }

  private handleResult(
    sentence:
      | {
          id?: string;
          text?: string;
          beginTime?: number;
          endTime?: number | null;
          isFinal?: boolean;
          itemId?: string;
          confidence?: number;
          speakerId?: string;
        }
      | undefined,
    replaces?: string[],
    provisional?: boolean,
    speakerId?: string,
  ): void {
    if (!sentence || !sentence.text) return;

    const finalSpeakerId = sentence.speakerId || speakerId;

    if (sentence.isFinal !== false) {
      const beginTime = sentence.beginTime ?? 0;
      const endTime = sentence.endTime ?? beginTime + 1000;

      const rawId = sentence.id || `seg-${Date.now()}-${this.sentenceIndex++}`;
      const result: ASRSentence = {
        id: this.namespaceRemoteId(rawId),
        text: sentence.text,
        beginTime,
        endTime,
        isFinal: true,
        confidence: sentence.confidence,
        itemId: sentence.itemId ? this.namespaceRemoteId(sentence.itemId) : undefined,
        provisional: provisional === true,
        replaces: Array.isArray(replaces)
          ? replaces.map((id) => this.namespaceRemoteId(id))
          : undefined,
        speakerId: finalSpeakerId,
      };
      this.callbacks.onSentence?.(result);
    } else {
      this.callbacks.onInterim?.({
        itemId: sentence.itemId ? this.namespaceRemoteId(sentence.itemId) : undefined,
        text: sentence.text,
        provisional: true,
        beginTime: sentence.beginTime,
        endTime: sentence.endTime ?? undefined,
      });
    }
  }

  sendAudio(audioData: ArrayBuffer | Blob): void {
    if (audioData instanceof Blob) {
      audioData.arrayBuffer().then((buffer) => this.sendAudioBuffer(buffer));
    } else {
      this.sendAudioBuffer(audioData);
    }
  }

  private sendAudioBuffer(buffer: ArrayBuffer): void {
    if (this.terminal || this.userStopRequested) return;
    this.enqueuedAudioBytes += buffer.byteLength;
    // ready/reconnect 后旧缓冲会分批回放。新音频必须继续排在旧缓冲后面，
    // 否则上游收到乱序 PCM，表现为重复、吞字或时间轴倒退。
    if (!this.isReady || this.isFlushing || this.audioQueue.length > 0) {
      this.audioQueue.push(buffer);
      this.audioQueueBytes += buffer.byteLength;
      // 超出断连缓冲预算：丢最旧帧并上报（单遍化后丢帧=内容永久缺失，绝不静默）
      const budget = this.audioQueueBudgetBytes();
      while (this.audioQueueBytes > budget && this.audioQueue.length > 0) {
        const dropped = this.audioQueue.shift();
        if (dropped) {
          this.audioQueueBytes -= dropped.byteLength;
          this.noteLocalAudioDropped(dropped.byteLength);
        }
      }
      if (this.isReady) this.flushAudioQueue();
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buffer);
    }
  }

  private namespaceRemoteId(remoteId: string): string {
    return `${this.sessionId}:${this.connectionGeneration}:${remoteId}`;
  }

  private flushAudioQueue(): void {
    if (this.isFlushing) return;
    if (this.audioQueue.length === 0) return;
    this.isFlushing = true;
    this.flushNextAudioBatch();
  }

  private flushNextAudioBatch(): void {
    if (!this.isFlushing) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.isFlushing = false;
      return;
    }

    const batchSize = Math.min(DashScopeASRClient.FLUSH_BATCH_SIZE, this.audioQueue.length);
    for (let i = 0; i < batchSize; i += 1) {
      const buffer = this.audioQueue.shift();
      if (buffer) {
        this.audioQueueBytes -= buffer.byteLength;
        this.ws.send(buffer);
      }
    }

    if (this.audioQueue.length === 0) {
      this.isFlushing = false;
      return;
    }

    setTimeout(() => this.flushNextAudioBatch(), DashScopeASRClient.FLUSH_INTERVAL_MS);
  }

  /** 连接建立时告诉代理：这条连接第一帧音频在课堂时间轴上的位置（首次连接为 0） */
  private sendTimelineOffset(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const offsetMs = this.timelineOffsetMs();
    if (offsetMs <= 0) return;
    this.ws.send(JSON.stringify({ type: 'timeline-offset', offsetMs }));
  }

  /**
   * Send initial context hint (hot words, course topic, references) to server
   * before audio starts flowing. The server injects this into DashScope session.
   *
   * @param contextHint 热词 / 术语表 / 课程背景
   * @param languageMode 语种模式：
   *   - 'auto'（默认）= 不传 language 参数（Qwen 官方推荐：混合语种或不确定时应省略）
   *   - 'zh' = 明确中文
   *   - 'en' = 明确英文
   */
  sendContextHint(contextHint: string, languageMode: 'auto' | 'zh' | 'en' = 'auto'): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // 允许空 hint 但指定 languageMode 的场景（比如录课一开始没有热词，但用户选了英文课）
    if (!contextHint.trim() && languageMode === 'auto') return;

    this.ws.send(
      JSON.stringify({
        type: 'context-hint',
        contextHint: contextHint.trim(),
        languageMode,
      })
    );
  }

  sendVADTimestamp(startMs: number, endMs: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(
      JSON.stringify({
        type: 'vad-timestamp',
        startMs,
        endMs,
      })
    );
  }

  sendVADEvent(event: 'start' | 'end', timestampMs: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(
      JSON.stringify({
        type: 'vad-event',
        event,
        timestampMs,
      })
    );
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      // 半开连接（换网 / 代理被杀而 TCP 还没超时）：浏览器不会触发 onclose，靠"多久没收到任何消息"判死
      if (this.lastInboundAt > 0 && Date.now() - this.lastInboundAt > LINK_IDLE_TIMEOUT_MS) {
        log.warn(`[DashScopeASR] no inbound message for ${LINK_IDLE_TIMEOUT_MS}ms, treating link as dead`);
        this.forceReconnect('idle-timeout');
        return;
      }
      try {
        this.ws.send(JSON.stringify({ type: 'ping', at: Date.now() }));
      } catch {
        /* connection close will trigger reconnect */
      }
    }, KEEP_ALIVE_INTERVAL_MS);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  async stop(): Promise<void> {
    this.userStopRequested = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopKeepAlive();
    const wasReady = this.isReady;
    this.isReady = false;
    this.updateStatus('stopped');
    this.settleStart(false);

    if (!this.ws) return;

    // CONNECTING 状态也要主动 close，否则 WS 留在后台，
    // 浏览器最终会自己 abort 并报 "closed before established"
    if (this.ws.readyState === WebSocket.CONNECTING) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
      return;
    }

    if (this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // 还没 ready 的连接上没有音频在飞，直接关，不用等上游收尾
    if (!wasReady) {
      this.closeConnection();
      return;
    }

    try {
      const finished = new Promise<void>((resolve) => {
        this.stopFinishedResolver = resolve;
      });
      this.ws.send(JSON.stringify({ action: 'stop' }));

      // 正常情况下 Qwen 在数百毫秒内回 session.finished；最多等 5 秒，
      // 既给尾句充分定稿时间，也不让“结束这节课”被异常网络永久卡住。
      await Promise.race([
        finished,
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch {
      this.closeConnection();
      return;
    } finally {
      this.stopFinishedResolver = null;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.closeConnection();
    }
  }

  private resolveStopFinished(): void {
    const resolve = this.stopFinishedResolver;
    this.stopFinishedResolver = null;
    resolve?.();
  }

  private closeConnection(): void {
    this.stopKeepAlive();
    this.resolveStopFinished();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.updateStatus('stopped');
  }

  private updateStatus(status: 'connecting' | 'connected' | 'transcribing' | 'stopped' | 'error'): void {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }

  getStatus(): string {
    return this.status;
  }

  /** 对外链路状态（录课界面的一行状态用） */
  getLinkState(): ASRLinkState | null {
    return this.linkState;
  }

  /** 已进终态（密钥 / 额度 / 重试用尽）：重建 client 也不会好，UI 不必再试 */
  isTerminated(): boolean {
    return this.terminal;
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.isReady;
  }
}

export async function checkDashScopeASRAvailable(): Promise<boolean> {
  try {
    const response = await fetch('/api/asr-config');
    return response.ok;
  } catch {
    return false;
  }
}

export const dashScopeASRService = {
  createClient(
    apiKey: string,
    callbacks?: DashScopeASRCallbacks,
    options?: DashScopeASROptions
  ): DashScopeASRClient {
    return new DashScopeASRClient(apiKey, callbacks, options);
  },

  checkAvailable: checkDashScopeASRAvailable,
};

export default dashScopeASRService;
