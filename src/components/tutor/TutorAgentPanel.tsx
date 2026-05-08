'use client';

/**
 * TutorAgentPanel — 使用 Vercel AI SDK v6 useChat 的 Tutor 交互面板（M6.5）
 *
 * 和 AITutor.tsx 并存，通过 NEXT_PUBLIC_TUTOR_AGENT_ENABLED feature flag 切换。
 *
 * 为什么不直接改 AITutor.tsx？
 *   - 1700+ 行的 SSE 自定义协议（breakpoint / guidance / parsedResponse）
 *   - useChat 的 UIMessage 模型 ≠ 现有 TutorChatMessage 模型
 *   - 灰度策略：flag=false → 老路径；flag=true → 新路径
 *
 * 设计：
 *   - 最小完整面板：输入框 + 消息流 + 工具卡片（TutorToolCard）
 *   - 保留关键输入：sessionId / transcript / subject，透传给 /api/tutor/agent
 *   - 不处理 guidance/actionItems/citations——那些是老 endpoint 特有，新 agent
 *     通过 lookupTranscript 工具直接返回 `[t=MM:SS]` 嵌在文本里
 */

import * as React from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { TutorToolCard } from './TutorToolCard';
import type { TutorToolPartLike } from './tutor-tool-card-utils';
import { splitByTimestamp } from './timestamp-parsing';
import { SkillChipRow } from './SkillChipRow';
import { cn } from '@/lib/utils';

export interface TutorAgentPanelTranscriptSegment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface TutorAgentPanelProps {
  sessionId: string;
  transcript: TutorAgentPanelTranscriptSegment[];
  subject?: string;
  className?: string;
  /** 访客模式不带 JWT；登录模式传 token 用于热词/鉴权 */
  authToken?: string;
  /** 点击 [t=MM:SS] 时把播放器跳转到该毫秒；父组件接 player.seek */
  onSeek?: (timeMs: number) => void;
}

/**
 * SkillChipRow + SKILL_PROMPTS 已提取到 ./skill-prompts.tsx，
 * 供 TutorAgentPanel 和 ClassroomCompanionPanel 共用——保证产品任意位置
 * "速查表 / 闪卡 / 测验 / 思维导图 / 薄弱点 / 再讲一遍" 的语义一致。
 */
function RenderTimestampedText({
  text,
  onSeek,
}: {
  text: string;
  onSeek?: (ms: number) => void;
}) {
  const parts = React.useMemo(() => splitByTimestamp(text), [text]);
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === 'text') return <span key={i}>{p.text}</span>;
        return (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSeek?.(p.startMs);
            }}
            disabled={!onSeek}
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md text-xs font-mono',
              'border border-slate-300 bg-white text-slate-700',
              onSeek
                ? 'hover:bg-slate-900 hover:text-white hover:border-slate-900 cursor-pointer transition-colors'
                : 'cursor-default opacity-60',
            )}
            title={onSeek ? `跳转到 ${p.display}` : p.display}
          >
            <span aria-hidden="true">▶</span>
            {p.display}
          </button>
        );
      })}
    </>
  );
}

export function TutorAgentPanel({
  sessionId,
  transcript,
  subject,
  className,
  authToken,
  onSeek,
}: TutorAgentPanelProps) {
  const [input, setInput] = React.useState('');

  // DefaultChatTransport 允许把非标字段一起发到 body（sessionId / transcript / subject）
  const transport = React.useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/tutor/agent',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        body: () => ({
          sessionId,
          transcript,
          subject: subject ?? '',
        }),
      }),
    [authToken, sessionId, transcript, subject],
  );

  const { messages, sendMessage, status, error, stop } = useChat({ transport });

  const busy = status === 'submitted' || status === 'streaming';

  const onSubmit = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || busy) return;
      sendMessage({ text });
      setInput('');
    },
    [input, busy, sendMessage],
  );

  const onPickSkill = React.useCallback(
    (prompt: string) => {
      if (busy) return;
      // 直接发送——减少犹豫，也避免 input 预填后用户误编辑
      sendMessage({ text: prompt });
    },
    [busy, sendMessage],
  );

  return (
    <div
      className={cn(
        'flex h-full flex-col bg-white text-slate-900',
        className,
      )}
      role="log"
      aria-live="polite"
      aria-label="AI 同桌对话"
    >
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="pt-6">
            <div className="text-sm text-slate-500 text-center">
              AI 同桌在这里。挑一个直接开始，也可以在下方直接问。
            </div>
            <SkillChipRow onPick={onPickSkill} onSay={onPickSkill} disabled={busy} />
          </div>
        ) : null}

        {messages.map((m) => {
          const parts = (m.parts ?? []) as Array<Record<string, unknown>>;
          return (
            <div
              key={m.id}
              className={cn(
                'flex',
                m.role === 'user' ? 'justify-end' : 'justify-start',
              )}
            >
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words',
                  m.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-md'
                    : 'bg-slate-100 text-slate-800 rounded-bl-md',
                )}
              >
                {parts.length > 0
                  ? parts.map((part, idx) => {
                      const partType = typeof part.type === 'string' ? part.type : '';
                      if (partType === 'text') {
                        const txt = typeof part.text === 'string' ? part.text : '';
                        return (
                          <RenderTimestampedText key={idx} text={txt} onSeek={onSeek} />
                        );
                      }
                      if (partType.startsWith('tool-')) {
                        return (
                          <TutorToolCard
                            key={idx}
                            part={part as unknown as TutorToolPartLike}
                          />
                        );
                      }
                      // reasoning / 其他 part：静默忽略，不干扰对话
                      return null;
                    })
                  : // 老版本兼容（content 字段）
                    (() => {
                      const content = (m as unknown as { content?: string }).content ?? '';
                      return <RenderTimestampedText text={content} onSeek={onSeek} />;
                    })()}
              </div>
            </div>
          );
        })}

        {error ? (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            出错了：{error.message ?? '未知错误'}
          </div>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="border-t border-slate-200 p-3 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          placeholder={busy ? '同桌在想…' : '问点什么…'}
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
          aria-label="向 AI 同桌提问"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            停
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            发送
          </button>
        )}
      </form>
    </div>
  );
}
