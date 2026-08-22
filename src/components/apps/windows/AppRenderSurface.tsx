'use client';

import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import type { TranscriptSegment } from '@/types';
import type { AppTaskState } from '@/components/apps/hooks/useAppExecution';
import { PodcastWindow } from './PodcastWindow';
import { FlashcardsWindow } from './FlashcardsWindow';
import { QuizWindow } from './QuizWindow';
import { MindmapWindow } from './MindmapWindow';
import { InfographicWindow } from './InfographicWindow';
import { CheatsheetWindow } from './CheatsheetWindow';
import { TeachBackWindow } from './TeachBackWindow';
import { ExplainerWindow } from './ExplainerWindow';

export interface AppRenderSurfaceProps {
  appKey: WorkshopAppKey;
  result: AppExecutionResult | null;
  transcript?: TranscriptSegment[];
  taskState?: AppTaskState;
  sessionId?: string;
  contentContext?: string;
  onSeek?: (startMs: number) => void;
  onRegenerate?: () => void;
  onGenerateDraft?: () => Promise<AppExecutionResult | null>;
  onResultUpdate?: (next: AppExecutionResult) => void;
  onLearningActivity?: (line: string) => void;
  /** 移动端结果页先展示大纲；桌面工作区默认导图。 */
  mindmapDefaultViewMode?: 'mindmap' | 'outline';
}

export function AppRenderSurface({
  appKey,
  result,
  transcript = [],
  taskState,
  sessionId = 'inline-session',
  contentContext,
  onSeek,
  onRegenerate,
  onGenerateDraft,
  onResultUpdate,
  onLearningActivity,
  mindmapDefaultViewMode = 'mindmap',
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
    return <MindmapWindow result={result} transcript={transcript} onSeek={onSeek} defaultViewMode={mindmapDefaultViewMode} />;
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

  if (appKey === 'cheatsheet') {
    return <CheatsheetWindow result={result} onSeek={onSeek} />;
  }

  if (appKey === 'teach-back') {
    return (
      <TeachBackWindow
        result={result}
        transcript={transcript}
        contentContext={contentContext}
        onSeek={onSeek}
        onLearningActivity={onLearningActivity}
      />
    );
  }

  if (appKey === 'explainer') {
    return <ExplainerWindow result={result} />;
  }

  return null;
}

export default AppRenderSurface;
