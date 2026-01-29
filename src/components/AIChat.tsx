'use client';

// AI 家教聊天组件
// 支持对话历史持久化存储、模型选择、图片上传

import { useState, useRef, useEffect, useCallback } from 'react';
import { formatTimestampMs } from '@/lib/longcut';
import { useAuth } from '@/lib/hooks/useAuth';
import { conversationService, getEffectiveUserId } from '@/lib/services/conversation-service';
import type { ConversationHistory, ConversationMessage } from '@/types/conversation';
import { ModelSelector } from './ModelSelector';
import { ImageUpload, useImagePaste, type UploadedImage } from './ImageUpload';
import { DEFAULT_MODEL_ID } from '@/lib/services/llm-service';

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
  /** 关联的音频会话 ID */
  sessionId?: string;
  /** 指定继续的对话 ID */
  conversationId?: string;
  /** 对话创建/更新回调 */
  onConversationChange?: (conversation: ConversationHistory) => void;
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
  sessionId,
  conversationId: initialConversationId,
  onConversationChange,
}: AIChatProps) {
  const { user, accessToken } = useAuth();
  const userId = getEffectiveUserId(user?.id);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 模型选择
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  const [supportsMultimodal, setSupportsMultimodal] = useState(true);
  
  // 图片上传
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  
  // 对话历史状态
  const [conversation, setConversation] = useState<ConversationHistory | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const conversationIdRef = useRef<string | null>(initialConversationId || null);

  // 监听粘贴事件
  useImagePaste(
    (pastedImages) => {
      if (supportsMultimodal) {
        setUploadedImages(prev => [...prev, ...pastedImages].slice(0, 5));
      }
    },
    supportsMultimodal,
    10
  );

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 初始化或恢复对话
  useEffect(() => {
    const initConversation = async () => {
      // 如果指定了对话 ID，加载历史
      if (initialConversationId) {
        setIsInitializing(true);
        try {
          const conv = await conversationService.getConversation(initialConversationId);
          if (conv) {
            setConversation(conv);
            conversationIdRef.current = conv.conversationId;
            
            // 加载历史消息
            const historyMessages = await conversationService.getMessages(conv.conversationId);
            setMessages(historyMessages.map(m => ({
              id: m.messageId,
              role: m.role as 'user' | 'assistant',
              content: m.content,
            })));
          }
        } catch (err) {
          console.error('Failed to load conversation:', err);
        } finally {
          setIsInitializing(false);
        }
      }
    };
    
    initConversation();
  }, [initialConversationId]);

  // 监听 sessionId 变化，清理消息状态
  useEffect(() => {
    // sessionId 变化时重置所有对话状态
    setMessages([]);
    setConversation(null);
    setError(null);
    setInputValue('');
    conversationIdRef.current = null;
  }, [sessionId]);

  // 创建新对话
  const createConversation = useCallback(async (firstMessage: string) => {
    try {
      const title = conversationService.generateTitleFromMessage(firstMessage);
      const conv = await conversationService.createConversation({
        userId,
        type: 'chat',
        title,
        sessionId,
        anchorId,
        anchorTimestamp,
      });
      
      setConversation(conv);
      conversationIdRef.current = conv.conversationId;
      onConversationChange?.(conv);
      
      return conv;
    } catch (err) {
      console.error('Failed to create conversation:', err);
      return null;
    }
  }, [userId, sessionId, anchorId, anchorTimestamp, onConversationChange]);

  // 保存消息到对话历史
  const saveMessage = useCallback(async (role: 'user' | 'assistant', content: string) => {
    if (!conversationIdRef.current) return;
    
    try {
      await conversationService.addMessage(conversationIdRef.current, {
        role,
        content,
      });
    } catch (err) {
      console.error('Failed to save message:', err);
    }
  }, []);

  // 发送消息
  const sendMessage = async (content: string) => {
    if ((!content.trim() && uploadedImages.length === 0) || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: content.trim() || '(发送了图片)',
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setError(null);

    try {
      // 如果是首条消息，创建对话
      if (!conversationIdRef.current) {
        await createConversation(content.trim() || '图片问题');
      }
      
      // 保存用户消息
      await saveMessage('user', userMessage.content);

      // 构建请求头
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      // 构建请求体
      const requestBody: Record<string, unknown> = {
        messages: [
          { role: 'system' as const, content: TUTOR_SYSTEM_PROMPT },
          ...messages.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
          { role: 'user' as const, content: userMessage.content },
        ],
        model: selectedModel,
        context: contextText,
        anchorId,
        stream: false,
      };

      // 支持多模态（图片上传）
      if (supportsMultimodal && uploadedImages.length > 0) {
        requestBody.messageContent = [
          ...uploadedImages.map(img => ({
            type: 'image_url',
            image_url: { url: img.base64 },
          })),
          { type: 'text', text: content.trim() || '请描述这张图片' },
        ];
        setUploadedImages([]);  // 清空图片
      }

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
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
      
      // 保存助手消息
      await saveMessage('assistant', assistantMessage.content);
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
            className="inline-flex items-center px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-sm font-mono hover:bg-amber-200 transition-colors"
          >
            ▶ {part}
          </button>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  // 清空当前对话
  const clearConversation = useCallback(() => {
    setMessages([]);
    setConversation(null);
    conversationIdRef.current = null;
  }, []);

  if (isInitializing) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-white rounded-lg border border-gray-200">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="flex gap-1 justify-center mb-2">
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <p className="text-sm text-gray-500">加载对话历史...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-white rounded-lg border border-gray-200">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="text-lg">🎓</span>
          <span className="font-medium text-gray-900">AI 家教</span>
          {conversation && (
            <span className="text-xs text-gray-400 truncate max-w-[120px]" title={conversation.title}>
              · {conversation.title}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ModelSelector
            value={selectedModel}
            onChange={setSelectedModel}
            onMultimodalChange={setSupportsMultimodal}
            compact={true}
          />
          {anchorTimestamp && (
            <span className="text-xs text-gray-500">
              困惑点: {formatTimestampMs(anchorTimestamp)}
            </span>
          )}
          {messages.length > 0 && (
            <button
              onClick={clearConversation}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              title="开始新对话"
            >
              🔄 新对话
            </button>
          )}
        </div>
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
                  ? 'bg-amber-500 text-white'
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
        {/* 图片预览区域 */}
        {supportsMultimodal && uploadedImages.length > 0 && (
          <div className="mb-3 p-2 bg-gray-50 rounded-lg">
            <ImageUpload
              images={uploadedImages}
              onImagesChange={setUploadedImages}
              maxImages={5}
              disabled={isLoading}
            />
          </div>
        )}
        
        <div className="flex gap-2 items-end">
          {/* 图片上传按钮 */}
          {supportsMultimodal && (
            <ImageUpload
              images={[]}
              onImagesChange={(newImages) => {
                setUploadedImages(prev => [...prev, ...newImages].slice(0, 5));
              }}
              maxImages={5 - uploadedImages.length}
              disabled={isLoading || uploadedImages.length >= 5}
              className="flex-shrink-0"
            />
          )}
          
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isLoading}
            placeholder="输入你的问题..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={isLoading || (!inputValue.trim() && uploadedImages.length === 0)}
            className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            发送
          </button>
        </div>
      </form>
    </div>
  );
}
