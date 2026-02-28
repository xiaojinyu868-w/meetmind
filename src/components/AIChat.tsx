'use client';

// AI 家教聊天组件
// 支持流式输出、思维引导、思考过程可视化、对话历史持久化、模型选择、图片上传

import { useState, useRef, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { formatTimestampMs } from '@/lib/longcut';
import { useAuth } from '@/lib/hooks/useAuth';
import { conversationService, getEffectiveUserId } from '@/lib/services/conversation-service';
import type { ConversationHistory } from '@/types/conversation';
import { ModelSelector } from './ModelSelector';
import { ImageUpload, useImagePaste, type UploadedImage } from './ImageUpload';
import { DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import { ThinkingGuideRenderer } from './ThinkingGuideRenderer';
import { StreamingMarkdown } from './StreamingMarkdown';
import { ThinkingVisualizer } from './ThinkingVisualizer';
import { useSimpleSSEStream } from '@/lib/hooks/useSSEStream';
import { VoiceMicButton } from './VoiceMicButton';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 思考过程内容（仅 assistant） */
  thinking?: string;
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
  /** 是否为移动端 */
  isMobile?: boolean;
  /** 是否强制回答携带时间戳引用 */
  forceTimestampCitations?: boolean;
  /** 助手回答回调（用于外部构建时间轴高亮） */
  onAssistantMessage?: (payload: {
    id: string;
    prompt: string;
    content: string;
    timestamps: number[];
  }) => void;
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

const STRICT_TIMESTAMP_HINT = `请尽量在回答中给出 2-6 个关键时间点，统一使用 [MM:SS] 格式，并把时间点和对应观点绑定。`;

function extractTimestampMs(content: string): number[] {
  if (!content) return [];
  const timestamps = new Set<number>();
  const patterns = [
    /\[(\d{1,2}):([0-5]\d)\]/g,
    /(?:^|[\s(（【])(\d{1,2}):([0-5]\d)(?=$|[\s)\]）】,，。.!?])/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null = pattern.exec(content);
    while (match) {
      const minutes = Number.parseInt(match[1], 10);
      const seconds = Number.parseInt(match[2], 10);
      if (Number.isFinite(minutes) && Number.isFinite(seconds)) {
        timestamps.add(minutes * 60000 + seconds * 1000);
      }
      match = pattern.exec(content);
    }
  }

  return Array.from(timestamps).sort((a, b) => a - b);
}

export function AIChat({
  anchorId,
  anchorTimestamp,
  contextText,
  onTimestampClick,
  apiEndpoint = '/api/chat',
  sessionId,
  conversationId: initialConversationId,
  onConversationChange,
  isMobile = false,
  forceTimestampCitations = false,
  onAssistantMessage,
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

  // 根据 sessionId + anchorId 生成持久化 key，用于 tab 切换后恢复对话
  const persistKey = `aichat_conv_${sessionId || 'default'}${anchorId ? `_${anchorId}` : ''}`;

  // 思维引导开关
  const [enableThinkingGuide, setEnableThinkingGuide] = useState(true);
  // 思考过程折叠状态
  const [thinkingCollapsed, setThinkingCollapsed] = useState(false);
  // 思考开始时间
  const [thinkingStartTime, setThinkingStartTime] = useState<number | undefined>();

  // 流式输出 SSE Hook
  const {
    fetchStream,
    stopStream,
    isStreaming,
    isThinking,
    streamingContent,
    thinkingContent,
    clearContent,
  } = useSimpleSSEStream();

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
  }, [messages, streamingContent, thinkingContent]);

  // 初始化或恢复对话
  useEffect(() => {
    const initConversation = async () => {
      // 确定要加载的对话 ID：优先使用传入的，其次从 sessionStorage 恢复
      const targetConvId = initialConversationId || (() => {
        try { return sessionStorage.getItem(persistKey) || undefined; } catch { return undefined; }
      })();

      if (targetConvId) {
        setIsInitializing(true);
        try {
          const conv = await conversationService.getConversation(targetConvId);
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
          toast.error('加载对话历史失败');
        } finally {
          setIsInitializing(false);
        }
      }
    };
    
    initConversation();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId, persistKey]);

  // 监听 sessionId 变化，清理消息状态
  useEffect(() => {
    // sessionId 变化时重置所有对话状态
    setMessages([]);
    setConversation(null);
    setError(null);
    setInputValue('');
    conversationIdRef.current = null;
    try { sessionStorage.removeItem(persistKey); } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

      // 持久化 conversationId，tab 切换后可恢复
      try { sessionStorage.setItem(persistKey, conv.conversationId); } catch { /* ignore */ }
      
      return conv;
    } catch (err) {
      console.error('Failed to create conversation:', err);
      toast.error('创建对话失败');
      return null;
    }
  }, [userId, sessionId, anchorId, anchorTimestamp, onConversationChange, persistKey]);

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

  // 发送消息（流式）
  const sendMessage = async (content: string) => {
    if ((!content.trim() && uploadedImages.length === 0) || isLoading || isStreaming) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: content.trim() || '(发送了图片)',
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setError(null);
    clearContent();
    setThinkingCollapsed(false);
    setThinkingStartTime(Date.now());

    try {
      // 如果是首条消息，创建对话
      if (!conversationIdRef.current) {
        await createConversation(content.trim() || '图片问题');
      }
      
      // 保存用户消息
      await saveMessage('user', userMessage.content);

      // 构建请求头
      const headers: Record<string, string> = {};
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      // 构建请求体
      const requestBody: Record<string, unknown> = {
        messages: [
          {
            role: 'system' as const,
            content: forceTimestampCitations
              ? `${TUTOR_SYSTEM_PROMPT}\n\n${STRICT_TIMESTAMP_HINT}`
              : TUTOR_SYSTEM_PROMPT,
          },
          ...messages.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
          { role: 'user' as const, content: userMessage.content },
        ],
        model: selectedModel,
        context: contextText,
        anchorId,
        stream: true,
        enable_thinking_guide: enableThinkingGuide,
      };

      // 支持多模态（图片上传）
      if (supportsMultimodal && uploadedImages.length > 0) {
        requestBody.messageContent = [
          ...uploadedImages.map(img => ({
            type: 'image_url',
            image_url: { url: img.dataUrl },
          })),
          { type: 'text', text: content.trim() || '请描述这张图片' },
        ];
        setUploadedImages([]);
      }

      const result = await fetchStream(apiEndpoint, requestBody, { headers });
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result.content || '抱歉，我无法回答这个问题。',
        thinking: result.thinking || undefined,
      };

      setMessages(prev => [...prev, assistantMessage]);
      onAssistantMessage?.({
        id: assistantMessage.id,
        prompt: userMessage.content,
        content: assistantMessage.content,
        timestamps: extractTimestampMs(assistantMessage.content),
      });
      
      // 保存助手消息
      await saveMessage('assistant', assistantMessage.content);
      clearContent();
    } catch (err) {
      // 用户取消不算错误
      if (err instanceof Error && err.name === 'AbortError') {
        // 把已经流式输出的内容保存为消息
        const partialContent = streamingContent;
        if (partialContent) {
          const partialMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: partialContent + '\n\n[生成已停止]',
            thinking: thinkingContent || undefined,
          };
          setMessages(prev => [...prev, partialMessage]);
          await saveMessage('assistant', partialMessage.content);
        }
        clearContent();
      } else {
        setError(err instanceof Error ? err.message : '发送失败');
      }
    } finally {
      setIsLoading(false);
      setThinkingStartTime(undefined);
    }
  };

  // 停止生成
  const handleStopGeneration = useCallback(() => {
    stopStream();
  }, [stopStream]);

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

  // 清空当前对话
  const clearConversation = useCallback(() => {
    setMessages([]);
    setConversation(null);
    conversationIdRef.current = null;
    try { sessionStorage.removeItem(persistKey); } catch { /* ignore */ }
  }, [persistKey]);

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
          {/* 思维引导开关 */}
          {!isMobile && (
            <label className="flex items-center gap-1 cursor-pointer select-none" title="开启后 AI 会展示解题思路引导">
              <input
                type="checkbox"
                checked={enableThinkingGuide}
                onChange={(e) => setEnableThinkingGuide(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-gray-300 text-violet-600 focus:ring-violet-500 cursor-pointer"
              />
              <span className="text-xs text-gray-500">🧠 思维引导</span>
            </label>
          )}
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
              className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="新对话"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
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
                  disabled={isLoading || isStreaming}
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
              className={`max-w-[90%] rounded-2xl ${isMobile ? 'px-3 py-2' : 'px-4 py-3'} ${
                message.role === 'user'
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white'
                  : 'bg-gray-50 text-gray-800'
              }`}
            >
              {message.role === 'assistant' ? (
                <div>
                  {/* 已完成消息的思考过程 */}
                  {message.thinking && !enableThinkingGuide && (
                    <div className="mb-2">
                      <ThinkingVisualizer
                        content={message.thinking}
                        isThinking={false}
                        isCollapsed={true}
                        onToggleCollapse={() => {}}
                        enableGuideMode={false}
                        onTimestampClick={onTimestampClick}
                        isMobile={isMobile}
                      />
                    </div>
                  )}
                  {enableThinkingGuide ? (
                    <ThinkingGuideRenderer
                      content={message.content}
                      onTimestampClick={onTimestampClick}
                      isMobile={isMobile}
                      className={`${isMobile ? 'text-xs' : 'text-sm'} leading-relaxed`}
                    />
                  ) : (
                    <StreamingMarkdown
                      content={message.content}
                      isStreaming={false}
                      onTimestampClick={onTimestampClick}
                      className={`${isMobile ? 'text-xs' : 'text-sm'} leading-relaxed`}
                    />
                  )}
                </div>
              ) : (
                <div className={`${isMobile ? 'text-xs' : 'text-sm'} whitespace-pre-wrap`}>
                  {message.content}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* 流式输出中的内容 */}
        {(isStreaming || isLoading) && (
          <div className="flex justify-start">
            <div className={`max-w-[90%] rounded-2xl ${isMobile ? 'px-3 py-2' : 'px-4 py-3'} bg-gray-50 text-gray-800`}>
              {/* 思考过程可视化 */}
              {thinkingContent && !enableThinkingGuide && (
                <div className="mb-2">
                  <ThinkingVisualizer
                    content={thinkingContent}
                    isThinking={isThinking}
                    isCollapsed={thinkingCollapsed}
                    onToggleCollapse={() => setThinkingCollapsed(prev => !prev)}
                    enableGuideMode={false}
                    onTimestampClick={onTimestampClick}
                    startTime={thinkingStartTime}
                    isMobile={isMobile}
                  />
                </div>
              )}
              {/* 流式内容 */}
              {streamingContent ? (
                enableThinkingGuide ? (
                  <ThinkingGuideRenderer
                    content={streamingContent}
                    onTimestampClick={onTimestampClick}
                    isMobile={isMobile}
                    className={`${isMobile ? 'text-xs' : 'text-sm'} leading-relaxed`}
                  />
                ) : (
                  <StreamingMarkdown
                    content={streamingContent}
                    isStreaming={isStreaming}
                    onTimestampClick={onTimestampClick}
                    className={`${isMobile ? 'text-xs' : 'text-sm'} leading-relaxed`}
                  />
                )
              ) : (
                <div className="flex items-center gap-2 text-gray-500">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-sm">{isThinking ? '正在思考...' : '生成中...'}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 停止生成按钮 */}
        {isStreaming && (
          <div className="flex justify-center">
            <button
              onClick={handleStopGeneration}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-full transition-colors"
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
              停止生成
            </button>
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
            disabled={isLoading || isStreaming}
            placeholder="输入你的问题..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          <VoiceMicButton
            onTranscript={(text) => setInputValue(prev => prev + text)}
            disabled={isLoading || isStreaming}
          />
          <button
            type="submit"
            disabled={isLoading || isStreaming || (!inputValue.trim() && uploadedImages.length === 0)}
            className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            发送
          </button>
        </div>
      </form>
    </div>
  );
}
