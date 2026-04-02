'use client';

import type {
  ClassSummary,
  TranscriptSegment,
} from '@/types';
import type { SharedWorkspaceTab, DataSource } from '@/types/page-types';
import type { Anchor } from '@/lib/services/anchor-service';
import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { WorkshopYellowPage } from '@/components/apps/WorkshopYellowPage';

interface SharedWorkspacePanelProps {
  tab: SharedWorkspaceTab;
  onSeek: (timeMs: number) => void;
  classSummary: ClassSummary | null;
  sessionId: string;
  dataSource: DataSource;
  segments: TranscriptSegment[];
  anchors: Anchor[];
  onOpenAppWindow: (appKey: WorkshopAppKey) => void;
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
}: SharedWorkspacePanelProps) {
  // tab 现在只有 'apps' 一种可能
  return (
    <WorkshopYellowPage
      sessionId={sessionId}
      dataSource={dataSource}
      transcript={segments}
      anchors={anchors}
      summaryOverview={classSummary?.overview}
      keyDifficulties={classSummary?.keyDifficulties}
      onOpenAppWindow={onOpenAppWindow}
    />
  );
}
