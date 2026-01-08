'use client';

// AI 家教聊天组件
// 简化实现，直接调用 /api/chat

import { useState, useRef, useEffect } from 'react';
import { formatTimestampMs } from '@/lib/longcut';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface AIChatProps {
  /** 困惑点 ID */
  anchorId?: string;
  /** 困惑点时间戳 */
  anchorTimestamp?: number;
  /** 上下文转录文本 */
  contextText?: string;
  /** 点击时间戳回调 */
  onTimestampClick?: (timeMs: number) => void;
  /** API 端点 */
  apiEndpoint?: string;
}

// AI 家教系统提示词
const TUTOR_SYSTEM_PROMPT = `你是一位专业的 AI 家教，专门帮助学生理解课堂上没听懂的内容。

你的职责：
1. 基于提供的课堂转录内容，帮助学生理解知识点
2. 用简单易懂的语言解释复杂概念
3. 提供相关的例子和类比
4. 引导学生思考，而不是直接给出答案
5. 鼓励学生提问，营造积极的学习氛围

回答要求：
- 如果涉及具体时间点，使用 [MM:SS] 格式标注
- 如果学生问的内容不在课堂转录中，诚实告知并尝试基于已有知识回答
- 保持耐心和鼓励的态度`;

export function AIChat({
  anchorId,
  anchorTimestamp,
  contextText,
  onTimestampClick,
  apiEndpoint = '/api/chat',
}: AIChatProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 发送消息
  const sendMessage = async (content: string) => {
    if (!content.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: content.trim(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setError(null);

    try {
      // 构建消息历史，包含系统提示词
      const apiMessages = [
        { role: 'system' as const, content: TUTOR_SYSTEM_PROMPT },
        ...messages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user' as const, content: userMessage.content },
      ];

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          context: contextText,
          anchorId,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`);
      }

      const data = await response.json();
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.content || data.message || '抱歉，我无法回答这个问题。',
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 表单提交
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputValue);
  };

  // 快捷问题
  const quickQuestions = [
    '这个概念能再解释一下吗？',
    '有没有类似的例子？',
    '这个和之前学的有什么关系？',
    '我应该怎么练习？',
  ];

  // 解析消息中的时间戳
  const renderMessageContent = (content: string) => {
    const timestampRegex = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;
    const parts = content.split(timestampRegex);

    return parts.map((part, index) => {
      if (index % 2 === 1) {
        const timeParts = part.split(':').map(Number);
        let timeMs = 0;
        if (timeParts.length === 2) {
          timeMs = (timeParts[0] * 60 + timeParts[1]) * 1000;
        } else if (timeParts.length === 3) {
          timeMs = (timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2]) * 1000;
        }

        return (
          <button
            key={index}
            onClick={() => onTimestampClick?.(timeMs)}
            className="inline-flex items-center px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-sm font-mono hover:bg-indigo-200 transition-colors"
          >
            ▶ {part}
          </button>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-white rounded-lg border border-gray-200">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="text-lg">🎓</span>
          <span className="font-medium text-gray-900">AI 家教</span>
        </div>
        {anchorTimestamp && (
          <span className="text-xs text-gray-500">
            困惑点: {formatTimestampMs(anchorTimestamp)}
          </span>
        )}
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 初始提示 */}
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="text-4xl mb-3">🤔</div>
            <h3 className="font-medium text-gray-900 mb-2">有什么不明白的？</h3>
            <p className="text-sm text-gray-500 mb-4">
              我会根据老师讲的内容帮你解答
            </p>

            {/* 快捷问题 */}
            <div className="flex flex-wrap justify-center gap-2">
              {quickQuestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  disabled={isLoading}
                  className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 消息 */}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-4 py-2 ${
                message.role === 'user'
                  ? 'bg-indigo-500 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              {message.role === 'assistant' ? (
                <div className="prose prose-sm max-w-none">
                  {renderMessageContent(message.content)}
                </div>
              ) : (
                message.content
              )}
            </div>
          </div>
        ))}

        {/* 加载状态 */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg px-4 py-2">
              <div className="flex items-center gap-2 text-gray-500">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-sm">思考中...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-200">
          <div className="flex items-center justify-between text-sm text-red-700">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="underline hover:no-underline"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* 输入框 */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-200">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isLoading}
            placeholder="输入你的问题..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={isLoading || !inputValue.trim()}
            className="px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            发送
          </button>
        </div>
      </form>
    </div>
  );
}
