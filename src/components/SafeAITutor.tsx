'use client';

import type { ComponentProps } from 'react';
import { AITutor } from './AITutor';
import { TutorErrorBoundary } from './TutorErrorBoundary';
import { TutorAgentPanel } from './tutor/TutorAgentPanel';

// Feature flag: M6.5 新 agent endpoint 的灰度开关。
// 默认 ON（当前无真实用户，dogfood 阶段）。显式设 false 才回退到老路径。
// true  → Vercel AI SDK v6 useChat + /api/tutor/agent（会用工具的同桌）
// false → AITutor.tsx 老 SSE 路径（breakpoint/guidance/parsedResponse 协议）
//
// 两条路径并存，真实流量增长后可根据对话质量 A/B 再定走向。
const TUTOR_AGENT_ENABLED =
  typeof process === 'undefined' ||
  String(process.env.NEXT_PUBLIC_TUTOR_AGENT_ENABLED ?? 'true').toLowerCase() !== 'false';

export function SafeAITutor(props: ComponentProps<typeof AITutor>) {
  const resetKeys = [
    props.sessionId ?? 'default',
    props.breakpoint?.id ?? 'global',
    props.launchQuestionNonce ?? 0,
    props.isMobile ? 'mobile' : 'desktop',
  ];

  if (TUTOR_AGENT_ENABLED) {
    const authToken =
      typeof window !== 'undefined'
        ? window.localStorage.getItem('auth_token') ?? undefined
        : undefined;
    return (
      <TutorErrorBoundary panelName="AI 同桌" resetKeys={resetKeys}>
        <TutorAgentPanel
          sessionId={props.sessionId ?? 'anon'}
          transcript={props.segments.map((s) => ({
            id: s.id,
            text: s.text,
            startMs: s.startMs,
            endMs: s.endMs,
          }))}
          subject={props.supportContextText}
          authToken={authToken}
          onSeek={props.onSeek}
        />
      </TutorErrorBoundary>
    );
  }

  return (
    <TutorErrorBoundary panelName="AI 助教" resetKeys={resetKeys}>
      <AITutor {...props} />
    </TutorErrorBoundary>
  );
}
