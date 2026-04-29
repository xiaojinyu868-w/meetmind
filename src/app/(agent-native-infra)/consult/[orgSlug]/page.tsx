'use client';

/**
 * /consult/[orgSlug] — 学生端对话
 *
 * 2026 agent UX 原则（参考 Perplexity Pro / Claude artifacts / 字节豆包）：
 *   - 单列秩序感，空间呼吸
 *   - Agent 后台动作汇聚成 Activity Timeline，不散落成孤立徽标
 *   - 层级：prose < askOptions < fileUpload < showOutreachWorkspace < showDraft < ctaWechat
 *   - 思考态用顶部 1px shimmer，不用旋转 loading
 *   - runtime 切换移入右上 overflow，对学生默认隐藏（演示时可开）
 *
 * 同一个 assistant message 内的 tool-part 按类型分流：
 *   - 能力块（webSearch/searchProgramRequirements/readProfile/writeProfile）→ 聚合到 Timeline
 *   - UI 块（askOptions/showOutreachWorkspace/showDraft/ctaWechat/fileUpload）→ 按顺序渲染成工作界面/卡
 *   - text-delta → 渲染成 prose 气泡
 *
 * 时序：UI 块和 prose 在时间线下方依序显示，保留空间顺序，避免学生感到"跳跃"。
 */

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useEffect } from 'react';
import { Button } from '@/components/academic/primitives';
import {
  AskOptionsBlock, ShowDraftBlock, ShowOutreachWorkspaceBlock, CtaWechatBlock, FileUploadBlock, StartVoiceCallBlock,
} from '@/components/consult/blocks';
import { ConsultComposer, type ConsultComposerHandle } from '@/components/consult/consult-composer';
import { AdvisorDiscoveryBlock } from '@/components/consult/advisor-discovery';
import { ConsultantMoveBlock } from '@/components/consult/consultant-move';
import { ServicePlanBlock } from '@/components/consult/service-plan';
import { ActivityTimeline, type TimelineItem } from '@/components/consult/activity-timeline';
import { PendingAssistantSkeleton, StreamingCaret } from '@/components/consult/skeletons';
import { ConsultMarkdown } from '@/components/consult/consult-markdown';
import { PixelAgentStatus } from '@/components/consult/pixel-agent-status';
import { TextChoiceFallback } from '@/components/consult/text-choice-fallback';
import { parseInlineChoicePrompt } from '@/components/consult/text-choice-parser';
import { ConsultWorkbenchCompass } from '@/components/consult/workbench-compass';
import { AssistantTurnFrame } from '@/components/consult/assistant-turn-frame';

// ────────── hooks / utils ──────────

function useStudentKey(): string {
  const [key] = useState(() => {
    if (typeof window === 'undefined') return 'ssr';
    const existing = window.localStorage.getItem('consult-student-key');
    if (existing) return existing;
    const k = 'stu_' + Math.random().toString(36).slice(2, 10);
    window.localStorage.setItem('consult-student-key', k);
    return k;
  });
  return key;
}

const CAPABILITY_TOOLS = new Set(['webSearch', 'searchProgramRequirements', 'readProfile', 'writeProfile', 'useSkill']);

/**
 * 是否要显示"AI 正在准备"的骨架。
 *
 * 触发条件（任一成立）：
 *   A. 最后一条是 user → 第一次 POST，assistant 还没 start
 *   B. 最后一条是 assistant 但 parts 空 → start 到了但 reasoning/text 还没来
 *   C. 最后一条是 assistant 且**最后一个 part 是已完成的工具**
 *      （output-available / output-error）→ 典型的"用户点完选项，后台在准备下一步"
 *
 * 不显示的条件：
 *   - 未在流式中
 *   - 最后一个 part 是 text / reasoning（正在流，已经可见）
 *   - 最后一个 part 是 tool input-streaming / input-available
 *     （timeline 上 RotatingHint 已经在跳，不需要额外 skeleton）
 */
function shouldShowPendingSkeleton(messages: UIMessage[], streaming: boolean): boolean {
  if (!streaming) return false;
  if (messages.length === 0) return false;
  const last = messages[messages.length - 1];
  if (last.role === 'user') return true;
  if (last.role !== 'assistant') return false;
  const parts = last.parts ?? [];
  if (parts.length === 0) return true;
  const tail = parts[parts.length - 1];
  if (!tail) return true;
  if (typeof tail.type === 'string' && tail.type.startsWith('tool-')) {
    const s = (tail as { state?: string }).state;
    return s === 'output-available' || s === 'output-error';
  }
  if (tail.type === 'reasoning') return true;
  // text / 其它：认为"已在可见流"，不重叠显示 skeleton
  return false;
}

function findLatestToolCallId(messages: UIMessage[], toolName: string): string | null {
  let latest: string | null = null;
  const targetType = `tool-${toolName}`;

  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const candidate = part as { type?: unknown; toolCallId?: unknown };
      if (candidate.type === targetType && typeof candidate.toolCallId === 'string') {
        latest = candidate.toolCallId;
      }
    }
  }

  return latest;
}

function findLatestDraftToolCallId(messages: UIMessage[], kind: string): string | null {
  let latest: string | null = null;

  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const candidate = part as { type?: unknown; toolCallId?: unknown; input?: unknown };
      const input = candidate.input as { kind?: unknown } | undefined;
      if (
        candidate.type === 'tool-showDraft' &&
        typeof candidate.toolCallId === 'string' &&
        input?.kind === kind
      ) {
        latest = candidate.toolCallId;
      }
    }
  }

  return latest;
}

interface ScenarioMeta { name: string; description: string }

const SCENARIO_LABEL: Record<string, string> = {
  'application-materials': '申请材料',
  'application-positioning': '申请定位',
  'cold-email-draft': '套磁起草',
  'cv-diagnose': 'CV 诊断',
  'mock-interview': '模拟面试',
  'school-program-shortlist': '项目短名单',
};

interface StarterPrompt {
  label: string;
  text: string;
  hint: string;
}

const INTENT_STARTERS: StarterPrompt[] = [
  {
    label: '我只有背景，不知道怎么走',
    text: '我先把我的背景发给你：。我还没有明确目标，你先像真人顾问一样判断我现在最该弄清哪件事。',
    hint: '经历 / 分数 / 项目 / 焦虑',
  },
  {
    label: '我有材料，想先被读懂',
    text: '我手上有这些材料或经历：。先不要假设我的目标，帮我看它们说明了什么、缺了什么、下一步该问我什么。',
    hint: 'CV / 项目 / 实习 / 论文',
  },
  {
    label: '我在几个方向之间摇摆',
    text: '我现在可能感兴趣的方向有：。你先帮我判断这些方向和我的背景怎么匹配，不要直接把我塞进某个申请流程。',
    hint: '方向偏好 / 犹豫点',
  },
  {
    label: '我需要一套申请准备方案',
    text: '你把我当成一个真实咨询用户来接待：先看我已有背景，问最关键的问题，再决定要不要给我从定位、材料到面试的准备方案。',
    hint: '先接待，再规划',
  },
];

// ────────── 页面 ──────────

export default function ConsultPage() {
  const params = useParams<{ orgSlug: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const orgSlug = params?.orgSlug ?? 'default';
  const studentKey = useStudentKey();
  const runtimeParam = (search?.get('runtime') ?? 'aisdk') as 'aisdk' | 'openclaw';
  const runtime: 'aisdk' | 'openclaw' = runtimeParam === 'openclaw' ? 'openclaw' : 'aisdk';

  const [scenarios, setScenarios] = useState<ScenarioMeta[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const composerRef = useRef<ConsultComposerHandle | null>(null);
  // 下一次 POST 携带的软提示 skill name（点预设卡时设置；发送一次就清空）
  const hintedSkillRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    fetch('/api/consult/scenarios')
      .then((r) => r.json())
      .then((j) => {
        if (j?.success && Array.isArray(j.data?.scenarios)) setScenarios(j.data.scenarios);
      })
      .catch(() => {});
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/consult/chat',
        // body 是一个函数：每次 sendMessage 前读 ref，保证 hintedSkill 能一次性捎带
        body: () => ({
          orgSlug,
          studentKey,
          runtime,
          hintedSkill: hintedSkillRef.current,
        }),
      }),
    [orgSlug, studentKey, runtime],
  );

  const { messages, sendMessage, status, error, addToolResult, regenerate, setMessages } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const streaming = status === 'streaming' || status === 'submitted';

  /**
   * 智能 follow：只在用户"贴近底部"时才自动滚动。
   * 一旦用户往上翻，就锁住不跟了——让学生能安心读思考过程。
   * 底部出现"↓ 回到最新"按钮，学生想回来时一键到底。
   *
   * NEAR_BOTTOM_PX：离底部 72px 以内算"贴底"，容忍一点阅读时手贱滚动
   */
  const NEAR_BOTTOM_PX = 72;
  const [followBottom, setFollowBottom] = useState(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setFollowBottom(distanceFromBottom <= NEAR_BOTTOM_PX);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!followBottom) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, status, followBottom]);

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setFollowBottom(true);
  };

  /**
   * 工具结果刚提交后的"乐观 pending" 窗口：
   * addToolResult 触发 useChat 的 sendAutomaticallyWhen → 但 status 切到 submitted 有一帧延迟。
   * 这个 flag 在学生刚点完选项 / 刚上传完文件的瞬间立刻亮起，让骨架屏无缝接力。
   * useChat 真正 streaming 后自动清零。
   */
  const [justSubmittedTool, setJustSubmittedTool] = useState(false);
  const [pendingToolCallId, setPendingToolCallId] = useState<string | null>(null);
  useEffect(() => {
    if (streaming) setJustSubmittedTool(false);
  }, [streaming]);
  useEffect(() => {
    if (!streaming && !justSubmittedTool) setPendingToolCallId(null);
  }, [streaming, justSubmittedTool]);

  const handleAddToolResult: typeof addToolResult = (args) => {
    setJustSubmittedTool(true);
    setPendingToolCallId(args.toolCallId);
    // 兜底：8s 内 useChat 没进入 streaming 也自动清，避免卡死
    setTimeout(() => {
      setJustSubmittedTool((v) => (v ? false : v));
      setPendingToolCallId((id) => (id === args.toolCallId ? null : id));
    }, 8000);
    return addToolResult(args);
  };

  /**
   * ConsultComposer 已经把附件正文 / 语音转写拼好了完整的 composedText，
   * 这里只负责一件事：把它真的发出去。
   */
  const submitComposed = (composedText: string) => {
    if (!composedText.trim() || streaming) return;
    hintedSkillRef.current = undefined;
    sendMessage({ text: composedText });
    // ConsultComposer 内部会清自己的 input + files，这里不重复 setInput('')
  };

  const switchRuntime = (r: 'aisdk' | 'openclaw') => {
    const q = new URLSearchParams();
    if (r !== 'aisdk') q.set('runtime', r);
    const qs = q.toString();
    router.push(qs ? `/consult/${orgSlug}?${qs}` : `/consult/${orgSlug}`);
    setMessages([]);
    setMenuOpen(false);
  };

  const reset = () => {
    setMessages([]);
    setMenuOpen(false);
  };

  const pickStarter = (text: string) => {
    setInput(text);
    window.setTimeout(() => {
      composerRef.current?.focus();
    }, 0);
  };

  const sendQuickReply = (text: string) => {
    if (streaming || !text.trim()) return;
    hintedSkillRef.current = undefined;
    sendMessage({ text: text.trim() });
  };

  const suggestions = INTENT_STARTERS;
  const latestVoiceToolCallId = useMemo(
    () => findLatestToolCallId(messages, 'startVoiceCall'),
    [messages],
  );
  const latestCvDiagnosisToolCallId = useMemo(
    () => findLatestDraftToolCallId(messages, 'cv-diagnosis'),
    [messages],
  );

  return (
    <div className="consult-agent-shell mx-auto flex h-screen max-w-[860px] flex-col bg-[var(--consult-bg)] text-[var(--consult-text)]">
      {/* ───── Header ───── */}
      <header className="relative z-10 flex items-center justify-between border-b border-[var(--consult-border)] bg-[var(--consult-surface)]/95 px-5 py-3 backdrop-blur">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-[var(--consult-primary)]">{orgSlug}</div>
          <h1 className="mt-0.5 text-[15px] font-medium leading-tight text-[var(--consult-text)]">AI 申请顾问</h1>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--consult-secondary)] transition hover:bg-[var(--consult-hover)] hover:text-[var(--consult-text)]"
            aria-label="菜单"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="consult-reveal absolute right-0 top-10 z-20 w-64 overflow-hidden rounded-xl border border-[var(--consult-border)] bg-[var(--consult-surface)]">
                {scenarios.length > 0 && (
                  <MenuSection label="本机构能做什么">
                    {scenarios.map((s) => (
                      <div
                        key={s.name}
                        className="px-3 py-1.5 text-[12px] text-ink-secondary"
                      >
                        <div className="font-medium text-ink">
                          {SCENARIO_LABEL[s.name] ?? s.name}
                        </div>
                        <div className="mt-0.5 text-[11px] text-ink-muted line-clamp-2">{s.description}</div>
                      </div>
                    ))}
                  </MenuSection>
                )}
                <MenuSection label="Runtime（演示用）">
                  <MenuItem active={runtime === 'aisdk'} onClick={() => switchRuntime('aisdk')}>
                    AI SDK · tool-calling
                  </MenuItem>
                  <MenuItem active={runtime === 'openclaw'} onClick={() => switchRuntime('openclaw')}>
                    OpenClaw · AG-UI
                  </MenuItem>
                </MenuSection>
                <MenuSection label="">
                  <MenuItem onClick={reset}>重置会话</MenuItem>
                </MenuSection>
              </div>
            </>
          )}
        </div>
      </header>

      {/* ───── Streaming shimmer：1px 极细顶部进度条 ───── */}
      <div
        aria-hidden="true"
        className={
          'relative h-px overflow-hidden bg-divider/0 transition-opacity ' +
          (streaming ? 'consult-shimmer opacity-100' : 'opacity-0')
        }
      />

      <ConsultWorkbenchCompass
        messages={messages}
        busy={streaming || justSubmittedTool}
        onContinue={sendQuickReply}
      />

      {/* ───── Thread ───── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[680px] px-5 py-6">
          {messages.length === 0 && (
            <EmptyState suggestions={suggestions} onPick={pickStarter} />
          )}

          <div className="space-y-5">
            {messages.map((m, idx) => {
              const isLastMessage = idx === messages.length - 1;
              const view = (
                <MessageView
                  message={m}
                  isStreamingTarget={streaming && isLastMessage && m.role === 'assistant'}
                  pendingToolCallId={pendingToolCallId}
                  pendingFollowup={justSubmittedTool || streaming}
                  latestVoiceToolCallId={latestVoiceToolCallId}
                  latestCvDiagnosisToolCallId={latestCvDiagnosisToolCallId}
                  onQuickReply={sendQuickReply}
                  addToolResult={handleAddToolResult}
                  orgSlug={orgSlug}
                  studentKey={studentKey}
                />
              );
              if (m.role !== 'assistant') return <div key={m.id}>{view}</div>;
              return (
                <AssistantTurnFrame
                  key={m.id}
                  message={m}
                  compactByDefault={!isLastMessage}
                >
                  {view}
                </AssistantTurnFrame>
              );
            })}
            {(shouldShowPendingSkeleton(messages, streaming) || justSubmittedTool) && (
              <PendingAssistantSkeleton />
            )}
          </div>

          {error && (
            <div className="consult-reveal mt-4 rounded-xl border border-rose-dark/40 bg-rose/20 p-4">
              <div className="text-[13px] font-medium text-ink">AI 顾问遇到了点问题</div>
              <div className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-secondary">
                {String(error.message ?? error).slice(0, 500)}
              </div>
              <button
                type="button"
                onClick={() => regenerate()}
                className="mt-3 rounded-lg border border-divider bg-card px-3 py-1.5 text-[12px] text-ink hover:border-ink/40"
              >
                重试
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ───── Composer ───── */}
      <div className="relative border-t border-[var(--consult-border)] bg-[var(--consult-bg)] px-5 pb-5 pt-3">
        {!followBottom && (
          <button
            type="button"
            onClick={jumpToBottom}
            className="consult-reveal absolute -top-10 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--consult-border)] bg-[var(--consult-surface)] px-3 py-1.5 text-[11.5px] text-[var(--consult-text)] transition hover:border-[var(--consult-primary)] hover:bg-[var(--consult-primary-soft)]"
            aria-label="回到最新"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M19 12l-7 7-7-7" />
            </svg>
            回到最新
          </button>
        )}
        <ConsultComposer
          ref={composerRef}
          value={input}
          onChangeValue={setInput}
          onSubmit={submitComposed}
          disabled={streaming}
          placeholder="先说背景、困惑或手上的材料；不确定目标也没关系。"
        />
      </div>
    </div>
  );
}

// ────────── Menu ──────────

function MenuSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      {label && (
        <div className="px-3 pb-1 pt-1.5 text-[10px] uppercase tracking-wider text-ink-muted">{label}</div>
      )}
      {children}
    </div>
  );
}

function MenuItem({ active, children, onClick }: { active?: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex w-full items-center justify-between px-3 py-2 text-left text-[13px] transition ' +
        (active ? 'bg-hover text-ink' : 'text-ink-secondary hover:bg-hover hover:text-ink')
      }
    >
      <span>{children}</span>
      {active && <span className="h-1.5 w-1.5 rounded-full bg-ink" />}
    </button>
  );
}

// ────────── Empty ──────────

function EmptyState({
  suggestions,
  onPick,
}: {
  suggestions: StarterPrompt[];
  onPick: (text: string) => void;
}) {
  return (
    <div className="consult-reveal flex flex-col items-center pt-8">
      <div className="rounded-xl border border-divider bg-card px-4 py-3">
        <PixelAgentStatus state="idle" label="在这儿，等你开口" size="lg" />
      </div>
      <div className="mt-4 text-[14px] font-medium text-ink">先不用选服务，讲你的真实局面</div>
      <div className="mt-1 max-w-[420px] text-center text-[12px] leading-relaxed text-ink-muted">
        可以只发背景、经历、焦虑或材料。目标还没想清也可以，我会先接待和定位，再决定问、查、写、规划或语音聊。
      </div>
      {suggestions.length > 0 && (
        <div className="mt-5 grid w-full max-w-[560px] gap-2 sm:grid-cols-2">
          {suggestions.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => onPick(s.text)}
              className="group rounded-xl border border-divider bg-card px-4 py-3 text-left transition hover:border-ink/40 hover:bg-hover active:scale-[0.98] active:bg-hover"
            >
              <span className="block text-[12.5px] font-medium leading-snug text-ink">{s.label}</span>
              <span className="mt-1 block text-[11px] leading-relaxed text-ink-muted">{s.hint}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 text-[10.5px] text-ink-muted">
        点一下只是放进输入框，你可以改完再发送。
      </div>
    </div>
  );
}

// ────────── MessageView ──────────

function MessageView({
  message,
  isStreamingTarget,
  pendingToolCallId,
  pendingFollowup,
  latestVoiceToolCallId,
  latestCvDiagnosisToolCallId,
  onQuickReply,
  addToolResult,
  orgSlug,
  studentKey,
}: {
  message: UIMessage;
  isStreamingTarget: boolean;
  pendingToolCallId: string | null;
  pendingFollowup: boolean;
  latestVoiceToolCallId: string | null;
  latestCvDiagnosisToolCallId: string | null;
  onQuickReply: (text: string) => void;
  addToolResult: (args: { tool: string; toolCallId: string; output: unknown }) => void;
  orgSlug: string;
  studentKey: string;
}) {
  const isUser = message.role === 'user';

  if (isUser) {
    // user 消息：右对齐气泡
    const text = (message.parts ?? [])
      .map((p) => (p.type === 'text' ? (p as { text?: string }).text ?? '' : ''))
      .join('');
    if (!text.trim()) return null;
    return (
      <div className="flex justify-end">
        <div className="consult-reveal max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--consult-primary)] px-4 py-2.5 text-[13.5px] leading-[1.6] text-white">
          {text}
        </div>
      </div>
    );
  }

  // assistant 消息：按 AI SDK part 原始顺序渲染 prose / 思考 / 工具 / UI 块。
  // 这样学生看到的是"思考 → 行动 → 再思考 → 交付"，而不是一整坨思考堆在最前面。
  const parts = message.parts ?? [];
  const sequential: Array<
    | { kind: 'text'; key: string; text: string }
    | { kind: 'reasoning'; key: string; text: string; active: boolean }
    | { kind: 'activity'; key: string; items: TimelineItem[] }
    | { kind: 'tool'; key: string; toolName: string; part: ToolPart }
  > = [];
  let activityBuffer: TimelineItem[] = [];
  let activityGroup = 0;

  const flushActivity = () => {
    if (activityBuffer.length === 0) return;
    sequential.push({ kind: 'activity', key: `a-${activityGroup}`, items: activityBuffer });
    activityBuffer = [];
    activityGroup += 1;
  };

  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i];
    if (p.type === 'reasoning') {
      const rp = p as { type: 'reasoning'; text?: string; state?: 'streaming' | 'done' };
      flushActivity();
      if (rp.text?.trim()) {
        const prev = sequential[sequential.length - 1];
        if (prev?.kind === 'reasoning') {
          prev.text += rp.text;
          prev.active = prev.active || rp.state === 'streaming';
        } else {
          sequential.push({ kind: 'reasoning', key: `r-${i}`, text: rp.text, active: rp.state === 'streaming' });
        }
      }
      continue;
    }
    if (p.type === 'text') {
      const t = (p as { text?: string }).text ?? '';
      flushActivity();
      if (t.trim()) sequential.push({ kind: 'text', key: `t-${i}`, text: t });
      continue;
    }
    if (typeof p.type === 'string' && p.type.startsWith('tool-')) {
      const toolName = p.type.slice('tool-'.length);
      const tp = p as ToolPart;
      if (CAPABILITY_TOOLS.has(toolName)) {
        activityBuffer.push({
          toolCallId: tp.toolCallId,
          tool: toolName as TimelineItem['tool'],
          state: tp.state,
          input: tp.input,
          output: tp.output,
          errorText: tp.errorText,
        });
      } else {
        flushActivity();
        sequential.push({ kind: 'tool', key: `tool-${i}`, toolName, part: tp });
      }
    }
  }
  flushActivity();
  const hasPrimaryUiTool = sequential.some((item) => item.kind === 'tool');
  const completedToolNames = new Set(
    sequential
      .filter((item): item is Extract<(typeof sequential)[number], { kind: 'tool' }> =>
        item.kind === 'tool' && (item.part.state === 'output-available' || item.part.state === 'output-error')
      )
      .map((item) => item.toolName),
  );

  const shouldHideActivity = (items: TimelineItem[]) => {
    const stillRunning = items.some((item) => item.state === 'input-streaming' || item.state === 'input-available');
    if (stillRunning) return false;
    const hasEvidenceWork = items.some(
      (item) => item.tool === 'webSearch' || item.tool === 'searchProgramRequirements',
    );
    if (!hasEvidenceWork) return true;
    return false;
  };

  return (
    <div className="space-y-3">
      {(() => {
        // 找到最后一个 text 项的索引，streaming 时在其尾部加 caret
        let lastTextIdx = -1;
        let renderedReasoning = false;
        const renderedStreamingTools = new Set<string>();
        for (let i = sequential.length - 1; i >= 0; i -= 1) {
          if (sequential[i].kind === 'text') { lastTextIdx = i; break; }
        }
        return sequential.map((item, idx) => {
          if (item.kind === 'text') {
            const showCaret = isStreamingTarget && idx === lastTextIdx;
            const choicePrompt = parseInlineChoicePrompt(item.text);
            if (choicePrompt) {
              return (
                <TextChoiceFallback
                  key={item.key}
                  prompt={choicePrompt}
                  disabled={pendingFollowup || isStreamingTarget}
                  onChoose={onQuickReply}
                />
              );
            }
            return (
              <div key={item.key} className="consult-reveal">
                <ConsultMarkdown content={item.text} density="chat" />
                {showCaret && <StreamingCaret />}
              </div>
            );
          }
          if (item.kind === 'reasoning') {
            // 流式推理属于内部 trace，不直接暴露给学生；等待态由一个轻量 skeleton 承接。
            if (isStreamingTarget) return null;
            // 有主 UI 块时，已完成的推理摘要会和顾问判断重复；只保留流式中的一条。
            if (hasPrimaryUiTool && !item.active) return null;
            if (renderedReasoning) return null;
            renderedReasoning = true;
            return <ReasoningBlock key={item.key} text={item.text} active={item.active || isStreamingTarget} />;
          }
          if (item.kind === 'activity') {
            if (shouldHideActivity(item.items)) return null;
            return <ActivityTimeline key={item.key} items={item.items} />;
          }
          const { toolName, part } = item;
          if (part.state === 'input-streaming') {
            if (completedToolNames.has(toolName)) return null;
            if (renderedStreamingTools.has(toolName)) return null;
            renderedStreamingTools.add(toolName);
          }
          if (toolName === 'showConsultantMove') {
            return (
              <ConsultantMoveBlock
                key={item.key}
                toolCallId={part.toolCallId}
                state={part.state}
                input={part.input as never}
                output={part.output}
                pendingFollowup={pendingFollowup && pendingToolCallId === part.toolCallId}
                addToolResult={addToolResult}
              />
            );
          }
          if (toolName === 'showServicePlan') {
            return (
              <ServicePlanBlock
                key={item.key}
                toolCallId={part.toolCallId}
                state={part.state}
                input={part.input as never}
                output={part.output}
                pendingFollowup={pendingFollowup && pendingToolCallId === part.toolCallId}
                addToolResult={addToolResult}
              />
            );
          }
          if (toolName === 'showAdvisorDiscovery') {
            return (
              <AdvisorDiscoveryBlock
                key={item.key}
                toolCallId={part.toolCallId}
                state={part.state}
                input={part.input as never}
                output={part.output}
                pendingFollowup={pendingFollowup && pendingToolCallId === part.toolCallId}
                addToolResult={addToolResult}
              />
            );
          }
          if (toolName === 'askOptions') {
            return (
              <AskOptionsBlock
                key={item.key}
                toolCallId={part.toolCallId}
                state={part.state}
                input={part.input as never}
                output={part.output}
                pendingFollowup={pendingFollowup && pendingToolCallId === part.toolCallId}
                addToolResult={addToolResult}
              />
            );
          }
          if (toolName === 'showDraft') {
            const draftInput = part.input as { kind?: string } | undefined;
            return (
              <ShowDraftBlock
                key={item.key}
                toolCallId={part.toolCallId}
                state={part.state}
                input={part.input as never}
                output={part.output}
                artifactState={
                  draftInput?.kind === 'cv-diagnosis' &&
                  latestCvDiagnosisToolCallId &&
                  latestCvDiagnosisToolCallId !== part.toolCallId
                    ? 'superseded'
                    : 'current'
                }
                pendingFollowup={pendingFollowup && pendingToolCallId === part.toolCallId}
                addToolResult={addToolResult}
              />
            );
          }
          if (toolName === 'showOutreachWorkspace') {
            return (
              <ShowOutreachWorkspaceBlock
                key={item.key}
                toolCallId={part.toolCallId}
                state={part.state}
                input={part.input as never}
                output={part.output}
                addToolResult={addToolResult}
              />
            );
          }
          if (toolName === 'ctaWechat') {
            return (
              <CtaWechatBlock
                key={item.key}
                input={part.input as never}
                orgSlug={orgSlug}
                studentKey={studentKey}
              />
            );
          }
          if (toolName === 'fileUpload') {
            return (
              <FileUploadBlock
                key={item.key}
                toolCallId={part.toolCallId}
                state={part.state}
                input={part.input as never}
                output={part.output}
                addToolResult={addToolResult}
              />
            );
          }
          if (toolName === 'startVoiceCall') {
            return (
              <StartVoiceCallBlock
                key={item.key}
                toolCallId={part.toolCallId}
                state={part.state}
                input={part.input as never}
                output={part.output}
                addToolResult={addToolResult}
                orgSlug={orgSlug}
                studentKey={studentKey}
                isLatestVoiceCall={latestVoiceToolCallId === part.toolCallId}
              />
            );
          }
          return null;
        });
      })()}
    </div>
  );
}

interface ToolPart {
  toolCallId: string;
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

// ────────── ReasoningBlock ──────────

function ReasoningBlock({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = useState(false);
  const items = summarizeReasoningWork(text);

  return (
    <div className="consult-reveal rounded-xl border border-[var(--consult-border)] bg-[var(--consult-surface)]/80 px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <PixelAgentStatus
            state={active ? 'thinking' : 'done'}
            label={active ? '正在判断下一步' : '判断已接上'}
            size="sm"
          />
          {!open && (
            <div className="mt-1 truncate pl-10 text-[11px] leading-relaxed text-ink-muted">
              {items[0] ?? '整理上下文，准备下一步。'}
            </div>
          )}
        </div>
        <span className="shrink-0 rounded-lg border border-[var(--consult-border)] bg-[var(--consult-surface)] px-2 py-1 text-[11px] text-[var(--consult-muted)] transition hover:border-[var(--consult-primary)] hover:bg-[var(--consult-primary-soft)] hover:text-[var(--consult-primary)]">
          {open ? '收起' : '工作摘要'}
        </span>
      </button>
      {open && (
        <div className="mt-3 border-t border-divider pt-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-ink-muted">Agent 正在处理</div>
          <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-ink-secondary">
            {items.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-muted" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function summarizeReasoningWork(text: string): string[] {
  const normalized = text.toLowerCase();
  const items: string[] = [];
  const push = (item: string) => {
    if (!items.includes(item)) items.push(item);
  };

  if (/画像|profile|cv|背景|材料/.test(normalized)) push('先看已有画像和材料，避免重复问学生。');
  if (/意图|真实问题|焦虑|clarify|关键问题|问一个/.test(normalized)) push('判断学生真正想解决的问题，只保留一个关键追问。');
  if (/导师|advisor|professor|percy|shortlist|短名单/.test(normalized)) push('区分“正在探索的导师”和“已经确认的短名单”。');
  if (/搜索|检索|websearch|citation|来源|论文|paper/.test(normalized)) push('需要实时事实时先核对公开来源。');
  if (/skill|剧本|workflow|场景/.test(normalized)) push('只在意图明确时加载 skill，把 skill 当方法库而不是固定流程。');
  if (/方案|serviceplan|时间线|计划|面试/.test(normalized)) push('把下一步组织成少量可执行动作，再逐步展开。');
  if (/草稿|draft|邮件|套磁|开头/.test(normalized)) push('等证据和定位足够后，再生成可交付草稿。');

  return items.length > 0 ? items.slice(0, 4) : ['整理上下文，准备一个低负荷的下一步。'];
}
