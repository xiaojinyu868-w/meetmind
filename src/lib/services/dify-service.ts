/**
 * Dify 学习引导 Agent 服务
 * 
 * 功能：
 * 1. 提问引导（可交互）- 诊断学生卡点
 * 2. 联网检索（可开关）- 补充知识库外的信息
 * 
 * 设计原则：
 * - 向后兼容：不传新字段时行为不变
 * - 附加模式：新功能以额外字段返回
 */

// ==================== 类型定义 ====================

/** 引导问题选项 */
export interface GuidanceOption {
  id: string;
  text: string;
  /** 选项类型：用于后续分流 */
  category: 'concept' | 'procedure' | 'calculation' | 'comprehension' | 'application';
}

/** 引导问题 */
export interface GuidanceQuestion {
  id: string;
  question: string;
  type: 'single_choice';
  options: GuidanceOption[];
  /** 提示文案 */
  hint?: string;
}

/** 引用来源 */
export interface Citation {
  id: string;
  title: string;
  url: string;
  snippet: string;
  /** 来源类型 */
  source_type: 'web' | 'knowledge_base' | 'transcript';
}

/** Dify 工作流输入 */
export interface DifyWorkflowInput {
  /** 学生困惑点时间戳 */
  timestamp: number;
  /** 课堂转录上下文 */
  context: string;
  /** 学科 */
  subject?: string;
  /** 是否启用引导问题 */
  enable_guidance?: boolean;
  /** 是否启用联网检索 */
  enable_web?: boolean;
  /** 学生选择的选项 ID（追问时传入） */
  selected_option_id?: string;
  /** 学生追问内容 */
  student_question?: string;
  /** 会话 ID（用于多轮对话） */
  conversation_id?: string;
}

/** Dify 工作流输出 */
export interface DifyWorkflowOutput {
  /** 主回答（与原有结构兼容） */
  answer: string;
  /** 引导问题（enable_guidance=true 时返回） */
  guidance_question?: GuidanceQuestion;
  /** 针对选项的补充解释 */
  option_followup?: string;
  /** 引用来源（enable_web=true 时返回） */
  citations?: Citation[];
  /** 会话 ID */
  conversation_id?: string;
  /** 元数据 */
  metadata?: {
    model: string;
    total_tokens: number;
    workflow_run_id: string;
  };
}

/** Dify API 配置 */
export interface DifyConfig {
  /** Dify API 基础 URL */
  baseUrl: string;
  /** API Key */
  apiKey: string;
  /** 工作流 ID（学习引导 Agent） */
  workflowId: string;
  /** 超时时间（毫秒） */
  timeout?: number;
}

// ==================== Dify 服务类 ====================

export class DifyService {
  private config: DifyConfig;

  constructor(config: DifyConfig) {
    this.config = {
      timeout: 30000,
      ...config,
    };
  }

  /**
   * 调用 Dify 工作流
   */
  async runWorkflow(input: DifyWorkflowInput): Promise<DifyWorkflowOutput> {
    const url = `${this.config.baseUrl}/v1/workflows/run`;
    
    const body = {
      inputs: {
        timestamp: input.timestamp.toString(),
        context: input.context,
        subject: input.subject || '数学',
        enable_guidance: input.enable_guidance ? 'true' : 'false',
        enable_web: input.enable_web ? 'true' : 'false',
        selected_option_id: input.selected_option_id || '',
        student_question: input.student_question || '',
      },
      response_mode: 'blocking',
      conversation_id: input.conversation_id || '',
      user: 'student-user',
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeout!),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new DifyError(
          `Dify API error: ${response.status}`,
          response.status,
          errorData
        );
      }

      const data = await response.json();
      return this.parseWorkflowOutput(data);
    } catch (error) {
      if (error instanceof DifyError) throw error;
      throw new DifyError(
        `Dify request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        0
      );
    }
  }

  /**
   * 流式调用 Dify 工作流
   */
  async *runWorkflowStream(input: DifyWorkflowInput): AsyncGenerator<DifyStreamEvent> {
    const url = `${this.config.baseUrl}/v1/workflows/run`;
    
    const body = {
      inputs: {
        timestamp: input.timestamp.toString(),
        context: input.context,
        subject: input.subject || '数学',
        enable_guidance: input.enable_guidance ? 'true' : 'false',
        enable_web: input.enable_web ? 'true' : 'false',
        selected_option_id: input.selected_option_id || '',
        student_question: input.student_question || '',
      },
      response_mode: 'streaming',
      conversation_id: input.conversation_id || '',
      user: 'student-user',
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new DifyError(`Dify API error: ${response.status}`, response.status);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new DifyError('No response body', 0);

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;
            
            try {
              const event = JSON.parse(data) as DifyStreamEvent;
              yield event;
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 解析工作流输出
   */
  private parseWorkflowOutput(data: any): DifyWorkflowOutput {
    const outputs = data.data?.outputs || {};
    
    // 解析引导问题
    let guidanceQuestion: GuidanceQuestion | undefined;
    if (outputs.guidance_question) {
      try {
        guidanceQuestion = typeof outputs.guidance_question === 'string'
          ? JSON.parse(outputs.guidance_question)
          : outputs.guidance_question;
      } catch {
        console.warn('Failed to parse guidance_question');
      }
    }

    // 解析引用
    let citations: Citation[] | undefined;
    if (outputs.citations) {
      try {
        citations = typeof outputs.citations === 'string'
          ? JSON.parse(outputs.citations)
          : outputs.citations;
      } catch {
        console.warn('Failed to parse citations');
      }
    }

    return {
      answer: outputs.answer || '',
      guidance_question: guidanceQuestion,
      option_followup: outputs.option_followup,
      citations: citations || [],
      conversation_id: data.conversation_id,
      metadata: {
        model: outputs.model || 'unknown',
        total_tokens: outputs.total_tokens || 0,
        workflow_run_id: data.workflow_run_id || '',
      },
    };
  }
}

// ==================== 流式事件类型 ====================

export interface DifyStreamEvent {
  event: 'workflow_started' | 'node_started' | 'node_finished' | 'workflow_finished' | 'text_chunk';
  workflow_run_id?: string;
  task_id?: string;
  data?: {
    id?: string;
    node_id?: string;
    node_type?: string;
    title?: string;
    text?: string;
    outputs?: Record<string, any>;
  };
}

// ==================== 错误类 ====================

export class DifyError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: any
  ) {
    super(message);
    this.name = 'DifyError';
  }
}

// ==================== 工厂函数 ====================

let difyServiceInstance: DifyService | null = null;

/**
 * 获取 Dify 服务实例（单例）
 */
export function getDifyService(): DifyService {
  if (!difyServiceInstance) {
    const config: DifyConfig = {
      baseUrl: process.env.DIFY_API_URL || 'http://localhost/v1',
      apiKey: process.env.DIFY_API_KEY || '',
      workflowId: process.env.DIFY_WORKFLOW_ID || '',
      timeout: 30000,
    };
    
    if (!config.apiKey) {
      console.warn('DIFY_API_KEY not configured, Dify features will be disabled');
    }
    
    difyServiceInstance = new DifyService(config);
  }
  return difyServiceInstance;
}

/**
 * 检查 Dify 服务是否可用
 */
export function isDifyEnabled(): boolean {
  return !!process.env.DIFY_API_KEY;
}
