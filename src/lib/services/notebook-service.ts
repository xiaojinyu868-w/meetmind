/**
 * Open Notebook 服务集成
 * 
 * 调用 Open Notebook 的 API 实现：
 * - 向量搜索（语义搜索课堂内容）
 * - 嵌入生成
 * - 笔记管理
 */

// Open Notebook API 地址
const NOTEBOOK_API = process.env.NEXT_PUBLIC_NOTEBOOK_API || 'http://localhost:5055';

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  source: string;
  metadata?: {
    timestamp?: number;
    sourceId?: string;
    type?: string;
  };
}

export interface EmbeddingResult {
  id: string;
  embedding: number[];
}

export interface NotebookSource {
  id: string;
  title: string;
  content: string;
  type: 'audio' | 'video' | 'document' | 'text';
  createdAt: string;
}

/**
 * Open Notebook 服务
 */
export const notebookService = {
  /**
   * 检查服务是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${NOTEBOOK_API}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  /**
   * 向量搜索 - 语义搜索课堂内容
   * 
   * @param query 搜索查询
   * @param notebookId 笔记本 ID（可选，不指定则搜索所有）
   * @param limit 返回结果数量
   */
  async search(
    query: string,
    options?: {
      notebookId?: string;
      limit?: number;
      threshold?: number;
    }
  ): Promise<SearchResult[]> {
    const { limit = 5, threshold = 0.5 } = options || {};

    try {
      const response = await fetch(`${NOTEBOOK_API}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          notebook_id: options?.notebookId,
          limit,
          threshold,
          search_type: 'hybrid', // 混合搜索：向量 + 全文
        }),
      });

      if (!response.ok) {
        console.warn('Open Notebook search failed:', response.status);
        return [];
      }

      const data = await response.json();
      
      // 转换结果格式
      return (data.results || []).map((item: any) => ({
        id: item.id,
        content: item.content || item.text,
        score: item.score || item.similarity,
        source: item.source_title || item.source,
        metadata: {
          timestamp: item.timestamp,
          sourceId: item.source_id,
          type: item.type,
        },
      }));
    } catch (error) {
      console.error('Open Notebook search error:', error);
      return [];
    }
  },

  /**
   * 生成文本嵌入向量
   */
  async embed(text: string): Promise<number[] | null> {
    try {
      const response = await fetch(`${NOTEBOOK_API}/embedding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.embedding;
    } catch {
      return null;
    }
  },

  /**
   * 创建内容源（将课堂转录添加到 Open Notebook）
   */
  async createSource(
    notebookId: string,
    source: {
      title: string;
      content: string;
      type: 'audio' | 'text';
    }
  ): Promise<string | null> {
    try {
      const response = await fetch(`${NOTEBOOK_API}/sources`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          notebook_id: notebookId,
          title: source.title,
          content: source.content,
          source_type: source.type,
        }),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.id;
    } catch {
      return null;
    }
  },

  /**
   * 获取笔记本列表
   */
  async getNotebooks(): Promise<Array<{ id: string; name: string }>> {
    try {
      const response = await fetch(`${NOTEBOOK_API}/notebooks`);
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      return data.notebooks || [];
    } catch {
      return [];
    }
  },

  /**
   * 创建笔记本
   */
  async createNotebook(name: string, description?: string): Promise<string | null> {
    try {
      const response = await fetch(`${NOTEBOOK_API}/notebooks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, description }),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.id;
    } catch {
      return null;
    }
  },

  /**
   * 与笔记本对话（基于内容的 AI 问答）
   */
  async chat(
    notebookId: string,
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<string | null> {
    try {
      const response = await fetch(`${NOTEBOOK_API}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          notebook_id: notebookId,
          message,
          history: history || [],
        }),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.response;
    } catch {
      return null;
    }
  },
};

/**
 * 本地向量搜索（当 Open Notebook 不可用时的降级方案）
 * 使用简单的 TF-IDF 相似度
 */
export const localSearch = {
  /**
   * 简单文本搜索
   */
  search(
    query: string,
    documents: Array<{ id: string; text: string; timestamp?: number }>
  ): SearchResult[] {
    const queryWords = new Set(
      query.toLowerCase().split(/\s+/).filter(w => w.length > 1)
    );

    const results = documents
      .map(doc => {
        const docWords = new Set(
          doc.text.toLowerCase().split(/\s+/).filter(w => w.length > 1)
        );
        
        // 计算 Jaccard 相似度
        const intersection = [...queryWords].filter(w => docWords.has(w)).length;
        const union = new Set([...queryWords, ...docWords]).size;
        const score = union > 0 ? intersection / union : 0;

        return {
          id: doc.id,
          content: doc.text,
          score,
          source: 'local',
          metadata: {
            timestamp: doc.timestamp,
          },
        };
      })
      .filter(r => r.score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return results;
  },

  /**
   * 关键词高亮
   */
  highlight(text: string, query: string): string {
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    let result = text;
    
    for (const word of words) {
      const regex = new RegExp(`(${word})`, 'gi');
      result = result.replace(regex, '**$1**');
    }
    
    return result;
  },
};
