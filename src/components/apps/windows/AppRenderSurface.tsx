'use client';

import type React from 'react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import type { TranscriptSegment } from '@/types';
import type { LearningObservationContent } from '@/types/learning-event';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { getWorkshopAppByKey } from '@/lib/ai-native/app-catalog';
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
import { useDelayedFlag } from './app-motion';

/**
 * "成品"里一件东西都没有——测验没题、闪卡没卡、导图没分支、幻灯没页。
 * 新契约下服务端不会再返回这种结果（会抛 GENERATION_FAILED），这里兜的是旧缓存与异常返回。
 */
export function isEmptyAppResult(appKey: WorkshopAppKey, result: AppExecutionResult): boolean {
  const payload = (result.render?.payload ?? {}) as Record<string, unknown>;
  const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
  switch (appKey) {
    case 'quiz':
      return count(payload.questions) === 0;
    case 'flashcards':
      return count(payload.cards) === 0 && typeof payload.message !== 'string';
    case 'mindmap':
      // MindmapWindow 接受 markdown / children / branches 三种形态之一
      return !(typeof payload.markdown === 'string' && payload.markdown.trim())
        && count(payload.children) === 0
        && count(payload.branches) === 0;
    default:
      return false;
  }
}

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
  /** 宿主已经是全屏舞台：窗口自己的「全屏」不再出现（导图此前会叠出第二层全屏，盖住返回） */
  hostFullscreen?: boolean;
}

type SurfacePhase = 'waiting' | 'loading' | 'error' | 'ready';

/**
 * 四种状态之间的过渡（DOMAIN.md「状态过渡」）：phase 变化时这一层重挂载，带 220ms 淡入 + 上移；
 * 加载态先静默 300ms（缓存命中 / 秒回不值得闪一张骨架），期间只占住高度不跳版。
 */
function SurfaceFrame({ phase, children }: { phase: SurfacePhase; children?: React.ReactNode }) {
  if (phase === 'waiting') return <div className="h-full min-h-[420px]" aria-busy data-app-surface="waiting" />;
  return (
    <div key={phase} className="mm-app-enter flex h-full min-h-0 flex-col" data-app-surface={phase}>
      {children}
    </div>
  );
}

export function AppRenderSurface(props: AppRenderSurfaceProps) {
  const { appKey, result, taskState, onRegenerate } = props;
  const loading = !result && taskState?.status !== 'error';
  const showLoading = useDelayedFlag(loading);
  // 生成失败（含 GENERATION_FAILED）且没有旧成品：所有应用统一进"这次没做出来，再试一次"，
  // 不再让窗口体停在加载态、只有头部一个"失败"小标
  if (!result && taskState?.status === 'error') {
    const app = getWorkshopAppByKey(appKey);
    return (
      <SurfaceFrame phase="error">
        <AppWindowPlaceholder status="error" appKey={appKey} appName={app?.name ?? appKey} errorMessage={taskState.error} onRetry={onRegenerate} />
      </SurfaceFrame>
    );
  }
  // 有"成品"但里面一道题 / 一张卡 / 一个分支都没有（旧缓存或异常返回）：这不是"做好了"，
  // 按失败处理并给"再试一次"——之前窗口体显示空态、顶栏却写着「做好了」，且没有按钮
  if (result && isEmptyAppResult(appKey, result)) {
    const app = getWorkshopAppByKey(appKey);
    return (
      <SurfaceFrame phase="error">
        <AppWindowPlaceholder status="error" appKey={appKey} appName={app?.name ?? appKey} errorMessage="GENERATION_FAILED" onRetry={onRegenerate} />
      </SurfaceFrame>
    );
  }
  if (loading && !showLoading) return <SurfaceFrame phase="waiting" />;
  return <SurfaceFrame phase={loading ? 'loading' : 'ready'}><AppSurfaceBody {...props} /></SurfaceFrame>;
}

function AppSurfaceBody({
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
  hostFullscreen = false,
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
    return <MindmapWindow result={result} transcript={transcript} onSeek={onSeek} defaultViewMode={mindmapDefaultViewMode} hostFullscreen={hostFullscreen} />;
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
    return <ExplainerWindow result={result} transcript={transcript} />;
  }

  return null;
}

export default AppRenderSurface;
