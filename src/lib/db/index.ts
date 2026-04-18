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
export {
  ANONYMOUS_USER_ID,
  saveAudioSession,
  updateSessionStatus,
  updateSessionTopic,
  getTodaySessions,
  cleanOldData,
  dedupeAudioSessions,
  getStorageUsage,
  getAllSessions,
  getSessionById,
  deleteSession,
} from './sessions';
export {
  addAnchor,
  resolveAnchor,
  getSessionAnchors,
} from './anchors';
export {
  addTranscript,
  addTranscripts,
  getSessionTranscripts,
} from './transcripts';
export {
  getTranscriptLexicon,
  upsertTranscriptLexiconEntry,
  recordTranscriptEditDiff,
  getTranscriptEditDiffs,
  seedTranscriptLexicon,
} from './lexicon';
export {
  saveHighlightTopics,
  getSessionHighlightTopics,
  deleteSessionHighlightTopics,
  updateHighlightTopic,
} from './highlights';
export {
  saveClassSummary,
  getSessionSummary,
  deleteSessionSummary,
  updateClassSummary,
} from './summaries';
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
export {
  saveTutorResponseCache,
  getTutorResponseCache,
  getSessionTutorCaches,
  updateTutorResponseCache,
  deleteTutorResponseCache,
  deleteSessionTutorCaches,
} from './tutor-cache';
export {
  getPreference,
  setPreference,
  deletePreference,
  resetAppState,
} from './preferences';
