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
    if (this.ws) {
      console.warn('[DashScopeASR] Already connected');
      return true;
    }

    this.sentenceIndex = 0;
    this.isReady = false;
    this.audioQueue = [];
    this.sessionStartTime = 0;

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
            console.error(`[DashScopeASR] Connection error: ${wsUrl}`, error);
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
        console.error('[DashScopeASR] Failed to connect:', error);
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
          console.warn('[DashScopeASR] Ignore stop-time commit error:', errorMessage);
          return;
        }
        if (this.isIgnorableSessionUpdateError(errorMessage)) {
          console.warn('[DashScopeASR] Ignore session update error (non-fatal):', errorMessage);
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
            console.warn('[DashScopeASR] Ignore session update error in event:', errorMessage);
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
      console.error('[DashScopeASR] Failed to parse message:', error);
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
   */
  sendContextHint(contextHint: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!contextHint.trim()) return;

    this.ws.send(
      JSON.stringify({
        type: 'context-hint',
        contextHint: contextHint.trim(),
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
