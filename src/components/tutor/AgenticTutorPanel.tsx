'use client';

/**
 * AgenticTutorPanel — Manus 风格的 Agentic Tutor UI
 *
 * 核心体验：用户看到 AI 在"真的思考"——
 * 不是等一个 loading spinner，而是看到一步步的过程：
 * "查看学过哪些科目" → "查看概率论的课堂记录" → "查看这节课的学习痕迹" → 最终回答
 *
 * 设计系统：零渐变、零阴影、纯平涂
 */

import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Search, BookOpen, Brain, FileText } from 'lucide-react';
import { useAgenticTutor, type AgentStep, type AgenticTutorMessage } from '@/hooks/useAgenticTutor';
import { useAuth } from '@/lib/hooks/useAuth';

// ── 思考步骤图标 ──

function StepIcon({ step }: { step: AgentStep }) {
  if (step.type === 'thinking') return <Brain size={13} strokeWidth={1.5} />;
  if (step.toolName === 'list_subjects') return <BookOpen size={13} strokeWidth={1.5} />;
  if (step.toolName === 'list_captures') return <Search size={13} strokeWidth={1.5} />;
  if (step.toolName === 'get_personal_context') return <Brain size={13} strokeWidth={1.5} />;
  if (step.toolName === 'read_transcript') return <FileText size={13} strokeWidth={1.5} />;
  return <Search size={13} strokeWidth={1.5} />;
}

// ── 思考步骤条 ──

function AgentStepsTrail({ steps, isLive }: { steps: AgentStep[]; isLive: boolean }) {
  if (steps.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 py-2">
      {steps.map((step, index) => (
        <div
          key={step.id}
          className="flex items-center gap-2 animate-fade-in"
          style={{ animationDelay: `${index * 80}ms` }}
        >
          <div
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md"
            style={{
              backgroundColor: step.type === 'tool_result' ? '#D1F4E0' : '#F7F7F5',
              color: step.type === 'tool_result' ? '#1A7F43' : '#787774',
            }}
          >
            {step.type === 'tool_result' ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <StepIcon step={step} />
            )}
          </div>
          <span
            className="text-[12px] leading-4"
            style={{ color: step.type === 'tool_result' ? '#787774' : '#232322' }}
          >
            {step.message}
          </span>
        </div>
      ))}
      {isLive && (
        <div className="flex items-center gap-2 pl-0.5">
          <Loader2 size={14} className="animate-spin text-[#A3A39E]" />
          <span className="text-[12px] text-[#A3A39E]">思考中...</span>
        </div>
      )}
    </div>
  );
}

// ── 消息气泡 ──

function MessageBubble({ message }: { message: AgenticTutorMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      {/* 思考步骤（仅 assistant 消息，折叠显示） */}
      {!isUser && message.steps && message.steps.length > 0 && (
        <details className="w-full max-w-[85%]">
          <summary className="cursor-pointer text-[11px] text-[#A3A39E] hover:text-[#787774] transition-colors py-1">
            思考了 {message.steps.length} 步
          </summary>
          <div className="mt-1 rounded-xl border border-[#E9E9E7] bg-[#F7F7F5] px-3 py-2">
            <AgentStepsTrail steps={message.steps} isLive={false} />
          </div>
        </details>
      )}

      {/* 消息内容 */}
      <div
        className="max-w-[85%] rounded-2xl px-4 py-3"
        style={{
          backgroundColor: isUser ? '#232322' : '#FFFFFF',
          color: isUser ? '#FFFFFF' : '#232322',
          border: isUser ? 'none' : '1px solid #E9E9E7',
        }}
      >
        <p className="text-[14px] leading-[1.7] whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  );
}

// ── 主面板 ──

export function AgenticTutorPanel() {
  const { accessToken } = useAuth();
  const { messages, isLoading, currentSteps, error, sendMessage, clearMessages } = useAgenticTutor(accessToken);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, currentSteps]);

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    void sendMessage(text);
  };

  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: '#F7F7F5' }}>
      {/* 头部 */}
      <div className="flex-shrink-0 border-b border-[#E9E9E7] bg-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: '#D3E4F4' }}>
              <Brain size={14} strokeWidth={1.5} style={{ color: '#1E5F8A' }} />
            </div>
            <div>
              <span className="text-[14px] font-medium" style={{ color: '#232322' }}>AI 同桌</span>
              <span className="ml-1.5 text-[11px] rounded-full border border-[#E9E9E7] px-1.5 py-0.5" style={{ color: '#A3A39E' }}>
                Agentic
              </span>
            </div>
          </div>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearMessages}
              className="text-[12px] transition-colors hover:underline"
              style={{ color: '#A3A39E' }}
            >
              新对话
            </button>
          )}
        </div>
      </div>

      {/* 消息区 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-2xl flex flex-col gap-4">
          {messages.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl" style={{ backgroundColor: '#D3E4F4' }}>
                <Brain size={24} strokeWidth={1.2} style={{ color: '#1E5F8A' }} />
              </div>
              <p className="mt-4 text-[15px] font-medium" style={{ color: '#232322' }}>
                问我任何学习上的问题
              </p>
              <p className="mt-1.5 text-center text-[13px] leading-5" style={{ color: '#A3A39E' }}>
                我会翻你的学习记录找到最相关的内容
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* 实时思考步骤 */}
          {isLoading && currentSteps.length > 0 && (
            <div className="rounded-xl border border-[#E9E9E7] bg-white px-4 py-3">
              <AgentStepsTrail steps={currentSteps} isLive />
            </div>
          )}

          {/* 纯 loading（还没有步骤时） */}
          {isLoading && currentSteps.length === 0 && (
            <div className="flex items-center gap-2 py-2">
              <Loader2 size={16} className="animate-spin text-[#A3A39E]" />
              <span className="text-[13px]" style={{ color: '#A3A39E' }}>正在连接...</span>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-[#FADEC9] px-4 py-3" style={{ backgroundColor: '#FADEC9', color: '#9A4A12' }}>
              <p className="text-[13px]">{error}</p>
            </div>
          )}
        </div>
      </div>

      {/* 输入栏 */}
      <div className="flex-shrink-0 border-t border-[#E9E9E7] bg-white px-4 py-3">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-end gap-2 rounded-2xl border border-[#E9E9E7] bg-[#F7F7F5] px-3 py-2 transition-all focus-within:border-[#232322]/20">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="问一个学习上的问题..."
              rows={1}
              className="min-h-[24px] max-h-20 flex-1 resize-none bg-transparent text-[14px] leading-6 outline-none placeholder:text-[#A3A39E]"
              style={{ color: '#232322' }}
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!input.trim() || isLoading}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-30"
              style={{ backgroundColor: '#232322', color: '#FFFFFF' }}
            >
              {isLoading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Send size={15} strokeWidth={2} />
              )}
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out both;
        }
      `}</style>
    </div>
  );
}

export default AgenticTutorPanel;
