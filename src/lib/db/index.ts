/**
 * MeetMind 数据库模块
 * 
 * 统一导出所有数据库操作，保持向后兼容
 * 
 * 目录结构：
 * - schema.ts      - 数据库定义、表结构、类型
 * - sessions.ts    - 音频会话操作 (Owner: 录音模块)
 * - anchors.ts     - 困惑点操作 (Owner: 录音模块)
 * - transcripts.ts - 转录操作 (Owner: 录音模块)
 * - highlights.ts  - 精选片段操作 (Owner: 笔记内容模块)
 * - summaries.ts   - 课堂摘要操作 (Owner: 笔记内容模块)
 * - notes.ts       - 个人笔记操作 (Owner: 笔记内容模块)
 * - conversations.ts - 对话历史操作 (Owner: AI家教模块)
 * - tutor-cache.ts - AI响应缓存操作 (Owner: AI家教模块)
 * - preferences.ts - 用户偏好操作 (Owner: 基建模块)
 */

// Schema & Types
export {
  db,
  MeetMindDB,
  generateSessionId,
  type AudioSession,
  type Anchor,
  type TranscriptSegment,
  type Preference,
  type HighlightTopic,
  type ClassSummary,
  type Note,
  type TutorResponseCache,
  type ConversationHistoryRecord,
  type ConversationMessageRecord,
} from './schema';

// Sessions
export {
  saveAudioSession,
  updateSessionStatus,
  getTodaySessions,
  cleanOldData,
  getStorageUsage,
} from './sessions';

// Anchors
export {
  addAnchor,
  resolveAnchor,
  getSessionAnchors,
} from './anchors';

// Transcripts
export {
  addTranscript,
  getSessionTranscripts,
} from './transcripts';

// Highlights
export {
  saveHighlightTopics,
  getSessionHighlightTopics,
  deleteSessionHighlightTopics,
  updateHighlightTopic,
} from './highlights';

// Summaries
export {
  saveClassSummary,
  getSessionSummary,
  deleteSessionSummary,
  updateClassSummary,
} from './summaries';

// Notes
export {
  addNote,
  getSessionNotes,
  getStudentNotes,
  getAllNotes,
  updateNote,
  deleteNote,
  deleteSessionNotes,
  getNotesBySource,
} from './notes';

// Conversations
export {
  createConversationHistory,
  getConversationById,
  getConversationByAnchorId,
  getUserConversations,
  searchUserConversations,
  updateConversationHistory,
  deleteConversationHistory,
  deleteSessionConversations,
  deleteUserConversations,
  addConversationMessage,
  addConversationMessages,
  getConversationMessages,
  getConversationMessageCount,
  deleteConversationMessages,
} from './conversations';

// Tutor Cache
export {
  saveTutorResponseCache,
  getTutorResponseCache,
  getSessionTutorCaches,
  updateTutorResponseCache,
  deleteTutorResponseCache,
  deleteSessionTutorCaches,
} from './tutor-cache';

// Preferences
export {
  getPreference,
  setPreference,
} from './preferences';
