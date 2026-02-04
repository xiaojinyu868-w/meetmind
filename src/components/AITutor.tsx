'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Breakpoint } from '@/lib/services/meetmind-service';
import { formatTimestamp } from '@/lib/services/longcut-utils';
import { notebookService, localSearch, type SearchResult } from '@/lib/services/notebook-service';
import { ModelSelector } from './ModelSelector';
import { GuidanceQuestion, GuidanceQuestionSkeleton } from './GuidanceQuestion';
import { Citations, CitationsSkeleton } from './Citations';
import { ImageUpload, useImagePaste, type UploadedImage } from './ImageUpload';
import { useAuth } from '@/lib/hooks/useAuth';
import { useSimpleSSEStream, type SSEEvent } from '@/lib/hooks/useSSEStream';
import { saveTutorResponseCache, getTutorResponseCache, deleteTutorResponseCache, getPreference, setPreference, type TutorResponseCache, saveClassSummary, getSessionSummary } from '@/lib/db';
import { conversationService, getEffectiveUserId } from '@/lib/services/conversation-service';
import type { GuidanceQuestion as GuidanceQuestionType, GuidanceOption, Citation } from '@/types/dify';
import { DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import { StreamingMarkdown } from './StreamingMarkdown';
import { ThinkingVisualizer } from './ThinkingVisualizer';
import { ThinkingGuideRenderer } from './ThinkingGuideRenderer';

// 持久化状态的 key
const TUTOR_STATE_KEY = 'tutor_last_state';

interface Segment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
}

interface ActionItem {
  id: string;
  type: 'replay' | 'exercise' | 'review';
  title: string;
  description: string;
  estimatedMinutes: number;
  completed: boolean;
}

interface AITutorProps {
  breakpoint: Breakpoint | null;
  segments: Segment[];
  isLoading: boolean;
  onResolve: () => void;
  onActionItemsUpdate?: (items: ActionItem[]) => void;
  sessionId?: string;  // 用于缓存关联
  onSeek?: (timeMs: number) => void;  // 点击时间戳跳转播放
  initialQuestion?: string;  // 移动端传入的初始问题
  isMobile?: boolean;  // 移动端模式，使用简化布局
}

interface TutorAPIResponse {
  explanation: {
    teacherSaid: string;
    citation: {
      text: string;
      timeRange: string;
      startMs: number;
      endMs: number;
    };
    possibleStuckPoints: string[];
    followUpQuestion: string;
  };
  actionItems: Array<{
    id: string;
    type: 'replay' | 'exercise' | 'review';
    title: string;
    description: string;
    estimatedMinutes: number;
    completed: boolean;
  }>;
  rawContent: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  guidance_question?: GuidanceQuestionType;
  citations?: Citation[];
  conversation_id?: string;
  // 摘要相关字段
  summary_generated?: boolean;
  cached_summary?: {
    overview: string;
    takeaways: string;
    keyDifficulties: string[];
  };
}

export function AITutor({ breakpoint, segments, isLoading: externalLoading, onResolve, onActionItemsUpdate, sessionId = 'default', onSeek, initialQuestion, isMobile = false }: AITutorProps) {
  const { accessToken, user } = useAuth();
  const userId = getEffectiveUserId(user?.id);
  const [userInput, setUserInput] = useState('');
  const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  const [response, setResponse] = useState<TutorAPIResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  
  // 缓存相关状态
  const [isFromCache, setIsFromCache] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);  // 正在恢复状态
  const previousBreakpointId = useRef<string | null>(null);
  const hasInitialized = useRef(false);  // 是否已完成初始化
  const hasProcessedInitialQuestion = useRef(false);  // 是否已处理初始问题
  const [isSearching, setIsSearching] = useState(false);
  const [notebookAvailable, setNotebookAvailable] = useState(false);
  
  // 对话历史相关
  const conversationIdRef = useRef<string | null>(null);
  
  const [enableWeb, setEnableWeb] = useState(false);  // 联网搜索默认关闭
  const [enableThinkingGuide, setEnableThinkingGuide] = useState(true);  // 学霸思维引导模式默认开启
  const [selectedOptionId, setSelectedOptionId] = useState<string | undefined>();
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [isGuidanceLoading, setIsGuidanceLoading] = useState(false);
  const [seekingTimestamp, setSeekingTimestamp] = useState<number | null>(null);
  
  // 思考开始时间（用于计算耗时）
  const [thinkingStartTime, setThinkingStartTime] = useState<number | undefined>();
  const [globalThinkingStartTime, setGlobalThinkingStartTime] = useState<number | undefined>();
  
  // 困惑点模式的流式输出 - 使用统一的 SSE Hook
  const {
    fetchStream: breakpointFetchStream,
    stopStream: breakpointStopStream,
    isStreaming: isBreakpointStreaming,
    isThinking: isBreakpointThinking,
    streamingContent: breakpointStreamingContent,
    thinkingContent: breakpointThinkingContent,
    clearContent: clearBreakpointContent,
    clearStreamingOnly: clearBreakpointStreamingOnly,
  } = useSimpleSSEStream();
  
  // 思考过程折叠状态
  const [isThinkingCollapsed, setIsThinkingCollapsed] = useState(false);
  
  // 多模态相关状态
  const [supportsMultimodal, setSupportsMultimodal] = useState(true);  // 默认模型支持多模态
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  // 监听粘贴事件
  useImagePaste(
    (pastedImages) => {
      if (supportsMultimodal) {
        setUploadedImages(prev => [...prev, ...pastedImages].slice(0, 5));
      }
    },
    supportsMultimodal && !!breakpoint,
    10
  );

  // 获取困惑点前后的转录上下文（前 90 秒，后 60 秒）
  const contextSegments = useMemo(() => {
    if (!breakpoint || segments.length === 0) return [];
    
    const startMs = Math.max(0, breakpoint.timestamp - 90000);
    const endMs = breakpoint.timestamp + 60000;
    
    return segments.filter(seg => 
      seg.endMs >= startMs && seg.startMs <= endMs
    );
  }, [breakpoint, segments]);

  // 处理 AI 返回的摘要 - 如果是新生成的，保存到 IndexedDB
  const handleSummaryFromResponse = useCallback(async (data: TutorAPIResponse) => {
    if (data.summary_generated && data.cached_summary && sessionId && sessionId !== 'default') {
      try {
        // 先检查是否已经存在摘要
        const existingSummary = await getSessionSummary(sessionId);
        if (!existingSummary) {
          // 解析 takeaways 字符串为结构化数据
          const takeawaysLines = data.cached_summary.takeaways.split('\n').filter(line => line.trim());
          const takeaways = takeawaysLines.map(line => {
            // 格式：- 知识点: 说明 [时间戳1, 时间戳2]
            const match = line.match(/^-\s*(.+?):\s*(.+?)\s*\[(.+?)\]$/);
            if (match) {
              return {
                label: match[1].trim(),
                insight: match[2].trim(),
                timestamps: match[3].split(',').map(t => t.trim()),
              };
            }
            // 简单格式
            return {
              label: '要点',
              insight: line.replace(/^-\s*/, '').trim(),
              timestamps: [],
            };
          });

          await saveClassSummary({
            summaryId: crypto.randomUUID(),
            sessionId,
            overview: data.cached_summary.overview,
            takeaways,
            keyDifficulties: data.cached_summary.keyDifficulties,
            structure: [], // 结构暂时为空
          });
          console.log('[AITutor] 摘要已自动保存到 IndexedDB');
        }
      } catch (err) {
        console.error('[AITutor] 保存摘要失败:', err);
      }
    }
  }, [sessionId]);

  // 格式化时间
  const formatTime = useCallback((ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(minutes)}:${pad(seconds % 60)}`;
  }, []);

  // 解析时间字符串为毫秒（支持单点和范围格式，增强鲁棒性）
  const parseTimeToMs = useCallback((time: string): number => {
    try {
      // 处理范围格式 "MM:SS-MM:SS"，取开始时间
      const rangeParts = time.split('-');
      const startTime = rangeParts[0].trim();
      
      const parts = startTime.split(':');
      if (parts.length === 2) {
        const minutes = parseInt(parts[0].trim());
        const seconds = parseInt(parts[1].trim());
        if (!isNaN(minutes) && !isNaN(seconds) && minutes >= 0 && seconds >= 0 && seconds < 60) {
          return (minutes * 60 + seconds) * 1000;
        }
      }
    } catch (error) {
      console.warn('Failed to parse timestamp:', time, error);
    }
    return 0;
  }, []);

  // 处理时间戳点击 - 添加视觉反馈和验证
  const handleTimestampClick = useCallback((timeMs: number) => {
    // 验证时间戳有效性
    if (timeMs < 0 || !isFinite(timeMs)) {
      console.warn('Invalid timestamp:', timeMs);
      return;
    }
    
    setSeekingTimestamp(timeMs);
    onSeek?.(timeMs);
    
    // 调试信息：确保时间戳同步
    console.log(`[Timestamp Click] Seeking to: ${formatTime(timeMs)} (${timeMs}ms)`);
    
    // 1.5秒后清除高亮状态
    setTimeout(() => setSeekingTimestamp(null), 1500);
  }, [onSeek, formatTime]);

  // 解析文本中的时间戳并渲染为可点击链接（增强视觉反馈）
  const renderTextWithTimestamps = useCallback((text: string) => {
    // 匹配多种时间戳格式：[MM:SS] 或 [MM:SS-MM:SS] 或 MM:SS 或 MM:SS-MM:SS
    const timestampRegex = /\[?(\d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?)\]?/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = timestampRegex.exec(text)) !== null) {
      // 添加时间戳前的文本
      if (match.index > lastIndex) {
        parts.push(<span key={`text-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
      }

      const timeString = match[1]; // 完整的时间字符串（可能包含范围）
      const startMs = parseTimeToMs(timeString);
      const isActive = seekingTimestamp === startMs;
      
      // 显示格式：如果是范围格式，显示范围；否则显示单点
      const displayText = timeString;

      parts.push(
          <button
          key={`ts-${match.index}`}
          onClick={() => handleTimestampClick(startMs)}
          className={`
            inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-mono mx-0.5
            transition-all duration-300 border
            ${isActive 
              ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white border-amber-600 shadow-lg shadow-amber-200 scale-110 animate-pulse' 
              : 'bg-gradient-to-r from-amber-100 to-amber-50 text-amber-700 border-amber-200 hover:from-amber-200 hover:to-amber-100 hover:shadow-md hover:scale-105'
            }
          `}
          title={`点击跳转到 ${displayText}`}
        >
          <span className={isActive ? 'animate-bounce' : ''}>▶</span>
          {displayText}
        </button>
      );

      lastIndex = match.index + match[0].length;
    }

    // 添加剩余文本
    if (lastIndex < text.length) {
      parts.push(<span key={`text-${lastIndex}`}>{text.slice(lastIndex)}</span>);
    }

    return parts.length > 0 ? parts : text;
  }, [handleTimestampClick, seekingTimestamp, parseTimeToMs]);

  useEffect(() => {
    notebookService.isAvailable().then(setNotebookAvailable);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  // 处理移动端传入的初始问题
  useEffect(() => {
    if (initialQuestion && !hasProcessedInitialQuestion.current) {
      hasProcessedInitialQuestion.current = true;
      setUserInput(initialQuestion);
      // 自动聚焦输入框
      setTimeout(() => {
        const input = document.querySelector('textarea[placeholder*="输入"]') as HTMLTextAreaElement;
        if (input) {
          input.focus();
        }
      }, 100);
    }
  }, [initialQuestion]);

  // 保存当前状态到 IndexedDB（用于页面刷新恢复）
  const saveCurrentState = useCallback(async () => {
    if (!breakpoint) return;
    
    try {
      await setPreference(TUTOR_STATE_KEY, {
        anchorId: breakpoint.id,
        sessionId,
        timestamp: breakpoint.timestamp,
        selectedModel,
        enableWeb,
        savedAt: Date.now(),
      });
    } catch (err) {
      console.error('Failed to save tutor state:', err);
    }
  }, [breakpoint, sessionId, selectedModel, enableWeb]);

  // 当关键状态变化时保存
  useEffect(() => {
    if (breakpoint && response) {
      saveCurrentState();
    }
  }, [breakpoint?.id, response, saveCurrentState]);

  // 当困惑点切换时，尝试从缓存加载
  useEffect(() => {
    if (!breakpoint) {
      setResponse(null);
      setChatHistory([]);
      setConversationId(undefined);
      setIsFromCache(false);
      previousBreakpointId.current = null;
      return;
    }

    // 如果是同一个困惑点，不重新加载
    if (previousBreakpointId.current === breakpoint.id) {
      return;
    }

    previousBreakpointId.current = breakpoint.id;

    // 尝试从缓存加载
    const loadFromCache = async () => {
      setIsRestoring(true);
      try {
        const cached = await getTutorResponseCache(breakpoint.id);
        if (cached) {
          const cachedResponse = JSON.parse(cached.response) as TutorAPIResponse;
          const cachedHistory = JSON.parse(cached.chatHistory) as Array<{ role: 'user' | 'assistant'; content: string }>;
          
          setResponse(cachedResponse);
          setChatHistory(cachedHistory);
          setConversationId(cached.conversationId);
          setIsFromCache(true);
          setError(null);
          
          // 通知父组件更新行动清单
          if (cachedResponse.actionItems && onActionItemsUpdate) {
            onActionItemsUpdate(cachedResponse.actionItems);
          }
          
          hasInitialized.current = true;
          setIsRestoring(false);
          return true;
        }
      } catch (err) {
        console.error('Failed to load from cache:', err);
      }
      
      // 没有缓存，清空状态
      setResponse(null);
      setChatHistory([]);
      setConversationId(undefined);
      setIsFromCache(false);
      hasInitialized.current = true;
      setIsRestoring(false);
      return false;
    };

    loadFromCache();
  }, [breakpoint, onActionItemsUpdate]);

  // 监听 sessionId 变化，清理旧会话状态
  useEffect(() => {
    // sessionId 变化时重置所有状态
    setChatHistory([]);
    setResponse(null);
    setConversationId(undefined);
    setIsFromCache(false);
    setError(null);
    setSearchResults([]);
    setSelectedOptionId(undefined);
    previousBreakpointId.current = null;
    hasInitialized.current = false;
    hasProcessedInitialQuestion.current = false;
    conversationIdRef.current = null;
  }, [sessionId]);

  // 保存到缓存
  const saveToCache = useCallback(async (
    resp: TutorAPIResponse,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    convId?: string
  ) => {
    if (!breakpoint) return;
    
    try {
      // 保存到 TutorResponseCache（原有缓存）
      await saveTutorResponseCache({
        anchorId: breakpoint.id,
        sessionId,
        timestamp: breakpoint.timestamp,
        response: JSON.stringify(resp),
        chatHistory: JSON.stringify(history),
        conversationId: convId,
      });
      
      // 同步到对话历史系统
      await syncToConversationHistory(resp, history);
    } catch (err) {
      console.error('Failed to save to cache:', err);
    }
  }, [breakpoint, sessionId]);

  // 同步到对话历史系统
  const syncToConversationHistory = useCallback(async (
    resp: TutorAPIResponse,
    history: Array<{ role: 'user' | 'assistant'; content: string }>
  ) => {
    if (!breakpoint) return;
    
    try {
      // 获取或创建对话记录
      let conv = await conversationService.getConversationByAnchor(breakpoint.id);
      
      if (!conv) {
        // 创建新对话
        conv = await conversationService.createConversation({
          userId,
          type: 'tutor',
          title: `困惑点 ${formatTimestamp(breakpoint.timestamp)}`,
          sessionId,
          anchorId: breakpoint.id,
          anchorTimestamp: breakpoint.timestamp,
          model: selectedModel,
        });
        conversationIdRef.current = conv.conversationId;
      }
      
      // 获取已保存的消息数
      const existingMessages = await conversationService.getMessages(conv.conversationId);
      
      // 只同步新增的消息
      if (history.length > existingMessages.length) {
        const newMessages = history.slice(existingMessages.length);
        await conversationService.addMessages(
          conv.conversationId,
          newMessages.map(m => ({
            role: m.role,
            content: m.content,
          }))
        );
      }
    } catch (err) {
      console.error('Failed to sync to conversation history:', err);
    }
  }, [breakpoint, userId, sessionId, selectedModel]);

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) return;
    
    setIsSearching(true);
    try {
      let results: SearchResult[];
      
      if (notebookAvailable) {
        results = await notebookService.search(query, { limit: 5 });
      } else {
        results = localSearch.search(
          query,
          segments.map(s => ({ id: s.id, text: s.text, timestamp: s.startMs }))
        );
      }
      
      setSearchResults(results);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setIsSearching(false);
    }
  }, [notebookAvailable, segments]);

  const explainBreakpoint = useCallback(async () => {
    if (!breakpoint || segments.length === 0) return;
    
    setIsLoading(true);
    setError(null);
    setResponse(null);
    setChatHistory([]);
    setSelectedOptionId(undefined);
    setConversationId(undefined);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }
      
      const res = await fetch('/api/tutor', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          timestamp: breakpoint.timestamp,
          segments,
          model: selectedModel,
          enable_guidance: true,
          enable_web: enableWeb,
          sessionId,  // 传递 sessionId 用于摘要缓存
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '请求失败');
      }

      const data: TutorAPIResponse = await res.json();
      setResponse(data);
      setIsFromCache(false);
      if (data.conversation_id) {
        setConversationId(data.conversation_id);
      }
      // 通知父组件更新行动清单
      if (data.actionItems && onActionItemsUpdate) {
        onActionItemsUpdate(data.actionItems);
      }
      // 保存摘要到 IndexedDB（如果是新生成的）
      await handleSummaryFromResponse(data);
      // 保存到缓存
      await saveToCache(data, [], data.conversation_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setIsLoading(false);
    }
  }, [breakpoint, segments, selectedModel, enableWeb, accessToken, onActionItemsUpdate, saveToCache, handleSummaryFromResponse]);

  useEffect(() => {
    // 只有在没有缓存数据且不在恢复状态时才自动加载
    if (breakpoint && !response && !isFromCache && !isRestoring && hasInitialized.current) {
      explainBreakpoint();
    }
  }, [breakpoint?.id, selectedModel, isRestoring]); // eslint-disable-line react-hooks/exhaustive-deps


  const handleGuidanceSelect = async (optionId: string, option: GuidanceOption) => {
    if (!breakpoint) return;
    
    setSelectedOptionId(optionId);
    setIsGuidanceLoading(true);
    
    // 添加用户消息
    const userMessage = `我选择了：${option.text}`;
    setChatHistory(prev => [...prev, { role: 'user', content: userMessage }]);
    
    // 用于接收元数据
    let newGuidanceQuestion: GuidanceQuestionType | undefined;
    let newConversationId: string | undefined;
    
    try {
      const headers: Record<string, string> = {};
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }
      
      // 记录思考开始时间
      setThinkingStartTime(Date.now());
      
      const result = await breakpointFetchStream('/api/tutor', {
        timestamp: breakpoint.timestamp,
        segments,
        model: selectedModel,
        enable_guidance: true,
        enable_web: enableWeb,
        enable_thinking_guide: enableThinkingGuide,
        selected_option_id: optionId,
        conversation_id: conversationId,
        studentQuestion: userMessage,
        sessionId,
        stream: true,
      }, {
        headers,
        onMetadata: (metadata: SSEEvent) => {
          if (metadata.conversation_id) {
            newConversationId = metadata.conversation_id as string;
          }
          if (metadata.guidance_question) {
            newGuidanceQuestion = metadata.guidance_question as GuidanceQuestionType;
          }
        },
      });

      // 流式完成
      const newHistory = [
        ...chatHistory,
        { role: 'user' as const, content: userMessage },
        { role: 'assistant' as const, content: result.content || '让我针对你的选择进一步解释...' },
      ];
      setChatHistory(newHistory);
      clearBreakpointStreamingOnly();  // 只清空流式内容，保留思考内容
      
      if (newConversationId) {
        setConversationId(newConversationId);
      }
      
      if (newGuidanceQuestion) {
        setResponse(prev => prev ? { ...prev, guidance_question: newGuidanceQuestion } : null);
        setSelectedOptionId(undefined);
      }
      
      // 更新缓存
      if (response) {
        await saveToCache(response, newHistory, newConversationId || conversationId);
      }
    } catch (err) {
      // 用户取消不显示错误
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: `抱歉，出现错误：${err instanceof Error ? err.message : '未知错误'}` 
      }]);
      clearBreakpointStreamingOnly();  // 只清空流式内容，保留思考内容
    } finally {
      setIsGuidanceLoading(false);
    }
  };

  const handleSend = async () => {
    if ((!userInput.trim() && uploadedImages.length === 0) || !breakpoint) return;
    
    const question = userInput.trim();
    const imagesToSend = [...uploadedImages];
    setUserInput('');
    setUploadedImages([]);
    
    // 构建用户消息显示内容
    const userDisplayContent = imagesToSend.length > 0
      ? `${question}${question ? '\n' : ''}[已上传 ${imagesToSend.length} 张图片]`
      : question;
    
    setChatHistory(prev => [...prev, { role: 'user', content: userDisplayContent }]);
    
    try {
      const headers: Record<string, string> = {};
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }
      
      // 构建多模态消息内容
      const messageContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
      
      // 添加图片
      for (const img of imagesToSend) {
        messageContent.push({
          type: 'image_url',
          image_url: { url: img.dataUrl },
        });
      }
      
      // 添加文本
      if (question) {
        messageContent.push({
          type: 'text',
          text: question,
        });
      }
      
      // 记录思考开始时间
      setThinkingStartTime(Date.now());
      
      const result = await breakpointFetchStream('/api/tutor', {
        timestamp: breakpoint.timestamp,
        segments,
        model: selectedModel,
        studentQuestion: question,
        messageContent: imagesToSend.length > 0 ? messageContent : undefined,
        enable_guidance: true,
        enable_web: enableWeb,
        enable_thinking_guide: enableThinkingGuide,
        conversation_id: conversationId,
        sessionId,
        stream: true,
      }, {
        headers,
        onMetadata: (metadata: SSEEvent) => {
          if (metadata.conversation_id) {
            setConversationId(metadata.conversation_id as string);
          }
          if ((metadata.citations as Citation[] | undefined)?.length) {
            setResponse(prev => prev ? { ...prev, citations: metadata.citations as Citation[] } : null);
          }
        },
      });

      // 流式完成，添加到历史
      const newHistory = [
        ...chatHistory,
        { role: 'user' as const, content: userDisplayContent },
        { role: 'assistant' as const, content: result.content || '抱歉，我没有理解你的问题' },
      ];
      setChatHistory(newHistory);
      clearBreakpointStreamingOnly();  // 只清空流式内容，保留思考内容
      
      // 更新缓存
      if (response) {
        await saveToCache(response, newHistory, conversationId);
      }
    } catch (err) {
      // 用户取消不显示错误
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: `抱歉，出现错误：${err instanceof Error ? err.message : '未知错误'}` 
      }]);
      clearBreakpointStreamingOnly();  // 只清空流式内容，保留思考内容
    }
  };


  // ===== 全局对话模式（无困惑点时）=====
  // 当没有选中困惑点时，进入全局对话模式，可以针对整节课提问
  const isGlobalMode = !breakpoint;

  // 全局模式下的对话历史
  const [globalChatHistory, setGlobalChatHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  
  // 全局模式的流式输出 - 使用统一的 SSE Hook
  const {
    fetchStream: globalFetchStream,
    stopStream: globalStopStream,
    isStreaming,
    isThinking: isGlobalThinking,
    streamingContent,
    thinkingContent: globalThinkingContent,
    clearContent: clearGlobalContent,
    clearStreamingOnly: clearGlobalStreamingOnly,
  } = useSimpleSSEStream();
  
  // 全局模式思考过程折叠状态
  const [isGlobalThinkingCollapsed, setIsGlobalThinkingCollapsed] = useState(false);
  
  // 全局模式：发送消息（必须在 useEffect 之前定义）
  const handleGlobalSend = useCallback(async (questionOverride?: string) => {
    const question = questionOverride || userInput.trim();
    if (!question || segments.length === 0) return;
    
    if (!questionOverride) {
      setUserInput('');
    }
    
    // 添加用户消息
    setGlobalChatHistory(prev => [...prev, { role: 'user', content: question }]);
    setGlobalLoading(true);


    // 构建请求体
    const requestBody: Record<string, unknown> = {
      timestamp: 0,
      segments,
      model: selectedModel,
      studentQuestion: question,
      globalMode: true,
      enable_guidance: false,
      enable_web: enableWeb,
      enable_thinking_guide: enableThinkingGuide,
      sessionId,
      stream: true,
    };

    // 支持多模态（图片上传）
    if (supportsMultimodal && uploadedImages.length > 0) {
      requestBody.messageContent = [
        ...uploadedImages.map(img => ({
          type: 'image_url',
          image_url: { url: img.dataUrl },
        })),
        { type: 'text', text: question },
      ];
      setUploadedImages([]);
    }

    try {
      const headers: Record<string, string> = {};
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      // 记录思考开始时间
      setGlobalThinkingStartTime(Date.now());

      const result = await globalFetchStream('/api/tutor', requestBody, { headers });


      // 流式完成，将完整内容添加到历史
      setGlobalChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: result.content || '抱歉，我没有理解你的问题，能换个方式问吗？'
      }]);
      clearGlobalStreamingOnly();  // 只清空流式内容，保留思考内容

      // 保存到对话历史
      if (!conversationIdRef.current) {
        try {
          const conv = await conversationService.createConversation({
            userId,
            type: 'global-chat',
            title: conversationService.generateTitleFromMessage(question),
            sessionId,
          });
          conversationIdRef.current = conv.conversationId;
        } catch (err) {
          console.error('Failed to create conversation:', err);
        }
      }

      if (conversationIdRef.current) {
        try {
          await conversationService.addMessages(conversationIdRef.current, [
            { role: 'user', content: question },
            { role: 'assistant', content: result.content || '' },
          ]);
        } catch (err) {
          console.error('Failed to save messages:', err);
        }
      }

    } catch (err) {
      // 用户取消不显示错误
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setGlobalChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: `抱歉，出现错误：${err instanceof Error ? err.message : '未知错误'}` 
      }]);
      clearGlobalStreamingOnly();  // 只清空流式内容，保留思考内容
    } finally {
      setGlobalLoading(false);
    }
  }, [userInput, segments, selectedModel, enableWeb, supportsMultimodal, uploadedImages, accessToken, userId, sessionId, globalFetchStream, clearGlobalContent]);

  // 全局模式：停止生成
  const stopGlobalGeneration = useCallback(() => {
    globalStopStream();
    setGlobalLoading(false);
    // 如果有部分内容，保存到历史
    if (streamingContent) {
      setGlobalChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: streamingContent + '\n\n[生成已停止]'
      }]);
      clearGlobalStreamingOnly();  // 只清空流式内容，保留思考内容
    }
  }, [streamingContent, globalStopStream, clearGlobalStreamingOnly]);

  // 困惑点模式：停止生成
  const stopBreakpointGeneration = useCallback(() => {
    breakpointStopStream();
    setIsGuidanceLoading(false);
    // 如果有部分内容，保存到历史
    if (breakpointStreamingContent) {
      setChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: breakpointStreamingContent + '\n\n[生成已停止]'
      }]);
      clearBreakpointStreamingOnly();  // 只清空流式内容，保留思考内容
    }
  }, [breakpointStreamingContent, breakpointStopStream, clearBreakpointStreamingOnly]);

  // 全局模式：处理初始问题（handleGlobalSend 已在上方定义）
  useEffect(() => {
    if (isGlobalMode && initialQuestion && !hasProcessedInitialQuestion.current && segments.length > 0) {
      hasProcessedInitialQuestion.current = true;
      setTimeout(() => {
        handleGlobalSend(initialQuestion);
      }, 300);
    }
  }, [isGlobalMode, initialQuestion, segments.length, handleGlobalSend]);

  // 重置 sessionId 变化时的全局对话状态
  useEffect(() => {
    if (isGlobalMode) {
      setGlobalChatHistory([]);
      conversationIdRef.current = null;
      hasProcessedInitialQuestion.current = false;
    }
  }, [sessionId, isGlobalMode]);

  // ===== 全局对话模式渲染 =====
  if (isGlobalMode) {
    return (
      <div className="h-full flex flex-col bg-white ai-chat-container">
        {/* 头部 - 紧凑设计 */}
        <div className={`border-b border-gray-100 bg-gradient-to-r from-lilac-100/50 to-white flex-shrink-0 ${isMobile ? 'p-3' : 'px-4 py-3'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">💬</span>
              <div>
                <h3 className={`font-medium text-gray-800 ${isMobile ? 'text-sm' : 'text-base'}`}>
                  AI 课堂助手
                </h3>
                <p className="text-xs text-gray-500">
                  基于整节课内容回答问题
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ModelSelector
                value={selectedModel}
                onChange={setSelectedModel}
                onMultimodalChange={setSupportsMultimodal}
                compact={isMobile}
              />
            </div>
          </div>
          
          {/* 功能开关 - 仅桌面端显示 */}
          {!isMobile && (
            <div className="mt-3 flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={enableWeb}
                  onChange={(e) => setEnableWeb(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                />
                <span className="group-hover:text-gray-900 transition-colors">🌐 联网搜索</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={enableThinkingGuide}
                  onChange={(e) => setEnableThinkingGuide(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-violet-500 focus:ring-violet-400"
                />
                <span className="group-hover:text-gray-900 transition-colors">🧠 思维引导</span>
              </label>
            </div>
          )}
        </div>

        {/* 对话区域 - 优化空间利用 */}
        <div className={`flex-1 overflow-y-auto chat-messages ${isMobile ? 'p-3' : 'p-4'}`} style={{ minHeight: 0 }}>
          {segments.length === 0 ? (
            // 无转录内容
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <span className="text-3xl">💬</span>
              </div>
              <h3 className="text-lg font-medium text-gray-700 mb-2">暂无课堂内容</h3>
              <p className="text-sm text-gray-500">请先录制课堂或上传录音</p>
            </div>
          ) : globalChatHistory.length === 0 ? (
            // 欢迎界面
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="w-20 h-20 bg-gradient-to-br from-amber-100 to-amber-200 rounded-full flex items-center justify-center mb-4">
                <span className="text-4xl">🎓</span>
              </div>
              <h3 className="text-lg font-medium text-gray-800 mb-2">
                有什么问题想问？
              </h3>
              <p className="text-sm text-gray-500 mb-6 max-w-xs">
                我已经学习了这节课的内容，可以帮你解答疑惑、总结要点
              </p>
              
              {/* 快捷问题 */}
              <div className="flex flex-wrap justify-center gap-2 max-w-sm">
                <button
                  onClick={() => handleGlobalSend('这节课讲了什么？')}
                  className="px-4 py-2 bg-gradient-to-r from-amber-50 to-amber-100 text-amber-700 rounded-full text-sm hover:from-amber-100 hover:to-amber-200 transition-colors border border-amber-200"
                >
                  这节课讲了什么？
                </button>
                <button
                  onClick={() => handleGlobalSend('帮我总结这节课的重点')}
                  className="px-4 py-2 bg-gradient-to-r from-amber-50 to-amber-100 text-amber-700 rounded-full text-sm hover:from-amber-100 hover:to-amber-200 transition-colors border border-amber-200"
                >
                  帮我总结重点
                </button>
                <button
                  onClick={() => handleGlobalSend('这节课有哪些需要注意的地方？')}
                  className="px-4 py-2 bg-gradient-to-r from-amber-50 to-amber-100 text-amber-700 rounded-full text-sm hover:from-amber-100 hover:to-amber-200 transition-colors border border-amber-200"
                >
                  有哪些需要注意的？
                </button>
              </div>
            </div>
          ) : (
            // 对话内容
            <div className="space-y-4">
              {globalChatHistory.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`${isMobile ? 'max-w-[92%]' : 'max-w-[85%]'} rounded-2xl ${isMobile ? 'px-3 py-2' : 'px-4 py-3'} ${
                      msg.role === 'user'
                        ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      // 助手消息：根据是否开启学霸引导选择渲染器
                      enableThinkingGuide ? (
                        <ThinkingGuideRenderer
                          content={msg.content}
                          onTimestampClick={handleTimestampClick}
                          isMobile={isMobile}
                          className={`leading-relaxed ${isMobile ? 'text-xs' : 'text-sm'}`}
                        />
                      ) : (
                        <StreamingMarkdown
                          content={msg.content}
                          onTimestampClick={handleTimestampClick}
                          className={`leading-relaxed ${isMobile ? 'text-xs' : 'text-sm'}`}
                        />
                      )
                    ) : (
                      <div className={`whitespace-pre-wrap leading-relaxed ${isMobile ? 'text-xs' : 'text-sm'}`}>
                        {msg.content}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              
              {/* 思考过程展示（全局模式） - 仅在非学霸引导模式下显示模型的 thinking */}
              {globalThinkingContent && !enableThinkingGuide && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] w-full">
                    <ThinkingVisualizer
                      content={globalThinkingContent}
                      isThinking={isGlobalThinking}
                      isCollapsed={isGlobalThinkingCollapsed}
                      onToggleCollapse={() => setIsGlobalThinkingCollapsed(!isGlobalThinkingCollapsed)}
                      enableGuideMode={false}
                      onTimestampClick={handleTimestampClick}
                      startTime={globalThinkingStartTime}
                      isMobile={isMobile}
                    />
                  </div>
                </div>
              )}
              
              {/* 流式输出中的消息 */}
              {isStreaming && streamingContent && (
                <div className="flex justify-start">
                  <div className={`${isMobile ? 'max-w-[92%]' : 'max-w-[85%]'} rounded-2xl ${isMobile ? 'px-3 py-2' : 'px-4 py-3'} bg-gray-100 text-gray-800`}>
                    {enableThinkingGuide ? (
                      <ThinkingGuideRenderer
                        content={streamingContent}
                        isStreaming={true}
                        onTimestampClick={handleTimestampClick}
                        isMobile={isMobile}
                        className={`leading-relaxed ${isMobile ? 'text-xs' : 'text-sm'}`}
                      />
                    ) : (
                      <StreamingMarkdown
                        content={streamingContent}
                        isStreaming={true}
                        onTimestampClick={handleTimestampClick}
                        className={`leading-relaxed ${isMobile ? 'text-xs' : 'text-sm'}`}
                      />
                    )}
                  </div>
                </div>
              )}
              
              {/* 等待开始流式输出时显示 loading */}
              {globalLoading && !streamingContent && !globalThinkingContent && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl px-4 py-3">
                    <div className="flex items-center gap-2 text-gray-500">
                      <div className="loading-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                      <span className="text-xs">思考中...</span>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* 输入区域 - 紧凑设计 */}
        <div className="px-4 py-3 border-t border-gray-100 bg-white flex-shrink-0">
          {/* 图片预览区域 */}
          {supportsMultimodal && uploadedImages.length > 0 && (
            <div className="mb-3 p-2 bg-gray-50 rounded-lg">
              <ImageUpload
                images={uploadedImages}
                onImagesChange={setUploadedImages}
                maxImages={5}
                disabled={globalLoading}
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
                disabled={globalLoading || uploadedImages.length >= 5}
                className="flex-shrink-0"
              />
            )}
            
            <input
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && !isStreaming && handleGlobalSend()}
              placeholder="问我任何关于这节课的问题..."
              className={`input flex-1 ${isMobile ? 'text-sm' : ''}`}
              disabled={globalLoading || segments.length === 0}
            />
            {isStreaming ? (
              <button
                onClick={stopGlobalGeneration}
                className={`btn bg-red-500 hover:bg-red-600 text-white ${isMobile ? 'px-4' : 'px-6'}`}
              >
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  停止
                </span>
              </button>
            ) : (
              <button
                onClick={() => handleGlobalSend()}
                disabled={(!userInput.trim() && uploadedImages.length === 0) || globalLoading || segments.length === 0}
                className={`btn btn-primary disabled:opacity-50 ${isMobile ? 'px-4' : 'px-6'}`}
              >
                发送
              </button>
            )}
          </div>
          
          {/* 快捷回复 */}
          {globalChatHistory.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              <QuickReply text="再详细说说" onClick={setUserInput} />
              <QuickReply text="举个例子" onClick={setUserInput} />
              <QuickReply text="谢谢，我懂了" onClick={setUserInput} />
            </div>
          )}
        </div>
      </div>
    );
  }

  const loading = isLoading || externalLoading;

  return (
    <div className="h-full flex flex-col ai-chat-container">
      {/* 头部控制栏 - 紧凑设计 */}
      <div className={`border-b border-gray-100 bg-gradient-to-r from-lilac-100/50 to-white flex-shrink-0 ${isMobile ? 'p-3' : 'px-4 py-2'}`}>
        {isMobile ? (
          // 移动端紧凑布局
          <div className="space-y-2">
            {/* 第一行：困惑点信息 + 状态 */}
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${breakpoint.resolved ? 'bg-mint' : 'bg-coral animate-pulse'}`} />
              <span className="text-sm font-medium text-navy truncate">
                {formatTimestamp(breakpoint.timestamp)} 的困惑点
              </span>
              <span className="text-xs text-gray-500 flex-shrink-0">
                {breakpoint.resolved ? '✅' : '🔴'}
              </span>
              {isFromCache && <span className="text-xs text-skyblue flex-shrink-0">📋</span>}
            </div>
            {/* 第二行：模型选择器 + 操作按钮 */}
            <div className="flex items-center justify-between gap-2">
              <ModelSelector 
                value={selectedModel} 
                onChange={setSelectedModel}
                onMultimodalChange={setSupportsMultimodal}
                compact={true}
              />
              <div className="flex items-center gap-2">
                {isFromCache && (
                  <button
                    onClick={async () => {
                      if (breakpoint) {
                        await deleteTutorResponseCache(breakpoint.id);
                      }
                      setIsFromCache(false);
                      setResponse(null);
                      explainBreakpoint();
                    }}
                    className="px-2 py-1 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
                    title="重新生成"
                  >
                    🔄
                  </button>
                )}
                {!breakpoint.resolved && (
                  <button
                    onClick={onResolve}
                    className="btn btn-primary px-3 py-1.5 text-xs"
                  >
                    ✓ 我懂了
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          // 桌面端简化布局 - 只保留操作按钮，标题信息由外层切换栏显示
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={enableWeb}
                  onChange={(e) => setEnableWeb(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                />
                <span className="group-hover:text-gray-900 transition-colors">🌐 联网搜索</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={enableThinkingGuide}
                  onChange={(e) => setEnableThinkingGuide(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-violet-500 focus:ring-violet-400"
                />
                <span className="group-hover:text-gray-900 transition-colors">🧠 思维引导</span>
              </label>
              {response?.usage && (
                <span className="text-xs text-gray-400">
                  {response.model} · {response.usage.totalTokens} tokens
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isFromCache && (
                <button
                  onClick={async () => {
                    if (breakpoint) {
                      await deleteTutorResponseCache(breakpoint.id);
                    }
                    setIsFromCache(false);
                    setResponse(null);
                    explainBreakpoint();
                  }}
                  className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                  title="重新生成"
                >
                  🔄 刷新
                </button>
              )}
              <ModelSelector 
                value={selectedModel} 
                onChange={setSelectedModel}
                onMultimodalChange={setSupportsMultimodal}
              />
              {!breakpoint.resolved && (
                <button
                  onClick={onResolve}
                  className="btn btn-primary px-3 py-1.5 text-sm"
                >
                  ✓ 我懂了
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 内容区 - 优化空间利用 */}
      <div className={`flex-1 overflow-y-auto chat-messages ${isMobile ? 'p-3' : 'p-4'}`} style={{ minHeight: 0 }}>
        {error ? (
          <div className="flex items-center justify-center h-full animate-fade-in">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
                <span className="text-3xl">⚠️</span>
              </div>
              <p className="text-red-600 mb-4">{error}</p>
              <button
                onClick={explainBreakpoint}
                className="btn btn-primary px-6 py-2"
              >
                重试
              </button>
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full animate-fade-in">
            <div className="text-center">
              <div className="loading-dots mx-auto mb-4">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <p className="text-gray-500">AI 正在分析你的困惑...</p>
              <p className="text-xs text-gray-400 mt-1">使用 {selectedModel}</p>
            </div>
          </div>
        ) : response ? (
          <div className="space-y-6 animate-slide-up">
            {/* 老师原话 - 扩展上下文 */}
            <Section icon="📚" title="课堂回顾">
              <div className="bg-sunflower-50 border border-sunflower-200 rounded-xl p-4">
                {/* 显示完整上下文，每段可点击跳转 */}
                <div className="text-sm text-gray-700 leading-relaxed space-y-1 max-h-48 overflow-y-auto">
                  {contextSegments.length > 0 ? (
                    contextSegments.map((seg) => {
                      const isNearBreakpoint = breakpoint && 
                        Math.abs(seg.startMs - breakpoint.timestamp) < 10000;
                      const isActive = seekingTimestamp === seg.startMs;
                      return (
                        <span
                          key={seg.id}
                          className={`
                            inline cursor-pointer transition-all duration-300
                            ${isActive 
                              ? 'bg-sunflower px-1 rounded shadow-md scale-105' 
                              : isNearBreakpoint 
                                ? 'bg-sunflower-200/60 px-1 rounded hover:bg-sunflower-300/80' 
                                : 'hover:bg-sunflower-200/80'
                            }
                          `}
                          onClick={() => handleTimestampClick(seg.startMs)}
                          title={`点击跳转到 ${formatTime(seg.startMs)}`}
                        >
                          <span className={`text-xs font-mono mr-1 ${isActive ? 'text-navy' : 'text-warmOrange-700'}`}>
                            [{formatTime(seg.startMs)}]
                          </span>
                          {seg.text}{' '}
                        </span>
                      );
                    })
                  ) : (
                    <span className="italic">"{response.explanation.teacherSaid}"</span>
                  )}
                </div>
                {response.explanation.citation.timeRange !== '00:00-00:00' && (
                  <button 
                    onClick={() => handleTimestampClick(response.explanation.citation.startMs)}
                    className={`
                      mt-3 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all duration-300 border
                      ${seekingTimestamp === response.explanation.citation.startMs
                        ? 'bg-gradient-to-r from-sunflower to-warmOrange text-navy border-sunflower-600 shadow-lg shadow-sunflower-200 scale-105'
                        : 'text-warmOrange-700 hover:text-warmOrange-800 bg-sunflower-100 hover:bg-sunflower-200 border-sunflower-200 hover:shadow-md'
                      }
                    `}
                    title="点击跳转播放"
                  >
                    <span className={seekingTimestamp === response.explanation.citation.startMs ? 'animate-bounce' : ''}>▶</span>
                    <span>播放 {response.explanation.citation.timeRange}</span>
                  </button>
                )}
              </div>
            </Section>

            {/* 引导问题 - 选择题模式定位困惑点 */}
            <Section icon="🎯" title="帮我定位你的困惑" badge="精准诊断">
              {isLoading ? (
                <GuidanceQuestionSkeleton />
              ) : response.guidance_question ? (
                <GuidanceQuestion
                  question={response.guidance_question}
                  onSelect={handleGuidanceSelect}
                  isLoading={isGuidanceLoading}
                  disabled={!!selectedOptionId}
                  selectedOptionId={selectedOptionId}
                />
              ) : (
                <div className="bg-gray-50 rounded-xl p-4 text-center text-sm text-gray-500">
                  <p>引导问题生成中...</p>
                  <p className="text-xs mt-1 text-gray-400">正在分析录音内容</p>
                </div>
              )}
            </Section>

            {/* 联网搜索结果 */}
            {enableWeb && response.citations && response.citations.length > 0 && (
              <Section icon="🌐" title="联网搜索结果" badge="实时检索">
                <Citations citations={response.citations} />
              </Section>
            )}

            {/* 知识库搜索 */}
            {notebookAvailable && (
              <Section icon="🔍" title="知识库搜索" badge="Open Notebook">
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    placeholder="搜索相关知识..."
                    className="input text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSearch((e.target as HTMLInputElement).value);
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      const input = document.querySelector('input[placeholder="搜索相关知识..."]') as HTMLInputElement;
                      if (input) handleSearch(input.value);
                    }}
                    disabled={isSearching}
                    className="btn btn-primary px-4 text-sm"
                  >
                    {isSearching ? '搜索中...' : '搜索'}
                  </button>
                </div>
                {searchResults.length > 0 && (
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {searchResults.map((result) => (
                      <div key={result.id} className="p-3 bg-gray-50 rounded-xl text-sm">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-gray-500">{result.source}</span>
                          <span className="text-xs text-coral">
                            相似度: {Math.round(result.score * 100)}%
                          </span>
                        </div>
                        <p className="text-gray-700 line-clamp-2">{result.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            )}

            {/* 对话历史 */}
            {(chatHistory.length > 0 || isBreakpointStreaming) && (
              <div className="space-y-3 pt-4 border-t border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <span>💬</span>
                  对话记录
                </h3>
                {chatHistory.map((msg, i) => (
                  <div 
                    key={i} 
                    className={`chat-bubble ${msg.role}`}
                  >
                    {msg.role === 'assistant' ? (
                      enableThinkingGuide ? (
                        <ThinkingGuideRenderer
                          content={msg.content}
                          onTimestampClick={handleTimestampClick}
                          isMobile={isMobile}
                          className="text-sm"
                        />
                      ) : (
                        <StreamingMarkdown
                          content={msg.content}
                          onTimestampClick={handleTimestampClick}
                          className="text-sm"
                        />
                      )
                    ) : (
                      <div className="whitespace-pre-wrap text-sm">
                        {msg.content}
                      </div>
                    )}
                  </div>
                ))}
                
                {/* 思考过程展示（困惑点模式） - 仅在非学霸引导模式下显示模型的 thinking */}
                {breakpointThinkingContent && !enableThinkingGuide && (
                  <div className="w-full">
                    <ThinkingVisualizer
                      content={breakpointThinkingContent}
                      isThinking={isBreakpointThinking}
                      isCollapsed={isThinkingCollapsed}
                      onToggleCollapse={() => setIsThinkingCollapsed(!isThinkingCollapsed)}
                      enableGuideMode={false}
                      onTimestampClick={handleTimestampClick}
                      startTime={thinkingStartTime}
                      isMobile={isMobile}
                    />
                  </div>
                )}
                
                {/* 流式输出中的消息 */}
                {isBreakpointStreaming && breakpointStreamingContent && (
                  <div className="chat-bubble assistant">
                    {enableThinkingGuide ? (
                      <ThinkingGuideRenderer
                        content={breakpointStreamingContent}
                        isStreaming={true}
                        onTimestampClick={handleTimestampClick}
                        isMobile={isMobile}
                        className="text-sm"
                      />
                    ) : (
                      <StreamingMarkdown
                        content={breakpointStreamingContent}
                        isStreaming={true}
                        onTimestampClick={handleTimestampClick}
                        className="text-sm"
                      />
                    )}
                  </div>
                )}
                
                {/* 等待开始流式输出时显示 loading */}
                {isBreakpointStreaming && !breakpointStreamingContent && !breakpointThinkingContent && (
                  <div className="chat-bubble assistant">
                    <div className="flex items-center gap-2 text-gray-500">
                      <div className="loading-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                      <span className="text-xs">思考中...</span>
                    </div>
                  </div>
                )}
                
                <div ref={chatEndRef} />
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* 输入框 - 紧凑设计 */}
      <div className="px-4 py-3 border-t border-gray-100 bg-white flex-shrink-0">
        {/* 图片预览区域 */}
        {supportsMultimodal && uploadedImages.length > 0 && (
          <div className="mb-3 p-2 bg-gray-50 rounded-lg">
            <ImageUpload
              images={uploadedImages}
              onImagesChange={setUploadedImages}
              maxImages={5}
              disabled={loading}
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
              disabled={loading || uploadedImages.length >= 5}
              className="flex-shrink-0"
            />
          )}
          
          <input
            type="text"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && !isBreakpointStreaming && handleSend()}
            placeholder="告诉我你哪里不懂..."
            className="input flex-1"
            disabled={isBreakpointStreaming}
          />
          {isBreakpointStreaming ? (
            <button
              onClick={stopBreakpointGeneration}
              className="btn bg-red-500 hover:bg-red-600 text-white px-6 flex-shrink-0"
            >
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                停止
              </span>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={(!userInput.trim() && uploadedImages.length === 0) || loading}
              className="btn btn-primary px-6 disabled:opacity-50 flex-shrink-0"
            >
              发送
            </button>
          )}
        </div>
        
        <div className="flex gap-2 mt-2 flex-wrap">
          <QuickReply text="我不理解这个公式" onClick={setUserInput} />
          <QuickReply text="能举个例子吗？" onClick={setUserInput} />
          <QuickReply text="这个和之前学的有什么关系？" onClick={setUserInput} />
          <QuickReply text="我懂了！" onClick={setUserInput} />
        </div>
      </div>
    </div>
  );
}

function Section({ 
  icon, 
  title, 
  badge, 
  children 
}: { 
  icon: string; 
  title: string; 
  badge?: string; 
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <span>{icon}</span>
        <span>{title}</span>
        {badge && (
          <span className="text-xs font-normal text-coral bg-coral-50 px-2 py-0.5 rounded-full">
            {badge}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

function QuickReply({ text, onClick }: { text: string; onClick: (text: string) => void }) {
  return (
    <button
      onClick={() => onClick(text)}
      className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200 transition-colors"
    >
      {text}
    </button>
  );
}
