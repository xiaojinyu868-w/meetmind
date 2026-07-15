'use client';

import type {
  ClassSummary,
  TranscriptSegment,
} from '@/types';
import type { SharedWorkspaceTab, DataSource } from '@/types/page-types';
import type { Anchor } from '@/lib/services/anchor-service';
import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { WorkshopYellowPage } from '@/components/apps/WorkshopYellowPage';
import { ReviewLearningWorkspace } from '@/components/ReviewLearningWorkspace';

interface SharedWorkspacePanelProps {
  tab: SharedWorkspaceTab;
  onSeek: (timeMs: number) => void;
  classSummary: ClassSummary | null;
  sessionId: string;
  dataSource: DataSource;
  segments: TranscriptSegment[];
  anchors: Anchor[];
  onOpenAppWindow: (appKey: WorkshopAppKey) => void;
  activeAppKey?: WorkshopAppKey | null;
  onActiveAppChange?: (appKey: WorkshopAppKey | null) => void;
  terminologyHint?: string;
  contextTitle?: string;
  onLearningActivity?: (line: string) => void;
}

export function SharedWorkspacePanel({
  tab,
  onSeek,
  classSummary,
  sessionId,
  dataSource,
  segments,
  anchors,
  onOpenAppWindow,
  activeAppKey,
  onActiveAppChange,
  terminologyHint,
  contextTitle,
  onLearningActivity,
}: SharedWorkspacePanelProps) {
  // tab 现在只有 'apps' 一种可能
  if (activeAppKey) {
    return (
      <ReviewLearningWorkspace
        appKey={activeAppKey}
        sessionId={sessionId}
        dataSource={dataSource}
        transcript={segments}
        anchors={anchors}
        summaryOverview={classSummary?.overview}
        keyDifficulties={classSummary?.keyDifficulties}
        terminologyHint={terminologyHint}
        contextTitle={contextTitle}
        onSeek={onSeek}
        onBack={() => onActiveAppChange?.(null)}
        onLearningActivity={onLearningActivity}
      />
    );
  }

  return (
    <WorkshopYellowPage
      sessionId={sessionId}
      dataSource={dataSource}
      transcript={segments}
      anchors={anchors}
      summaryOverview={classSummary?.overview}
      keyDifficulties={classSummary?.keyDifficulties}
      contextTitle={contextTitle}
      onOpenAppWindow={(appKey) => {
        if (onActiveAppChange) {
          onActiveAppChange(appKey);
          return;
        }
        onOpenAppWindow(appKey);
      }}
    />
  );
}
