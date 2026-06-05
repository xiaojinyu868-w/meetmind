'use client';

import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import type { TranscriptSegment } from '@/types';
import type { ClassCheckRound } from '@/hooks/useClassCheck';
import type { ClassCheckPlan } from '@/app/api/class-check/plan/route';
import type { AppTaskState } from '@/components/apps/hooks/useAppExecution';
import { PodcastWindow } from './PodcastWindow';
import { FlashcardsWindow } from './FlashcardsWindow';
import { QuizWindow } from './QuizWindow';
import { MindmapWindow } from './MindmapWindow';
import { InfographicWindow } from './InfographicWindow';
import { StudyReportWindow } from './StudyReportWindow';
import { CheatsheetWindow } from './CheatsheetWindow';

export interface AppRenderSurfaceProps {
  appKey: WorkshopAppKey;
  result: AppExecutionResult | null;
  transcript?: TranscriptSegment[];
  taskState?: AppTaskState;
  sessionId?: string;
  contentContext?: string;
  classCheckRounds?: ClassCheckRound[];
  classCheckPlan?: ClassCheckPlan | null;
  onSeek?: (startMs: number) => void;
  onRegenerate?: () => void;
  onGenerateDraft?: () => Promise<AppExecutionResult | null>;
  onResultUpdate?: (next: AppExecutionResult) => void;
  onLearningActivity?: (line: string) => void;
  /** 思维导图在"查看结果"场景默认全屏（复习工作区 / 独立结果页传 true；对话内联不传） */
  mindmapDefaultFullscreen?: boolean;
}

export function AppRenderSurface({
  appKey,
  result,
  transcript = [],
  taskState,
  sessionId = 'inline-session',
  contentContext,
  classCheckRounds,
  classCheckPlan,
  onSeek,
  onRegenerate,
  onGenerateDraft,
  onResultUpdate,
  onLearningActivity,
  mindmapDefaultFullscreen = false,
}: AppRenderSurfaceProps) {
  if (appKey === 'audio-overview') {
    return <PodcastWindow result={result} transcript={transcript} taskState={taskState} onSeek={onSeek} onRegenerate={onRegenerate} />;
  }

  if (appKey === 'flashcards') {
    return <FlashcardsWindow result={result} transcript={transcript} onSeek={onSeek} onLearningActivity={onLearningActivity} />;
  }

  if (appKey === 'quiz') {
    return <QuizWindow result={result} transcript={transcript} onSeek={onSeek} onLearningActivity={onLearningActivity} />;
  }

  if (appKey === 'mindmap') {
    return <MindmapWindow result={result} transcript={transcript} onSeek={onSeek} defaultFullscreen={mindmapDefaultFullscreen} />;
  }

  if (appKey === 'infographic') {
    if (!onResultUpdate) return null;
    return (
      <InfographicWindow
        sessionId={sessionId}
        result={result}
        taskState={taskState}
        contentContext={contentContext}
        onGenerateDraft={onGenerateDraft}
        onResultUpdate={onResultUpdate}
      />
    );
  }

  if (appKey === 'study-report') {
    return <StudyReportWindow result={result} rounds={classCheckRounds} plan={classCheckPlan} transcript={transcript} />;
  }

  if (appKey === 'cheatsheet') {
    return <CheatsheetWindow result={result} onSeek={onSeek} />;
  }

  return null;
}

export default AppRenderSurface;
