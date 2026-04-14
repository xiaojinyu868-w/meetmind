'use client';

/**
 * useAgenticTutor — Agentic Tutor 前端 Hook
 *
 * 消费 /api/tutor/agent 的 SSE 事件流，维护：
 * - 思考步骤列表（Manus 风格 UI）
 * - 最终回答
 * - 加载状态
 */

import { useState, useCallback, useRef } from 'react';

export interface AgentStep {
  id: string;
  type: 'thinking' | 'tool_start' | 'tool_result';
  message: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  resultPreview?: string;
  timestamp: number;
}

export interface AgenticTutorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  steps?: AgentStep[]; // 只有 assistant 消息有思考步骤
  timestamp: number;
}

export interface UseAgenticTutorReturn {
  messages: AgenticTutorMessage[];
  isLoading: boolean;
  currentSteps: AgentStep[];
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  clearMessages: () => void;
}

export function useAgenticTutor(accessToken: string | null): UseAgenticTutorReturn {
  const [messages, setMessages] = useState<AgenticTutorMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSteps, setCurrentSteps] = useState<AgentStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const stepIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !accessToken) return;

    // 取消之前的请求
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const userMsg: AgenticTutorMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setCurrentSteps([]);
    setError(null);

    const steps: AgentStep[] = [];

    try {
      const history = messages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch('/api/tutor/agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ message: text.trim(), history }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

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
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);

            switch (event.type) {
              case 'thinking': {
                const step: AgentStep = {
                  id: `step-${++stepIdRef.current}`,
                  type: 'thinking',
                  message: event.message || '思考中...',
                  timestamp: Date.now(),
                };
                steps.push(step);
                setCurrentSteps([...steps]);
                break;
              }

              case 'tool_start': {
                const step: AgentStep = {
                  id: `step-${++stepIdRef.current}`,
                  type: 'tool_start',
                  message: event.description || event.toolName,
                  toolName: event.toolName,
                  toolArgs: event.toolArgs,
                  timestamp: Date.now(),
                };
                steps.push(step);
                setCurrentSteps([...steps]);
                break;
              }

              case 'tool_result': {
                const step: AgentStep = {
                  id: `step-${++stepIdRef.current}`,
                  type: 'tool_result',
                  message: `${event.toolName} 完成`,
                  toolName: event.toolName,
                  resultPreview: event.resultPreview,
                  timestamp: Date.now(),
                };
                steps.push(step);
                setCurrentSteps([...steps]);
                break;
              }

              case 'content_done': {
                const assistantMsg: AgenticTutorMessage = {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: event.content || '',
                  steps: [...steps],
                  timestamp: Date.now(),
                };
                setMessages(prev => [...prev, assistantMsg]);
                setCurrentSteps([]);
                break;
              }

              case 'error': {
                setError(event.message || '出错了');
                break;
              }
            }
          } catch { /* 忽略解析错误 */ }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // 用户取消，不处理
      } else {
        setError(err instanceof Error ? err.message : '网络错误');
      }
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, messages]);

  const clearMessages = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setCurrentSteps([]);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    currentSteps,
    error,
    sendMessage,
    clearMessages,
  };
}
