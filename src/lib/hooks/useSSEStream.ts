/**
 * SSE 流式响应处理 Hook
 *
 * 统一处理项目中的 SSE 输出逻辑，并通过轻量缓冲降低高频 setState 开销。
 */

import { useCallback, useRef, useState, type MutableRefObject } from 'react';

const STREAM_FLUSH_INTERVAL_MS = 40;

export interface SSEEvent {
  type: 'content' | 'metadata' | 'error' | 'thinking';
  content?: string;
  error?: string;
  conversation_id?: string;
  guidance_question?: unknown;
  citations?: unknown[];
  [key: string]: unknown;
}

export interface UseSSEStreamOptions {
  onContent?: (content: string, fullContent: string) => void;
  onMetadata?: (metadata: SSEEvent) => void;
  onError?: (error: Error) => void;
  onComplete?: (fullContent: string) => void;
  onAbort?: () => void;
}

export interface StreamRequestOptions {
  url: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface UseSSEStreamReturn {
  startStream: (options: StreamRequestOptions) => Promise<{
    fullContent: string;
    metadata: SSEEvent | null;
  }>;
  stopStream: () => void;
  isStreaming: boolean;
  streamingContent: string;
  clearContent: () => void;
}

function clearTimer(timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>): void {
  if (!timerRef.current) return;
  clearTimeout(timerRef.current);
  timerRef.current = null;
}

export function useSSEStream(options: UseSSEStreamOptions = {}): UseSSEStreamReturn {
  const { onContent, onMetadata, onError, onComplete, onAbort } = options;

  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingStreamingContentRef = useRef('');
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');

  const flushStreamingContent = useCallback((force: boolean = false) => {
    const applyFlush = () => {
      setStreamingContent(pendingStreamingContentRef.current);
    };

    if (force) {
      clearTimer(flushTimerRef);
      applyFlush();
      return;
    }

    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      applyFlush();
    }, STREAM_FLUSH_INTERVAL_MS);
  }, []);

  const parseSSEStream = useCallback(
    async (reader: ReadableStreamDefaultReader<Uint8Array>, onChunk: (event: SSEEvent) => void) => {
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data) as SSEEvent;
            onChunk(parsed);
          } catch (error) {
            if (error instanceof Error && error.message !== 'Unexpected end of JSON input') {
              console.warn('[useSSEStream] Failed to parse SSE event:', error);
            }
          }
        }
      }
    },
    []
  );

  const startStream = useCallback(
    async (requestOptions: StreamRequestOptions): Promise<{ fullContent: string; metadata: SSEEvent | null }> => {
      const { url, body, headers = {} } = requestOptions;

      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      pendingStreamingContentRef.current = '';
      setStreamingContent('');
      setIsStreaming(true);

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
            pendingStreamingContentRef.current = fullContent;
            flushStreamingContent();
            onContent?.(event.content, fullContent);
            return;
          }

          if (event.type === 'metadata') {
            metadata = event;
            onMetadata?.(event);
            return;
          }

          if (event.type === 'error') {
            throw new Error(event.error || '服务端错误');
          }
        });

        flushStreamingContent(true);
        onComplete?.(fullContent);
        return { fullContent, metadata };
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          onAbort?.();
          throw error;
        }
        onError?.(error instanceof Error ? error : new Error('未知错误'));
        throw error;
      } finally {
        flushStreamingContent(true);
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [flushStreamingContent, onAbort, onComplete, onContent, onError, onMetadata, parseSSEStream]
  );

  const stopStream = useCallback(() => {
    abortControllerRef.current?.abort();
    clearTimer(flushTimerRef);
    setIsStreaming(false);
    abortControllerRef.current = null;
  }, []);

  const clearContent = useCallback(() => {
    pendingStreamingContentRef.current = '';
    clearTimer(flushTimerRef);
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

export function useSimpleSSEStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [thinkingContent, setThinkingContent] = useState('');
  const [isThinking, setIsThinking] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingStreamingContentRef = useRef('');
  const pendingThinkingContentRef = useRef('');
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushBufferedContent = useCallback((force: boolean = false) => {
    const applyFlush = () => {
      setStreamingContent(pendingStreamingContentRef.current);
      setThinkingContent(pendingThinkingContentRef.current);
    };

    if (force) {
      clearTimer(flushTimerRef);
      applyFlush();
      return;
    }

    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      applyFlush();
    }, STREAM_FLUSH_INTERVAL_MS);
  }, []);

  const fetchStream = useCallback(
    async (
      url: string,
      body: Record<string, unknown>,
      options: {
        headers?: Record<string, string>;
        onMetadata?: (metadata: SSEEvent) => void;
        onContent?: (chunk: string, fullContent: string) => void;
        onThinking?: (chunk: string, fullThinking: string) => void;
      } = {}
    ): Promise<{ content: string; thinking: string }> => {
      const { headers = {}, onMetadata, onContent, onThinking } = options;

      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      pendingStreamingContentRef.current = '';
      pendingThinkingContentRef.current = '';
      setStreamingContent('');
      setThinkingContent('');
      setIsThinking(true);
      setIsStreaming(true);

      let fullContent = '';
      let fullThinking = '';

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
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data) as SSEEvent;

              if (parsed.type === 'thinking' && parsed.content) {
                fullThinking += parsed.content;
                pendingThinkingContentRef.current = fullThinking;
                flushBufferedContent();
                onThinking?.(parsed.content, fullThinking);
                continue;
              }

              if ((parsed.type === 'content' || !parsed.type) && parsed.content) {
                setIsThinking(false);
                fullContent += parsed.content;
                pendingStreamingContentRef.current = fullContent;
                flushBufferedContent();
                onContent?.(parsed.content, fullContent);
                continue;
              }

              if (parsed.type === 'metadata') {
                onMetadata?.(parsed);
                continue;
              }

              if (parsed.type === 'error' || parsed.error) {
                throw new Error(parsed.error || '服务端错误');
              }
            } catch (error) {
              if (error instanceof SyntaxError) {
                continue;
              }
              throw error;
            }
          }
        }

        flushBufferedContent(true);
        return { content: fullContent, thinking: fullThinking };
      } finally {
        flushBufferedContent(true);
        setIsStreaming(false);
        setIsThinking(false);
        abortControllerRef.current = null;
      }
    },
    [flushBufferedContent]
  );

  const stopStream = useCallback(() => {
    abortControllerRef.current?.abort();
    flushBufferedContent(true);
    setIsStreaming(false);
    setIsThinking(false);
    abortControllerRef.current = null;
  }, [flushBufferedContent]);

  const clearContent = useCallback(() => {
    pendingStreamingContentRef.current = '';
    pendingThinkingContentRef.current = '';
    flushBufferedContent(true);
    setStreamingContent('');
    setThinkingContent('');
  }, [flushBufferedContent]);

  const clearStreamingOnly = useCallback(() => {
    pendingStreamingContentRef.current = '';
    flushBufferedContent(true);
    setStreamingContent('');
  }, [flushBufferedContent]);

  return {
    fetchStream,
    stopStream,
    isStreaming,
    isThinking,
    streamingContent,
    thinkingContent,
    clearContent,
    clearStreamingOnly,
  };
}
