/**
 * Data Hooks 统一导出
 * 
 * 遵循 vercel-react-best-practices 规则：
 * - bundle-barrel-file: 使用命名导出，支持 tree-shaking
 */

// 精选片段 Hook
export { useTopics } from './useTopics';
export type { UseTopicsOptions, UseTopicsReturn, TopicGenerationMode } from './useTopics';

// 课堂摘要 Hook
export { useSummary } from './useSummary';

// AI 家教 Hook
export { useTutor } from './useTutor';
export type { TutorMessage } from './useTutor';

// 会话管理 Hooks
export { useSessions, useSession, useCreateSession } from './useSession';
export type { Session } from './useSession';

// 转录数据 Hook
export { useTranscript } from './useTranscript';
