/**
 * 个人笔记 (Note) 数据库操作
 * Owner: 笔记内容模块开发者
 */

import { db, type Note } from './schema';

/** 添加笔记 */
export async function addNote(
  note: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>
): Promise<number> {
  const now = new Date();
  return db.notes.add({
    ...note,
    createdAt: now,
    updatedAt: now
  });
}

/** 获取会话的所有笔记 */
export async function getSessionNotes(sessionId: string): Promise<Note[]> {
  return db.notes
    .where('sessionId')
    .equals(sessionId)
    .sortBy('createdAt');
}

/** 获取学生的所有笔记 */
export async function getStudentNotes(studentId: string): Promise<Note[]> {
  return db.notes
    .where('studentId')
    .equals(studentId)
    .reverse()
    .sortBy('createdAt');
}

/** 获取所有笔记（带分页） */
export async function getAllNotes(options: {
  offset?: number;
  limit?: number;
  studentId?: string;
} = {}): Promise<Note[]> {
  let query = db.notes.orderBy('createdAt').reverse();
  
  if (options.studentId) {
    query = db.notes.where('studentId').equals(options.studentId).reverse();
  }
  
  if (options.offset) {
    query = query.offset(options.offset);
  }
  
  if (options.limit) {
    query = query.limit(options.limit);
  }
  
  return query.toArray();
}

/** 更新笔记 */
export async function updateNote(
  noteId: string,
  updates: Partial<Omit<Note, 'id' | 'noteId' | 'sessionId' | 'studentId' | 'createdAt'>>
): Promise<number> {
  return db.notes
    .where('noteId')
    .equals(noteId)
    .modify({ ...updates, updatedAt: new Date() });
}

/** 删除笔记 */
export async function deleteNote(noteId: string): Promise<number> {
  return db.notes
    .where('noteId')
    .equals(noteId)
    .delete();
}

/** 删除会话的所有笔记 */
export async function deleteSessionNotes(sessionId: string): Promise<number> {
  return db.notes
    .where('sessionId')
    .equals(sessionId)
    .delete();
}

/** 按来源获取笔记 */
export async function getNotesBySource(
  sessionId: string,
  source: Note['source']
): Promise<Note[]> {
  return db.notes
    .where(['sessionId', 'source'])
    .equals([sessionId, source])
    .sortBy('createdAt');
}
