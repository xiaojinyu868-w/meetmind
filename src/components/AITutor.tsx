'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import {
  MessageCircle,
  Globe,
  Brain,
  AlertTriangle,
  BookOpen,
  Target,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ClipboardList,
  MessageSquare,
  Check,
} from 'lucide-react';
import { formatTimestamp } from '@/lib/services/longcut-utils';
import { notebookService, localSearch, type SearchResult } from '@/lib/services/notebook-service';
import { GuidanceQuestion, GuidanceQuestionSkeleton } from './GuidanceQuestion';
import { ImageUpload, useImagePaste, type UploadedImage } from './ImageUpload';
import { useAuth } from '@/lib/hooks/useAuth';
import { useAnalyticsContext } from '@/components/AnalyticsProvider';
import { useSimpleSSEStream, type SSEEvent } from '@/lib/hooks/useSSEStream';
import { primeOmniRealtimeCallEntry } from '@/hooks/useOmniRealtimeCall';
import IntentBubbleExplorer from './IntentBubbleExplorer';
import { saveTutorResponseCache, getTutorResponseCache, deleteTutorResponseCache, setPreference, saveClassSummary, getSessionSummary } from '@/lib/db';
import { conversationService, getEffectiveUserId } from '@/lib/services/conversation-service';
import type { GuidanceQuestion as GuidanceQuestionType, GuidanceOption, Citation } from '@/types/dify';
import { isMultimodalModel } from '@/lib/services/llm-service';
import { StreamingMarkdown } from './StreamingMarkdown';
import { ThinkingVisualizer } from './ThinkingVisualizer';
import { ThinkingGuideRenderer } from './ThinkingGuideRenderer';
import { VoiceMicButton } from './VoiceMicButton';

// --- 拆分子模块 ---
import type {
  Segment,
  TutorLaunchImage,
  AITutorProps,
  TutorCacheEnvelopeV1,
  TutorAPIResponse,
  TutorChatMessage,
} from './tutor/tutor-types';
import {
  TUTOR_STATE_KEY,
  FIXED_TUTOR_MODEL_ID,
  REALTIME_TEACHER_MODEL_ID,
  IS_REALTIME_TEACHER_AVAILABLE,
} from './tutor/tutor-types';
import {
  toTranscriptSignature,
  normalizeSupportContextText,
  buildTutorRequestSegments,
  unpackTutorCachePayload,
  normalizeCitations,
  normalizeChatHistory,
  toTutorMessageImages,
  formatTutorErrorMessage,
} from './tutor/tutor-utils';
import { FixedModelBadge, TutorModeToggle, StopGenerationButton, Section, QuickReply } from './tutor/TutorWidgets';
import { TutorCallComposer } from './tutor/TutorCallComposer';
import { TutorRealtimeCallBar } from './tutor/TutorRealtimeCallBar';
import { TutorRealtimeCallScreen } from './tutor/TutorRealtimeCallScreen';

type StarterIntentMeta = {
  role?: string;
  intent?: string;
  displayText?: string;
  hideBubble?: boolean;
};

export function AITutor({
  breakpoint,
  segments,
  isLoading: externalLoading,
  onResolve,
  onActionItemsUpdate,
  sessionId = 'default',
  onSeek,
  initialQuestion,
  isMobile = false,
  preferSupportContext = false,
  supportContextText = '',
  launchQuestion = '',
  launchQuestionNonce = 0,
  launchDisplayText = '',
  launchImages: launchImagesProp = [],
  onLaunchQuestionConsumed,
  hideMobileHeader = false,
  realtimeTeacherEnabled,
  onRealtimeTeacherEnabledChange,
  newConversationNonce = 0,
  onConversationActiveChange,
}: AITutorProps) {
  const { accessToken, user, isCheckingAuth } = useAuth();
  const userId = getEffectiveUserId(user?.id);
  const { trackCoreEvent } = useAnalyticsContext();
  const [userInput, setUserInput] = useState('');
  const [chatHistory, setChatHistory] = useState<TutorChatMessage[]>([]);
  const [localRealtimeTeacherEnabled, setLocalRealtimeTeacherEnabled] = useState(false);
  const enableRealtimeTeacher = realtimeTeacherEnabled ?? localRealtimeTeacherEnabled;
  const selectedModel =
    enableRealtimeTeacher && IS_REALTIME_TEACHER_AVAILABLE
      ? REALTIME_TEACHER_MODEL_ID
      : FIXED_TUTOR_MODEL_ID;
  const isRealtimeTeacherMode = selectedModel === REALTIME_TEACHER_MODEL_ID;
  const supportsMultimodal = isMultimodalModel(selectedModel);
  const [response, setResponse] = useState<TutorAPIResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [breakpointStreamingCitations, setBreakpointStreamingCitations] = useState<Citation[]>([]);
  
  // 缓存相关状态
  const [isFromCache, setIsFromCache] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);  // 正在恢复状态
  const previousBreakpointId = useRef<string | null>(null);
  const hasInitialized = useRef(false);  // 是否已完成初始化
  const lastProcessedInitialQuestionKeyRef = useRef<string | null>(null);
  const lastGlobalChatSessionIdRef = useRef(sessionId);
  const hasProcessedInitialQuestion = useRef(false);  // 是否已处理初始问题
  const [isSearching, setIsSearching] = useState(false);
  const [notebookAvailable, setNotebookAvailable] = useState(false);
  
  // 对话历史相关
  const conversationIdRef = useRef<string | null>(null);
  const isGlobalSendInFlightRef = useRef(false);
  
  const [enableWeb, setEnableWeb] = useState(false);  // 联网搜索默认关闭
  const [enableThinkingGuide, setEnableThinkingGuide] = useState(true);  // 学霸思维引导模式默认开启
  const enableAgentMode = true; // Agent 原生：全局对话永远走 Agent
  const [agentLiveSteps, setAgentLiveSteps] = useState<import('./tutor/tutor-types').AgentStepInfo[]>([]);  // Agent 实时思考步骤
  const [agentPhase, setAgentPhase] = useState<'idle' | 'searching' | 'reading' | 'writing'>('idle');
  const [agentStreamingContent, setAgentStreamingContent] = useState('');  // Agent 流式回答内容
  const [selectedOptionId, setSelectedOptionId] = useState<string | undefined>();
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [isGuidanceLoading, setIsGuidanceLoading] = useState(false);
  const [seekingTimestamp, setSeekingTimestamp] = useState<number | null>(null);
  
  // 思考开始时间（用于计算耗时）
  const [thinkingStartTime, setThinkingStartTime] = useState<number | undefined>();
  const [globalThinkingStartTime, setGlobalThinkingStartTime] = useState<number | undefined>();
  const [realtimeAssistantDraft, setRealtimeAssistantDraft] = useState('');
  const [isRealtimeAssistantResponding, setIsRealtimeAssistantResponding] = useState(false);
  const realtimeAssistantDraftRef = useRef('');
  const realtimeAssistantFinalizedRef = useRef(false);
  const justExitedRealtimeCallRef = useRef(false);
  
  // 困惑点模式的流式输出 - 使用统一的 SSE Hook
  const {
    fetchStream: breakpointFetchStream,
    stopStream: breakpointStopStream,
    isStreaming: isBreakpointStreaming,
    isThinking: isBreakpointThinking,
    streamingContent: breakpointStreamingContent,
    thinkingContent: breakpointThinkingContent,
    clearContent: _clearBreakpointContent,
    clearStreamingOnly: clearBreakpointStreamingOnly,
  } = useSimpleSSEStream();
  
  // 思考过程折叠状态
  const [isThinkingCollapsed, setIsThinkingCollapsed] = useState(false);
  
  // 多模态相关状态
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const hasTutorContext = useMemo(
    () => segments.length > 0 || normalizeSupportContextText(supportContextText).length > 0,
    [segments.length, supportContextText]
  );
  const handleRealtimeTeacherToggle = useCallback(() => {
    const nextEnabled = !enableRealtimeTeacher;
    if (!nextEnabled) {
      justExitedRealtimeCallRef.current = true;
    }
    void (async () => {
      if (nextEnabled) {
        await primeOmniRealtimeCallEntry();
      }
      onRealtimeTeacherEnabledChange?.(nextEnabled);
      if (realtimeTeacherEnabled === undefined) {
        setLocalRealtimeTeacherEnabled(nextEnabled);
      }
    })();
  }, [enableRealtimeTeacher, onRealtimeTeacherEnabledChange, realtimeTeacherEnabled]);
  const transcriptSignature = useMemo(() => {
    const baseSignature = toTranscriptSignature(segments);
    const supportSignature = normalizeSupportContextText(supportContextText, 400);
    if (!supportSignature) return baseSignature;
    return `${baseSignature}|support:${supportSignature.length}:${supportSignature.slice(0, 80)}`;
  }, [segments, supportContextText]);
  const buildSegmentsForTutorRequest = useCallback(
    (focusTimestamp: number, prepend = false): Segment[] =>
      buildTutorRequestSegments({
        baseSegments: segments,
        supportContextText,
        focusTimestamp,
        prepend,
      }),
    [segments, supportContextText]
  );
  const buildGlobalSegmentsForTutorRequest = useCallback(
    () =>
      buildTutorRequestSegments({
        baseSegments: preferSupportContext ? [] : segments,
        supportContextText,
        focusTimestamp: 0,
        prepend: !preferSupportContext,
      }),
    [preferSupportContext, segments, supportContextText]
  );
  const realtimeTeacherContext = useMemo(() => {
    const relevantSegments = breakpoint
      ? buildSegmentsForTutorRequest(breakpoint.timestamp)
      : buildGlobalSegmentsForTutorRequest();
    const mergedText = relevantSegments.map((segment) => segment.text).join(' ');
    return normalizeSupportContextText(mergedText || supportContextText, 2600);
  }, [breakpoint, buildGlobalSegmentsForTutorRequest, buildSegmentsForTutorRequest, supportContextText]);
  const realtimeTeacherInstructions = useMemo(() => {
    const sceneHint = breakpoint
      ? '学生刚好卡在课上的一个具体片段，你要顺着这段继续讲。'
      : '学生正在围绕整节课继续追问，你要像陪学老师一样顺着往下带。';

    return [
      '你是一位像真人一样在微信里陪学生语音辅导的中文老师。',
      '学生会一轮一轮地发来语音。',
      '先自然接住学生刚说的话，再继续解释，一次只推进一点。',
      '不要写提纲，不要列条目，不要把回答讲成讲义。',
      '除非学生明确要回放原话，否则不要主动报时间戳。',
      sceneHint,
      realtimeTeacherContext ? `这节课的已知上下文：${realtimeTeacherContext}` : '',
    ].filter(Boolean).join('\n\n');
  }, [breakpoint, realtimeTeacherContext]);
  
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
  const parseTimeToMs = useCallback((time: string): number | null => {
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
    return null;
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
    
    // 1.5秒后清除高亮状态
    setTimeout(() => setSeekingTimestamp(null), 1500);
  }, [onSeek, formatTime]);

  // 解析文本中的时间戳并渲染为可点击链接（增强视觉反馈）
  const _renderTextWithTimestamps = useCallback((text: string) => {
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
      if (startMs === null) {
        parts.push(<span key={`ts-text-${match.index}`}>{match[0]}</span>);
        lastIndex = timestampRegex.lastIndex;
        continue;
      }
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
              ? 'bg-[#232322] text-white border-[#232322]  scale-110 animate-pulse' 
              : 'bg-[#FDF3C0] text-[#232322] border-[#E9E9E7] hover:bg-[#232322] hover:hover:scale-105'
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
    if (isRealtimeTeacherMode && enableThinkingGuide) {
      setEnableThinkingGuide(false);
    }
  }, [enableThinkingGuide, isRealtimeTeacherMode]);

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
  }, [breakpoint, response, saveCurrentState]);

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

    const cacheKey = `${breakpoint.id}:${selectedModel}:${transcriptSignature}`;

    // 相同锚点 + 相同模型 + 相同转录签名时，复用当前状态
    if (previousBreakpointId.current === cacheKey) {
      return;
    }

    previousBreakpointId.current = cacheKey;

    // 尝试从缓存加载
    const loadFromCache = async () => {
      setIsRestoring(true);
      try {
        const cached = await getTutorResponseCache(breakpoint.id);
        if (cached) {
          const { envelope, response: cachedResponse } = unpackTutorCachePayload(cached.response);
          if (!cachedResponse) {
            setResponse(null);
            setChatHistory([]);
            setConversationId(undefined);
            setIsFromCache(false);
            hasInitialized.current = true;
            setIsRestoring(false);
            return false;
          }

          if (!envelope) {
            await deleteTutorResponseCache(breakpoint.id);
            setResponse(null);
            setChatHistory([]);
            setConversationId(undefined);
            setIsFromCache(false);
            hasInitialized.current = true;
            setIsRestoring(false);
            return false;
          }

          const sameModel = envelope.model === selectedModel;
          const sameTranscript = envelope.transcriptSignature === transcriptSignature;
          if (!sameModel || !sameTranscript) {
            await deleteTutorResponseCache(breakpoint.id);
            setResponse(null);
            setChatHistory([]);
            setConversationId(undefined);
            setIsFromCache(false);
            hasInitialized.current = true;
            setIsRestoring(false);
            return false;
          }

          const cachedHistory = normalizeChatHistory(JSON.parse(cached.chatHistory));
          
          setResponse(cachedResponse);
          setChatHistory(cachedHistory);
          setConversationId(cached.conversationId);
          setIsFromCache(true);
          setError(null);
          
          // 通知父组件更新行动清单
          if (cachedResponse.actionItems && onActionItemsUpdate) {
            onActionItemsUpdate(cachedResponse.actionItems, breakpoint.id);
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
  }, [breakpoint, onActionItemsUpdate, selectedModel, transcriptSignature]);

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
    history: TutorChatMessage[],
    convId?: string
  ) => {
    if (!breakpoint) return;
    
    try {
      const cachePayload: TutorCacheEnvelopeV1 = {
        version: 1,
        model: selectedModel,
        transcriptSignature,
        response: resp,
      };

      // 保存到 TutorResponseCache（原有缓存）
      await saveTutorResponseCache({
        anchorId: breakpoint.id,
        sessionId,
        timestamp: breakpoint.timestamp,
        response: JSON.stringify(cachePayload),
        chatHistory: JSON.stringify(history),
        conversationId: convId,
      });
      
      // 同步到对话历史系统
      await syncToConversationHistory(resp, history);
    } catch (err) {
      console.error('Failed to save to cache:', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- syncToConversationHistory is declared below and intentionally stable for this closure.
  }, [breakpoint, sessionId, selectedModel, transcriptSignature]);

  // 同步到对话历史系统
  const syncToConversationHistory = useCallback(async (
    resp: TutorAPIResponse,
    history: TutorChatMessage[]
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
      toast.error('搜索失败，请重试');
    } finally {
      setIsSearching(false);
    }
  }, [notebookAvailable, segments]);

  const explainBreakpoint = useCallback(async () => {
    if (!breakpoint || segments.length === 0) return;

    breakpointStopStream();

    setIsLoading(true);
    setError(null);
    setResponse(null);
    setChatHistory([]);
    setSelectedOptionId(undefined);
    setConversationId(undefined);
    setIsFromCache(false);
    setBreakpointStreamingCitations([]);
    trackCoreEvent('tutor_chat_start', {
      mode: 'breakpoint-initial',
      anchorId: breakpoint.id,
      sessionId,
    });

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      setThinkingStartTime(Date.now());

      let parsedResponse: TutorAPIResponse | null = null;
      let parsedResponseHandledActionItems = false;
      let nextConversationId: string | undefined;
      let collectedCitations: Citation[] = [];

      const result = await breakpointFetchStream('/api/tutor', {
        timestamp: breakpoint.timestamp,
        segments: buildSegmentsForTutorRequest(breakpoint.timestamp),
        model: selectedModel,
        enable_guidance: true,
        enable_web: enableWeb,
        sessionId,
        stream: true,
      }, {
        headers,
        onMetadata: (metadata: SSEEvent) => {
          if (metadata.conversation_id) {
            nextConversationId = metadata.conversation_id as string;
            setConversationId(nextConversationId);
          }

          const nextCitations = normalizeCitations(metadata.citations);
          if (nextCitations?.length) {
            collectedCitations = nextCitations;
            setBreakpointStreamingCitations(nextCitations);
          }

          if (metadata.parsed_response) {
            parsedResponse = metadata.parsed_response as TutorAPIResponse;
            if (parsedResponse.citations?.length) {
              collectedCitations = parsedResponse.citations;
              setBreakpointStreamingCitations(parsedResponse.citations);
            }
            if (parsedResponse.conversation_id) {
              nextConversationId = parsedResponse.conversation_id;
              setConversationId(parsedResponse.conversation_id);
            }
            if (parsedResponse.actionItems && onActionItemsUpdate) {
              parsedResponseHandledActionItems = true;
              onActionItemsUpdate(parsedResponse.actionItems, breakpoint.id);
            }
          }
        },
      });

      const data = parsedResponse ?? {
        explanation: {
          teacherSaid: '',
          citation: { text: '', timeRange: '00:00-00:00', startMs: 0, endMs: 0 },
          possibleStuckPoints: [],
          followUpQuestion: '',
        },
        actionItems: [],
        rawContent: result.content || '我先顺着这段课堂内容想一想。',
        model: selectedModel,
        citations: collectedCitations.length ? collectedCitations : undefined,
        conversation_id: nextConversationId,
      };

      setResponse(data);
      setIsFromCache(false);
      if (data.conversation_id) {
        setConversationId(data.conversation_id);
      }
      if (!parsedResponseHandledActionItems && data.actionItems && onActionItemsUpdate) {
        onActionItemsUpdate(data.actionItems, breakpoint.id);
      }
      await handleSummaryFromResponse(data);
      await saveToCache(data, [], data.conversation_id);
      clearBreakpointStreamingOnly();
      setBreakpointStreamingCitations([]);
      trackCoreEvent('tutor_chat_complete', {
        mode: 'breakpoint-initial',
        anchorId: breakpoint.id,
        sessionId,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setIsLoading(false);
    }
  }, [breakpoint, segments.length, breakpointStopStream, breakpointFetchStream, buildSegmentsForTutorRequest, selectedModel, enableWeb, accessToken, onActionItemsUpdate, handleSummaryFromResponse, saveToCache, clearBreakpointStreamingOnly, trackCoreEvent, sessionId]);

  useEffect(() => {
    setIsLoading(false);
    breakpointStopStream();
    return () => {
      breakpointStopStream();
    };
  }, [breakpoint?.id, selectedModel, breakpointStopStream]);

  const handleGuidanceSelect = async (optionId: string, option: GuidanceOption) => {
    if (!breakpoint) return;
    
    setSelectedOptionId(optionId);
    setIsGuidanceLoading(true);
    setBreakpointStreamingCitations([]);
    
    // 添加用户消息
    const currentQuestion = response?.guidance_question?.question?.trim();
    const userMessage = currentQuestion
      ? `关于"${currentQuestion}"，我更想顺着这个方向继续：${option.text}`
      : `我更想顺着这个方向继续：${option.text}`;
    setChatHistory(prev => [...prev, { role: 'user', content: userMessage }]);
    
    // 用于接收元数据
    let newGuidanceQuestion: GuidanceQuestionType | undefined;
    let newConversationId: string | undefined;
    let collectedCitations: Citation[] = [];
    
    try {
      trackCoreEvent('tutor_chat_start', {
        mode: 'guidance-followup',
        anchorId: breakpoint.id,
        sessionId,
      });
      const headers: Record<string, string> = {};
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }
      
      // 记录思考开始时间
      setThinkingStartTime(Date.now());
      
      const result = await breakpointFetchStream('/api/tutor', {
        timestamp: breakpoint.timestamp,
        segments: buildSegmentsForTutorRequest(breakpoint.timestamp),
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
          const nextCitations = normalizeCitations(metadata.citations);
          if (nextCitations?.length) {
            collectedCitations = nextCitations;
            setBreakpointStreamingCitations(nextCitations);
          }
        },
      });

      // 流式完成
      const newHistory = [
        ...chatHistory,
        { role: 'user' as const, content: userMessage },
        {
          role: 'assistant' as const,
          content: result.content || '让我针对你的选择进一步解释...',
          citations: collectedCitations.length ? collectedCitations : undefined,
        },
      ];
      setChatHistory(newHistory);
      clearBreakpointStreamingOnly();  // 只清空流式内容，保留思考内容
      setBreakpointStreamingCitations([]);
      
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
      trackCoreEvent('tutor_chat_complete', {
        mode: 'guidance-followup',
        anchorId: breakpoint.id,
        sessionId,
      });
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
      setBreakpointStreamingCitations([]);
    } finally {
      setIsGuidanceLoading(false);
    }
  };

  const handleSend = async (questionOverride?: string) => {
    if ((!userInput.trim() && !questionOverride?.trim() && uploadedImages.length === 0) || !breakpoint) return;

    const question = (questionOverride ?? userInput).trim();
    const effectiveQuestion = question || (uploadedImages.length > 0 ? '先帮我看这张图片里最关键的信息。' : '');
    const imagesToSend = [...uploadedImages];
    const userMessageImages = toTutorMessageImages(
      imagesToSend.map((image) => ({
        id: image.id,
        name: image.name,
        previewUrl: image.dataUrl,
      }))
    );
    setUserInput('');
    setUploadedImages([]);

    setChatHistory((prev) => [
      ...prev,
      {
        role: 'user',
        content: question,
        images: userMessageImages.length ? userMessageImages : undefined,
      },
    ]);
    setBreakpointStreamingCitations([]);
    let collectedCitations: Citation[] = [];
    
    try {
      trackCoreEvent('tutor_chat_start', {
        mode: 'breakpoint-chat',
        anchorId: breakpoint.id,
        sessionId,
      });
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
      if (effectiveQuestion) {
        messageContent.push({
          type: 'text',
          text: effectiveQuestion,
        });
      }
      
      // 记录思考开始时间
      setThinkingStartTime(Date.now());
      
      const result = await breakpointFetchStream('/api/tutor', {
        timestamp: breakpoint.timestamp,
        segments: buildSegmentsForTutorRequest(breakpoint.timestamp),
        model: selectedModel,
        studentQuestion: effectiveQuestion,
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
          const nextCitations = normalizeCitations(metadata.citations);
          if (nextCitations?.length) {
            collectedCitations = nextCitations;
            setBreakpointStreamingCitations(nextCitations);
            setResponse(prev => (prev ? { ...prev, citations: nextCitations } : null));
          }
        },
      });

      // 流式完成，添加到历史
      const newHistory = [
        ...chatHistory,
        {
          role: 'user' as const,
          content: question,
          images: userMessageImages.length ? userMessageImages : undefined,
        },
        {
          role: 'assistant' as const,
          content: result.content || '抱歉，我没有理解你的问题',
          citations: collectedCitations.length ? collectedCitations : undefined,
        },
      ];
      setChatHistory(newHistory);
      clearBreakpointStreamingOnly();  // 只清空流式内容，保留思考内容
      setBreakpointStreamingCitations([]);
      
      // 更新缓存
      if (response) {
        await saveToCache(response, newHistory, conversationId);
      }
      trackCoreEvent('tutor_chat_complete', {
        mode: 'breakpoint-chat',
        anchorId: breakpoint.id,
        sessionId,
      });
    } catch (err) {
      // 用户取消不显示错误
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: `抱歉，出现错误：${formatTutorErrorMessage(err)}` 
      }]);
      clearBreakpointStreamingOnly();  // 只清空流式内容，保留思考内容
      setBreakpointStreamingCitations([]);
    }
  };

  // ===== 全局对话模式（无困惑点时）=====
  // 当没有选中困惑点时，进入全局对话模式，可以针对整节课提问
  const isGlobalMode = !breakpoint;

  // 全局模式下的对话历史
  const [globalChatHistory, setGlobalChatHistory] = useState<TutorChatMessage[]>([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalStreamingCitations, setGlobalStreamingCitations] = useState<Citation[]>([]);
  
  // 全局模式的流式输出 - 使用统一的 SSE Hook
  const {
    fetchStream: globalFetchStream,
    stopStream: globalStopStream,
    isStreaming,
    isThinking: isGlobalThinking,
    streamingContent,
    thinkingContent: globalThinkingContent,
    clearContent: _clearGlobalContent,
    clearStreamingOnly: clearGlobalStreamingOnly,
  } = useSimpleSSEStream();
  
  // 全局模式思考过程折叠状态
  const [isGlobalThinkingCollapsed, setIsGlobalThinkingCollapsed] = useState(false);
  
  // 全局模式：发送消息（必须在 useEffect 之前定义）
  const handleGlobalSend = useCallback(async (
    questionOverride?: string,
    options?: {
      images?: TutorLaunchImage[];
      displayText?: string;
      hideUserBubble?: boolean;
    }
  ) => {
    const question = (questionOverride || userInput).trim();
    const launchImages = (options?.images || []).filter((image) => image.url);
    const composerImages = uploadedImages.map((image) => ({
      id: image.id,
      name: image.name,
      url: image.dataUrl,
      previewUrl: image.dataUrl,
    }));
    const imagesForRequest = launchImages.length > 0 ? launchImages : composerImages;
    const effectiveQuestion = question || (imagesForRequest.length > 0 ? '先帮我看这张图片里最关键的信息。' : '');
    if ((!effectiveQuestion && imagesForRequest.length === 0) || !hasTutorContext) return;
    if (globalLoading || isStreaming || isGlobalSendInFlightRef.current) return;

    isGlobalSendInFlightRef.current = true;
    setUserInput('');

    const userVisibleText = options?.displayText ?? question;
    const userMessageImages = toTutorMessageImages(
      imagesForRequest.map((image) => ({
        id: image.id,
        name: image.name,
        previewUrl: image.previewUrl || image.url,
      }))
    );
    const shouldHideUserBubble = Boolean(options?.hideUserBubble);
    if (!shouldHideUserBubble) {
      setGlobalChatHistory((prev) => [
        ...prev,
        {
          role: 'user',
          content: userVisibleText,
          images: userMessageImages.length ? userMessageImages : undefined,
        },
      ]);
    }
    setGlobalStreamingCitations([]);
    let collectedCitations: Citation[] = [];
    setGlobalLoading(true);
    trackCoreEvent('tutor_chat_start', {
      mode: 'global-chat',
      sessionId,
    });

    // 构建请求体
    const requestBody: Record<string, unknown> = {
      timestamp: 0,
      segments: buildGlobalSegmentsForTutorRequest(),
      model: selectedModel,
      studentQuestion: effectiveQuestion,
      globalMode: true,
      selected_context_mode: preferSupportContext,
      enable_guidance: false,
      enable_web: enableWeb,
      enable_thinking_guide: enableThinkingGuide,
      sessionId,
      stream: true,
    };

    // 支持多模态（图片上传）
    if (supportsMultimodal && imagesForRequest.length > 0) {
      requestBody.messageContent = [
        ...imagesForRequest.map((image) => ({
          type: 'image_url',
          image_url: { url: image.url },
        })),
        ...(effectiveQuestion
          ? [{ type: 'text', text: effectiveQuestion }]
          : []),
      ];
      if (composerImages.length > 0) {
        setUploadedImages([]);
      }
    }

    try {
      // ── Agent 模式：走 /api/tutor/agent SSE 路由 ──
      if (enableAgentMode) {
        const collectedSteps: import('./tutor/tutor-types').AgentStepInfo[] = [];
        setGlobalThinkingStartTime(Date.now());
        setAgentLiveSteps([]);
        setAgentPhase('searching');
        setAgentStreamingContent('');

        const agentHistory = globalChatHistory.map(m => ({ role: m.role, content: m.content }));
        const agentSegments = buildGlobalSegmentsForTutorRequest().map(s => ({
          text: s.text, startMs: s.startMs, endMs: s.endMs,
        }));
        const agentResponse = await fetch('/api/tutor/agent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            message: effectiveQuestion,
            history: agentHistory,
            segments: agentSegments,
            enableThinkingGuide,
          }),
        });

        if (!agentResponse.ok) {
          // 401 时尝试刷新页面（token 可能过期）
          if (agentResponse.status === 401) {
            throw new Error('登录已过期，请刷新页面重试');
          }
          throw new Error(`Agent error: ${agentResponse.status}`);
        }
        const reader = agentResponse.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';
        let agentContent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') continue;
            try {
              const evt = JSON.parse(raw);
              if (evt.type === 'tool_start') {
                const step = { label: evt.description || evt.toolName, toolName: evt.toolName, done: false };
                collectedSteps.push(step);
                setAgentLiveSteps([...collectedSteps]);
                setAgentPhase('reading');
              } else if (evt.type === 'tool_result') {
                const last = collectedSteps[collectedSteps.length - 1];
                if (last) last.done = true;
                setAgentLiveSteps([...collectedSteps]);
              } else if (evt.type === 'content_delta') {
                // 流式回答——逐字追加
                setAgentPhase('writing');
                agentContent += (evt.delta as string) || '';
                setAgentStreamingContent(agentContent);
              } else if (evt.type === 'content_done') {
                agentContent = evt.content as string || agentContent;
                setAgentPhase('writing');
              }
            } catch { /* ignore */ }
          }
        }

        setAgentPhase('idle');
        setAgentLiveSteps([]);
        setAgentStreamingContent('');
        setGlobalChatHistory(prev => [...prev, {
          role: 'assistant',
          content: agentContent || '抱歉，我没有找到相关的学习记录来回答这个问题。',
          agentSteps: collectedSteps.length > 0 ? collectedSteps : undefined,
        }]);
        clearGlobalStreamingOnly();

        isGlobalSendInFlightRef.current = false;
        setGlobalLoading(false);
        return;
      }

      // ── 普通模式：走 /api/tutor ──
      const headers: Record<string, string> = {};
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      // 记录思考开始时间
      setGlobalThinkingStartTime(Date.now());

      const result = await globalFetchStream('/api/tutor', requestBody, {
        headers,
        onMetadata: (metadata: SSEEvent) => {
          const nextCitations = normalizeCitations(metadata.citations);
          if (nextCitations?.length) {
            collectedCitations = nextCitations;
            setGlobalStreamingCitations(nextCitations);
          }
        },
      });

      // 流式完成，将完整内容添加到历史
      setGlobalChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: result.content || '抱歉，我没有理解你的问题，能换个方式问吗？',
        citations: collectedCitations.length ? collectedCitations : undefined,
      }]);
      clearGlobalStreamingOnly();  // 只清空流式内容，保留思考内容
      setGlobalStreamingCitations([]);

      // 保存到对话历史
      if (!conversationIdRef.current) {
        try {
          const conv = await conversationService.createConversation({
            userId,
            type: 'global-chat',
            title: conversationService.generateTitleFromMessage(question || userVisibleText || '图片问答'),
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
            { role: 'user', content: effectiveQuestion || userVisibleText || '图片问答' },
            { role: 'assistant', content: result.content || '' },
          ]);
        } catch (err) {
          console.error('Failed to save messages:', err);
        }
      }

      trackCoreEvent('tutor_chat_complete', {
        mode: 'global-chat',
        sessionId,
      });

    } catch (err) {
      // 用户取消不显示错误
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setGlobalChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: `抱歉，出现错误：${formatTutorErrorMessage(err)}` 
      }]);
      clearGlobalStreamingOnly();  // 只清空流式内容，保留思考内容
      setGlobalStreamingCitations([]);
    } finally {
      isGlobalSendInFlightRef.current = false;
      setGlobalLoading(false);
    }
  }, [userInput, selectedModel, enableWeb, enableThinkingGuide, enableAgentMode, supportsMultimodal, uploadedImages, accessToken, userId, sessionId, globalFetchStream, clearGlobalStreamingOnly, trackCoreEvent, buildGlobalSegmentsForTutorRequest, globalLoading, hasTutorContext, isStreaming, preferSupportContext, globalChatHistory]);

  // 全局模式：停止生成
  const stopGlobalGeneration = useCallback(() => {
    globalStopStream();
    setGlobalLoading(false);
    // 如果有部分内容，保存到历史
    if (streamingContent) {
      setGlobalChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: streamingContent + '\n\n[生成已停止]',
        citations: globalStreamingCitations.length ? globalStreamingCitations : undefined,
      }]);
      clearGlobalStreamingOnly();  // 只清空流式内容，保留思考内容
    }
    setGlobalStreamingCitations([]);
  }, [streamingContent, globalStopStream, clearGlobalStreamingOnly, globalStreamingCitations]);

  // 困惑点模式：停止生成
  const stopBreakpointGeneration = useCallback(() => {
    breakpointStopStream();
    setIsLoading(false);
    setIsGuidanceLoading(false);
    // 如果有部分内容，保存到历史
    if (breakpointStreamingContent) {
      setChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: breakpointStreamingContent + '\n\n[生成已停止]',
        citations: breakpointStreamingCitations.length ? breakpointStreamingCitations : undefined,
      }]);
      clearBreakpointStreamingOnly();  // 只清空流式内容，保留思考内容
    }
    setBreakpointStreamingCitations([]);
  }, [breakpointStreamingContent, breakpointStopStream, clearBreakpointStreamingOnly, breakpointStreamingCitations]);

  // 全局模式：处理初始问题（handleGlobalSend 已在上方定义）
  useEffect(() => {
    // 刚从通话退出时，不自动触发思维引导——用户只想看到对话记录
    if (justExitedRealtimeCallRef.current) {
      justExitedRealtimeCallRef.current = false;
      onLaunchQuestionConsumed?.();
      return;
    }

    const normalizedQuestion = launchQuestion.trim();
    const launchDisplay = launchDisplayText.trim();
    const launchImages = launchImagesProp.filter((image) => image.url);
    const shouldWaitForAuth = isCheckingAuth && !accessToken;
    if (!isGlobalMode || shouldWaitForAuth || (!normalizedQuestion && launchImages.length === 0) || !hasTutorContext) return;

    const initialQuestionKey = `${launchQuestionNonce}:${normalizedQuestion}:${launchImages.map((image) => image.id).join(',')}`;
    if (lastProcessedInitialQuestionKeyRef.current === initialQuestionKey) return;

    lastProcessedInitialQuestionKeyRef.current = initialQuestionKey;
    onLaunchQuestionConsumed?.();
    void handleGlobalSend(normalizedQuestion, {
      images: launchImages,
      displayText: launchDisplay,
      hideUserBubble: launchDisplay.length === 0,
    });
  }, [accessToken, hasTutorContext, isCheckingAuth, isGlobalMode, handleGlobalSend, launchDisplayText, launchImagesProp, launchQuestion, launchQuestionNonce, onLaunchQuestionConsumed]);

  // 重置 sessionId 变化时的全局对话状态
  useEffect(() => {
    if (lastGlobalChatSessionIdRef.current === sessionId) return;
    lastGlobalChatSessionIdRef.current = sessionId;
    conversationIdRef.current = null;
    lastProcessedInitialQuestionKeyRef.current = null;
    const shouldPreserveFreshLaunch =
      globalLoading ||
      isStreaming ||
      (globalChatHistory.length === 1 && globalChatHistory[0]?.role === 'user');

    if (!shouldPreserveFreshLaunch) {
      setGlobalChatHistory([]);
    }
  }, [globalChatHistory, globalLoading, isStreaming, sessionId]);

  // 外部触发「开新对话」——递增 nonce 时清空全局对话
  const lastNewConversationNonceRef = useRef(newConversationNonce);
  useEffect(() => {
    if (lastNewConversationNonceRef.current === newConversationNonce) return;
    lastNewConversationNonceRef.current = newConversationNonce;
    setGlobalChatHistory([]);
    conversationIdRef.current = null;
    lastProcessedInitialQuestionKeyRef.current = null;
  }, [newConversationNonce]);

  // 通知外层当前对话是否有内容（用于显示「开新对话」按钮）
  useEffect(() => {
    onConversationActiveChange?.(globalChatHistory.length > 0);
  }, [globalChatHistory.length, onConversationActiveChange]);

  // ===== 全局对话模式渲染 =====
  const hasLaunchPayload = launchQuestion.trim().length > 0 || launchImagesProp.some((image) => image.url);
  const hasStreamOutput = Boolean(streamingContent) || Boolean(globalThinkingContent);
  const shouldShowAutoLaunchState =
    isGlobalMode &&
    globalChatHistory.length === 0 &&
    !hasStreamOutput &&
    (hasLaunchPayload || globalLoading || isStreaming || (isCheckingAuth && !accessToken));
  const shouldShowRealtimeCallHero =
    isRealtimeTeacherMode &&
    !isMobile &&
    globalChatHistory.length === 0 &&
    !hasStreamOutput &&
    !shouldShowAutoLaunchState;
  const shouldUseMobileRealtimeComposer = isRealtimeTeacherMode && isMobile;
  const mobileRealtimeContextLabel = breakpoint
    ? `${formatTimestamp(breakpoint.timestamp)} 附近`
    : preferSupportContext
      ? '已选内容'
      : '整节课';

  useEffect(() => {
    realtimeAssistantDraftRef.current = realtimeAssistantDraft;
  }, [realtimeAssistantDraft]);

  const handleRealtimeUserTranscript = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // 通话记录同时写入两个 history，确保无论退出后在哪个视图都能看到
    setGlobalChatHistory((prev) => [...prev, { role: 'user', content: trimmed }]);
    setChatHistory((prev) => [...prev, { role: 'user', content: trimmed }]);
  }, []);

  const handleRealtimeAssistantStart = useCallback(() => {
    realtimeAssistantFinalizedRef.current = false;
    setRealtimeAssistantDraft('');
    setIsRealtimeAssistantResponding(true);
  }, []);

  const handleRealtimeAssistantChange = useCallback((text: string) => {
    setRealtimeAssistantDraft(text);
    if (text.trim()) {
      setIsRealtimeAssistantResponding(true);
    }
  }, []);

  const handleRealtimeAssistantDone = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (realtimeAssistantFinalizedRef.current) return;

    realtimeAssistantFinalizedRef.current = true;
    setGlobalChatHistory((prev) => [...prev, { role: 'assistant', content: trimmed }]);
    setChatHistory((prev) => [...prev, { role: 'assistant', content: trimmed }]);
    setRealtimeAssistantDraft('');
  }, []);

  const handleRealtimeAssistantEnd = useCallback(() => {
    if (!realtimeAssistantFinalizedRef.current) {
      const fallbackText = realtimeAssistantDraftRef.current.trim();
      if (fallbackText) {
        setGlobalChatHistory((prev) => [...prev, { role: 'assistant', content: fallbackText }]);
        setChatHistory((prev) => [...prev, { role: 'assistant', content: fallbackText }]);
      }
    }

    // 重置标记，为下一轮准备（包括结束通话时的 flush 场景）
    realtimeAssistantFinalizedRef.current = false;
    setRealtimeAssistantDraft('');
    setIsRealtimeAssistantResponding(false);
  }, [isGlobalMode]);

  if (isGlobalMode) {
    if (shouldUseMobileRealtimeComposer) {
      return (
        <div className="h-full flex flex-col ai-chat-container bg-[#F7F7F5]">
          <TutorRealtimeCallScreen
            title="语音同桌"
            contextLabel={mobileRealtimeContextLabel}
            disabled={!hasTutorContext}
            instructions={realtimeTeacherInstructions}
            enableSearch={enableWeb}
            onExit={handleRealtimeTeacherToggle}
            onUserTranscript={handleRealtimeUserTranscript}
            onAssistantTranscriptChange={handleRealtimeAssistantChange}
            onAssistantTranscriptDone={handleRealtimeAssistantDone}
            onAssistantResponseStart={handleRealtimeAssistantStart}
            onAssistantResponseEnd={handleRealtimeAssistantEnd}
          />
        </div>
      );
    }

    return (
      <div className={`relative h-full flex flex-col ai-chat-container ${isMobile ? 'bg-transparent' : 'bg-white'}`}>
        {/* 头部 - 紧凑设计 */}
        {!(isMobile && hideMobileHeader) ? (
          <div className={`${isMobile ? 'px-3 pt-3' : 'border-b border-gray-100 bg-white px-4 py-3'} flex-shrink-0`}>
            <div className={`${isMobile ? 'rounded-[24px] border border-[#E9E9E7] bg-white px-4 py-3' : ''}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className={`${isMobile ? 'flex h-9 w-9 items-center justify-center rounded-xl bg-[#F7F7F5] text-[#232322]' : ''}`}>
                    <MessageCircle size={20} strokeWidth={1.75} className={isMobile ? '' : 'text-lilac-500'} />
                  </div>
                  <div>
                  <h3 className={`font-medium text-gray-800 ${isMobile ? 'text-[15px]' : 'text-base'}`}>
                      {isRealtimeTeacherMode
                        ? (isMobile ? '老师' : '像打电话一样问老师')
                        : isMobile
                          ? 'AI 助教'
                          : 'AI 课堂助手'}
                    </h3>
                    {!isRealtimeTeacherMode && !isMobile ? (
                      <p className="text-xs text-gray-500">
                        {preferSupportContext
                          ? '会优先沿着你刚圈出的内容继续讲解。'
                          : isMobile
                            ? '继续解释、举例，或者帮你把这节课讲透。'
                            : '基于整节课内容回答问题'}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isMobile ? <FixedModelBadge compact /> : <FixedModelBadge />}
                  <TutorModeToggle
                    enabled={isRealtimeTeacherMode}
                    available={IS_REALTIME_TEACHER_AVAILABLE}
                    onClick={handleRealtimeTeacherToggle}
                    compact={isMobile}
                  />
                </div>
              </div>
              {isMobile ? (
                hasTutorContext ? null : (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
                    <AlertCircle size={11} />
                    <span>先收一条内容</span>
                  </div>
                )
              ) : null}
            </div>

            {/* 功能开关 - 仅桌面端显示 */}
            {!isMobile && (
              <div className="mt-3 flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={enableWeb}
                    onChange={(e) => setEnableWeb(e.target.checked)}
                    disabled={enableAgentMode}
                    className="w-4 h-4 rounded border-gray-300 text-[#787774] focus:ring-[#232322]"
                  />
                  <span className={`flex items-center gap-1 group-hover:text-gray-900 transition-colors ${enableAgentMode ? 'opacity-40' : ''}`}>
                    <Globe size={13} strokeWidth={1.75} />
                    联网搜索{enableAgentMode ? '(Agent 内置)' : ''}
                  </span>
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={enableThinkingGuide}
                    onChange={(e) => setEnableThinkingGuide(e.target.checked)}
                    disabled={isRealtimeTeacherMode}
                    className="w-4 h-4 rounded border-gray-300 text-violet-500 focus:ring-violet-400"
                  />
                  <span className="flex items-center gap-1 group-hover:text-gray-900 transition-colors">
                    <Brain size={13} strokeWidth={1.75} />
                    思维引导
                  </span>
                </label>
              </div>
            )}
          </div>
        ) : null}

        {/* 对话区域 - 优化空间利用 */}
        <div className={`flex-1 overflow-y-auto chat-messages ${isMobile ? 'p-3' : 'p-4'}`} style={{ minHeight: 0 }}>
          {!hasTutorContext ? (
            // 无可用上下文
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <MessageCircle size={28} strokeWidth={1.5} className="text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-700 mb-2">还没有可用的学习上下文</h3>
              <p className="text-sm text-gray-500">先录一段、贴一份材料，或者从微信发一句给我都可以。</p>
            </div>
          ) : shouldShowAutoLaunchState ? (
            <div className="space-y-4">
              <div className="flex justify-start">
                <div className={`${isMobile ? 'max-w-[92%]' : 'max-w-[85%]'} rounded-2xl ${isMobile ? 'px-3 py-2.5' : 'px-4 py-3'} bg-gray-100 text-gray-700`}>
                  {agentPhase !== 'idle' ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <div className="relative flex h-5 w-5 items-center justify-center">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#5B8DBF]/30" />
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#5B8DBF]" />
                        </div>
                        <span className="text-xs font-medium text-[#3D7EAA]">
                          {agentPhase === 'searching' && '正在理解你的问题…'}
                          {agentPhase === 'reading' && '正在检索学习记录…'}
                          {agentPhase === 'writing' && '正在组织回答…'}
                        </span>
                      </div>
                      {agentLiveSteps.length > 0 && (
                        <div className="ml-2.5 border-l border-[#D3E4F4] pl-3 flex flex-col gap-1">
                          {agentLiveSteps.map((step, si) => (
                            <div
                              key={si}
                              className="flex items-center gap-2 text-[11px] animate-[fadeSlideIn_0.3s_ease-out]"
                              style={{ animationFillMode: 'backwards', animationDelay: `${si * 80}ms` }}
                            >
                              {step.done ? (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34C759" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><polyline points="20 6 9 17 4 12" /></svg>
                              ) : (
                                <div className="flex h-3 w-3 items-center justify-center flex-shrink-0">
                                  <span className="block h-1.5 w-1.5 rounded-full bg-[#5B8DBF] animate-pulse" />
                                </div>
                              )}
                              <span className={step.done ? 'text-[#787774]' : 'text-[#3D7EAA] font-medium'}>{step.label}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm">
                      <div className="loading-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                      <span>
                        {isRealtimeTeacherMode
                          ? (preferSupportContext ? '老师正在顺着你刚选的内容继续往下讲…' : '老师正在顺着这节课继续带你往下走…')
                          : '正在准备…'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div ref={chatEndRef} />
            </div>
          ) : globalChatHistory.length === 0 && !hasStreamOutput ? (
            isRealtimeTeacherMode ? (
              shouldShowRealtimeCallHero ? (
                <div className="flex h-full items-center justify-center">
                  <div className="w-full max-w-md">
                    <TutorCallComposer
                      disabled={globalLoading || !hasTutorContext}
                      compact={isMobile}
                      variant="hero"
                      onSubmitTranscript={(text) => handleGlobalSend(text)}
                    />
                  </div>
                </div>
              ) : (
                shouldUseMobileRealtimeComposer ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <div className="flex h-24 w-24 items-center justify-center rounded-full border border-[#E9E9E7] bg-white text-2xl font-semibold text-[#232322]">
                      师
                    </div>
                    <p className="mt-5 text-base font-medium text-[#232322]">语音同桌</p>
                    <p className="mt-2 max-w-[220px] text-xs leading-5 text-[#A3A39E]">
                      先进入通话页，再像发微信语音一样说一轮。
                    </p>
                  </div>
                ) : (
                  <div className="h-full" />
                )
              )
            ) : (
              <IntentBubbleExplorer
                transcriptText={segments.map(s => s.text).join(' ') || normalizeSupportContextText(supportContextText, 2400)}
                preferSupportContext={preferSupportContext}
                onSend={(prompt, meta?: StarterIntentMeta) => handleGlobalSend(prompt, {
                  displayText: meta?.displayText || '',
                  hideUserBubble: meta?.hideBubble ?? false,
                })}
              />
            )
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
                        ? 'bg-[#232322] text-white'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <>
                        {msg.agentSteps && msg.agentSteps.length > 0 && (
                          <details className="mb-3 group">
                            <summary className="cursor-pointer select-none flex items-center gap-2 text-[11px] text-[#A3A39E] hover:text-[#787774] transition-colors">
                              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-[#D3E4F4]/50">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#5B8DBF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                              </div>
                              <span>检索了 {msg.agentSteps.filter(s => s.done).length} 处学习记录</span>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-open:rotate-90"><polyline points="9 18 15 12 9 6" /></svg>
                            </summary>
                            <div className="mt-1.5 ml-2 border-l border-[#E9E9E7] pl-3 flex flex-col gap-0.5">
                              {msg.agentSteps.map((step, si) => (
                                <div key={si} className="flex items-center gap-2 py-0.5 text-[11px]">
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#34C759" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><polyline points="20 6 9 17 4 12" /></svg>
                                  <span className="text-[#787774]">{step.label}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                        {enableThinkingGuide ? (
                          <ThinkingGuideRenderer
                            content={msg.content}
                            onTimestampClick={handleTimestampClick}
                            citations={msg.citations}
                            isMobile={isMobile}
                            className={`leading-relaxed ${isMobile ? 'text-xs' : 'text-sm'}`}
                          />
                        ) : (
                          <StreamingMarkdown
                            content={msg.content}
                            onTimestampClick={handleTimestampClick}
                            citations={msg.citations}
                            className={`leading-relaxed ${isMobile ? 'text-xs' : 'text-sm'}`}
                          />
                        )}
                      </>
                    ) : (
                      <div className="space-y-2">
                        {msg.images?.length ? (
                          <div className="flex flex-wrap gap-2">
                            {msg.images.map((image) => (
                              <img
                                key={image.id}
                                src={image.previewUrl}
                                alt={image.name}
                                className="h-16 w-16 rounded-2xl object-cover ring-1 ring-white/10"
                              />
                            ))}
                          </div>
                        ) : null}
                        {msg.content ? (
                          <div className={`whitespace-pre-wrap leading-relaxed ${isMobile ? 'text-xs' : 'text-sm'}`}>
                            {msg.content}
                          </div>
                        ) : null}
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
                        citations={globalStreamingCitations}
                        isMobile={isMobile}
                        className={`leading-relaxed ${isMobile ? 'text-xs' : 'text-sm'}`}
                      />
                    ) : (
                      <StreamingMarkdown
                        content={streamingContent}
                        isStreaming={true}
                        onTimestampClick={handleTimestampClick}
                        citations={globalStreamingCitations}
                        className={`leading-relaxed ${isMobile ? 'text-xs' : 'text-sm'}`}
                      />
                    )}
                  </div>
                </div>
              )}
              
              {/* 等待开始流式输出时显示 loading / Agent 实时思考步骤 */}
              {globalLoading && !streamingContent && !globalThinkingContent && !agentStreamingContent && (
                <div className="flex justify-start">
                  <div className={`${isMobile ? 'max-w-[92%]' : 'max-w-[85%]'} rounded-2xl ${isMobile ? 'px-3 py-2.5' : 'px-4 py-3'} bg-gray-100 text-gray-800`}>
                    {enableAgentMode && agentPhase !== 'idle' ? (
                      <div className="flex flex-col gap-2">
                        {/* Agent 阶段指示器 */}
                        <div className="flex items-center gap-2">
                          <div className="relative flex h-5 w-5 items-center justify-center">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#5B8DBF]/30" />
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#5B8DBF]" />
                          </div>
                          <span className="text-xs font-medium text-[#3D7EAA]">
                            {agentPhase === 'searching' && '正在理解你的问题…'}
                            {agentPhase === 'reading' && '正在检索学习记录…'}
                            {agentPhase === 'writing' && '正在组织回答…'}
                          </span>
                        </div>
                        {/* 实时步骤时间线 */}
                        {agentLiveSteps.length > 0 && (
                          <div className="ml-2.5 border-l border-[#D3E4F4] pl-3 flex flex-col gap-1">
                            {agentLiveSteps.map((step, si) => (
                              <div
                                key={si}
                                className="flex items-center gap-2 text-[11px] animate-[fadeSlideIn_0.3s_ease-out]"
                                style={{ animationFillMode: 'backwards', animationDelay: `${si * 80}ms` }}
                              >
                                {step.done ? (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34C759" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><polyline points="20 6 9 17 4 12" /></svg>
                                ) : (
                                  <div className="flex h-3 w-3 items-center justify-center flex-shrink-0">
                                    <span className="block h-1.5 w-1.5 rounded-full bg-[#5B8DBF] animate-pulse" />
                                  </div>
                                )}
                                <span className={step.done ? 'text-[#787774]' : 'text-[#3D7EAA] font-medium'}>{step.label}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-gray-500">
                        <div className="loading-dots">
                          <span></span>
                          <span></span>
                          <span></span>
                        </div>
                        <span className="text-xs">思考中...</span>
                        {isRealtimeTeacherMode ? <span className="text-xs text-gray-400">老师正在组织下一句</span> : null}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Agent 流式回答输出 */}
              {agentPhase === 'writing' && agentStreamingContent && (
                <div className="flex justify-start">
                  <div className={`${isMobile ? 'max-w-[92%]' : 'max-w-[85%]'} rounded-2xl ${isMobile ? 'px-3 py-2' : 'px-4 py-3'} bg-gray-100 text-gray-800`}>
                    {/* 折叠的 Agent 步骤 */}
                    {agentLiveSteps.length > 0 && (
                      <details className="mb-3 group">
                        <summary className="cursor-pointer select-none flex items-center gap-2 text-[11px] text-[#A3A39E] hover:text-[#787774] transition-colors">
                          <div className="flex h-4 w-4 items-center justify-center rounded-full bg-[#D3E4F4]/50">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#5B8DBF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                          </div>
                          <span>检索了 {agentLiveSteps.filter(s => s.done).length} 处学习记录</span>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-open:rotate-90"><polyline points="9 18 15 12 9 6" /></svg>
                        </summary>
                        <div className="mt-1.5 ml-2 border-l border-[#E9E9E7] pl-3 flex flex-col gap-0.5">
                          {agentLiveSteps.map((step, si) => (
                            <div key={si} className="flex items-center gap-2 py-0.5 text-[11px]">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#34C759" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><polyline points="20 6 9 17 4 12" /></svg>
                              <span className="text-[#787774]">{step.label}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                    {enableThinkingGuide ? (
                      <ThinkingGuideRenderer
                        content={agentStreamingContent}
                        isStreaming={true}
                        onTimestampClick={handleTimestampClick}
                        isMobile={isMobile}
                        className={`leading-relaxed ${isMobile ? 'text-xs' : 'text-sm'}`}
                      />
                    ) : (
                      <StreamingMarkdown
                        content={agentStreamingContent}
                        isStreaming={true}
                        onTimestampClick={handleTimestampClick}
                        className={`leading-relaxed ${isMobile ? 'text-xs' : 'text-sm'}`}
                      />
                    )}
                  </div>
                </div>
              )}

              {shouldUseMobileRealtimeComposer && isRealtimeAssistantResponding && realtimeAssistantDraft && (
                <div className="flex justify-start">
                  <div className="max-w-[92%] rounded-2xl bg-gray-100 px-3 py-2 text-gray-800">
                    <div className="whitespace-pre-wrap text-xs leading-relaxed">{realtimeAssistantDraft}</div>
                  </div>
                </div>
              )}

              {shouldUseMobileRealtimeComposer && isRealtimeAssistantResponding && !realtimeAssistantDraft ? (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl px-4 py-3">
                    <div className="flex items-center gap-2 text-gray-500">
                      <div className="loading-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                      <span className="text-xs">老师在回你</span>
                    </div>
                  </div>
                </div>
              ) : null}

              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        <div className={`${isMobile ? 'bg-transparent px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-2' : 'border-t border-gray-100 bg-white px-4 py-3'} flex-shrink-0`}>
          <div className={`${isMobile ? 'rounded-[24px] border border-[#E9E9E7] bg-white p-2' : ''}`}>
            {isRealtimeTeacherMode && !shouldShowRealtimeCallHero ? (
              <div className={shouldUseMobileRealtimeComposer ? '' : 'mb-3'}>
                {shouldUseMobileRealtimeComposer ? (
                  <TutorRealtimeCallBar
                    disabled={!hasTutorContext}
                    instructions={realtimeTeacherInstructions}
                    enableSearch={enableWeb}
                    onUserTranscript={handleRealtimeUserTranscript}
                    onAssistantTranscriptChange={handleRealtimeAssistantChange}
                    onAssistantTranscriptDone={handleRealtimeAssistantDone}
                    onAssistantResponseStart={handleRealtimeAssistantStart}
                    onAssistantResponseEnd={handleRealtimeAssistantEnd}
                  />
                ) : (
                  <TutorCallComposer
                    disabled={globalLoading || !hasTutorContext}
                    compact={isMobile}
                    variant="dock"
                    onSubmitTranscript={(text) => handleGlobalSend(text)}
                  />
                )}
              </div>
            ) : null}

            {!shouldUseMobileRealtimeComposer && supportsMultimodal && uploadedImages.length > 0 && (
              <div className={`mb-3 ${isMobile ? 'rounded-xl bg-slate-50/80 p-2.5' : 'rounded-lg bg-gray-50 p-2'}`}>
                <ImageUpload
                  images={uploadedImages}
                  onImagesChange={setUploadedImages}
                  maxImages={5}
                  disabled={globalLoading}
                />
              </div>
            )}

            {!shouldUseMobileRealtimeComposer ? (
              <div className="flex items-end gap-2">
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

                <div className={`${isMobile ? 'flex min-w-0 flex-1 items-center gap-2 rounded-[18px] border border-slate-200/50 bg-slate-50/50 px-3 py-2.5' : 'flex min-w-0 flex-1 items-center gap-2'}`}>
                  <input
                    type="text"
                    data-testid="tutor-global-input"
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && !isStreaming && handleGlobalSend()}
                    placeholder={isRealtimeTeacherMode
                      ? '补一句'
                      : preferSupportContext
                        ? '继续顺着这几条内容问...'
                        : '继续问这节课里没讲透的地方...'}
                    className={`${isMobile ? 'min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-sm text-slate-700 outline-none ring-0 placeholder:text-slate-400' : 'input flex-1'}`}
                    disabled={globalLoading || !hasTutorContext}
                  />
                  {!isRealtimeTeacherMode ? (
                    <VoiceMicButton
                      onTranscript={(text) => setUserInput(prev => prev + text)}
                      disabled={globalLoading || !hasTutorContext}
                      size={isMobile ? 'sm' : 'md'}
                    />
                  ) : null}
                </div>

                {isStreaming ? (
                  <StopGenerationButton onClick={stopGlobalGeneration} compact={isMobile} />
                ) : (
                  <button
                    data-testid="tutor-global-send"
                    onClick={() => handleGlobalSend()}
                    disabled={(!userInput.trim() && uploadedImages.length === 0) || globalLoading || !hasTutorContext}
                    className={`${isMobile ? 'inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#232322] text-white disabled:opacity-30' : 'btn btn-primary px-6 disabled:opacity-50'}`}
                  >
                    发送
                  </button>
                )}
              </div>
            ) : null}

            {!shouldUseMobileRealtimeComposer && globalChatHistory.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {isRealtimeTeacherMode ? null : (
                  <>
                    <QuickReply text="再详细说说" onClick={setUserInput} />
                    <QuickReply text="举个例子" onClick={setUserInput} />
                    <QuickReply text="谢谢，我懂了" onClick={setUserInput} />
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const loading = isLoading || externalLoading;

  if (shouldUseMobileRealtimeComposer) {
    return (
      <div className="h-full flex flex-col ai-chat-container bg-[#F7F7F5]">
        <TutorRealtimeCallScreen
          title="语音同桌"
          contextLabel={mobileRealtimeContextLabel}
          disabled={!hasTutorContext}
          instructions={realtimeTeacherInstructions}
          enableSearch={enableWeb}
          onExit={handleRealtimeTeacherToggle}
          onUserTranscript={handleRealtimeUserTranscript}
          onAssistantTranscriptChange={handleRealtimeAssistantChange}
          onAssistantTranscriptDone={handleRealtimeAssistantDone}
          onAssistantResponseStart={handleRealtimeAssistantStart}
          onAssistantResponseEnd={handleRealtimeAssistantEnd}
        />
      </div>
    );
  }

  return (
    <div className="relative h-full flex flex-col ai-chat-container">
      {/* 头部控制栏 - 紧凑设计 */}
      {!(isMobile && hideMobileHeader) && (
      <div className={`border-b border-gray-100 bg-white flex-shrink-0 ${isMobile ? 'p-3' : 'px-4 py-2'}`}>
          {isMobile ? (
            // 移动端紧凑布局
          <div className="space-y-2">
            {/* 第一行：困惑点信息 + 状态 */}
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${breakpoint.resolved ? 'bg-mint' : 'bg-coral animate-pulse'}`} />
              <span className="text-sm font-medium text-navy truncate">
                {formatTimestamp(breakpoint.timestamp)} 的困惑点
              </span>
              <span className="text-xs flex-shrink-0">
                {breakpoint.resolved ? <CheckCircle2 size={14} strokeWidth={1.75} className="text-mint" /> : <AlertCircle size={14} strokeWidth={1.75} className="text-coral" />}
              </span>
              {isFromCache && <ClipboardList size={14} strokeWidth={1.75} className="text-skyblue flex-shrink-0" />}
            </div>
            {/* 第二行：操作按钮 */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FixedModelBadge compact />
                <TutorModeToggle
                  enabled={isRealtimeTeacherMode}
                  available={IS_REALTIME_TEACHER_AVAILABLE}
                  onClick={handleRealtimeTeacherToggle}
                  compact
                />
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
                    className="px-2 py-1 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors flex items-center gap-1"
                    title="重新生成"
                  >
                    <RefreshCw size={13} strokeWidth={1.75} />
                  </button>
                )}
                {!breakpoint.resolved && (
                  <button
                    data-testid="tutor-resolve-button"
                    onClick={onResolve}
                    className="btn btn-primary px-3 py-1.5 text-xs flex items-center gap-1"
                  >
                    <Check size={13} strokeWidth={2} />
                    我懂了
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          // 桌面端简化布局 - 只保留操作按钮，标题信息由外层切换栏显示
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
              <FixedModelBadge />
              <TutorModeToggle
                enabled={isRealtimeTeacherMode}
                available={IS_REALTIME_TEACHER_AVAILABLE}
                onClick={handleRealtimeTeacherToggle}
              />
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={enableWeb}
                  onChange={(e) => setEnableWeb(e.target.checked)}
                  disabled={enableAgentMode}
                  className="w-4 h-4 rounded border-gray-300 text-[#787774] focus:ring-[#232322]"
                />
                <span className={`flex items-center gap-1 group-hover:text-gray-900 transition-colors ${enableAgentMode ? 'opacity-40' : ''}`}>
                  <Globe size={13} strokeWidth={1.75} />
                  联网搜索{enableAgentMode ? '(Agent 内置)' : ''}
                </span>
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={enableThinkingGuide}
                  onChange={(e) => setEnableThinkingGuide(e.target.checked)}
                  disabled={isRealtimeTeacherMode}
                  className="w-4 h-4 rounded border-gray-300 text-violet-500 focus:ring-violet-400"
                />
                <span className="flex items-center gap-1 group-hover:text-gray-900 transition-colors">
                  <Brain size={13} strokeWidth={1.75} />
                  思维引导
                </span>
              </label>
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
                    className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors flex items-center gap-1"
                    title="重新生成"
                  >
                    <RefreshCw size={13} strokeWidth={1.75} />
                    刷新
                  </button>
                )}
                {!breakpoint.resolved && (
                  <button
                    data-testid="tutor-resolve-button"
                    onClick={onResolve}
                    className="btn btn-primary px-3 py-1.5 text-sm flex items-center gap-1"
                  >
                    <Check size={14} strokeWidth={2} />
                    我懂了
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {/* 内容区 - 优化空间利用 */}
      <div className={`flex-1 overflow-y-auto chat-messages ${isMobile ? 'p-3' : 'p-4'}`} style={{ minHeight: 0 }}>
        {error ? (
          <div className="flex items-center justify-center h-full animate-fade-in">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
                <AlertTriangle size={28} strokeWidth={1.5} className="text-red-500" />
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
        ) : response || chatHistory.length > 0 || isBreakpointStreaming || Boolean(breakpointThinkingContent) || (isRealtimeTeacherMode && isMobile && isRealtimeAssistantResponding) ? (
          <div className="space-y-6 animate-slide-up">
            {response ? (
              <>
                <Section icon={<BookOpen size={16} strokeWidth={1.75} />} title="课堂回顾">
                  <div className="bg-sunflower-50 border border-sunflower-200 rounded-xl p-4">
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
                                  ? 'bg-sunflower px-1 rounded scale-105'
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
                            ? 'bg-[#232322] text-navy border-sunflower-600 shadow-sunflower-200 scale-105'
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

                <Section icon={<Target size={16} strokeWidth={1.75} />} title="一起缩小问题范围" badge="意图澄清">
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
                      <p>正在准备更合适的追问...</p>
                      <p className="text-xs mt-1 text-gray-400">会先帮你收窄到最接近的问题方向</p>
                    </div>
                  )}
                </Section>

                {notebookAvailable && (
                  <Section icon={<Search size={16} strokeWidth={1.75} />} title="知识库搜索" badge="Open Notebook">
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
              </>
            ) : null}

            {(chatHistory.length > 0 || isBreakpointStreaming || breakpointThinkingContent || (isRealtimeTeacherMode && isMobile && isRealtimeAssistantResponding)) ? (
              <div className={`space-y-3 ${response ? 'pt-4 border-t border-gray-100' : ''}`}>
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <MessageSquare size={16} strokeWidth={1.75} className="text-gray-500" />
                  {response ? '对话记录' : '分析过程'}
                </h3>

                {!response ? (
                  <div className="rounded-2xl border border-[#E9E9E7] bg-[#F7F7F5] px-4 py-3 text-sm text-[#787774]">
                    这次不会自动开分析。你点了以后，我会边想边把内容往下生成。
                  </div>
                ) : null}

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
                          citations={msg.citations}
                          isMobile={isMobile}
                          className="text-sm"
                        />
                      ) : (
                        <StreamingMarkdown
                          content={msg.content}
                          onTimestampClick={handleTimestampClick}
                          citations={msg.citations}
                          className="text-sm"
                        />
                      )
                    ) : (
                      <div className="space-y-2">
                        {msg.images?.length ? (
                          <div className="flex flex-wrap gap-2">
                            {msg.images.map((image) => (
                              <img
                                key={image.id}
                                src={image.previewUrl}
                                alt={image.name}
                                className="h-16 w-16 rounded-2xl object-cover ring-1 ring-black/5"
                              />
                            ))}
                          </div>
                        ) : null}
                        {msg.content ? (
                          <div className="whitespace-pre-wrap text-sm">
                            {msg.content}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}

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

                {isBreakpointStreaming && breakpointStreamingContent ? (
                  <div className="chat-bubble assistant">
                    {enableThinkingGuide ? (
                      <ThinkingGuideRenderer
                        content={breakpointStreamingContent}
                        isStreaming={true}
                        onTimestampClick={handleTimestampClick}
                        citations={breakpointStreamingCitations}
                        isMobile={isMobile}
                        className="text-sm"
                      />
                    ) : (
                      <StreamingMarkdown
                        content={breakpointStreamingContent}
                        isStreaming={true}
                        onTimestampClick={handleTimestampClick}
                        citations={breakpointStreamingCitations}
                        className="text-sm"
                      />
                    )}
                  </div>
                ) : null}

                {isBreakpointStreaming && !breakpointStreamingContent && !breakpointThinkingContent ? (
                  <div className="chat-bubble assistant">
                    <div className="flex items-center gap-2 text-gray-500">
                      <div className="loading-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                      <span className="text-xs">思考中...</span>
                      {isRealtimeTeacherMode ? <span className="text-xs text-gray-400">老师正在组织下一句</span> : null}
                    </div>
                  </div>
                ) : null}

                {isRealtimeTeacherMode && isMobile && isRealtimeAssistantResponding && realtimeAssistantDraft ? (
                  <div className="chat-bubble assistant">
                    <div className="whitespace-pre-wrap text-sm">{realtimeAssistantDraft}</div>
                  </div>
                ) : null}

                {isRealtimeTeacherMode && isMobile && isRealtimeAssistantResponding && !realtimeAssistantDraft ? (
                  <div className="chat-bubble assistant">
                    <div className="flex items-center gap-2 text-gray-500">
                      <div className="loading-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                      <span className="text-xs">老师在回你</span>
                    </div>
                  </div>
                ) : null}

                <div ref={chatEndRef} />
              </div>
            ) : null}
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
              {isMobile ? <p className="mt-1 text-xs text-gray-400">{isRealtimeTeacherMode ? '老师正在顺着你的课堂继续想…' : '正在准备回答…'}</p> : null}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full animate-fade-in">
            <div className="max-w-sm text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[#E9E9E7] bg-[#F7F7F5] text-[#232322]">
                <MessageCircle size={22} strokeWidth={1.75} />
              </div>
              <p className="text-base font-medium text-[#232322]">先不自动分析这个困惑点</p>
              <p className="mt-2 text-sm leading-6 text-[#787774]">
                你点一下再开始，我会直接流式往下讲。你也可以先在下面输入一句更具体的问题。
              </p>
              <button
                onClick={explainBreakpoint}
                className="mt-5 inline-flex h-10 items-center justify-center rounded-full bg-[#232322] px-5 text-sm font-medium text-white transition-colors hover:bg-black"
              >
                开始分析
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 输入框 - 紧凑设计 */}
      <div className="px-4 py-3 border-t border-gray-100 bg-white flex-shrink-0">
        {/* 图片预览区域 */}
        {!(isRealtimeTeacherMode && isMobile) && supportsMultimodal && uploadedImages.length > 0 && (
          <div className="mb-3 p-2 bg-gray-50 rounded-lg">
            <ImageUpload
              images={uploadedImages}
              onImagesChange={setUploadedImages}
              maxImages={5}
              disabled={loading}
            />
          </div>
        )}
        
        {isRealtimeTeacherMode && isMobile ? (
          <TutorRealtimeCallBar
            disabled={false}
            instructions={realtimeTeacherInstructions}
            enableSearch={enableWeb}
            onUserTranscript={handleRealtimeUserTranscript}
            onAssistantTranscriptChange={handleRealtimeAssistantChange}
            onAssistantTranscriptDone={handleRealtimeAssistantDone}
            onAssistantResponseStart={handleRealtimeAssistantStart}
            onAssistantResponseEnd={handleRealtimeAssistantEnd}
          />
        ) : (
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

            <div className="flex-1 space-y-2">
              {isRealtimeTeacherMode ? (
                <TutorCallComposer
                  disabled={isBreakpointStreaming}
                  compact={isMobile}
                  variant="dock"
                  onSubmitTranscript={(text) => handleSend(text)}
                />
              ) : null}
              <input
                type="text"
                data-testid="tutor-breakpoint-input"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && !isBreakpointStreaming && handleSend()}
                placeholder={isRealtimeTeacherMode ? '补一句' : '告诉我你哪里不懂...'}
                className="input w-full"
                disabled={isBreakpointStreaming}
              />
            </div>
            {!isRealtimeTeacherMode ? (
              <VoiceMicButton
                onTranscript={(text) => setUserInput(prev => prev + text)}
                disabled={isBreakpointStreaming}
              />
            ) : null}
            {isBreakpointStreaming ? (
              <StopGenerationButton onClick={stopBreakpointGeneration} compact={isMobile} />
            ) : (
              <button
                data-testid="tutor-breakpoint-send"
                onClick={() => handleSend()}
                disabled={(!userInput.trim() && uploadedImages.length === 0) || loading}
                className="btn btn-primary px-6 disabled:opacity-50 flex-shrink-0"
              >
                发送
              </button>
            )}
          </div>
        )}
        
        <div className="flex gap-2 mt-2 flex-wrap">
          {isRealtimeTeacherMode ? null : (
            <>
              <QuickReply text="我不理解这个公式" onClick={setUserInput} />
              <QuickReply text="能举个例子吗？" onClick={setUserInput} />
              <QuickReply text="这个和之前学的有什么关系？" onClick={setUserInput} />
              <QuickReply text="我懂了！" onClick={setUserInput} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
