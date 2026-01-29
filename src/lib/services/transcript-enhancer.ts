/**
 * 转录文本增强服务
 * 
 * 使用 LLM 对 ASR 转录结果进行后处理优化：
 * - 删除口语填充词和重复
 * - 纠正同音字错误
 * - 优化标点和断句
 * 
 * 触发时机：
 * 1. 检测到 2 秒以上静音时，批量优化已累积的句子
 * 2. 录音结束时，对未优化的句子进行最终优化
 */

import type { TranscriptSegment } from '@/types';

// 优化状态
export type EnhanceStatus = 'pending' | 'enhancing' | 'enhanced' | 'failed';

// 带优化状态的转录片段
export interface EnhancedTranscriptSegment extends TranscriptSegment {
  originalText?: string;       // 原始 ASR 文本
  enhanceStatus: EnhanceStatus;
  enhancedAt?: string;
}

// 批量优化请求
export interface EnhanceRequest {
  segments: TranscriptSegment[];
  /** 是否为最终优化（录音结束时） */
  isFinal?: boolean;
}

// 批量优化响应
export interface EnhanceResponse {
  segments: EnhancedTranscriptSegment[];
  success: boolean;
  error?: string;
}

/**
 * 转录增强 Prompt
 * 
 * 设计原则：
 * 1. 结果导向 + 规则导向结合
 * 2. 控制 Prompt 长度
 * 3. 输出格式严格约束
 */
const ENHANCE_PROMPT = `【角色】课堂转录优化助手

【任务】将 ASR 转录优化为流畅易读的书面文本

【规则】
- 删除口语填充词和重复
- 纠正同音字错误
- 保持原意和专业术语

【输出】严格按 JSON 数组格式返回，每项包含 id 和优化后的 text
示例：[{"id":"seg-1","text":"优化后文本"}]

【输入】`;

/**
 * 构建优化请求的输入文本
 */
function buildInputText(segments: TranscriptSegment[]): string {
  const items = segments.map(seg => ({
    id: seg.id,
    text: seg.text,
  }));
  return JSON.stringify(items, null, 0);
}

/**
 * 解析 LLM 输出
 */
function parseEnhanceOutput(output: string): Map<string, string> {
  const result = new Map<string, string>();
  
  try {
    // 尝试直接解析 JSON
    const parsed = JSON.parse(output.trim());
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item.id && item.text) {
          result.set(item.id, item.text);
        }
      }
    }
  } catch {
    // JSON 解析失败，尝试提取 JSON 块
    const jsonMatch = output.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item.id && item.text) {
              result.set(item.id, item.text);
            }
          }
        }
      } catch {
        console.error('[TranscriptEnhancer] Failed to parse JSON block');
      }
    }
  }
  
  return result;
}

/**
 * 调用 LLM 进行转录优化
 */
export async function enhanceTranscript(
  segments: TranscriptSegment[],
  options?: {
    model?: string;
    apiKey?: string;
    baseUrl?: string;
  }
): Promise<EnhanceResponse> {
  if (segments.length === 0) {
    return { segments: [], success: true };
  }

  const model = options?.model || 'qwen3-max';
  
  try {
    // 构建请求
    const inputText = buildInputText(segments);
    const fullPrompt = ENHANCE_PROMPT + '\n' + inputText;
    
    console.log('[TranscriptEnhancer] Enhancing', segments.length, 'segments with', model);
    
    // 调用 API
    const response = await fetch('/api/transcript-enhance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        segments,
        model,
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.success && data.segments) {
      return {
        segments: data.segments,
        success: true,
      };
    } else {
      throw new Error(data.error || '优化失败');
    }
    
  } catch (error) {
    console.error('[TranscriptEnhancer] Error:', error);
    
    // 优化失败时，返回原始文本并标记状态
    const failedSegments: EnhancedTranscriptSegment[] = segments.map(seg => ({
      ...seg,
      enhanceStatus: 'failed' as EnhanceStatus,
    }));
    
    return {
      segments: failedSegments,
      success: false,
      error: error instanceof Error ? error.message : '优化失败',
    };
  }
}

/**
 * 转录增强管理器
 * 
 * 负责跟踪待优化的句子，并在适当时机触发优化
 */
export class TranscriptEnhanceManager {
  private pendingSegments: TranscriptSegment[] = [];
  private enhancedSegments: Map<string, EnhancedTranscriptSegment> = new Map();
  private isEnhancing = false;
  private lastActivityTime = Date.now();
  private silenceCheckTimer: NodeJS.Timeout | null = null;
  
  // 配置
  private readonly config = {
    minBatchSize: 3,           // 最小批量大小
    silenceThreshold: 2000,    // 静音阈值（毫秒）
    model: 'qwen3-max',        // 使用 qwen3-max 模型
  };
  
  // 回调
  private onEnhanced?: (segments: EnhancedTranscriptSegment[]) => void;
  
  constructor(options?: {
    minBatchSize?: number;
    silenceThreshold?: number;
    model?: string;
    onEnhanced?: (segments: EnhancedTranscriptSegment[]) => void;
  }) {
    if (options?.minBatchSize) this.config.minBatchSize = options.minBatchSize;
    if (options?.silenceThreshold) this.config.silenceThreshold = options.silenceThreshold;
    if (options?.model) this.config.model = options.model;
    if (options?.onEnhanced) this.onEnhanced = options.onEnhanced;
  }
  
  /**
   * 添加新的转录片段
   */
  addSegment(segment: TranscriptSegment): void {
    console.log('[TranscriptEnhancer] Adding segment:', segment.id, ', pending count:', this.pendingSegments.length + 1);
    this.pendingSegments.push(segment);
    this.lastActivityTime = Date.now();
    this.startSilenceCheck();
  }
  
  /**
   * 更新活动时间（用于 VAD 检测）
   */
  updateActivity(): void {
    this.lastActivityTime = Date.now();
  }
  
  /**
   * 启动静音检测
   */
  private startSilenceCheck(): void {
    if (this.silenceCheckTimer) return;
    
    console.log('[TranscriptEnhancer] Starting silence check timer');
    this.silenceCheckTimer = setInterval(() => {
      const silenceDuration = Date.now() - this.lastActivityTime;
      
      // 每次检查都输出状态（方便调试）
      if (this.pendingSegments.length > 0) {
        console.log('[TranscriptEnhancer] Silence check: duration=', silenceDuration, 'ms, pending=', this.pendingSegments.length, ', threshold=', this.config.silenceThreshold, ', minBatch=', this.config.minBatchSize);
      }
      
      if (silenceDuration >= this.config.silenceThreshold && 
          this.pendingSegments.length >= this.config.minBatchSize &&
          !this.isEnhancing) {
        console.log('[TranscriptEnhancer] Silence detected, triggering batch enhance');
        this.enhancePending();
      }
    }, 500);
  }
  
  /**
   * 停止静音检测
   */
  private stopSilenceCheck(): void {
    if (this.silenceCheckTimer) {
      clearInterval(this.silenceCheckTimer);
      this.silenceCheckTimer = null;
    }
  }
  
  /**
   * 优化待处理的片段
   */
  async enhancePending(): Promise<EnhancedTranscriptSegment[]> {
    console.log('[TranscriptEnhancer] enhancePending called, pending:', this.pendingSegments.length, ', isEnhancing:', this.isEnhancing);
    
    if (this.pendingSegments.length === 0 || this.isEnhancing) {
      console.log('[TranscriptEnhancer] Skipping enhance: empty or already enhancing');
      return [];
    }
    
    this.isEnhancing = true;
    const segmentsToEnhance = [...this.pendingSegments];
    this.pendingSegments = [];
    
    console.log('[TranscriptEnhancer] Starting enhance for', segmentsToEnhance.length, 'segments');
    
    try {
      const result = await enhanceTranscript(segmentsToEnhance, {
        model: this.config.model,
      });
      
      console.log('[TranscriptEnhancer] Enhance result:', result.success, ', segments:', result.segments.length);
      
      // 更新缓存
      for (const seg of result.segments) {
        this.enhancedSegments.set(seg.id, seg);
      }
      
      // 回调通知
      if (this.onEnhanced) {
        console.log('[TranscriptEnhancer] Calling onEnhanced callback');
        this.onEnhanced(result.segments);
      }
      
      return result.segments;
      
    } catch (error) {
      console.error('[TranscriptEnhancer] enhancePending error:', error);
      return [];
    } finally {
      this.isEnhancing = false;
    }
  }
  
  /**
   * 最终优化（录音结束时调用）
   */
  async finalize(): Promise<EnhancedTranscriptSegment[]> {
    console.log('[TranscriptEnhancer] finalize called, pending:', this.pendingSegments.length);
    this.stopSilenceCheck();
    
    // 优化所有剩余的待处理片段
    if (this.pendingSegments.length > 0) {
      return this.enhancePending();
    }
    
    return [];
  }
  
  /**
   * 获取片段的优化结果
   */
  getEnhanced(segmentId: string): EnhancedTranscriptSegment | undefined {
    return this.enhancedSegments.get(segmentId);
  }
  
  /**
   * 获取所有已优化的片段
   */
  getAllEnhanced(): EnhancedTranscriptSegment[] {
    return Array.from(this.enhancedSegments.values());
  }
  
  /**
   * 清理资源
   */
  dispose(): void {
    this.stopSilenceCheck();
    this.pendingSegments = [];
    this.enhancedSegments.clear();
  }
}

export default TranscriptEnhanceManager;
