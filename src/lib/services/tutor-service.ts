/**
 * AI 家教服务
 * 
 * 复用 LongCut 引用匹配 + Discussion LLM
 * 自研比例: 20% (主要是 Prompt 工程)
 */

import {
  buildTranscriptIndex,
  findTextInTranscript,
  type TranscriptIndex,
  type TranscriptSegment as LongCutSegment,
} from '@/lib/longcut';
import type { TranscriptSegment } from './tingwu-service';

// 匹配结果类型
interface QuoteMatchResult {
  found: boolean;
  startSegmentIdx: number;
  endSegmentIdx: number;
  startCharOffset: number;
  endCharOffset: number;
  matchStrategy: string;
}

export interface TutorContext {
  /** 困惑点时间戳（毫秒） */
  anchorTimestamp: number;
  /** 转录片段列表 */
  segments: TranscriptSegment[];
  /** 学科 */
  subject?: string;
  /** 学生问题 */
  question?: string;
}

export interface TutorResponse {
  /** 老师原话引用 */
  teacherQuote?: string;
  /** 困惑分析 */
  confusionAnalysis: string;
  /** 解释内容 */
  explanation: string;
  /** 引导问题 */
  guidingQuestion?: string;
  /** 行动清单 */
  actionItems?: string[];
  /** 引用时间戳 */
  quoteTimestamps?: number[];
}

/**
 * AI 家教服务类
 */
export class TutorService {
  private transcriptIndex: TranscriptIndex | null = null;
  private segments: TranscriptSegment[] = [];
  private longcutSegments: LongCutSegment[] = [];

  /**
   * 初始化转录索引
   */
  initializeIndex(segments: TranscriptSegment[]): void {
    this.segments = segments;
    
    // 转换为 LongCut 格式 (start: 秒, duration: 秒)
    this.longcutSegments = segments.map(seg => ({
      text: seg.text,
      start: seg.startMs / 1000,
      duration: (seg.endMs - seg.startMs) / 1000,
    }));

    this.transcriptIndex = buildTranscriptIndex(this.longcutSegments);
  }

  /**
   * 查找引用在转录中的位置
   */
  findQuote(quote: string): QuoteMatchResult | null {
    if (!this.transcriptIndex) {
      console.warn('Transcript index not built');
      return null;
    }

    const result = findTextInTranscript(this.longcutSegments, quote, this.transcriptIndex);
    return result && result.found ? result : null;
  }

  /**
   * 获取困惑点周围的上下文
   */
  getContextAroundTimestamp(
    timestamp: number,
    beforeMs: number = 60000,
    afterMs: number = 30000
  ): TranscriptSegment[] {
    const startTime = Math.max(0, timestamp - beforeMs);
    const endTime = timestamp + afterMs;

    return this.segments.filter(
      seg => seg.startMs >= startTime && seg.endMs <= endTime
    );
  }

  /**
   * 格式化上下文为文本
   */
  formatContextText(segments: TranscriptSegment[]): string {
    return segments
      .map(seg => {
        const minutes = Math.floor(seg.startMs / 60000);
        const seconds = Math.floor((seg.startMs % 60000) / 1000);
        const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        return `[${timeStr}] ${seg.text}`;
      })
      .join('\n');
  }

  /**
   * 生成 AI 家教回复
   */
  async generateResponse(context: TutorContext): Promise<TutorResponse> {
    // 获取困惑点周围的上下文
    const contextSegments = this.getContextAroundTimestamp(
      context.anchorTimestamp,
      60000,
      30000
    );
    const contextText = this.formatContextText(contextSegments);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: this.buildSystemPrompt(context.subject) },
            { role: 'user', content: this.buildUserMessage(context.anchorTimestamp, contextText, context.question) },
          ],
          context: contextText,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      return this.parseResponse(data.content, contextSegments);
    } catch (error) {
      console.error('TutorService error:', error);
      return {
        confusionAnalysis: '无法分析困惑点',
        explanation: '抱歉，AI 家教暂时无法回答。请稍后再试。',
      };
    }
  }

  /**
   * 构建系统提示
   */
  private buildSystemPrompt(subject?: string): string {
    const subjectHint = subject ? `你正在辅导${subject}科目。` : '';
    
    return `你是一位耐心的 AI 家教，帮助学生理解课堂内容。${subjectHint}

当学生表示困惑时，请按以下结构回复：

## 老师是这样讲的
引用老师的原话，用 [MM:SS] 格式标注时间戳。

## 你可能卡在这里
分析学生可能困惑的具体知识点。

## 让我来解释
用简单易懂的语言解释概念，可以举例子。

## 让我问你一个问题
提一个引导性问题，帮助学生自己思考。

## 今晚行动清单
给出 2-3 个具体的复习建议。

注意：
- 语气要亲切友好，像朋友一样
- 解释要通俗易懂，避免专业术语
- 时间戳格式必须是 [MM:SS]`;
  }

  /**
   * 构建用户消息
   */
  private buildUserMessage(
    timestamp: number,
    contextText: string,
    question?: string
  ): string {
    const minutes = Math.floor(timestamp / 60000);
    const seconds = Math.floor((timestamp % 60000) / 1000);
    const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    let message = `我在 ${timeStr} 的时候按下了"不懂"按钮。\n\n`;
    message += `这是老师讲的内容：\n\n${contextText}\n\n`;

    if (question) {
      message += `我的问题是：${question}`;
    } else {
      message += `请帮我分析一下我可能不懂什么，并解释给我听。`;
    }

    return message;
  }

  /**
   * 解析 AI 回复
   */
  private parseResponse(
    content: string,
    contextSegments: TranscriptSegment[]
  ): TutorResponse {
    const response: TutorResponse = {
      confusionAnalysis: '',
      explanation: '',
    };

    // 提取各部分内容
    const sections: Record<string, RegExp> = {
      teacherQuote: /## 老师是这样讲的\s*([\s\S]*?)(?=##|$)/i,
      confusionAnalysis: /## 你可能卡在这里\s*([\s\S]*?)(?=##|$)/i,
      explanation: /## 让我来解释\s*([\s\S]*?)(?=##|$)/i,
      guidingQuestion: /## 让我问你一个问题\s*([\s\S]*?)(?=##|$)/i,
      actionItems: /## 今晚行动清单\s*([\s\S]*?)(?=##|$)/i,
    };

    for (const [key, regex] of Object.entries(sections)) {
      const match = content.match(regex);
      if (match) {
        const text = match[1].trim();
        if (key === 'actionItems') {
          // 解析行动清单为数组
          response.actionItems = text
            .split('\n')
            .filter(line => line.trim().match(/^[-*\d.]/))
            .map(line => line.replace(/^[-*\d.]+\s*/, '').trim());
        } else if (key === 'teacherQuote') {
          response.teacherQuote = text;
        } else if (key === 'confusionAnalysis') {
          response.confusionAnalysis = text;
        } else if (key === 'explanation') {
          response.explanation = text;
        } else if (key === 'guidingQuestion') {
          response.guidingQuestion = text;
        }
      }
    }

    // 如果没有结构化内容，使用原始回复
    if (!response.explanation) {
      response.explanation = content;
    }

    // 提取时间戳
    const timestampRegex = /\[(\d{1,2}):(\d{2})\]/g;
    const timestamps: number[] = [];
    let match;
    while ((match = timestampRegex.exec(content)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      timestamps.push((minutes * 60 + seconds) * 1000);
    }
    if (timestamps.length > 0) {
      response.quoteTimestamps = timestamps;
    }

    return response;
  }
}

// 单例实例
export const tutorService = new TutorService();

/**
 * 创建家教服务实例
 */
export function createTutorService(): TutorService {
  return new TutorService();
}
