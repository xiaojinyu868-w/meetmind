'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Breakpoint } from '@/lib/services/meetmind-service';
import { formatTimestamp } from '@/lib/services/longcut-utils';
import { notebookService, localSearch, type SearchResult } from '@/lib/services/notebook-service';
import { ModelSelector } from './ModelSelector';
import { GuidanceQuestion, GuidanceQuestionSkeleton } from './GuidanceQuestion';
import { Citations, CitationsSkeleton } from './Citations';
import type { GuidanceQuestion as GuidanceQuestionType, GuidanceOption, Citation } from '@/types/dify';

interface Segment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
}

interface AITutorProps {
  breakpoint: Breakpoint | null;
  segments: Segment[];
  isLoading: boolean;
  onResolve: () => void;
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
}

export function AITutor({ breakpoint, segments, isLoading: externalLoading, onResolve }: AITutorProps) {
  const [userInput, setUserInput] = useState('');
  const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [selectedModel, setSelectedModel] = useState('qwen3-max');
  const [response, setResponse] = useState<TutorAPIResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [notebookAvailable, setNotebookAvailable] = useState(false);
  
  const [enableGuidance, setEnableGuidance] = useState(true);
  const [enableWeb, setEnableWeb] = useState(true);
  const [selectedOptionId, setSelectedOptionId] = useState<string | undefined>();
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [isGuidanceLoading, setIsGuidanceLoading] = useState(false);
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    notebookService.isAvailable().then(setNotebookAvailable);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

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
      const res = await fetch('/api/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: breakpoint.timestamp,
          segments,
          model: selectedModel,
          enable_guidance: enableGuidance,
          enable_web: enableWeb,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '请求失败');
      }

      const data: TutorAPIResponse = await res.json();
      setResponse(data);
      if (data.conversation_id) {
        setConversationId(data.conversation_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setIsLoading(false);
    }
  }, [breakpoint, segments, selectedModel, enableGuidance, enableWeb]);

  useEffect(() => {
    if (breakpoint) {
      explainBreakpoint();
    }
  }, [breakpoint?.id, selectedModel]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGuidanceSelect = async (optionId: string, option: GuidanceOption) => {
    if (!breakpoint) return;
    
    setSelectedOptionId(optionId);
    setIsGuidanceLoading(true);
    
    try {
      const res = await fetch('/api/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: breakpoint.timestamp,
          segments,
          model: selectedModel,
          enable_guidance: enableGuidance,
          enable_web: enableWeb,
          selected_option_id: optionId,
          conversation_id: conversationId,
          studentQuestion: `我选择了：${option.text}`,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '请求失败');
      }

      const data: TutorAPIResponse = await res.json();
      
      setChatHistory(prev => [
        ...prev,
        { role: 'user', content: `我选择了：${option.text}` },
        { role: 'assistant', content: data.rawContent || '让我针对你的选择进一步解释...' },
      ]);
      
      if (data.conversation_id) {
        setConversationId(data.conversation_id);
      }
      
      if (data.guidance_question) {
        setResponse(prev => prev ? { ...prev, guidance_question: data.guidance_question } : null);
        setSelectedOptionId(undefined);
      }
    } catch (err) {
      setChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: `抱歉，出现错误：${err instanceof Error ? err.message : '未知错误'}` 
      }]);
    } finally {
      setIsGuidanceLoading(false);
    }
  };

  const handleSend = async () => {
    if (!userInput.trim() || !breakpoint) return;
    
    const question = userInput.trim();
    setUserInput('');
    
    setChatHistory(prev => [...prev, { role: 'user', content: question }]);
    
    try {
      const res = await fetch('/api/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: breakpoint.timestamp,
          segments,
          model: selectedModel,
          studentQuestion: question,
          enable_guidance: enableGuidance,
          enable_web: enableWeb,
          conversation_id: conversationId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '请求失败');
      }

      const data: TutorAPIResponse = await res.json();
      
      setChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: data.rawContent || data.explanation.followUpQuestion 
      }]);
      
      if (data.conversation_id) {
        setConversationId(data.conversation_id);
      }
      
      if (data.citations?.length) {
        setResponse(prev => prev ? { ...prev, citations: data.citations } : null);
      }
    } catch (err) {
      setChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: `抱歉，出现错误：${err instanceof Error ? err.message : '未知错误'}` 
      }]);
    }
  };

  if (!breakpoint) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <div className="text-center animate-fade-in">
          <div className="w-20 h-20 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
            <span className="text-4xl">🎯</span>
          </div>
          <p className="text-lg font-medium text-gray-600 mb-1">选择一个困惑点</p>
          <p className="text-sm">点击时间轴上的红点开始学习</p>
        </div>
      </div>
    );
  }

  const loading = isLoading || externalLoading;

  return (
    <div className="h-full flex flex-col">
      {/* 断点信息 */}
      <div className="p-4 border-b border-gray-100 bg-gradient-to-r from-rose-50 to-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${breakpoint.resolved ? 'bg-emerald-400' : 'bg-rose-500 animate-pulse'}`} />
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {formatTimestamp(breakpoint.timestamp)} 的困惑点
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {breakpoint.resolved ? '✅ 已解决' : '🔴 待解决'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ModelSelector value={selectedModel} onChange={setSelectedModel} />
            {!breakpoint.resolved && (
              <button
                onClick={onResolve}
                className="btn btn-primary px-4 py-2 text-sm"
              >
                ✓ 我懂了
              </button>
            )}
          </div>
        </div>
        
        {/* 功能开关 */}
        <div className="mt-3 flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer group">
            <input
              type="checkbox"
              checked={enableGuidance}
              onChange={(e) => setEnableGuidance(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-rose-500 focus:ring-rose-400"
            />
            <span className="group-hover:text-gray-900 transition-colors">🎯 引导提问</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer group">
            <input
              type="checkbox"
              checked={enableWeb}
              onChange={(e) => setEnableWeb(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-rose-500 focus:ring-rose-400"
            />
            <span className="group-hover:text-gray-900 transition-colors">🌐 联网搜索</span>
          </label>
          
          {response?.usage && (
            <span className="ml-auto text-xs text-gray-400">
              {response.model} · {response.usage.totalTokens} tokens
            </span>
          )}
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-5" style={{ minHeight: 0 }}>
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
            {/* 老师原话 */}
            <Section icon="📚" title="老师是这样讲的">
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                <p className="text-sm text-gray-700 italic leading-relaxed">
                  "{response.explanation.teacherSaid}"
                </p>
                {response.explanation.citation.timeRange !== '00:00-00:00' && (
                  <button className="mt-3 inline-flex items-center gap-1.5 text-xs text-amber-700 hover:text-amber-800 transition-colors">
                    <span>🔊</span>
                    <span>引用 {response.explanation.citation.timeRange}</span>
                  </button>
                )}
              </div>
            </Section>

            {/* 可能卡住的点 */}
            <Section icon="🤔" title="你可能卡在这里">
              <ul className="space-y-2">
                {response.explanation.possibleStuckPoints.map((point, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                    <span className="w-5 h-5 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </Section>

            {/* 追问 */}
            <Section icon="💬" title="让我问你一个问题">
              <div className="bg-accent-50 border border-accent-100 rounded-xl p-4">
                <p className="text-sm text-gray-700">{response.explanation.followUpQuestion}</p>
              </div>
            </Section>

            {/* 引导问题 */}
            {enableGuidance && (
              <Section icon="🎯" title="帮我定位你的问题" badge="AI 引导">
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
                    <p className="text-xs mt-1 text-gray-400">需要配置 Dify API Key</p>
                  </div>
                )}
              </Section>
            )}

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
                          <span className="text-xs text-rose-600">
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

            {/* 行动清单 */}
            <Section icon="✅" title="今晚行动清单">
              <div className="space-y-2">
                {response.actionItems.map((item) => (
                  <div 
                    key={item.id}
                    className="action-item"
                  >
                    <input 
                      type="checkbox" 
                      className="action-checkbox"
                      defaultChecked={item.completed}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          item.type === 'replay' ? 'bg-blue-100 text-blue-700' :
                          item.type === 'exercise' ? 'bg-emerald-100 text-emerald-700' :
                          'bg-purple-100 text-purple-700'
                        }`}>
                          {item.type === 'replay' ? '回放' : item.type === 'exercise' ? '练习' : '复习'}
                        </span>
                        <span className="text-sm font-medium text-gray-900">{item.title}</span>
                        <span className="text-xs text-gray-400">{item.estimatedMinutes}分钟</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* 对话历史 */}
            {chatHistory.length > 0 && (
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
                    <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* 输入框 */}
      <div className="p-4 border-t border-gray-100 bg-white">
        <div className="flex gap-2">
          <input
            type="text"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="告诉我你哪里不懂..."
            className="input"
          />
          <button
            onClick={handleSend}
            disabled={!userInput.trim() || loading}
            className="btn btn-primary px-6 disabled:opacity-50"
          >
            发送
          </button>
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
          <span className="text-xs font-normal text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">
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
