/**
 * useNoteActions
 *
 * 笔记 CRUD — 从 page.tsx 提取（Phase 6）
 *
 * 包含：
 *   handleAddNote    — 添加新笔记
 *   handleUpdateNote — 更新已有笔记文本
 *   handleDeleteNote — 删除笔记
 *
 * 遵循 (deps) 模式。Store 写入通过 getState().actions。
 */

import { useCallback } from 'react';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import type { Note, NoteSource, NoteMetadata } from '@/types';

// ── Deps interface ──

interface UseNoteActionsDeps {
  sessionId: string;
  studentId: string;
}

// ── Hook ──

export function useNoteActions(deps: UseNoteActionsDeps) {
  const { sessionId, studentId } = deps;

  // 添加一条笔记
  const handleAddNote = useCallback((text: string, source: NoteSource = 'custom', metadata?: NoteMetadata) => {
    const newNote: Note = {
      id: crypto.randomUUID(),
      sessionId,
      studentId,
      source,
      text,
      metadata,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    useCaptureEditorStore.getState().actions.setNotes(prev => [newNote, ...prev]);
  }, [sessionId, studentId]);

  // 更新已有笔记
  const handleUpdateNote = useCallback((noteId: string, text: string) => {
    useCaptureEditorStore.getState().actions.setNotes(prev => prev.map(n =>
      n.id === noteId ? { ...n, text, updatedAt: new Date().toISOString() } : n
    ));
  }, []);

  // 删除一条笔记
  const handleDeleteNote = useCallback((noteId: string) => {
    useCaptureEditorStore.getState().actions.setNotes(prev => prev.filter(n => n.id !== noteId));
  }, []);

  return {
    handleAddNote,
    handleUpdateNote,
    handleDeleteNote,
  };
}
