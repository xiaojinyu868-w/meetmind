import { createLogger, track } from '@/lib/logger';
import { fullJitterDelay } from '@/lib/services/asr/text-utils';
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
  /** 重连期间允许保留的音频上限（ms）；超过则丢弃最早的帧。默认 20000 */
  reconnectAudioBufferMs?: number;
}

export class DashScopeASRClient {
  private callbacks: DashScopeASRCallbacks;
  private options: DashScopeASROptions;

  private ws: WebSocket | null = null;
  private status: 'idle' | 'connecting' | 'connected' | 'transcribing' | 'stopped' | 'error' = 'idle';
  private sentenceIndex = 0;
  private isReady = false;
  private audioQueue: ArrayBuffer[] = [];
  private static readonly AUDIO_QUEUE_MAX_SIZE = 500;

  private sessionStartTime = 0;

  // M2 T2.2: 重连状态
  private userStopRequested = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly sessionId = `asr-realtime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  constructor(
    _apiKey: string,
    callbacks: DashScopeASRCallbacks = {},
    options: DashScopeASROptions = {}
  ) {
    this.callbacks = callbacks;
    this.options = {
      model: 'qwen3-asr-flash-realtime',
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

    return new Promise((resolve) => {
      try {
        this.updateStatus('connecting');

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const currentUrl = new URL('/api/asr-stream', window.location.href);
        const candidateUrls = [currentUrl.toString()];

        if (protocol === 'wss:' && currentUrl.port !== '8443') {
          candidateUrls.push(`${protocol}//${window.location.hostname}:8443/api/asr-stream`);
        }

        const tryConnect = (urlIndex: number) => {
          if (urlIndex >= candidateUrls.length) {
            this.updateStatus('error');
            this.callbacks.onError?.('所有连接端口均失败');
            resolve(false);
            return;
          }

          const wsUrl = candidateUrls[urlIndex];
          this.ws = new WebSocket(wsUrl);

          const connectionTimeout: NodeJS.Timeout = setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
              this.ws.close();
              tryConnect(urlIndex + 1);
            }
          }, 3500);

          let resolved = false;
          let connected = false;

          this.ws.onopen = () => {
            clearTimeout(connectionTimeout);
            connected = true;
            this.updateStatus('connected');
            this.sendContextHint(
              this.options.initialContextHint || '',
              this.options.initialLanguageMode || 'auto'
            );
          };

          this.ws.onmessage = (event) => {
            this.handleMessage(event.data);
            if (this.isReady && !resolved) {
              resolved = true;
              resolve(true);
            }
          };

          this.ws.onerror = (error) => {
            clearTimeout(connectionTimeout);
            log.error(`[DashScopeASR] Connection error: ${wsUrl}`, error);
            if (!connected && !resolved && urlIndex < candidateUrls.length - 1) {
              tryConnect(urlIndex + 1);
            } else if (!connected && !resolved) {
              this.updateStatus('error');
              this.callbacks.onError?.('WebSocket 连接错误');
              resolve(false);
            }
          };

          this.ws.onclose = (event) => {
            clearTimeout(connectionTimeout);

            const maxAttempts = this.options.maxReconnectAttempts ?? 5;
            const shouldAttemptReconnect =
              !this.userStopRequested &&
              connected &&
              this.reconnectAttempts < maxAttempts;

            if (shouldAttemptReconnect) {
              this.scheduleReconnect(event.code, event.reason);
              this.ws = null;
              return;
            }

            if (this.status !== 'stopped') {
              this.updateStatus('stopped');
            }
            this.ws = null;
          };
        };

        tryConnect(0);

        setTimeout(() => {
          if (!this.isReady) {
            this.callbacks.onError?.('连接超时');
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

        case 'result':
          this.handleResult(msg.sentence, msg.replaces, msg.provisional);
          break;

        case 'interim': {
          const payload: ASRInterim = {
            itemId: typeof msg.itemId === 'string' ? msg.itemId : undefined,
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
          break;

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
        }
      | undefined,
    replaces?: string[],
    provisional?: boolean,
  ): void {
    if (!sentence || !sentence.text) return;

    if (sentence.isFinal !== false) {
      const beginTime = sentence.beginTime ?? 0;
      const endTime = sentence.endTime ?? beginTime + 1000;

      const result: ASRSentence = {
        id: sentence.id || `seg-${Date.now()}-${this.sentenceIndex++}`,
        text: sentence.text,
        beginTime,
        endTime,
        isFinal: true,
        confidence: sentence.confidence,
        itemId: sentence.itemId,
        provisional: provisional === true,
        replaces: Array.isArray(replaces) ? replaces : undefined,
      };
      this.callbacks.onSentence?.(result);
    } else {
      this.callbacks.onInterim?.({
        itemId: sentence.itemId,
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
    if (!this.isReady) {
      this.audioQueue.push(buffer);
      if (this.audioQueue.length > DashScopeASRClient.AUDIO_QUEUE_MAX_SIZE) {
        this.audioQueue.shift();
      }
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buffer);
    }
  }

  private flushAudioQueue(): void {
    while (this.audioQueue.length > 0) {
      const buffer = this.audioQueue.shift();
      if (buffer && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(buffer);
      }
    }
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

  /**
   * Dynamically update context with recently confirmed transcript text.
   * Called periodically after N final segments to help ASR maintain
   * consistency for names and terms.
   */
  sendContextUpdate(recentText: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!recentText.trim()) return;

    this.ws.send(
      JSON.stringify({
        type: 'context-update',
        recentText: recentText.trim(),
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

  async stop(): Promise<void> {
    this.userStopRequested = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isReady = false;
    this.updateStatus('stopped');

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      this.ws.send(JSON.stringify({ action: 'stop' }));
    } catch {
      this.closeConnection();
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.closeConnection();
    }
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
        // start 失败，保留 attempts（后续 close 事件会再增）
        track({
          kind: 'asr.fail',
          mode: 'realtime-reconnect',
          sessionId: this.sessionId,
          durationMs: 0,
          errorCode: 'RECONNECT_START_FAILED',
          errorMsg: `lastCloseCode=${lastCloseCode} reason=${lastCloseReason}`,
        });
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
