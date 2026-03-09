'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  ANONYMOUS_USER_ID,
  deleteSession,
  getAllSessions,
  type AudioSession,
  updateSessionTopic,
} from '@/lib/db';
import { cn } from '@/lib/utils';

interface SessionHistoryListProps {
  userId?: string;
  onSessionSelect: (session: AudioSession) => void;
  onClose?: () => void;
  activeSessionId?: string;
  maxHeight?: string;
  showHeader?: boolean;
  className?: string;
  variant?: 'default' | 'capture';
}

function dedupeSessionsBySessionId(list: AudioSession[]): AudioSession[] {
  const map = new Map<string, AudioSession>();

  for (const item of list) {
    const existing = map.get(item.sessionId);
    if (!existing) {
      map.set(item.sessionId, item);
      continue;
    }

    const existingTime = new Date(existing.updatedAt).getTime();
    const nextTime = new Date(item.updatedAt).getTime();
    if (Number.isFinite(nextTime) && nextTime >= existingTime) {
      map.set(item.sessionId, item);
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function buildSessionTitle(session: AudioSession) {
  return (
    session.topic ||
    session.subject ||
    new Date(session.createdAt).toLocaleDateString('zh-CN', {
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  );
}

function buildCaptureHint(session: AudioSession) {
  if (session.sourceType === 'video-link') {
    return '这节视频已经收进来了，随时可以接着复习。';
  }
  return '这段内容已经收进来了，随时可以接着复习。';
}

function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  onConfirm,
  onCancel,
  variant = 'danger',
}: {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'warning';
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center gap-3">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full',
              variant === 'danger' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
            )}
          >
            {variant === 'danger' ? (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            )}
          </div>
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        </div>
        <p className="mb-5 text-sm leading-6 text-slate-600">{message}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              'flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-white transition',
              variant === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
            )}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

function RenameInput({
  isOpen,
  currentName,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  currentName: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setValue(currentName);
    window.setTimeout(() => inputRef.current?.focus(), 80);
  }, [currentName, isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-slate-900">重命名记录</h3>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim()) {
              onConfirm(value.trim());
            }
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="mb-4 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
            placeholder="给这条记录起个名字"
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="flex-1 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SessionItem({
  session,
  isActive,
  onSelect,
  onRename,
  onDelete,
  variant = 'default',
}: {
  session: AudioSession;
  isActive: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
  variant?: 'default' | 'capture';
}) {
  const timeAgo = formatDistanceToNow(new Date(session.createdAt), {
    addSuffix: true,
    locale: zhCN,
  });
  const title = buildSessionTitle(session);
  const isVideoSession = session.sourceType === 'video-link';

  if (variant === 'capture') {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'group w-full rounded-[20px] border px-4 py-3 text-left transition-all duration-200',
          isActive
            ? 'border-emerald-200 bg-emerald-50/80 shadow-sm'
            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold shadow-sm',
              isActive ? 'bg-white text-emerald-700' : 'bg-slate-100 text-slate-500'
            )}
          >
            {isVideoSession ? '视' : '录'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                {isVideoSession ? '视频' : '录音'}
              </span>
              <span className="text-[11px] text-slate-400">{timeAgo}</span>
            </div>
            <p className="mt-1 truncate text-sm font-semibold text-slate-900">{title}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{buildCaptureHint(session)}</p>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
              <span>{formatDuration(session.duration)}</span>
              {session.subject ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{session.subject}</span>
                </>
              ) : null}
            </div>
          </div>
          <svg
            className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>
    );
  }

  return (
    <div
      onClick={onSelect}
      className={cn(
        'group cursor-pointer rounded-lg border border-transparent p-3 transition-all duration-200',
        isActive ? 'border-amber-200 bg-amber-50 shadow-sm' : 'hover:bg-slate-50'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
              {isVideoSession ? '视频' : '录音'}
            </span>
            <h4 className={cn('truncate text-sm font-medium', isActive ? 'text-amber-900' : 'text-slate-900')}>
              {title}
            </h4>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-400">
            <span>{timeAgo}</span>
            <span>·</span>
            <span>{formatDuration(session.duration)}</span>
            {session.subject ? (
              <>
                <span>·</span>
                <span className="text-slate-500">{session.subject}</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {session.status === 'completed' ? (
            <span className="mr-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
              已完成
            </span>
          ) : null}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onRename();
            }}
            className="rounded-md p-1.5 text-slate-400 opacity-0 transition-all duration-200 hover:bg-amber-50 hover:text-amber-600 group-hover:opacity-100"
            title="重命名"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className="rounded-md p-1.5 text-slate-400 opacity-0 transition-all duration-200 hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
            title="删除记录"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export function SessionHistoryList({
  userId,
  onSessionSelect,
  onClose,
  activeSessionId,
  maxHeight = '400px',
  showHeader = true,
  className,
  variant = 'default',
}: SessionHistoryListProps) {
  const [sessions, setSessions] = useState<AudioSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AudioSession | null>(null);
  const [renameTarget, setRenameTarget] = useState<AudioSession | null>(null);

  const headerTitle = variant === 'capture' ? '历史收集' : '录音历史';
  const emptyStateIcon = variant === 'capture' ? '🗂️' : '🎙️';
  const emptyTitle = variant === 'capture' ? '还没有历史收集' : '暂无录音记录';
  const emptyHint =
    variant === 'capture'
      ? '先收一点进来，后面就能从这里接着学。'
      : '录音或上传音频后，会自动保存在这里。';

  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const currentUserId = userId || ANONYMOUS_USER_ID;
      const data = await getAllSessions(currentUserId);
      setSessions(dedupeSessionsBySessionId(data));
    } catch (err) {
      console.error('加载会话历史失败:', err);
      setError('加载失败，请稍后再试。');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const footerText = useMemo(() => {
    if (sessions.length === 0) {
      return '';
    }
    return `共 ${sessions.length} 条录音记录`;
  }, [sessions.length]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) {
      return;
    }

    try {
      await deleteSession(deleteTarget.sessionId);
      setSessions((prev) => prev.filter((session) => session.sessionId !== deleteTarget.sessionId));
      setDeleteTarget(null);
    } catch (err) {
      console.error('删除会话失败:', err);
      toast.error('删除失败，请稍后再试。');
    }
  }, [deleteTarget]);

  const handleRename = useCallback(
    async (newName: string) => {
      if (!renameTarget) {
        return;
      }

      try {
        await updateSessionTopic(renameTarget.sessionId, newName);
        setSessions((prev) =>
          prev.map((session) =>
            session.sessionId === renameTarget.sessionId
              ? { ...session, topic: newName }
              : session
          )
        );
        setRenameTarget(null);
      } catch (err) {
        console.error('重命名会话失败:', err);
        toast.error('重命名失败，请稍后再试。');
      }
    },
    [renameTarget]
  );

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {showHeader ? (
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-3">
          <h3 className="text-sm font-semibold text-slate-900">{headerTitle}</h3>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label="关闭"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto p-2" style={{ maxHeight }}>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="flex gap-1">
              <div className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '0ms' }} />
              <div className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '150ms' }} />
              <div className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="mb-2 text-sm text-red-600">{error}</p>
            <button type="button" onClick={() => void loadSessions()} className="text-sm text-amber-600 hover:text-amber-700">
              重试
            </button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="py-8 text-center">
            <div className="mb-2 text-3xl">{emptyStateIcon}</div>
            <p className="text-sm text-slate-500">{emptyTitle}</p>
            <p className="mt-1 text-xs text-slate-400">{emptyHint}</p>
          </div>
        ) : (
          <div className={variant === 'capture' ? 'space-y-2' : 'space-y-1'}>
            {sessions.map((session) => (
              <SessionItem
                key={`${session.sessionId}-${session.id ?? session.createdAt}`}
                session={session}
                isActive={session.sessionId === activeSessionId}
                onSelect={() => onSessionSelect(session)}
                onRename={() => setRenameTarget(session)}
                onDelete={() => setDeleteTarget(session)}
                variant={variant}
              />
            ))}
          </div>
        )}
      </div>

      {!isLoading && sessions.length > 0 && variant === 'default' ? (
        <div className="border-t border-slate-100 p-2 text-center">
          <span className="text-xs text-slate-400">{footerText}</span>
        </div>
      ) : null}

      {variant === 'default' ? (
        <>
          <ConfirmDialog
            isOpen={!!deleteTarget}
            title="删除录音记录"
            message="确定要删除这条录音记录吗？相关的转录和笔记也会一起删除，这个操作无法撤销。"
            confirmText="删除"
            cancelText="取消"
            onConfirm={handleDelete}
            onCancel={() => setDeleteTarget(null)}
            variant="danger"
          />
          <RenameInput
            isOpen={!!renameTarget}
            currentName={renameTarget?.topic || renameTarget?.subject || ''}
            onConfirm={handleRename}
            onCancel={() => setRenameTarget(null)}
          />
        </>
      ) : null}
    </div>
  );
}
