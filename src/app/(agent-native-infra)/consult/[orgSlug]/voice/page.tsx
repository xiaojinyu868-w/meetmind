'use client';

/**
 * /consult/[orgSlug]/voice?call=<toolCallId>
 *
 * 当 agent emit 了 startVoiceCall UI 块，学生按"接听" → 跳到这个页面。
 * 这个页面的工作流程：
 *   1. 从 sessionStorage 读 call 上下文（StartVoiceCallBlock 存的 openingLine / focus / voice）
 *   2. 调 /api/consult/voice/context 把画像 + 最近对话拼成 Omni realtime 的 instructions
 *   3. 把 instructions 交给 TutorRealtimeCallScreen（复用 /learn/practice 的同一个通话组件）
 *   4. 挂断时回到 /consult/[orgSlug]（对话会继续，学生可以说"我们刚才聊到..."）
 *
 * 不改 Omni realtime 通路本身：这块已经跑了很久，稳定。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { TutorRealtimeCallScreen } from '@/components/tutor/TutorRealtimeCallScreen';
import { primeOmniRealtimeCallEntry } from '@/hooks/useOmniRealtimeCall';

interface CallContext {
  openingLine: string;
  focus: string[];
  voice: string;
  reason?: string;
  orgSlug: string;
  studentKey: string;
}

interface VoiceContextResp {
  success: boolean;
  data?: {
    instructions: string;
    voice: string;
    introLine: string;
    studentSummary: string;
    activeScenario: string | null;
  };
  error?: string;
}

export default function ConsultVoicePage() {
  const params = useParams<{ orgSlug: string }>();
  const router = useRouter();
  const orgSlug = params?.orgSlug ?? 'default';

  const [instructions, setInstructions] = useState<string | null>(null);
  const [voice, setVoice] = useState<string>('Ethan');
  const [scenario, setScenario] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const callIdRef = useRef<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const callId = url.searchParams.get('call');
    callIdRef.current = callId;
    if (!callId) {
      setErr('缺少 call 参数');
      return;
    }
    let ctx: CallContext | null = null;
    try {
      const raw = sessionStorage.getItem(`consult-voice-call:${callId}`);
      if (raw) ctx = JSON.parse(raw) as CallContext;
    } catch {
      ctx = null;
    }
    if (!ctx || !ctx.openingLine) {
      setErr('通话上下文已失效。请回到对话再让 AI 顾问重新发起一次。');
      return;
    }

    // 第二道防线：mic 已经在 StartVoiceCallBlock 预热过；但如果是刷新/深链进来，这里再试一次
    // 失败也不 block —— 真正的报错交给 hook 的 getUserMedia
    void primeOmniRealtimeCallEntry().catch(() => {});

    fetch('/api/consult/voice/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgSlug: ctx.orgSlug || orgSlug,
        studentKey: ctx.studentKey,
        openingLine: ctx.openingLine,
        focus: ctx.focus,
        voice: ctx.voice,
      }),
    })
      .then((r) => r.json() as Promise<VoiceContextResp>)
      .then((j) => {
        if (!j.success || !j.data) {
          setErr(j.error ?? '加载通话上下文失败');
          return;
        }
        setInstructions(j.data.instructions);
        setVoice(j.data.voice);
        setScenario(j.data.activeScenario);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [orgSlug]);

  const onExit = useCallback(() => {
    // 清理本地缓存避免下一通电话读到老上下文
    if (callIdRef.current) {
      try { sessionStorage.removeItem(`consult-voice-call:${callIdRef.current}`); } catch {}
    }
    router.push(`/consult/${encodeURIComponent(orgSlug)}`);
  }, [orgSlug, router]);

  // 记录通话文字稿（同一 session 的 messages 不修改；先留 hook，后续可写 VoiceTranscript 表）
  const noop = useCallback(() => {}, []);

  if (err) {
    return (
      <div className="mx-auto flex h-screen max-w-md flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
        <div className="text-[14px] font-medium text-ink">语音连线没能接通</div>
        <div className="text-[12px] leading-relaxed text-ink-secondary">{err}</div>
        <button
          type="button"
          onClick={() => router.push(`/consult/${encodeURIComponent(orgSlug)}`)}
          className="rounded-full bg-ink px-4 py-2 text-[12.5px] text-canvas transition hover:bg-ink/85"
        >
          回到对话
        </button>
      </div>
    );
  }

  if (!instructions) {
    return (
      <div className="mx-auto flex h-screen max-w-md flex-col items-center justify-center gap-3 bg-canvas text-center">
        <div className="relative flex h-3 w-3">
          <span className="consult-dot-pulse absolute inline-flex h-full w-full rounded-full bg-mint-400" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-mint-400" />
        </div>
        <div className="text-[13px] text-ink-secondary">连线中…</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 bg-[#F7F7F5]">
      <TutorRealtimeCallScreen
        title="AI 申请顾问"
        contextLabel={scenario ? `延续「${scenario}」的对话` : '语音通话'}
        instructions={instructions}
        onExit={onExit}
        onUserTranscript={noop}
        onAssistantTranscriptChange={noop}
        onAssistantTranscriptDone={noop}
      />
    </div>
  );
}
