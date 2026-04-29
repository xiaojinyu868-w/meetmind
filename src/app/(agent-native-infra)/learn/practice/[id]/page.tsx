'use client';

/**
 * /learn/practice/[id] —— 学生语音陪练
 *
 * 三种子视图自动切换：
 *   1. connecting：刚进来在拉会话详情
 *   2. call：占满全屏的 iOS 通话界面（复用 TutorRealtimeCallScreen）
 *   3. feedback：挂断后显示 Markdown 反馈报告（StreamingMarkdown）
 *
 * 数据流：
 *   - 进页 GET /api/academic/practice/:id 拿 realtimeInstructions + scenario + status
 *   - 每一轮 onUserTranscript / onAssistantTranscriptDone 调 /message 把对话落库
 *   - 用户按"结束通话"挂断 → POST /finish → 重新 GET 拿 feedback → 切到 feedback 视图
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { academicFetch } from '@/components/academic/academic-client';
import { TutorRealtimeCallScreen } from '@/components/tutor/TutorRealtimeCallScreen';
import { StreamingMarkdown } from '@/components/StreamingMarkdown';
import { Button, Card, InlineAlert, Tag } from '@/components/academic/primitives';

interface Feedback {
  headline?: string;
  strengths?: string[];
  improvements?: string[];
  nextAction?: string;
}

interface SessionData {
  sessionId: string;
  scenario: { id: string; name: string; description: string };
  mode: 'text' | 'voice';
  status: 'active' | 'completed' | 'abandoned';
  messages: { role: 'user' | 'assistant'; content: string }[];
  feedback: Feedback | null;
  realtimeInstructions: string | null;
  sourcesUsed: string[];
  playbookSectionsUsed: number;
}

export default function PracticePage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const { accessToken } = useAuth();

  const [session, setSession] = useState<SessionData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [pendingMessage, setPendingMessage] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const fresh = await academicFetch<SessionData>(`/api/academic/practice/${id}`, { accessToken });
      setSession(fresh);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '加载失败');
    }
  }, [accessToken, id]);

  useEffect(() => {
    void load();
  }, [load]);

  // 通话中：把学生说的话持久化
  const persistUserTurn = useCallback(
    async (text: string) => {
      if (!text.trim() || pendingMessage) return;
      setPendingMessage(true);
      try {
        // 只做持久化；assistant 的回答由 Omni realtime 直接出语音，不走 /message
        await fetch(`/api/academic/practice/${id}/turn`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ role: 'user', content: text.trim() }),
        });
      } catch {
        // 语音实时场景里落库失败不阻塞对话
      } finally {
        setPendingMessage(false);
      }
    },
    [accessToken, id, pendingMessage],
  );

  const persistAssistantTurn = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      try {
        await fetch(`/api/academic/practice/${id}/turn`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ role: 'assistant', content: text.trim() }),
        });
      } catch {}
    },
    [accessToken, id],
  );

  const onExit = useCallback(async () => {
    if (!session || finishing) return;
    setFinishing(true);
    setErr(null);
    try {
      await academicFetch(`/api/academic/practice/${id}/finish`, { accessToken, method: 'POST' });
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '结束失败');
    } finally {
      setFinishing(false);
    }
  }, [accessToken, finishing, id, load, session]);

  if (!session && !err) return <FullPageNotice text="连线中…" />;
  if (!session) return <FullPageNotice text={err || '无法加载会话'} tone="danger" />;

  // 已完成 → 反馈视图
  if (session.status === 'completed' || session.status === 'abandoned') {
    return <FeedbackView session={session} onBack={() => router.push('/learn')} />;
  }

  // 未完成但没有 instructions（例如老会话没生成）→ 出错提示
  if (!session.realtimeInstructions) {
    return (
      <div className="mx-auto max-w-xl space-y-4 py-10">
        <InlineAlert>这个会话没有拼出语音陪练 instructions，请重新开始一轮。</InlineAlert>
        <Button variant="secondary" onClick={() => router.push('/learn')}>
          回到首页
        </Button>
      </div>
    );
  }

  // active → 全屏语音通话
  return (
    <div className="fixed inset-0 z-40 bg-[#F7F7F5]">
      <TutorRealtimeCallScreen
        title={session.scenario.name || '语音陪练'}
        contextLabel={session.sourcesUsed[0] ? `老师：《${session.sourcesUsed[0]}》` : '语音陪练'}
        instructions={session.realtimeInstructions}
        onExit={onExit}
        onUserTranscript={persistUserTurn}
        onAssistantTranscriptChange={() => {
          // streaming 中不落库，只在 done 时落库
        }}
        onAssistantTranscriptDone={persistAssistantTurn}
      />
      {finishing && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[120px] flex justify-center">
          <div className="rounded-full border border-divider bg-white px-4 py-2 text-xs text-ink-muted">
            正在整理这轮反馈…
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Feedback 视图
// =========================================================================

function FeedbackView({ session, onBack }: { session: SessionData; onBack: () => void }) {
  const fb = session.feedback;
  const markdown = buildFeedbackMarkdown(session);

  return (
    <div className="mx-auto max-w-3xl space-y-5 py-6">
      <div className="flex items-start justify-between gap-4 border-b border-divider pb-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-ink-muted">本轮陪练已结束</div>
          <h1 className="mt-1 text-2xl font-medium">{session.scenario.name}</h1>
          <div className="mt-1 inline-flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            {session.sourcesUsed.length > 0 && (
              <Tag tone="success">老师：《{session.sourcesUsed[0]}》</Tag>
            )}
            <Tag tone="info">语音陪练</Tag>
          </div>
        </div>
        <Button variant="secondary" onClick={onBack}>
          回到首页
        </Button>
      </div>

      {!fb ? (
        <InlineAlert tone="warning">没能生成反馈（可能这轮没有对话内容）。</InlineAlert>
      ) : (
        <Card className="p-6">
          <StreamingMarkdown content={markdown} />
        </Card>
      )}

      {session.messages.length > 0 && (
        <details className="rounded border border-divider bg-card p-4 text-sm">
          <summary className="cursor-pointer text-ink-secondary">本轮对话记录（{session.messages.length} 条）</summary>
          <div className="mt-3 space-y-3">
            {session.messages.map((m, i) => (
              <div key={i}>
                <div className="text-[11px] text-ink-muted">{m.role === 'user' ? '你' : '老师'}</div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-ink">{m.content}</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function buildFeedbackMarkdown(session: SessionData): string {
  const fb = session.feedback || {};
  const lines: string[] = [];
  if (fb.headline) lines.push(`## ${fb.headline}`);
  if (fb.strengths && fb.strengths.length > 0) {
    lines.push('\n### 做得好\n');
    for (const s of fb.strengths) lines.push(`- ${s}`);
  }
  if (fb.improvements && fb.improvements.length > 0) {
    lines.push('\n### 还能更好\n');
    for (const s of fb.improvements) lines.push(`- ${s}`);
  }
  if (fb.nextAction) {
    lines.push('\n### 下一步');
    lines.push('');
    lines.push(`> ${fb.nextAction}`);
  }
  if (lines.length === 0) lines.push('（本轮没有生成反馈）');
  return lines.join('\n');
}

function FullPageNotice({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'danger' }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className={`text-sm ${tone === 'danger' ? 'text-rose-600' : 'text-ink-muted'}`}>{text}</div>
    </div>
  );
}
