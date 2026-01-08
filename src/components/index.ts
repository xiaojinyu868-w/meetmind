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

// Dify 引导组件（新增）
export { GuidanceQuestion, GuidanceQuestionSkeleton } from './GuidanceQuestion';
export { Citations, InlineCitation, CitationsSkeleton } from './Citations';

// 可视化组件
export { ConfusionHeatmap, aggregateConfusionData, type ConfusionData } from './ConfusionHeatmap';
export { ConfusionDetail, ConfusionDetailList, type ConfusionDetailData } from './ConfusionDetail';

// 状态组件
export { ServiceStatus, DegradedModeBanner } from './ServiceStatus';

// 布局组件
export { Header } from './Header';
export { ActionList } from './ActionList';
export { LessonList } from './LessonList';
