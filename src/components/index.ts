// 组件统一导出

// 核心组件
export { WaveformPlayer, type WaveformPlayerRef } from './WaveformPlayer';
export { Recorder } from './Recorder';
export { TimelineView } from './TimelineView';

// AI 组件
export { AITutor } from './AITutor';
export { AIChat } from './AIChat';
export { ModelSelector } from './ModelSelector';
export { ConversationList, ConversationItem } from './ConversationHistory';

// Dify 引导组件
export { GuidanceQuestion, GuidanceQuestionSkeleton } from './GuidanceQuestion';
export { Citations, InlineCitation, CitationsSkeleton } from './Citations';


// 状态组件
export { ServiceStatus, DegradedModeBanner } from './ServiceStatus';

// 布局组件
export { Header } from './Header';
export { ActionList } from './ActionList';
export { ActionSidebar } from './ActionSidebar';
export { ActionDrawer } from './ActionDrawer';
export { ResizablePanel } from './layout/ResizablePanel';
