/**
 * LongCut 服务调用层
 * 
 * 复用能力：
 * - 时间轴处理
 * - 引用匹配
 * - 智能分块
 * - 翻译服务
 * 
 * 注意：部分能力直接引用 LongCut 的 lib 文件（通过 tsconfig paths）
 */

const LONGCUT_API = '/api/longcut';

export interface TranscriptSegment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  speakerId?: string;
}

export interface Topic {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  summary: string;
}

export interface Quote {
  text: string;
  startMs: number;
  endMs: number;
  relevance: number;
}

/**
 * LongCut 服务客户端
 */
export const longcutService = {
  /**
   * 生成主题分段
   */
  async generateTopics(
    transcript: TranscriptSegment[]
  ): Promise<Topic[]> {
    const res = await fetch(`${LONGCUT_API}/generate-topics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript }),
    });
    if (!res.ok) throw new Error('生成主题失败');
    return res.json();
  },

  /**
   * 提取精彩引用
   */
  async extractQuotes(
    transcript: TranscriptSegment[],
    count?: number
  ): Promise<Quote[]> {
    const res = await fetch(`${LONGCUT_API}/top-quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, count: count || 5 }),
    });
    if (!res.ok) throw new Error('提取引用失败');
    return res.json();
  },

  /**
   * AI 对话 (基于转录内容)
   */
  async chat(
    videoId: string,
    message: string,
    history?: Array<{ role: string; content: string }>
  ): Promise<{ response: string; citations: Quote[] }> {
    const res = await fetch(`${LONGCUT_API}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, message, history }),
    });
    if (!res.ok) throw new Error('对话失败');
    return res.json();
  },

  /**
   * 翻译文本
   */
  async translate(
    text: string,
    targetLang: string
  ): Promise<{ translated: string }> {
    const res = await fetch(`${LONGCUT_API}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, targetLang }),
    });
    if (!res.ok) throw new Error('翻译失败');
    return res.json();
  },
};

/**
 * 直接引用 LongCut 的工具函数
 * 
 * 这些函数不通过 API 调用，而是直接复用代码
 * 需要在 tsconfig.json 中配置 paths: { "@longcut/*": ["../../longcut/lib/*"] }
 */
export { 
  // 从 LongCut lib 直接导入（需要确保路径正确）
  // mergeSentences 
  // matchQuotes
  // formatTimestamp
} from './longcut-utils';
