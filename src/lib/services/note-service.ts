/**
 * 个人笔记服务 (Notes)
 * 
 * 支持学生在复习时添加笔记
 * 笔记可关联时间戳和转录内容
 * 支持从转录、AI对话中引用内容到笔记
 */

import { 
  db, 
  addNote as dbAddNote, 
  getSessionNotes, 
  getStudentNotes, 
  getAllNotes,
  updateNote as dbUpdateNote,
  deleteNote as dbDeleteNote,
  type Note as DBNote
} from '@/lib/db';
import type { Note, NoteSource, NoteMetadata, NoteWithSession } from '@/types';

// ============ 类型转换 ============

/**
 * 将数据库 Note 转换为类型定义的 Note
 */
function dbNoteToNote(dbNote: DBNote): Note {
  return {
    id: dbNote.noteId,
    sessionId: dbNote.sessionId,
    studentId: dbNote.studentId,
    source: dbNote.source,
    sourceId: dbNote.sourceId,
    text: dbNote.text,
    metadata: dbNote.metadata,
    createdAt: dbNote.createdAt.toISOString(),
    updatedAt: dbNote.updatedAt.toISOString()
  };
}

// ============ 笔记创建 ============

export interface CreateNoteParams {
  sessionId: string;
  studentId: string;
  text: string;
  source: NoteSource;
  sourceId?: string;
  metadata?: NoteMetadata;
}

/**
 * 创建新笔记
 */
export async function createNote(params: CreateNoteParams): Promise<Note> {
  const noteId = crypto.randomUUID();
  
  await dbAddNote({
    noteId,
    sessionId: params.sessionId,
    studentId: params.studentId,
    source: params.source,
    sourceId: params.sourceId,
    text: params.text,
    metadata: params.metadata
  });
  
  const now = new Date().toISOString();
  return {
    id: noteId,
    sessionId: params.sessionId,
    studentId: params.studentId,
    source: params.source,
    sourceId: params.sourceId,
    text: params.text,
    metadata: params.metadata,
    createdAt: now,
    updatedAt: now
  };
}

/**
 * 从转录创建笔记
 */
export async function createNoteFromTranscript(
  sessionId: string,
  studentId: string,
  text: string,
  transcriptInfo: {
    start: number;
    end?: number;
    segmentIndex?: number;
    selectedText?: string;
  }
): Promise<Note> {
  return createNote({
    sessionId,
    studentId,
    text,
    source: 'transcript',
    metadata: {
      transcript: {
        start: transcriptInfo.start,
        end: transcriptInfo.end,
        segmentIndex: transcriptInfo.segmentIndex
      },
      selectedText: transcriptInfo.selectedText,
      timestampLabel: formatTimestampLabel(transcriptInfo.start)
    }
  });
}

/**
 * 从 AI 对话创建笔记
 */
export async function createNoteFromChat(
  sessionId: string,
  studentId: string,
  text: string,
  chatInfo: {
    messageId: string;
    role: 'user' | 'assistant';
    selectedText?: string;
  }
): Promise<Note> {
  return createNote({
    sessionId,
    studentId,
    text,
    source: 'chat',
    sourceId: chatInfo.messageId,
    metadata: {
      chat: {
        messageId: chatInfo.messageId,
        role: chatInfo.role,
        timestamp: new Date().toISOString()
      },
      selectedText: chatInfo.selectedText
    }
  });
}

/**
 * 从摘要要点创建笔记
 */
export async function createNoteFromTakeaway(
  sessionId: string,
  studentId: string,
  text: string,
  takeawayInfo: {
    label: string;
    timestamps?: string[];
  }
): Promise<Note> {
  return createNote({
    sessionId,
    studentId,
    text,
    source: 'takeaways',
    metadata: {
      selectedText: takeawayInfo.label,
      extra: {
        timestamps: takeawayInfo.timestamps
      }
    }
  });
}

/**
 * 创建自定义笔记
 */
export async function createCustomNote(
  sessionId: string,
  studentId: string,
  text: string
): Promise<Note> {
  return createNote({
    sessionId,
    studentId,
    text,
    source: 'custom'
  });
}

// ============ 笔记查询 ============

/**
 * 获取会话的所有笔记
 */
export async function getNotesBySession(sessionId: string): Promise<Note[]> {
  const dbNotes = await getSessionNotes(sessionId);
  return dbNotes.map(dbNoteToNote);
}

/**
 * 获取学生的所有笔记
 */
export async function getNotesByStudent(studentId: string): Promise<Note[]> {
  const dbNotes = await getStudentNotes(studentId);
  return dbNotes.map(dbNoteToNote);
}

/**
 * 获取所有笔记（带分页）
 */
export async function getNotesWithPagination(options: {
  offset?: number;
  limit?: number;
  studentId?: string;
}): Promise<Note[]> {
  const dbNotes = await getAllNotes(options);
  return dbNotes.map(dbNoteToNote);
}

/**
 * 获取带会话信息的笔记（用于跨课程笔记管理）
 */
export async function getNotesWithSessionInfo(
  studentId: string,
  options: { offset?: number; limit?: number } = {}
): Promise<NoteWithSession[]> {
  const dbNotes = await getAllNotes({ ...options, studentId });
  
  // 获取所有相关会话
  const sessionIds = [...new Set(dbNotes.map(n => n.sessionId))];
  const sessions = await db.audioSessions
    .where('sessionId')
    .anyOf(sessionIds)
    .toArray();
  
  const sessionMap = new Map(sessions.map(s => [s.sessionId, s]));
  
  return dbNotes.map(dbNote => {
    const session = sessionMap.get(dbNote.sessionId);
    return {
      ...dbNoteToNote(dbNote),
      session: session ? {
        sessionId: session.sessionId,
        subject: session.subject,
        topic: session.topic,
        date: session.createdAt.toISOString().split('T')[0]
      } : null
    };
  });
}

/**
 * 按来源分组获取笔记
 */
export async function getNotesBySourceGrouped(
  sessionId: string
): Promise<Record<NoteSource, Note[]>> {
  const notes = await getNotesBySession(sessionId);
  
  const grouped: Record<NoteSource, Note[]> = {
    chat: [],
    takeaways: [],
    transcript: [],
    custom: []
  };
  
  notes.forEach(note => {
    grouped[note.source].push(note);
  });
  
  return grouped;
}

// ============ 笔记更新 ============

/**
 * 更新笔记内容
 */
export async function updateNoteText(noteId: string, text: string): Promise<void> {
  await dbUpdateNote(noteId, { text });
}

/**
 * 更新笔记元数据
 */
export async function updateNoteMetadata(
  noteId: string, 
  metadata: Partial<NoteMetadata>
): Promise<void> {
  // 获取现有笔记
  const existing = await db.notes.where('noteId').equals(noteId).first();
  if (!existing) return;
  
  await dbUpdateNote(noteId, {
    metadata: { ...existing.metadata, ...metadata }
  });
}

// ============ 笔记删除 ============

/**
 * 删除笔记
 */
export async function deleteNoteById(noteId: string): Promise<void> {
  await dbDeleteNote(noteId);
}

// ============ 工具函数 ============

/**
 * 格式化时间戳标签
 */
function formatTimestampLabel(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * 获取笔记统计
 */
export async function getNoteStats(studentId: string): Promise<{
  total: number;
  bySource: Record<NoteSource, number>;
  recentCount: number;
}> {
  const notes = await getNotesByStudent(studentId);
  
  const bySource: Record<NoteSource, number> = {
    chat: 0,
    takeaways: 0,
    transcript: 0,
    custom: 0
  };
  
  notes.forEach(note => {
    bySource[note.source]++;
  });
  
  // 最近7天的笔记数
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const recentCount = notes.filter(
    n => new Date(n.createdAt) >= weekAgo
  ).length;
  
  return {
    total: notes.length,
    bySource,
    recentCount
  };
}

/**
 * 搜索笔记
 */
export async function searchNotes(
  studentId: string,
  query: string
): Promise<Note[]> {
  const notes = await getNotesByStudent(studentId);
  const lowerQuery = query.toLowerCase();
  
  return notes.filter(note => 
    note.text.toLowerCase().includes(lowerQuery) ||
    note.metadata?.selectedText?.toLowerCase().includes(lowerQuery)
  );
}

export const noteService = {
  // 创建
  create: createNote,
  createFromTranscript: createNoteFromTranscript,
  createFromChat: createNoteFromChat,
  createFromTakeaway: createNoteFromTakeaway,
  createCustom: createCustomNote,
  
  // 查询
  getBySession: getNotesBySession,
  getByStudent: getNotesByStudent,
  getWithPagination: getNotesWithPagination,
  getWithSessionInfo: getNotesWithSessionInfo,
  getBySourceGrouped: getNotesBySourceGrouped,
  
  // 更新
  updateText: updateNoteText,
  updateMetadata: updateNoteMetadata,
  
  // 删除
  delete: deleteNoteById,
  
  // 工具
  getStats: getNoteStats,
  search: searchNotes
};
