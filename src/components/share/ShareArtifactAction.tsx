'use client';

import { Share2 } from 'lucide-react';
import * as React from 'react';
import { getSessionById } from '@/lib/db/sessions';
import { useAuth } from '@/lib/hooks/useAuth';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { COPY } from '@/lib/ui/copy';
import type { TranscriptSegment } from '@/types';
import {
  buildSharedArtifactSnapshot,
  isShareableArtifactAppKey,
} from './share-artifact-model';
import { useShareAgentCreator } from './useShareAgentCreator';

interface ShareArtifactActionProps {
  appKey: WorkshopAppKey;
  result: AppExecutionResult | null;
  sessionId: string;
  transcript?: TranscriptSegment[];
  courseTitle?: string;
  subject?: string;
  summary?: string;
  className?: string;
}

export function ShareArtifactAction({
  appKey,
  result,
  sessionId,
  transcript = [],
  courseTitle,
  subject,
  summary,
  className,
}: ShareArtifactActionProps) {
  const { user } = useAuth();
  const { openCreator, isCreating, modal } = useShareAgentCreator();
  const [resolvedCourseTitle, setResolvedCourseTitle] = React.useState(courseTitle?.trim() || '');

  React.useEffect(() => {
    if (courseTitle?.trim()) {
      setResolvedCourseTitle(courseTitle.trim());
      return;
    }
    if (!sessionId) return;
    let cancelled = false;
    void getSessionById(sessionId)
      .then((session) => {
        if (!cancelled && session?.topic?.trim()) setResolvedCourseTitle(session.topic.trim());
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [courseTitle, sessionId]);

  if (!result || !isShareableArtifactAppKey(appKey)) return null;

  const handleShare = async () => {
    await openCreator(buildSharedArtifactSnapshot({
      appKey,
      result,
      transcript,
      courseTitle: resolvedCourseTitle,
      subject,
      summary,
      nickname: user?.nickname,
    }));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleShare()}
        disabled={isCreating}
        className={className ?? 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-divider bg-white px-3 text-[12px] font-semibold text-ink-secondary transition hover:border-pine/35 hover:text-pine disabled:opacity-55'}
        aria-label={COPY.share.creator.currentAction}
        data-testid={`share-artifact-${appKey}`}
      >
        <Share2 size={14} strokeWidth={1.8} aria-hidden />
        <span>{isCreating ? COPY.share.creator.currentPreparing : COPY.share.creator.currentAction}</span>
      </button>
      {modal}
    </>
  );
}
