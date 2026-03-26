'use client';

import type {
  ClassSummary,
  HighlightTopic,
  Note,
  NoteMetadata,
  NoteSource,
  SummaryTakeaway,
  TranscriptSegment,
} from '@/types';
import type { SharedWorkspaceTab, DataSource } from '@/types/page-types';
import type { Anchor } from '@/lib/services/anchor-service';
import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { HighlightsPanel } from '@/components/HighlightsPanel';
import { SummaryPanel } from '@/components/SummaryPanel';
import { NotesPanel } from '@/components/NotesPanel';
import { WorkshopYellowPage } from '@/components/apps/WorkshopYellowPage';

interface SharedWorkspacePanelProps {
  tab: SharedWorkspaceTab;
  highlightTopics: HighlightTopic[];
  selectedTopic: HighlightTopic | null;
  onTopicSelect: (topic: HighlightTopic) => void;
  onPlayTopic: (topic: HighlightTopic) => void;
  onSeek: (timeMs: number) => void;
  onPlayAll: () => void;
  isPlayingAll: boolean;
  playAllIndex: number;
  currentTime: number;
  totalDuration: number;
  isLoadingTopics: boolean;
  onGenerateTopics: () => void;
  onRegenerateByTheme: (theme: string) => void;
  onClearTopics: () => void;
  classSummary: ClassSummary | null;
  isLoadingSummary: boolean;
  onGenerateSummary: () => void;
  onAddNote: (text: string, source?: NoteSource, metadata?: NoteMetadata) => void;
  notes: Note[];
  onUpdateNote: (noteId: string, text: string) => void;
  onDeleteNote: (noteId: string) => void;
  sessionId: string;
  dataSource: DataSource;
  segments: TranscriptSegment[];
  anchors: Anchor[];
  onOpenAppWindow: (appKey: WorkshopAppKey) => void;
}

export function SharedWorkspacePanel({
  tab,
  highlightTopics,
  selectedTopic,
  onTopicSelect,
  onPlayTopic,
  onSeek,
  onPlayAll,
  isPlayingAll,
  playAllIndex,
  currentTime,
  totalDuration,
  isLoadingTopics,
  onGenerateTopics,
  onRegenerateByTheme,
  onClearTopics,
  classSummary,
  isLoadingSummary,
  onGenerateSummary,
  onAddNote,
  notes,
  onUpdateNote,
  onDeleteNote,
  sessionId,
  dataSource,
  segments,
  anchors,
  onOpenAppWindow,
}: SharedWorkspacePanelProps) {
  if (tab === 'highlights') {
    return (
      <HighlightsPanel
        topics={highlightTopics}
        selectedTopic={selectedTopic}
        onTopicSelect={onTopicSelect}
        onPlayTopic={onPlayTopic}
        onSeek={onSeek}
        onPlayAll={onPlayAll}
        isPlayingAll={isPlayingAll}
        playAllIndex={playAllIndex}
        currentTime={currentTime}
        totalDuration={totalDuration}
        isLoading={isLoadingTopics}
        onGenerate={onGenerateTopics}
        onRegenerateByTheme={onRegenerateByTheme}
        onClear={onClearTopics}
      />
    );
  }

  if (tab === 'summary') {
    return (
      <SummaryPanel
        summary={classSummary}
        isLoading={isLoadingSummary}
        onGenerate={onGenerateSummary}
        onSeek={onSeek}
        onAddNote={(text: string, takeaway: SummaryTakeaway) => {
          onAddNote(text, 'takeaways', {
            selectedText: takeaway.label,
            extra: { timestamps: takeaway.timestamps },
          });
        }}
      />
    );
  }

  if (tab === 'apps') {
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

  return (
    <NotesPanel
      notes={notes}
      onAddNote={onAddNote}
      onUpdateNote={onUpdateNote}
      onDeleteNote={onDeleteNote}
      onSeek={onSeek}
    />
  );
}
