'use client';

import { useState, useRef } from 'react';
import { useSimpleSSEStream } from '@/lib/hooks/useSSEStream';

interface ReflectionGeneratorProps {
  lessonInfo: {
    subject: string;
    teacher: string;
    duration: number;
    date: string;
  };
  hotspots: Array<{
    timeRange: string;
    count: number;
    content: string;
    possibleReason: string;
  }>;
  onGenerate?: () => void;
}

export function ReflectionGenerator({ lessonInfo, hotspots, onGenerate }: ReflectionGeneratorProps) {
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  
  // 使用统一的 SSE Hook
  const {
    fetchStream,
    stopStream,
    isStreaming: isGenerating,
    streamingContent: streamedText,
    clearContent,
  } = useSimpleSSEStream();

  // 构建 AI 提示词
  const buildPrompt = () => {
    const hotspotsText = hotspots.length > 0
      ? hotspots.map((h, i) => 
          `${i + 1}. 时间段 ${h.timeRange}：${h.content}\n   - 困惑人数：${h.count}人\n   - 可能原因：${h.possibleReason}`
        ).join('\n\n')
      : '本节课没有记录到明显的困惑点。';

    return `你是一位资深教学顾问。请根据以下课堂数据，生成一份简洁、实用的教学反思报告。

【课堂信息】
- 学科：${lessonInfo.subject}
- 教师：${lessonInfo.teacher}
- 时长：${Math.floor(lessonInfo.duration / 60000)} 分钟
- 日期：${lessonInfo.date}

【学生困惑热点 TOP${hotspots.length}】
${hotspotsText}

请按以下格式输出（使用 emoji 作为标题前缀）：

📋 课堂总结
（2-3句话概括本节课的整体情况）

✨ 教学亮点
• （列出2-3个亮点）

⚠️ 问题分析
• （基于困惑热点数据，分析具体问题）

💡 改进建议
• （给出3条具体可操作的改进建议）

要求：
1. 语言简洁专业，避免空话套话
2. 建议要具体可操作，针对本节课的实际问题
3. 总字数控制在 300-400 字`;
  };

  // 调用 AI 流式生成
  const generateReflection = async () => {
    clearContent();
    setIsComplete(false);
    setError(null);
    onGenerate?.();

    try {
      await fetchStream('/api/chat', {
        messages: [
          { role: 'user', content: buildPrompt() }
        ],
        model: 'qwen3-max-2026-01-23',
        stream: true,
        temperature: 0.7,
        maxTokens: 1000,
      }, {
        onContent: () => {
          // 滚动到底部
          requestAnimationFrame(() => {
            if (contentRef.current) {
              contentRef.current.scrollTop = contentRef.current.scrollHeight;
            }
          });
        },
      });
      
      setIsComplete(true);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // 用户取消，不显示错误
        return;
      }
      console.error('生成反思失败:', err);
      setError(err instanceof Error ? err.message : '生成失败，请重试');
    }
  };

  // 停止生成
  const stopGeneration = () => {
    stopStream();
    setIsComplete(true);
  };

  // 复制到剪贴板
  const copyToClipboard = async () => {
    if (streamedText) {
      try {
        await navigator.clipboard.writeText(streamedText);
        // 可以添加一个 toast 提示
      } catch (err) {
        console.error('复制失败:', err);
      }
    }
  };

  const hasContent = streamedText.length > 0;

  return (
    <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl border border-slate-200/50 overflow-hidden">
      {/* 头部 */}
      <div className="px-6 py-5 bg-gradient-to-r from-slate-800 via-slate-900 to-indigo-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center">
              <span className="text-xl">📝</span>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">课后反思</h3>
              <p className="text-sm text-slate-400">AI 智能生成教学反思报告</p>
            </div>
          </div>
          
          {isGenerating ? (
            <button
              onClick={stopGeneration}
              className="px-5 py-2.5 rounded-xl font-medium text-sm bg-red-500 text-white shadow-lg shadow-red-500/30 hover:bg-red-600 transition-all"
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                停止生成
              </span>
            </button>
          ) : (
            <button
              onClick={generateReflection}
              className="px-5 py-2.5 rounded-xl font-medium text-sm bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/30 hover:shadow-amber-500/50 hover:scale-105 active:scale-95 transition-all"
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {hasContent ? '重新生成' : '一键生成'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* 内容区 */}
      <div className="p-6">
        {!hasContent && !isGenerating && !error ? (
          // 空状态
          <div className="text-center py-12">
            <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-50 flex items-center justify-center">
              <span className="text-4xl opacity-50">🤖</span>
            </div>
            <h4 className="text-lg font-medium text-slate-700 mb-2">准备生成教学反思</h4>
            <p className="text-sm text-slate-500 max-w-sm mx-auto">
              AI 将根据本节课的 {hotspots.length} 个困惑热点，为您生成结构化的教学反思和改进建议
            </p>
          </div>
        ) : error ? (
          // 错误状态
          <div className="text-center py-12">
            <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-red-50 flex items-center justify-center">
              <span className="text-4xl">😕</span>
            </div>
            <h4 className="text-lg font-medium text-red-700 mb-2">生成失败</h4>
            <p className="text-sm text-red-500 max-w-sm mx-auto mb-4">{error}</p>
            <button
              onClick={generateReflection}
              className="px-4 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 transition-colors"
            >
              重试
            </button>
          </div>
        ) : (
          // 反思内容（流式显示）
          <div 
            ref={contentRef}
            className="min-h-[300px] max-h-[400px] overflow-y-auto pr-2"
            style={{ scrollBehavior: 'smooth' }}
          >
            <div className="prose prose-slate prose-sm max-w-none">
              <pre className="whitespace-pre-wrap font-sans text-slate-700 leading-relaxed text-sm bg-transparent p-0 m-0">
                {streamedText}
                {isGenerating && (
                  <span className="inline-block w-0.5 h-4 bg-amber-500 animate-pulse ml-0.5 align-middle" />
                )}
              </pre>
            </div>
          </div>
        )}

        {/* 底部操作栏 */}
        {hasContent && isComplete && (
          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
            <div className="text-xs text-slate-400">
              ✨ 由 AI 生成于 {new Date().toLocaleTimeString('zh-CN')}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={copyToClipboard}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                复制
              </button>
              <button
                onClick={generateReflection}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                重新生成
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
