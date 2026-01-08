'use client';

import { useState, useEffect, useCallback } from 'react';
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
  segments: Segment[];  // 课堂转录片段
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
  // 新增 Dify 字段
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
  
  // 新增：Dify 功能开关
  const [enableGuidance, setEnableGuidance] = useState(true);
  const [enableWeb, setEnableWeb] = useState(true);
  const [selectedOptionId, setSelectedOptionId] = useState<string | undefined>();
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [isGuidanceLoading, setIsGuidanceLoading] = useState(false);

  // 检查 Open Notebook 服务
  useEffect(() => {
    notebookService.isAvailable().then(setNotebookAvailable);
  }, []);

  // 语义搜索相关内容
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) return;
    
    setIsSearching(true);
    try {
      let results: SearchResult[];
      
      if (notebookAvailable) {
        // 使用 Open Notebook 向量搜索
        results = await notebookService.search(query, { limit: 5 });
      } else {
        // 降级到本地搜索
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

  // 当断点变化时，调用 AI 解释
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
          // 新增：Dify 功能参数
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

  // 处理引导问题选择
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
      
      // 添加到对话历史
      setChatHistory(prev => [
        ...prev,
        { role: 'user', content: `我选择了：${option.text}` },
        { role: 'assistant', content: data.rawContent || '让我针对你的选择进一步解释...' },
      ]);
      
      // 更新会话 ID
      if (data.conversation_id) {
        setConversationId(data.conversation_id);
      }
      
      // 如果有新的引导问题，更新响应
      if (data.guidance_question) {
        setResponse(prev => prev ? { ...prev, guidance_question: data.guidance_question } : null);
        setSelectedOptionId(undefined); // 重置选择状态
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

  // 发送追问
  const handleSend = async () => {
    if (!userInput.trim() || !breakpoint) return;
    
    const question = userInput.trim();
    setUserInput('');
    
    // 添加用户消息
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
          // 新增：Dify 功能参数
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
      
      // 添加 AI 响应
      setChatHistory(prev => [...prev, { 
        role: 'assistant', 
        content: data.rawContent || data.explanation.followUpQuestion 
      }]);
      
      // 更新会话 ID
      if (data.conversation_id) {
        setConversationId(data.conversation_id);
      }
      
      // 如果有新的引用，更新
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
        <div className="text-center">
          <div className="text-4xl mb-3">🎯</div>
          <p>选择一个断点开始学习</p>
          <p className="text-sm mt-1">点击时间轴上的红点</p>
        </div>
      </div>
    );
  }

  const loading = isLoading || externalLoading;

  return (
    <div className="h-full flex flex-col">
      {/* 断点信息 + 模型选择 */}
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${breakpoint.resolved ? 'bg-green-500' : 'bg-red-500'}`} />
            <div>
              <p className="text-sm font-medium text-gray-900">
                {formatTimestamp(breakpoint.timestamp)} 的困惑点
              </p>
              <p className="text-xs text-gray-500">
                {breakpoint.resolved ? '已解决' : '待解决'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ModelSelector 
              value={selectedModel} 
              onChange={setSelectedModel} 
            />
            {!breakpoint.resolved && (
              <button
                onClick={onResolve}
                className="px-3 py-1.5 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
              >
                标记为已懂
              </button>
            )}
          </div>
        </div>
        
        {/* 显示模型信息 */}
        {response?.usage && (
          <div className="mt-2 text-xs text-gray-400">
            模型: {response.model} | 
            Token: {response.usage.totalTokens}
          </div>
        )}
        
        {/* 功能开关 */}
        <div className="mt-3 flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={enableGuidance}
              onChange={(e) => setEnableGuidance(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>🎯 引导提问</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={enableWeb}
              onChange={(e) => setEnableWeb(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>🌐 联网搜索</span>
          </label>
        </div>
      </div>

      {/* AI 解释内容 */}
      <div className="flex-1 overflow-y-auto p-4" style={{ minHeight: 0 }}>
        {error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-4xl mb-3">⚠️</div>
              <p className="text-red-500 mb-2">{error}</p>
              <button
                onClick={explainBreakpoint}
                className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600"
              >
                重试
              </button>
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full mx-auto mb-3" />
              <p className="text-gray-500">AI 正在分析...</p>
              <p className="text-xs text-gray-400 mt-1">使用 {selectedModel}</p>
            </div>
          </div>
        ) : response ? (
          <div className="space-y-6">
            {/* 老师原话 */}
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                <span>📚</span> 老师是这样讲的
              </h3>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-sm text-gray-700 italic">
                  "{response.explanation.teacherSaid}"
                </p>
                {response.explanation.citation.timeRange !== '00:00-00:00' && (
                  <button className="mt-2 inline-flex items-center gap-1 text-xs text-amber-700 hover:text-amber-800">
                    <span>🔊</span>
                    <span>引用 {response.explanation.citation.timeRange}</span>
                  </button>
                )}
              </div>
            </section>

            {/* 可能卡住的点 */}
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                <span>🤔</span> 你可能卡在这里
              </h3>
              <ul className="space-y-2">
                {response.explanation.possibleStuckPoints.map((point, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                    <span className="text-primary-500">•</span>
                    {point}
                  </li>
                ))}
              </ul>
            </section>

            {/* 追问 */}
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                <span>💬</span> 让我问你一个问题
              </h3>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-gray-700">
                {response.explanation.followUpQuestion}
              </div>
            </section>

            {/* 引导问题（Dify 返回） */}
            {enableGuidance && (
              <section>
                <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <span>🎯</span> 帮我定位你的问题
                  <span className="text-xs font-normal text-indigo-600">(AI 引导)</span>
                </h3>
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
                  <div className="bg-gray-50 rounded-lg p-4 text-center text-sm text-gray-500">
                    <p>引导问题生成中...</p>
                    <p className="text-xs mt-1">需要配置 Dify API Key</p>
                  </div>
                )}
              </section>
            )}

            {/* 联网搜索结果（Dify 返回） */}
            {enableWeb && response.citations && response.citations.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <span>🌐</span> 联网搜索结果
                  <span className="text-xs font-normal text-green-600">(实时检索)</span>
                </h3>
                <Citations citations={response.citations} />
              </section>
            )}

            {/* 语义搜索 */}
            {notebookAvailable && (
              <section>
                <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <span>🔍</span> 知识库搜索
                  <span className="text-xs font-normal text-green-600">(Open Notebook)</span>
                </h3>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    placeholder="搜索相关知识..."
                    className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                    className="px-3 py-1.5 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50"
                  >
                    {isSearching ? '搜索中...' : '搜索'}
                  </button>
                </div>
                {searchResults.length > 0 && (
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {searchResults.map((result) => (
                      <div key={result.id} className="p-2 bg-gray-50 rounded-lg text-sm">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-gray-500">{result.source}</span>
                          <span className="text-xs text-primary-600">
                            相似度: {Math.round(result.score * 100)}%
                          </span>
                        </div>
                        <p className="text-gray-700 line-clamp-2">{result.content}</p>
                        {result.metadata?.timestamp && (
                          <span className="text-xs text-gray-400">
                            {formatTimestamp(result.metadata.timestamp)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* 行动清单 */}
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                <span>✅</span> 今晚行动清单
              </h3>
              <div className="space-y-2">
                {response.actionItems.map((item) => (
                  <div 
                    key={item.id}
                    className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg"
                  >
                    <input 
                      type="checkbox" 
                      className="mt-1 w-4 h-4 rounded border-gray-300"
                      defaultChecked={item.completed}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          item.type === 'replay' ? 'bg-blue-100 text-blue-700' :
                          item.type === 'exercise' ? 'bg-green-100 text-green-700' :
                          'bg-purple-100 text-purple-700'
                        }`}>
                          {item.type === 'replay' ? '回放' : item.type === 'exercise' ? '练习' : '复习'}
                        </span>
                        <span className="text-sm font-medium">{item.title}</span>
                        <span className="text-xs text-gray-400">{item.estimatedMinutes}分钟</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 对话历史 */}
            {chatHistory.length > 0 && (
              <div className="space-y-3 pt-4 border-t border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900">对话记录</h3>
                {chatHistory.map((msg, i) => (
                  <div 
                    key={i} 
                    className={`p-3 rounded-lg text-sm ${
                      msg.role === 'user' 
                        ? 'bg-primary-50 text-primary-900 ml-8' 
                        : 'bg-gray-50 text-gray-700 mr-8'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* 输入框 */}
      <div className="p-4 border-t border-gray-200">
        <div className="flex gap-2">
          <input
            type="text"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="告诉我你哪里不懂..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <button
            onClick={handleSend}
            disabled={!userInput.trim() || loading}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            发送
          </button>
        </div>
        <div className="flex gap-2 mt-2">
          <QuickReply text="我不理解这个公式" onClick={setUserInput} />
          <QuickReply text="能举个例子吗？" onClick={setUserInput} />
          <QuickReply text="你是什么模型" onClick={setUserInput} />
          <QuickReply text="我懂了！" onClick={setUserInput} />
        </div>
      </div>
    </div>
  );
}

function QuickReply({ text, onClick }: { text: string; onClick: (text: string) => void }) {
  return (
    <button
      onClick={() => onClick(text)}
      className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
    >
      {text}
    </button>
  );
}
