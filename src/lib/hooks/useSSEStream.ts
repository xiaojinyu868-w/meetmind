/**
 * SSE 流式响应处理 Hook
 * 
 * 统一处理项目中所有的 SSE 流式输出逻辑，消除代码重复
 * 
 * 使用场景：
 * - AITutor 的全局对话模式
 * - AITutor 的困惑点模式（选择题、自由提问）
 * - ReflectionGenerator 的反思生成
 */

import { useRef, useCallback, useState } from 'react';

/** SSE 事件的数据类型 */
export interface SSEEvent {
  type: 'content' | 'metadata' | 'error' | 'thinking';
  content?: string;
  error?: string;
  // 元数据字段
  conversation_id?: string;
  guidance_question?: unknown;
  citations?: unknown[];
  [key: string]: unknown;
}

/** Hook 配置选项 */
export interface UseSSEStreamOptions {
  /** 收到内容时的回调 */
  onContent?: (content: string, fullContent: string) => void;
  /** 收到元数据时的回调 */
  onMetadata?: (metadata: SSEEvent) => void;
  /** 发生错误时的回调 */
  onError?: (error: Error) => void;
  /** 流式完成时的回调 */
  onComplete?: (fullContent: string) => void;
  /** 用户取消时的回调 */
  onAbort?: () => void;
}

/** 流式请求的参数 */
export interface StreamRequestOptions {
  url: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** Hook 返回值 */
export interface UseSSEStreamReturn {
  /** 开始流式请求 */
  startStream: (options: StreamRequestOptions) => Promise<{
    fullContent: string;
    metadata: SSEEvent | null;
  }>;
  /** 停止当前流 */
  stopStream: () => void;
  /** 当前是否正在流式输出 */
  isStreaming: boolean;
  /** 当前累积的内容 */
  streamingContent: string;
  /** 清空流式内容 */
  clearContent: () => void;
}

/**
 * SSE 流式响应处理 Hook
 * 
 * @example
 * ```tsx
 * const { startStream, stopStream, isStreaming, streamingContent } = useSSEStream({
 *   onContent: (chunk, full) => console.log('收到内容:', chunk),
 *   onMetadata: (meta) => console.log('收到元数据:', meta),
 *   onComplete: (content) => console.log('完成:', content),
 * });
 * 
 * // 开始流式请求
 * const result = await startStream({
 *   url: '/api/tutor',
 *   body: { question: '什么是 React?' },
 *   headers: { Authorization: 'Bearer xxx' },
 * });
 * ```
 */
export function useSSEStream(options: UseSSEStreamOptions = {}): UseSSEStreamReturn {
  const { onContent, onMetadata, onError, onComplete, onAbort } = options;
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  
  /**
   * 解析 SSE 响应流
   */
  const parseSSEStream = useCallback(async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onChunk: (event: SSEEvent) => void
  ) => {
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 保留不完整的行
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          
          try {
            const parsed = JSON.parse(data) as SSEEvent;
            onChunk(parsed);
          } catch (e) {
            // 忽略 JSON 解析错误（不完整的数据）
            if (e instanceof Error && e.message !== 'Unexpected end of JSON input') {
              console.warn('[useSSEStream] 解析 SSE 数据失败:', e);
            }
          }
        }
      }
    }
  }, []);
  
  /**
   * 开始流式请求
   */
  const startStream = useCallback(async (requestOptions: StreamRequestOptions): Promise<{
    fullContent: string;
    metadata: SSEEvent | null;
  }> => {
    const { url, body, headers = {} } = requestOptions;
    
    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    abortControllerRef.current = new AbortController();
    setIsStreaming(true);
    setStreamingContent('');
    
    let fullContent = '';
    let metadata: SSEEvent | null = null;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
        signal: abortControllerRef.current.signal,
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `请求失败: ${response.status}`);
      }
      
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取响应流');
      }
      
      await parseSSEStream(reader, (event) => {
        if (event.type === 'content' && event.content) {
          fullContent += event.content;
          setStreamingContent(fullContent);
          onContent?.(event.content, fullContent);
        } else if (event.type === 'metadata') {
          metadata = event;
          onMetadata?.(event);
        } else if (event.type === 'error') {
          throw new Error(event.error || '服务端错误');
        }
      });
      
      onComplete?.(fullContent);
      return { fullContent, metadata };
      
    } catch (err) {
      // 用户取消不算错误
      if (err instanceof Error && err.name === 'AbortError') {
        onAbort?.();
        throw err; // 继续抛出让调用方知道是取消
      }
      
      onError?.(err instanceof Error ? err : new Error('未知错误'));
      throw err;
      
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [parseSSEStream, onContent, onMetadata, onError, onComplete, onAbort]);
  
  /**
   * 停止当前流
   */
  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, []);
  
  /**
   * 清空流式内容
   */
  const clearContent = useCallback(() => {
    setStreamingContent('');
  }, []);
  
  return {
    startStream,
    stopStream,
    isStreaming,
    streamingContent,
    clearContent,
  };
}

/**
 * 简化版：直接处理流式内容更新的 Hook
 * 适用于简单场景，自动管理流式内容状态
 * 
 * 支持两种 SSE 格式：
 * 1. { type: 'content', content: '...' } - /api/tutor 使用
 * 2. { content: '...' } - /api/chat 使用
 * 3. { type: 'thinking', content: '...' } - 思考模式的思考过程
 */
export function useSimpleSSEStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [thinkingContent, setThinkingContent] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  const fetchStream = useCallback(async (
    url: string,
    body: Record<string, unknown>,
    options: {
      headers?: Record<string, string>;
      onMetadata?: (metadata: SSEEvent) => void;
      /** 收到内容时的回调，可用于额外处理（如滚动） */
      onContent?: (chunk: string, fullContent: string) => void;
      /** 收到思考内容时的回调 */
      onThinking?: (chunk: string, fullThinking: string) => void;
    } = {}
  ): Promise<{ content: string; thinking: string }> => {
    const { headers = {}, onMetadata, onContent, onThinking } = options;
    
    // 取消之前的请求
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    
    setIsStreaming(true);
    setStreamingContent('');
    setThinkingContent('');
    setIsThinking(true);
    
    let fullContent = '';
    let fullThinking = '';
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: abortControllerRef.current.signal,
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `请求失败: ${response.status}`);
      }
      
      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');
      
      const decoder = new TextDecoder();
      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(data) as SSEEvent;
              
              // 思考模式：处理 thinking 类型
              if (parsed.type === 'thinking' && parsed.content) {
                fullThinking += parsed.content;
                setThinkingContent(fullThinking);
                onThinking?.(parsed.content, fullThinking);
              }
              // 支持两种格式：
              // 格式1: { type: 'content', content: '...' }
              // 格式2: { content: '...' } (无 type 字段)
              else if ((parsed.type === 'content' || !parsed.type) && parsed.content) {
                // 收到 content 说明思考阶段结束
                if (isThinking) {
                  setIsThinking(false);
                }
                fullContent += parsed.content;
                setStreamingContent(fullContent);
                onContent?.(parsed.content, fullContent);
              } else if (parsed.type === 'metadata') {
                onMetadata?.(parsed);
              } else if (parsed.type === 'error' || parsed.error) {
                throw new Error(parsed.error || '服务端错误');
              }
            } catch (e) {
              // JSON 解析错误 - 忽略（可能是不完整的数据）
              if (e instanceof SyntaxError) {
                continue;
              }
              // 业务错误 - 继续抛出
              throw e;
            }
          }
        }
      }
      
      return { content: fullContent, thinking: fullThinking };
    } finally {
      setIsStreaming(false);
      setIsThinking(false);
      abortControllerRef.current = null;
    }
  }, []);
  
  const stopStream = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    setIsThinking(false);
    abortControllerRef.current = null;
  }, []);
  
  const clearContent = useCallback(() => {
    setStreamingContent('');
    setThinkingContent('');
  }, []);
  
  return {
    fetchStream,
    stopStream,
    isStreaming,
    isThinking,
    streamingContent,
    thinkingContent,
    clearContent,
  };
}
