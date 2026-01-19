// 组件统一导出

// 核心组件
export { AudioPlayer } from './AudioPlayer';
export { WaveformPlayer, type WaveformPlayerRef } from './WaveformPlayer';
export { Recorder } from './Recorder';
export { TimelineView } from './TimelineView';

// AI 组件
export { AITutor } from './AITutor';
export { AIChat } from './AIChat';
export { ModelSelector } from './ModelSelector';
export { ConversationList, ConversationItem } from './ConversationHistory';

// Dify 引导组件（新增）
export { GuidanceQuestion, GuidanceQuestionSkeleton } from './GuidanceQuestion';
export { Citations, InlineCitation, CitationsSkeleton } from './Citations';

// 精选片段与摘要组件
export { HighlightsPanel } from './HighlightsPanel';
export { SummaryPanel } from './SummaryPanel';
export { NotesPanel, type EditingNote } from './NotesPanel';
export { AudioUploader } from './AudioUploader';

// 可视化组件
export { ConfusionHeatmap, aggregateConfusionData, type ConfusionData } from './ConfusionHeatmap';
export { ConfusionDetail, ConfusionDetailList, type ConfusionDetailData } from './ConfusionDetail';

// 状态组件
export { ServiceStatus, DegradedModeBanner } from './ServiceStatus';

// 布局组件
export { Header } from './Header';
export { ActionList } from './ActionList';
export { LessonList } from './LessonList';
export { ActionSidebar } from './ActionSidebar';
export { ActionDrawer } from './ActionDrawer';
export { ResizablePanel } from './layout/ResizablePanel';
