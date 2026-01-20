/**
 * 百炼 DashScope 实时语音识别服务
 * 
 * 通过后端 WebSocket 代理连接到百炼 ASR
 * 解决浏览器 WebSocket 无法设置自定义 Header 的问题
 */

export interface ASRSentence {
  id: string;
  text: string;
  beginTime: number;  // 毫秒
  endTime: number | null;    // 毫秒，null 表示中间结果
  isFinal: boolean;
  confidence?: number;
}

export interface DashScopeASRCallbacks {
  onSentence?: (sentence: ASRSentence) => void;
  onInterim?: (text: string, beginTime: number) => void;
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

/**
 * 百炼实时语音识别客户端
 * 通过后端 WebSocket 代理连接
 * 
 * 时间戳由前端计算，更准确：
 * - 记录录音开始时间
 * - 每个句子的 beginTime = 上一句的 endTime
 * - 每个句子的 endTime = 收到结果时的经过时间
 */
export class DashScopeASRClient {
  private callbacks: DashScopeASRCallbacks;
  private options: DashScopeASROptions;
  
  private ws: WebSocket | null = null;
  private status: 'idle' | 'connecting' | 'connected' | 'transcribing' | 'stopped' | 'error' = 'idle';
  private sentenceIndex = 0;
  private isReady = false;
  private audioQueue: ArrayBuffer[] = [];
  
  // 前端时间戳跟踪
  private sessionStartTime = 0;      // 录音开始时间
  private lastSentenceEndTime = 0;   // 上一个句子的结束时间

  constructor(
    _apiKey: string,  // 不再需要，由后端处理
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

  /**
   * 连接到后端 WebSocket 代理
   */
  async start(): Promise<boolean> {
    if (this.ws) {
      console.warn('[DashScopeASR] Already connected');
      return true;
    }

    this.sentenceIndex = 0;
    this.isReady = false;
    this.audioQueue = [];
    this.sessionStartTime = 0;
    this.lastSentenceEndTime = 0;

    return new Promise((resolve) => {
      try {
        this.updateStatus('connecting');
        
        // 连接到后端 WebSocket 代理
        // 优先尝试 8443 端口（绕过运营商 WebSocket 限制），失败后降级到默认端口
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const hostname = window.location.hostname;
        const defaultPort = window.location.port || (protocol === 'wss:' ? '443' : '80');
        
        // 尝试的端口列表：8443（备用）-> 默认端口
        const portsToTry = protocol === 'wss:' ? ['8443', defaultPort] : [defaultPort];
        let currentPortIndex = 0;
        
        const tryConnect = (portIndex: number) => {
          if (portIndex >= portsToTry.length) {
            console.error('[DashScopeASR] All ports failed');
            this.updateStatus('error');
            this.callbacks.onError?.('所有连接端口均失败');
            resolve(false);
            return;
          }
          
          const port = portsToTry[portIndex];
          const wsUrl = `${protocol}//${hostname}:${port}/api/asr-stream`;
          
          console.log(`[DashScopeASR] Trying port ${port}:`, wsUrl);
          this.ws = new WebSocket(wsUrl);
          
          let connectionTimeout: NodeJS.Timeout;
          let resolved = false;
          
          // 单个端口的连接超时（5秒）
          connectionTimeout = setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
              console.log(`[DashScopeASR] Port ${port} timeout, trying next...`);
              this.ws.close();
              tryConnect(portIndex + 1);
            }
          }, 5000);
          
          this.ws.onopen = () => {
            clearTimeout(connectionTimeout);
            console.log(`[DashScopeASR] Connected via port ${port}`);
            this.updateStatus('connected');
          };
          
          this.ws.onmessage = (event) => {
            this.handleMessage(event.data);
            
            // 如果收到 ready 事件，resolve（只执行一次）
            if (this.isReady && !resolved) {
              resolved = true;
              resolve(true);
            }
          };
          
          this.ws.onerror = (error) => {
            clearTimeout(connectionTimeout);
            console.error(`[DashScopeASR] Port ${port} error:`, error);
            // 尝试下一个端口
            if (!resolved && portIndex < portsToTry.length - 1) {
              console.log('[DashScopeASR] Trying next port...');
              tryConnect(portIndex + 1);
            } else if (!resolved) {
              this.updateStatus('error');
              this.callbacks.onError?.('WebSocket 连接错误');
              resolve(false);
            }
          };
          
          this.ws.onclose = (event) => {
            clearTimeout(connectionTimeout);
            console.log('[DashScopeASR] WebSocket closed:', event.code, event.reason);
            if (this.status !== 'stopped') {
              this.updateStatus('stopped');
            }
            this.ws = null;
          };
        };
        
        // 开始尝试连接
        tryConnect(0);

        // 总超时处理（15秒）
        setTimeout(() => {
          if (!this.isReady) {
            console.error('[DashScopeASR] Connection timeout');
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

  /**
   * 处理服务端消息
   */
  private handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data);
      console.log('[DashScopeASR] Received:', msg.event || msg);

      if (msg.error) {
        this.callbacks.onError?.(msg.error);
        this.updateStatus('error');
        return;
      }

      switch (msg.event) {
        case 'ready':
          this.isReady = true;
          this.sessionStartTime = Date.now();  // 记录录音开始时间
          this.lastSentenceEndTime = 0;
          this.updateStatus('transcribing');
          this.callbacks.onTaskStarted?.();
          // 发送队列中的音频
          this.flushAudioQueue();
          break;

        case 'result':
          this.handleResult(msg.sentence);
          break;

        case 'finished':
          this.updateStatus('stopped');
          this.callbacks.onTaskFinished?.();
          break;

        case 'error':
          this.callbacks.onError?.(msg.error || '识别错误');
          this.updateStatus('error');
          break;

        case 'closed':
          this.updateStatus('stopped');
          break;
      }
    } catch (error) {
      console.error('[DashScopeASR] Failed to parse message:', error);
    }
  }

  /**
   * 处理识别结果
   * 使用前端计算的时间戳（更准确）
   */
  private handleResult(sentence: {
    text?: string;
    beginTime?: number;
    endTime?: number | null;
    isFinal?: boolean;
  } | undefined): void {
    if (!sentence || !sentence.text) return;

    if (sentence.isFinal) {
      // 计算前端时间戳
      const now = Date.now();
      const elapsedMs = now - this.sessionStartTime;
      
      // beginTime = 上一句的结束时间
      // endTime = 当前经过时间
      const beginTime = this.lastSentenceEndTime;
      const endTime = elapsedMs;
      
      // 更新上一句结束时间
      this.lastSentenceEndTime = endTime;
      
      console.log(`[DashScopeASR] Sentence timestamp: ${beginTime}ms - ${endTime}ms (frontend calculated)`);
      
      // 最终结果
      const result: ASRSentence = {
        id: `seg-${Date.now()}-${this.sentenceIndex++}`,
        text: sentence.text,
        beginTime: beginTime,
        endTime: endTime,
        isFinal: true,
      };
      this.callbacks.onSentence?.(result);
    } else {
      // 中间结果 - 使用当前经过时间
      const elapsedMs = Date.now() - this.sessionStartTime;
      this.callbacks.onInterim?.(sentence.text, elapsedMs);
    }
  }

  /**
   * 发送音频数据
   */
  sendAudio(audioData: ArrayBuffer | Blob): void {
    if (audioData instanceof Blob) {
      audioData.arrayBuffer().then(buffer => this.sendAudioBuffer(buffer));
    } else {
      this.sendAudioBuffer(audioData);
    }
  }

  private sendAudioBuffer(buffer: ArrayBuffer): void {
    if (!this.isReady) {
      // 任务未启动，加入队列
      this.audioQueue.push(buffer);
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buffer);
    }
  }

  /**
   * 发送队列中的音频
   */
  private flushAudioQueue(): void {
    while (this.audioQueue.length > 0) {
      const buffer = this.audioQueue.shift();
      if (buffer && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(buffer);
      }
    }
  }

  /**
   * 停止识别
   */
  async stop(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.updateStatus('stopped');
      return;
    }

    // 发送停止指令
    this.ws.send(JSON.stringify({ action: 'stop' }));

    // 等待任务结束或超时
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.closeConnection();
        resolve();
      }, 5000);

      const originalOnTaskFinished = this.callbacks.onTaskFinished;
      this.callbacks.onTaskFinished = () => {
        clearTimeout(timeout);
        originalOnTaskFinished?.();
        this.closeConnection();
        resolve();
      };
    });
  }

  /**
   * 关闭连接
   */
  private closeConnection(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.updateStatus('stopped');
  }

  /**
   * 更新状态
   */
  private updateStatus(status: 'connecting' | 'connected' | 'transcribing' | 'stopped' | 'error'): void {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }

  /**
   * 获取当前状态
   */
  getStatus(): string {
    return this.status;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.isReady;
  }
}

/**
 * 检查 ASR 服务是否可用
 */
export async function checkDashScopeASRAvailable(): Promise<boolean> {
  // 检查后端代理是否可用
  try {
    const response = await fetch('/api/asr-config');
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 百炼 ASR 服务单例
 */
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
