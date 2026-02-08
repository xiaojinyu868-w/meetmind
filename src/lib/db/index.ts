/**
 * MeetMind 鏁版嵁搴撴ā鍧?
 * 
 * 缁熶竴瀵煎嚭鎵€鏈夋暟鎹簱鎿嶄綔锛屼繚鎸佸悜鍚庡吋瀹?
 * 
 * 鐩綍缁撴瀯锛?
 * - schema.ts      - 鏁版嵁搴撳畾涔夈€佽〃缁撴瀯銆佺被鍨?
 * - sessions.ts    - 闊抽浼氳瘽鎿嶄綔 (Owner: 褰曢煶妯″潡)
 * - anchors.ts     - 鍥版儜鐐规搷浣?(Owner: 褰曢煶妯″潡)
 * - transcripts.ts - 杞綍鎿嶄綔 (Owner: 褰曢煶妯″潡)
 * - highlights.ts  - 绮鹃€夌墖娈垫搷浣?(Owner: 绗旇鍐呭妯″潡)
 * - summaries.ts   - 璇惧爞鎽樿鎿嶄綔 (Owner: 绗旇鍐呭妯″潡)
 * - notes.ts       - 涓汉绗旇鎿嶄綔 (Owner: 绗旇鍐呭妯″潡)
 * - conversations.ts - 瀵硅瘽鍘嗗彶鎿嶄綔 (Owner: AI瀹舵暀妯″潡)
 * - tutor-cache.ts - AI鍝嶅簲缂撳瓨鎿嶄綔 (Owner: AI瀹舵暀妯″潡)
 * - preferences.ts - 鐢ㄦ埛鍋忓ソ鎿嶄綔 (Owner: 鍩哄缓妯″潡)
 */

// Schema & Types
export {
  db,
  MeetMindDB,
  generateSessionId,
  type AudioSession,
  type Anchor,
  type TranscriptSegment,
  type TranscriptLexiconEntry,
  type TranscriptEditDiff,
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
  ANONYMOUS_USER_ID,
  saveAudioSession,
  updateSessionStatus,
  updateSessionTopic,
  getTodaySessions,
  cleanOldData,
  getStorageUsage,
  getAllSessions,
  getSessionById,
  deleteSession,
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
  addTranscripts,
  getSessionTranscripts,
} from './transcripts';

// Transcript Lexicon
export {
  getTranscriptLexicon,
  upsertTranscriptLexiconEntry,
  recordTranscriptEditDiff,
  getTranscriptEditDiffs,
  seedTranscriptLexicon,
} from './lexicon';

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
  deletePreference,
  resetAppState,
} from './preferences';
