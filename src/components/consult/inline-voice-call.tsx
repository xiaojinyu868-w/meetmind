'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Mic, MicOff, Phone, PhoneCall, PhoneOff, RotateCcw } from 'lucide-react';
import {
  primeOmniRealtimeCallEntry,
  useOmniRealtimeCall,
  type OmniRealtimeCallStatus,
} from '@/hooks/useOmniRealtimeCall';
import { LevelMeter, Receipt, VoiceHistoryReceipt } from './inline-voice-call-parts';

export interface InlineVoiceCallInput {
  reason: string;
  openingLine: string;
  focus: string[];
  voice?: 'Ethan' | 'Cherry';
}

interface InlineVoiceCallBlockProps {
  toolCallId: string;
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  input: InlineVoiceCallInput;
  output?: unknown;
  orgSlug: string;
  studentKey: string;
  addToolResult: (args: { tool: string; toolCallId: string; output: unknown }) => void;
  isLatestVoiceCall?: boolean;
}

interface VoiceContextData {
  instructions: string;
  voice?: string;
  introLine?: string;
  studentSummary?: string;
  activeScenario?: string | null;
}

interface VoiceStatusCopy {
  title: string;
  body: string;
}

function appendTranscript(prev: string[], text: string): string[] {
  const cleaned = text.trim();
  if (!cleaned) return prev;
  if (prev[prev.length - 1] === cleaned) return prev;
  return [...prev.slice(-3), cleaned];
}

function buildFallbackInstructions(input: InlineVoiceCallInput, orgSlug: string): string {
  const focus = Array.isArray(input.focus) && input.focus.length > 0
    ? input.focus.slice(0, 4).map((item) => `- ${item}`).join('\n')
    : '- 先听学生最想解决的问题';

  return [
    `你是 ${orgSlug} 机构提供的 AI 申请顾问。学生刚在文字对话里点了接听。`,
    `接通后的第一句话只说：「${input.openingLine}」`,
    `然后停顿，等学生回应。`,
    ``,
    `本次重点：`,
    focus,
    ``,
    `语音纪律：一次只说一件事，句子短，学生开口就停，不要 markdown，不要自我介绍。`,
  ].join('\n');
}

async function fetchVoiceContext(args: {
  orgSlug: string;
  studentKey: string;
  openingLine: string;
  focus: string[];
  voice?: string;
}): Promise<VoiceContextData> {
  const res = await fetch('/api/consult/voice/context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const json = (await res.json().catch(() => null)) as {
    success?: boolean;
    data?: VoiceContextData;
    error?: string;
  } | null;

  if (!res.ok || !json?.success || !json.data?.instructions) {
    throw new Error(json?.error || `HTTP ${res.status}`);
  }

  return json.data;
}

function getStatusCopy(args: {
  status: OmniRealtimeCallStatus;
  isConnected: boolean;
  accepting: boolean;
  contextHint: string | null;
  errorMessage: string;
  permissionError: string | null;
  capturedText: string;
  assistantText: string;
}): VoiceStatusCopy {
  const {
    status,
    isConnected,
    accepting,
    contextHint,
    errorMessage,
    permissionError,
    capturedText,
    assistantText,
  } = args;

  const err = permissionError || errorMessage;
  if (err) return { title: '没接上', body: err };
  if (contextHint) return { title: '准备通话', body: contextHint };
  if (accepting && status === 'idle') return { title: '正在接听', body: '正在把这轮文字上下文带进语音里' };
  if (status === 'connecting') return { title: '连接语音通道', body: '不用跳页，接通后直接说' };
  if (status === 'authorizing') return { title: '等待开麦', body: '浏览器在等麦克风启动，点一下开麦继续' };
  if (status === 'listening') return { title: '正在听', body: capturedText || '你可以像打电话一样直接说' };
  if (status === 'thinking') return { title: '顾问在想', body: capturedText || '正在抓你刚才话里的重点' };
  if (status === 'responding') return { title: '顾问在说', body: assistantText || '正在回答' };
  if (status === 'muted') return { title: '已静音', body: '点开麦后继续说' };
  if (isConnected) return { title: '已接通', body: '直接说你的顾虑就好' };
  return { title: '准备接通', body: '语音会留在这条对话里' };
}

export function InlineVoiceCallBlock({
  toolCallId,
  state,
  input,
  output,
  orgSlug,
  studentKey,
  addToolResult,
  isLatestVoiceCall = true,
}: InlineVoiceCallBlockProps) {
  const done = state === 'output-available';
  const outcome = done ? (output as { action?: 'accepted' | 'declined' })?.action : null;
  const fallbackInstructions = useMemo(() => buildFallbackInstructions(input, orgSlug), [input, orgSlug]);

  const [decliningBusy, setDecliningBusy] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [contextHint, setContextHint] = useState<string | null>(null);
  const [voiceInstructions, setVoiceInstructions] = useState(fallbackInstructions);
  const [callStarted, setCallStarted] = useState(false);
  const [connectRequested, setConnectRequested] = useState(false);
  const [submitResultOnConnect, setSubmitResultOnConnect] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [userTurns, setUserTurns] = useState<string[]>([]);
  const [assistantTurns, setAssistantTurns] = useState<string[]>([]);

  useEffect(() => {
    if (!callStarted) setVoiceInstructions(fallbackInstructions);
  }, [callStarted, fallbackInstructions]);

  const handleUserTranscript = useCallback((text: string) => {
    setUserTurns((prev) => appendTranscript(prev, text));
  }, []);

  const handleAssistantTranscriptDone = useCallback((text: string) => {
    setAssistantTurns((prev) => appendTranscript(prev, text));
  }, []);

  const {
    status,
    isConnected,
    isMuted,
    capturedText,
    assistantText,
    errorMessage,
    connectSession,
    disconnectSession,
    toggleRecording,
  } = useOmniRealtimeCall({
    instructions: voiceInstructions,
    voice: input.voice ?? 'Ethan',
    connectOnMount: false,
    onUserTranscript: handleUserTranscript,
    onAssistantTranscriptDone: handleAssistantTranscriptDone,
  });

  useEffect(() => {
    if (!connectRequested || callEnded) return;
    let cancelled = false;
    setConnectRequested(false);
    void connectSession()
      .then(() => {
        if (cancelled || !submitResultOnConnect || outcome === 'accepted') return;
        addToolResult({
          tool: 'startVoiceCall',
          toolCallId,
          output: { action: 'accepted', acceptedAt: new Date().toISOString() },
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setSubmitResultOnConnect(false);
          setAccepting(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    addToolResult,
    callEnded,
    connectRequested,
    connectSession,
    outcome,
    submitResultOnConnect,
    toolCallId,
  ]);

  useEffect(() => {
    if (status !== 'connecting' && status !== 'authorizing') {
      setContextHint(null);
    }
  }, [status]);

  useEffect(() => {
    if (isLatestVoiceCall) return;
    if (!callStarted && !isConnected) return;
    void disconnectSession();
    setCallStarted(false);
    setConnectRequested(false);
    setSubmitResultOnConnect(false);
    setAccepting(false);
    setContextHint(null);
  }, [callStarted, disconnectSession, isConnected, isLatestVoiceCall]);

  const requestConnect = async (submitToolResult: boolean) => {
    if (accepting || decliningBusy) return;
    setAccepting(true);
    setPermissionError(null);
    setContextHint('正在把文字对话和学生画像带进语音里');
    setCallEnded(false);
    setSubmitResultOnConnect(false);

    try {
      const ok = await primeOmniRealtimeCallEntry();
      if (!ok) {
        setPermissionError('需要麦克风权限才能语音通话。请在浏览器弹窗里点击"允许"。');
        setAccepting(false);
        setContextHint(null);
        return;
      }

      setCallStarted(true);

      try {
        const voiceContext = await fetchVoiceContext({
          orgSlug,
          studentKey,
          openingLine: input.openingLine,
          focus: input.focus ?? [],
          voice: input.voice,
        });
        setVoiceInstructions(voiceContext.instructions);
        setContextHint(null);
      } catch {
        setVoiceInstructions(fallbackInstructions);
        setContextHint('实时上下文没有完全取到，先用当前这轮对话接通');
      }

      setSubmitResultOnConnect(submitToolResult);
      setConnectRequested(true);
    } catch (error) {
      setPermissionError(error instanceof Error ? error.message : String(error));
      setContextHint(null);
      setAccepting(false);
    }
  };

  const accept = () => {
    if (callStarted || accepting) return;
    void requestConnect(true);
  };

  const retry = () => {
    void requestConnect(false);
  };

  const decline = () => {
    if (done || decliningBusy || accepting) return;
    setDecliningBusy(true);
    addToolResult({
      tool: 'startVoiceCall',
      toolCallId,
      output: { action: 'declined', declinedAt: new Date().toISOString() },
    });
  };

  const endCall = async () => {
    await disconnectSession();
    setCallEnded(true);
    setCallStarted(false);
    setAccepting(false);
    setContextHint(null);
  };

  if (!isLatestVoiceCall) {
    const failed = Boolean(permissionError || errorMessage);
    const title = outcome === 'declined'
      ? '已跳过语音'
      : failed
        ? '上一次语音没接上'
        : callEnded
          ? '上一次语音已结束'
          : '上一次语音已收起';
    const body = input.openingLine
      ? `「${input.openingLine}」`
      : '最新语音通话保留在下面。';
    return <VoiceHistoryReceipt title={title} body={body} />;
  }

  if (outcome === 'declined') {
    return <Receipt>好，继续文字聊。随时都可以请我语音。</Receipt>;
  }

  if (callEnded) {
    return (
      <div className="consult-reveal rounded-2xl border border-divider bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium text-ink">语音已结束</div>
            <div className="mt-1 text-[12px] leading-relaxed text-ink-muted">
              继续在这里文字聊，刚才的话题不会丢。
            </div>
          </div>
          <button
            type="button"
            onClick={retry}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-divider bg-card px-3 py-1.5 text-[12px] text-ink-secondary transition hover:border-ink/40 hover:text-ink"
          >
            <RotateCcw size={13} strokeWidth={1.8} />
            再接一次
          </button>
        </div>
        {(userTurns.length > 0 || assistantTurns.length > 0) && (
          <div className="mt-3 rounded-lg border border-divider bg-canvas px-3 py-2 text-[11.5px] leading-relaxed text-ink-secondary">
            {userTurns.at(-1) && <div>你：{userTurns.at(-1)}</div>}
            {assistantTurns.at(-1) && <div className="mt-1">顾问：{assistantTurns.at(-1)}</div>}
          </div>
        )}
      </div>
    );
  }

  if (callStarted || outcome === 'accepted') {
    const copy = getStatusCopy({
      status,
      isConnected,
      accepting,
      contextHint,
      errorMessage,
      permissionError,
      capturedText,
      assistantText,
    });
    const active = accepting || isConnected || status === 'connecting' || status === 'authorizing';
    const showRetry = Boolean(permissionError || errorMessage || (!isConnected && status === 'idle' && !accepting));

    return (
      <div className="consult-reveal rounded-2xl border border-divider bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-ink-muted">
              <span className={'h-2 w-2 rounded-full ' + (active ? 'bg-ink consult-dot-pulse' : 'bg-ink-muted')} />
              AI 顾问语音中
            </div>
            <div className="mt-2 text-[15px] font-medium leading-tight text-ink">{copy.title}</div>
            <div className="mt-1 max-w-[34rem] break-words text-[12px] leading-relaxed text-ink-secondary">
              {copy.body}
            </div>
          </div>
          <div className="shrink-0 rounded-full border border-divider bg-canvas px-3 py-2">
            <LevelMeter active={active && !permissionError && !errorMessage} />
          </div>
        </div>

        {(capturedText || assistantText || userTurns.length > 0 || assistantTurns.length > 0) && (
          <div className="mt-4 space-y-2 rounded-xl border border-divider bg-canvas p-3">
            {(capturedText || userTurns.at(-1)) && (
              <div className="text-[12px] leading-relaxed text-ink-secondary">
                <span className="text-ink-muted">你：</span>{capturedText || userTurns.at(-1)}
              </div>
            )}
            {(assistantText || assistantTurns.at(-1)) && (
              <div className="text-[12px] leading-relaxed text-ink">
                <span className="text-ink-muted">顾问：</span>{assistantText || assistantTurns.at(-1)}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {showRetry && (
            <button
              type="button"
              onClick={retry}
              disabled={accepting}
              className="inline-flex items-center gap-1.5 rounded-full border border-divider bg-card px-3 py-2 text-[12px] font-medium text-ink transition hover:border-ink/40 hover:bg-hover disabled:opacity-50"
            >
              <RotateCcw size={14} strokeWidth={1.8} />
              重新接通
            </button>
          )}
          <button
            type="button"
            onClick={() => void toggleRecording()}
            disabled={accepting || status === 'connecting'}
            className={
              'inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-medium transition disabled:opacity-50 ' +
              (isMuted
                ? 'border border-divider bg-card text-ink-secondary hover:border-ink/40 hover:text-ink'
                : 'border border-ink bg-ink text-card hover:bg-ink/90')
            }
          >
            {isMuted ? <Mic size={14} strokeWidth={1.8} /> : <MicOff size={14} strokeWidth={1.8} />}
            {isMuted ? '开麦' : '静音'}
          </button>
          <button
            type="button"
            onClick={() => void endCall()}
            className="inline-flex items-center gap-1.5 rounded-full border border-divider bg-card px-3 py-2 text-[12px] font-medium text-ink-secondary transition hover:border-ink/40 hover:text-ink"
          >
            <PhoneOff size={14} strokeWidth={1.8} />
            结束
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="consult-reveal overflow-hidden rounded-2xl border border-divider bg-card p-5">
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-2.5 w-2.5">
          <span className="consult-dot-pulse absolute inline-flex h-full w-full rounded-full bg-mint-400" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-mint-400" />
        </span>
        <span className="text-[10.5px] uppercase tracking-wider text-mint-800">
          AI 顾问想和你语音聊聊
        </span>
      </div>

      <div className="mt-3 text-[15px] font-medium leading-[1.6] text-ink">
        「{input.openingLine}」
      </div>

      {input.reason && (
        <div className="mt-2 text-[12px] leading-[1.7] text-ink-secondary">
          {input.reason}
        </div>
      )}

      {input.focus && input.focus.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {input.focus.map((focus) => (
            <span
              key={focus}
              className="rounded-full border border-mint-200 bg-mint-50 px-2.5 py-0.5 text-[11px] text-mint-800"
            >
              {focus}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {permissionError && (
          <div className="rounded-lg border border-rose-dark/40 bg-rose-light px-3 py-2 text-[11px] text-ink">
            {permissionError}
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={accept}
            disabled={accepting}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-[13px] font-medium text-card transition hover:bg-ink/90 active:scale-[0.98] disabled:opacity-70"
          >
            {accepting ? <Phone size={14} strokeWidth={1.8} /> : <PhoneCall size={14} strokeWidth={1.8} />}
            {accepting ? '正在接听…' : '接听'}
          </button>
          <button
            type="button"
            onClick={decline}
            disabled={decliningBusy || accepting}
            className="rounded-full border border-divider bg-card px-4 py-2.5 text-[12.5px] text-ink-secondary transition hover:border-ink/40 hover:bg-hover hover:text-ink disabled:opacity-60"
          >
            稍后再说
          </button>
        </div>
      </div>
    </div>
  );
}
