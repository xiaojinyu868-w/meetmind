/**
 * 个人笔记面板组件
 * 
 * 支持学生在复习时添加和管理笔记
 * 笔记可关联时间戳和转录内容
 */

'use client';

import React, { useState, useMemo } from 'react';
import type { Note, NoteSource, NoteMetadata } from '@/types';

// ============ 类型定义 ============

interface NotesPanelProps {
  notes: Note[];
  isLoading?: boolean;
  onAddNote?: (text: string, source?: NoteSource, metadata?: NoteMetadata) => void;
  onUpdateNote?: (noteId: string, text: string) => void;
  onDeleteNote?: (noteId: string) => void;
  onSeek?: (timeMs: number) => void;
  editingNote?: EditingNote | null;
  onSaveEditingNote?: (payload: { noteText: string; selectedText?: string }) => void;
  onCancelEditing?: () => void;
}

export interface EditingNote {
  text: string;
  metadata?: NoteMetadata | null;
  source?: NoteSource;
}

// ============ 工具函数 ============

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
  
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function getSourceLabel(source: NoteSource): string {
  switch (source) {
    case 'chat':
      return 'AI 对话';
    case 'takeaways':
      return '知识点';
    case 'transcript':
      return '转录';
    case 'custom':
      return '自定义';
    default:
      return '笔记';
  }
}

function getSourceColor(source: NoteSource): string {
  switch (source) {
    case 'chat':
      return 'bg-purple-100 text-purple-700';
    case 'takeaways':
      return 'bg-green-100 text-green-700';
    case 'transcript':
      return 'bg-blue-100 text-blue-700';
    case 'custom':
      return 'bg-gray-100 text-gray-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

// ============ 子组件 ============

interface NoteEditorProps {
  initialText?: string;
  selectedText?: string;
  source?: NoteSource;
  onSave: (text: string) => void;
  onCancel: () => void;
}

function NoteEditor({ initialText = '', selectedText, source, onSave, onCancel }: NoteEditorProps) {
  const [text, setText] = useState(initialText);
  
  return (
    <div className="bg-white rounded-lg border-2 border-blue-500 p-4 shadow-lg">
      {/* 引用内容 */}
      {selectedText && (
        <div className="mb-3 p-3 bg-gray-50 rounded-lg border-l-4 border-blue-400">
          <div className="flex items-center gap-2 mb-1">
            {source && (
              <span className={`px-2 py-0.5 text-xs rounded ${getSourceColor(source)}`}>
                {getSourceLabel(source)}
              </span>
            )}
            <span className="text-xs text-gray-400">引用内容</span>
          </div>
          <p className="text-sm text-gray-600 line-clamp-3">{selectedText}</p>
        </div>
      )}
      
      {/* 编辑区 */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="写下你的笔记..."
        className="w-full h-24 p-3 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
        autoFocus
      />
      
      {/* 操作按钮 */}
      <div className="flex items-center justify-end gap-2 mt-3">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
        >
          取消
        </button>
        <button
          onClick={() => {
            if (text.trim()) {
              onSave(text.trim());
            }
          }}
          disabled={!text.trim()}
          className="px-4 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          保存笔记
        </button>
      </div>
    </div>
  );
}

interface NoteCardProps {
  note: Note;
  onEdit?: () => void;
  onDelete?: () => void;
  onSeek?: (timeMs: number) => void;
}

function NoteCard({ note, onEdit, onDelete, onSeek }: NoteCardProps) {
  const [showActions, setShowActions] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  const timestamp = note.metadata?.transcript?.start;
  const timestampLabel = note.metadata?.timestampLabel;
  
  return (
    <div 
      className="bg-white rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 text-xs rounded ${getSourceColor(note.source)}`}>
            {getSourceLabel(note.source)}
          </span>
          {timestampLabel && timestamp !== undefined && (
            <button
              onClick={() => onSeek?.(timestamp)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {timestampLabel}
            </button>
          )}
        </div>
        
        {/* 操作按钮 */}
        {showActions && (
          <div className="flex items-center gap-1">
            {onEdit && (
              <button
                onClick={onEdit}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                title="编辑"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => {
                  if (isDeleting) {
                    onDelete();
                  } else {
                    setIsDeleting(true);
                    setTimeout(() => setIsDeleting(false), 3000);
                  }
                }}
                className={`p-1.5 rounded transition-colors ${
                  isDeleting 
                    ? 'text-red-600 hover:text-red-700 hover:bg-red-50' 
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                }`}
                title={isDeleting ? '再次点击确认删除' : '删除'}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
      
      {/* 引用内容 */}
      {note.metadata?.selectedText && (
        <div className="mb-2 p-2 bg-gray-50 rounded border-l-2 border-gray-300">
          <p className="text-xs text-gray-500 line-clamp-2">{note.metadata.selectedText}</p>
        </div>
      )}
      
      {/* 笔记内容 */}
      <p className="text-gray-800 whitespace-pre-wrap">{note.text}</p>
      
      {/* 时间 */}
      <p className="mt-2 text-xs text-gray-400">{formatDate(note.createdAt)}</p>
    </div>
  );
}

interface NoteGroupProps {
  title: string;
  notes: Note[];
  onEdit?: (noteId: string) => void;
  onDelete?: (noteId: string) => void;
  onSeek?: (timeMs: number) => void;
}

function NoteGroup({ title, notes, onEdit, onDelete, onSeek }: NoteGroupProps) {
  if (notes.length === 0) return null;
  
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-gray-500 px-1">{title} ({notes.length})</h4>
      {notes.map(note => (
        <NoteCard
          key={note.id}
          note={note}
          onEdit={onEdit ? () => onEdit(note.id) : undefined}
          onDelete={onDelete ? () => onDelete(note.id) : undefined}
          onSeek={onSeek}
        />
      ))}
    </div>
  );
}

// ============ 主组件 ============

export function NotesPanel({
  notes,
  isLoading = false,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onSeek,
  editingNote,
  onSaveEditingNote,
  onCancelEditing
}: NotesPanelProps) {
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  
  // 按来源分组
  const groupedNotes = useMemo(() => {
    const groups: Record<NoteSource, Note[]> = {
      chat: [],
      takeaways: [],
      transcript: [],
      custom: [],
      anchor: []
    };
    
    notes.forEach(note => {
      groups[note.source].push(note);
    });
    
    return groups;
  }, [notes]);
  
  // 有编辑中的笔记（来自外部）
  if (editingNote) {
    return (
      <div className="p-4">
        <NoteEditor
          initialText={editingNote.text}
          selectedText={editingNote.metadata?.selectedText}
          source={editingNote.source}
          onSave={(text) => {
            onSaveEditingNote?.({
              noteText: text,
              selectedText: editingNote.metadata?.selectedText
            });
          }}
          onCancel={() => onCancelEditing?.()}
        />
      </div>
    );
  }
  
  // 空状态
  if (!isLoading && notes.length === 0 && !isAddingNote) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-16 h-16 mb-4 bg-gray-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">暂无笔记</h3>
        <p className="text-gray-500 mb-6 max-w-sm">
          在复习时记录你的想法和问题，支持从转录、AI 对话中引用内容
        </p>
        
        {onAddNote && (
          <button
            onClick={() => setIsAddingNote(true)}
            className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors"
          >
            添加第一条笔记
          </button>
        )}
      </div>
    );
  }
  
  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <span className="text-sm text-gray-500">共 {notes.length} 条笔记</span>
        
        {onAddNote && !isAddingNote && (
          <button
            onClick={() => setIsAddingNote(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            添加笔记
          </button>
        )}
      </div>
      
      {/* 笔记列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 新建笔记编辑器 */}
        {isAddingNote && (
          <NoteEditor
            onSave={(text) => {
              onAddNote?.(text, 'custom');
              setIsAddingNote(false);
            }}
            onCancel={() => setIsAddingNote(false)}
          />
        )}
        
        {/* 编辑现有笔记 */}
        {editingNoteId && (
          <NoteEditor
            initialText={notes.find(n => n.id === editingNoteId)?.text}
            onSave={(text) => {
              onUpdateNote?.(editingNoteId, text);
              setEditingNoteId(null);
            }}
            onCancel={() => setEditingNoteId(null)}
          />
        )}
        
        {/* 分组显示 */}
        {!editingNoteId && (
          <>
            <NoteGroup
              title="AI 对话笔记"
              notes={groupedNotes.chat}
              onEdit={onUpdateNote ? setEditingNoteId : undefined}
              onDelete={onDeleteNote}
              onSeek={onSeek}
            />
            <NoteGroup
              title="知识点笔记"
              notes={groupedNotes.takeaways}
              onEdit={onUpdateNote ? setEditingNoteId : undefined}
              onDelete={onDeleteNote}
              onSeek={onSeek}
            />
            <NoteGroup
              title="转录笔记"
              notes={groupedNotes.transcript}
              onEdit={onUpdateNote ? setEditingNoteId : undefined}
              onDelete={onDeleteNote}
              onSeek={onSeek}
            />
            <NoteGroup
              title="自定义笔记"
              notes={groupedNotes.custom}
              onEdit={onUpdateNote ? setEditingNoteId : undefined}
              onDelete={onDeleteNote}
              onSeek={onSeek}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default NotesPanel;
