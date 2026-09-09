'use client';

import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import type { TranscriptSegment } from '@/types';
import type { LearningObservationContent } from '@/types/learning-event';
import type { AppTaskState } from '@/components/apps/hooks/useAppExecution';
import { PodcastWindow } from './PodcastWindow';
import { FlashcardsWindow } from './FlashcardsWindow';
import { QuizWindow } from './QuizWindow';
import { MindmapWindow } from './MindmapWindow';
import { InfographicWindow } from './InfographicWindow';
import { CheatsheetWindow } from './CheatsheetWindow';
import { TeachBackWindow } from './TeachBackWindow';
import { ExplainerWindow } from './ExplainerWindow';
import type { AssessmentDraft } from './assessment-events';
import type { NextStepCardProps } from './NextStepCard';

export interface AppRenderSurfaceProps {
  appKey: WorkshopAppKey;
  result: AppExecutionResult | null;
  transcript?: TranscriptSegment[];
  taskState?: AppTaskState;
  sessionId?: string;
  /** 给信息图的正文上下文（转录前 1400 字）——不是标题，别当标题传给别的窗口 */
  contentContext?: string;
  /** 课名（讲给同桌听的黑板抬头与请求 metadata.title） */
  contextTitle?: string;
  onSeek?: (startMs: number) => void;
  onRegenerate?: () => void;
  onGenerateDraft?: () => Promise<AppExecutionResult | null>;
  onResultUpdate?: (next: AppExecutionResult) => void;
  onLearningActivity?: (line: string, observation?: LearningObservationContent) => void;
  /** 结构化检验结果（测验 / 闪卡 / 讲给同桌听）→ 记忆事件；不传则只走 onLearningActivity 的人话通道 */
  onAssessment?: (draft: AssessmentDraft) => void;
  /** 完成态里同桌接着说的下一步（宿主按会话结果算好；不传则完成态到此为止） */
  nextStep?: NextStepCardProps;
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
  contextTitle,
  onSeek,
  onRegenerate,
  onGenerateDraft,
  onResultUpdate,
  onLearningActivity,
  onAssessment,
  nextStep,
  mindmapDefaultViewMode = 'mindmap',
}: AppRenderSurfaceProps) {
  if (appKey === 'audio-overview') {
    return <PodcastWindow result={result} transcript={transcript} taskState={taskState} onSeek={onSeek} onRegenerate={onRegenerate} />;
  }

  if (appKey === 'flashcards') {
    return <FlashcardsWindow result={result} transcript={transcript} onSeek={onSeek} onLearningActivity={onLearningActivity} onAssessment={onAssessment} nextStep={nextStep} />;
  }

  if (appKey === 'quiz') {
    return <QuizWindow result={result} transcript={transcript} onSeek={onSeek} onLearningActivity={onLearningActivity} onAssessment={onAssessment} nextStep={nextStep} />;
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
        contextTitle={contextTitle}
        onSeek={onSeek}
        onLearningActivity={onLearningActivity}
        onAssessment={onAssessment}
        nextStep={nextStep}
      />
    );
  }

  if (appKey === 'explainer') {
    return <ExplainerWindow result={result} />;
  }

  return null;
}

export default AppRenderSurface;
