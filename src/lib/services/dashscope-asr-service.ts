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

export interface DashScopeASRCallbacks {
  onSentence?: (sentence: ASRSentence) => void;
  onInterim?: (interim: ASRInterim) => void;
  onError?: (error: string) => void;
  onStatusChange?: (status: 'connecting' | 'connected' | 'transcribing' | 'stopped' | 'error') => void;
  onTaskStarted?: () => void;
  onTaskFinished?: () => void;
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
  // M2 T2.2: WebSocket 自动重连配置
  /** 允许重连的最大次数，默认 5 */
  maxReconnectAttempts?: number;
  /** 重连的 base 延迟（ms），Full Jitter 的底数。默认 500 */
  reconnectBaseMs?: number;
  /** 重连延迟上限（ms），默认 10000 */
  reconnectCapMs?: number;
  /** 重连期间允许保留的音频上限（ms）；超过则丢弃最早的帧并通过 onAudioDropped 上报。默认 120000（2 分钟，覆盖锁屏/电梯/隧道场景） */
  reconnectAudioBufferMs?: number;
}

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

  private sessionStartTime = 0;

  // M2 T2.2: 重连状态
  private userStopRequested = false;
  private reconnectAttempts = 0;
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

  async start(): Promise<boolean> {
    return this.startInternal({ isReconnect: false });
  }

  private async startInternal(opts: { isReconnect: boolean }): Promise<boolean> {
    if (this.ws) {
      log.warn('[DashScopeASR] Already connected');
      return true;
    }

    if (!opts.isReconnect) {
      // 首次 start：清全部状态
      this.userStopRequested = false;
      this.reconnectAttempts = 0;
      this.sentenceIndex = 0;
      this.audioQueue = [];
      this.sessionStartTime = 0;
    }
    // 重连路径：保留 audioQueue / reconnectAttempts / sentenceIndex / sessionStartTime
    this.isReady = false;
    this.connectionGeneration += 1;

    return new Promise((resolve) => {
      try {
        this.updateStatus('connecting');

        const candidateUrls = buildAsrWebSocketCandidates(window.location.href);
        // M13-fix: 默认重连次数从 30 降到 8。
        // 30 次（指数退避到 ~10s 上限）= 最长重试 ~80s，对真·鉴权失败/服务异常场景毫无意义，
        // 反而堆出几十条同样的报错刷爆日志。8 次（~30s）足够覆盖瞬时网络波动，重大故障应该让用户感知。
        const maxAttempts = this.options.maxReconnectAttempts ?? 8;

        const tryConnect = (urlIndex: number) => {
          if (urlIndex >= candidateUrls.length) {
            this.updateStatus('error');
            this.callbacks.onError?.('所有连接端口均失败');
            resolve(false);
            return;
          }

          const wsUrl = candidateUrls[urlIndex];
          // 积分 Phase 2：浏览器 WebSocket 不能带 Authorization 头，
          // JWT 走 ?token= 查询参数；server.js 在连接关闭结算时原样回传。
          // 未登录（guest）不带 token，服务端只记影子流水不扣分。
          const authToken = typeof window !== 'undefined'
            ? window.localStorage.getItem('meetmind_access_token') || window.localStorage.getItem('auth_token')
            : null;
          const wsUrlWithAuth = authToken
            ? `${wsUrl}${wsUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(authToken)}`
            : wsUrl;
          const ws = new WebSocket(wsUrlWithAuth);
          this.ws = ws;

          const connectionTimeout: NodeJS.Timeout = setTimeout(() => {
            if (this.ws === ws && ws.readyState === WebSocket.CONNECTING) {
              ws.close();
              this.ws = null;
              tryConnect(urlIndex + 1);
            }
          }, 5000);

          let settled = false;
          let connected = false;
          const settle = (ok: boolean) => {
            if (settled) return;
            settled = true;
            resolve(ok);
          };

          ws.onopen = () => {
            if (this.ws !== ws) return;
            clearTimeout(connectionTimeout);
            connected = true;
            this.updateStatus('connected');
            this.startKeepAlive();
            this.sendContextHint(
              this.options.initialContextHint || '',
              this.options.initialLanguageMode || 'auto'
            );
          };

          ws.onmessage = (event) => {
            if (this.ws !== ws) return;
            this.handleMessage(event.data);
            if (this.isReady && !settled) {
              settle(true);
            }
          };

          ws.onerror = (error) => {
            if (this.ws !== ws) return;
            clearTimeout(connectionTimeout);
            // M7-fix7: 三种情况静默——
            //   1. 用户主动停止（destroy / unmount）
            //   2. 连接已经 resolve 过（重复 onerror）
            //   3. 浏览器 page-unload 导致的 CLOSING/CLOSED（真·不是我们的错）
            const currentWs = this.ws;
            const browserAborted =
              currentWs &&
              (currentWs.readyState === WebSocket.CLOSING ||
                currentWs.readyState === WebSocket.CLOSED);
            if (this.userStopRequested || settled || browserAborted) {
              return;
            }
            log.error(`[DashScopeASR] Connection error: ${wsUrl}`, error);
            if (!connected && urlIndex < candidateUrls.length - 1) {
              this.ws = null;
              tryConnect(urlIndex + 1);
            }
          };

          ws.onclose = (event) => {
            if (this.ws !== ws) return;
            clearTimeout(connectionTimeout);
            this.stopKeepAlive();
            this.ws = null;
            this.resolveStopFinished();

            // M13-fix: 4401 = 服务端标记的鉴权失败，重连无意义，立刻给用户清晰提示
            if (event.code === 4401) {
              this.userStopRequested = true;
              if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
              }
              this.updateStatus('error');
              this.callbacks.onError?.('实时转写服务密钥失效，请联系管理员更新 DashScope 密钥后重试');
              settle(false);
              return;
            }

            if (!connected) {
              if (urlIndex < candidateUrls.length - 1) {
                tryConnect(urlIndex + 1);
                return;
              }
              this.updateStatus(opts.isReconnect ? 'connecting' : 'error');
              if (!opts.isReconnect) this.callbacks.onError?.('WebSocket 连接错误');
              settle(false);
              return;
            }

            const shouldAttemptReconnect =
              !this.userStopRequested &&
              this.reconnectAttempts < maxAttempts;

            if (shouldAttemptReconnect) {
              this.scheduleReconnect(event.code, event.reason);
              return;
            }

            if (this.status !== 'stopped') {
              this.updateStatus('stopped');
            }
            settle(false);
          };
        };

        tryConnect(0);

        setTimeout(() => {
          if (!this.isReady) {
            if (!opts.isReconnect) this.callbacks.onError?.('连接超时');
            resolve(false);
          }
        }, 15000);
      } catch (error) {
        log.error('[DashScopeASR] Failed to connect:', error);
        this.updateStatus('error');
        this.callbacks.onError?.('连接失败');
        resolve(false);
      }
    });
  }

  private handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data);

      if (msg.error) {
        const errorMessage = this.normalizeErrorMessage(msg.error);
        if (this.isIgnorableStopError(errorMessage)) {
          log.warn('[DashScopeASR] Ignore stop-time commit error:', errorMessage);
          return;
        }
        if (this.isIgnorableSessionUpdateError(errorMessage)) {
          log.warn('[DashScopeASR] Ignore session update error (non-fatal):', errorMessage);
          return;
        }
        this.callbacks.onError?.(errorMessage);
        this.updateStatus('error');
        return;
      }

      switch (msg.event) {
        case 'ready':
          this.isReady = true;
          this.sessionStartTime = Date.now();
          this.updateStatus('transcribing');
          this.callbacks.onTaskStarted?.();
          this.flushAudioQueue();
          break;

        // M13-fix: 服务端检测到 DashScope 401/403 时下发 auth_failed
        // 鉴权失败重连无意义——立刻终止，给用户清晰提示
        case 'auth_failed': {
          this.userStopRequested = true; // 关掉重连闸门
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          const reason = typeof msg.error === 'string' ? msg.error : '识别服务密钥失效';
          this.callbacks.onError?.(`${reason}（请联系管理员更新 DashScope 密钥）`);
          this.updateStatus('error');
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
          this.updateStatus('stopped');
          this.callbacks.onTaskFinished?.();
          this.resolveStopFinished();
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
          if (this.isIgnorableStopError(errorMessage)) {
            break;
          }
          if (this.isIgnorableSessionUpdateError(errorMessage)) {
            log.warn('[DashScopeASR] Ignore session update error in event:', errorMessage);
            break;
          }
          this.callbacks.onError?.(errorMessage);
          this.updateStatus('error');
          break;
        }

        case 'closed':
          this.updateStatus('stopped');
          this.resolveStopFinished();
          break;
      }
    } catch (error) {
      log.error('[DashScopeASR] Failed to parse message:', error);
    }
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
      try {
        this.ws.send(JSON.stringify({ type: 'ping', at: Date.now() }));
      } catch {
        /* connection close will trigger reconnect */
      }
    }, 15_000);
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
    this.isReady = false;
    this.updateStatus('stopped');

    if (!this.ws) return;

    // M7-fix7: CONNECTING 状态也要主动 close，否则 WS 留在后台，
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

  // M2 T2.2: 重连机制
  // 触发条件：WebSocket 非用户主动关闭，且曾经 connected 成功过。
  // 策略：AWS Full Jitter 退避；在 maxReconnectAttempts 之内反复尝试。
  // 音频缓冲：audioQueue 在整个重连窗口期保留；重连成功后 flushAudioQueue 一次吐回。
  private scheduleReconnect(code: number, reason: string): void {
    this.reconnectAttempts += 1;
    const delay = fullJitterDelay(
      this.reconnectAttempts - 1,
      this.options.reconnectBaseMs ?? 500,
      this.options.reconnectCapMs ?? 10000,
    );
    log.warn(
      `[DashScopeASR] Unexpected close (code=${code}, reason=${reason || '-'}), reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`,
    );
    // 保持 "connecting" 状态给 UI 一个提示
    this.updateStatus('connecting');

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.doReconnect(code, reason);
    }, delay);
  }

  private async doReconnect(lastCloseCode: number, lastCloseReason: string): Promise<void> {
    if (this.userStopRequested) return;

    try {
      const attemptsBefore = this.reconnectAttempts;
      const ok = await this.startInternal({ isReconnect: true });
      if (ok) {
        // 重连成功：把断线期缓存的音频重放，transcriber 继续。
        this.flushAudioQueue();
        log.info('[DashScopeASR] Reconnected successfully, audio buffer flushed', {
          attempts: attemptsBefore,
          bufferedChunks: this.audioQueue.length,
        });
        track({
          kind: 'asr.success',
          mode: 'realtime-reconnect',
          sessionId: this.sessionId,
          durationMs: 0,
        });
      } else {
        track({
          kind: 'asr.fail',
          mode: 'realtime-reconnect',
          sessionId: this.sessionId,
          durationMs: 0,
          errorCode: 'RECONNECT_START_FAILED',
          errorMsg: `lastCloseCode=${lastCloseCode} reason=${lastCloseReason}`,
        });
        const maxAttempts = this.options.maxReconnectAttempts ?? 8;
        if (!this.userStopRequested && this.reconnectAttempts < maxAttempts) {
          this.scheduleReconnect(lastCloseCode, lastCloseReason);
        } else {
          this.updateStatus('error');
          this.callbacks.onError?.('实时转写连接断开，请重新开始录音。');
        }
      }
    } catch (err) {
      log.error('[DashScopeASR] Reconnect threw', err);
      track({
        kind: 'asr.fail',
        mode: 'realtime-reconnect',
        sessionId: this.sessionId,
        durationMs: 0,
        errorCode: 'RECONNECT_EXCEPTION',
        errorMsg: (err as Error).message,
      });
    }
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
