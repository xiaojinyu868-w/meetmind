'use client';

import type { ComponentProps } from 'react';
import { AITutor } from './AITutor';
import { TutorErrorBoundary } from './TutorErrorBoundary';

export function SafeAITutor(props: ComponentProps<typeof AITutor>) {
  const resetKeys = [
    props.sessionId ?? 'default',
    props.breakpoint?.id ?? 'global',
    props.launchQuestionNonce ?? 0,
    props.isMobile ? 'mobile' : 'desktop',
  ];

  return (
    <TutorErrorBoundary panelName="AI 助教" resetKeys={resetKeys}>
      <AITutor {...props} />
    </TutorErrorBoundary>
  );
}
