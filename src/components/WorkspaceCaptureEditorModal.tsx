'use client';

import { X } from 'lucide-react';
import { useCollectionStore } from '@/stores/collection-store';
import { useWorkspaceCaptureActions } from '@/hooks/useWorkspaceCaptureActions';
import type { WorkspaceCaptureActionsDeps } from '@/hooks/useWorkspaceCaptureActions';

// ── Props ──

export interface WorkspaceCaptureEditorModalProps {
  /** External deps forwarded to useWorkspaceCaptureActions. */
  captureActionsDeps: WorkspaceCaptureActionsDeps;
}

/**
 * 收集编辑器模态框 — 编辑转写 / 文字 / 标题+备注。
 *
 * 所有状态直接从 CollectionStore 读取，编辑/保存动作来自 useWorkspaceCaptureActions。
 * 当 `workspaceCaptureEditor` 为 null 时不渲染任何内容。
 */
export function WorkspaceCaptureEditorModal({ captureActionsDeps }: WorkspaceCaptureEditorModalProps) {
  // ── Store state ──
  const workspaceCaptureEditor = useCollectionStore((s) => s.workspaceCaptureEditor);
  const workspaceCaptureEditorTitle = useCollectionStore((s) => s.workspaceCaptureEditorTitle);
  const workspaceCaptureEditorBody = useCollectionStore((s) => s.workspaceCaptureEditorBody);
  const isSavingWorkspaceCaptureEdit = useCollectionStore((s) => s.isSavingWorkspaceCaptureEdit);

  // ── Store actions ──
  const { setWorkspaceCaptureEditorTitle, setWorkspaceCaptureEditorBody } = useCollectionStore((s) => s.actions);

  // ── Hook actions ──
  const { closeWorkspaceCaptureEditor, saveWorkspaceCaptureEdit } = useWorkspaceCaptureActions(captureActionsDeps);

  if (!workspaceCaptureEditor) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/28 p-3 md:items-center">
      <button
        type="button"
        aria-label="关闭收集编辑器"
        className="absolute inset-0"
        onClick={closeWorkspaceCaptureEditor}
      />
      <div className="relative w-full max-w-lg overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_28px_70px_rgba(15,23,42,0.22)]">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-base font-semibold text-slate-900">
                {workspaceCaptureEditor.mode === 'transcript'
                  ? '校正文字'
                  : workspaceCaptureEditor.mode === 'text'
                    ? '编辑文字'
                    : '编辑标题/备注'}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {workspaceCaptureEditor.mode === 'transcript'
                  ? '把这条转写校正成你真正想保留的版本。'
                  : workspaceCaptureEditor.mode === 'text'
                    ? '直接改这条文字收集，改完会同步回你正在看的收集里。'
                    : '改一下标题或补一句备注，后面更容易回看。'}
              </p>
            </div>
            <button
              type="button"
              onClick={closeWorkspaceCaptureEditor}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
              aria-label="关闭编辑器"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          {workspaceCaptureEditor.mode === 'meta' ? (
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">标题</span>
              <input
                value={workspaceCaptureEditorTitle}
                onChange={(event) => setWorkspaceCaptureEditorTitle(event.target.value)}
                placeholder="给这条收集起个更好找的名字"
                aria-label="收集标题"
                className="w-full rounded-2xl border border-[#E9E9E7] bg-[#F7F7F5] px-4 py-3 text-sm text-[#232322] outline-none transition focus:border-[#232322] focus:bg-white focus:ring-2 focus:ring-[#232322]/10"
              />
            </label>
          ) : null}

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">
              {workspaceCaptureEditor.mode === 'transcript'
                ? '文字内容'
                : workspaceCaptureEditor.mode === 'text'
                  ? '正文'
                  : '备注'}
            </span>
            <textarea
              value={workspaceCaptureEditorBody}
              onChange={(event) => setWorkspaceCaptureEditorBody(event.target.value)}
              placeholder={
                workspaceCaptureEditor.mode === 'transcript'
                  ? '把更准确的转写写在这里'
                  : workspaceCaptureEditor.mode === 'text'
                    ? '把你真正想保留的文字写在这里'
                    : '可选，补一句备注方便以后回看'
              }
              aria-label={
                workspaceCaptureEditor.mode === 'transcript'
                  ? '收集转写文字'
                  : workspaceCaptureEditor.mode === 'text'
                    ? '收集正文'
                    : '收集备注'
              }
              rows={workspaceCaptureEditor.mode === 'meta' ? 4 : 8}
              className="w-full resize-none rounded-2xl border border-[#E9E9E7] bg-[#F7F7F5] px-4 py-3 text-sm leading-6 text-[#232322] outline-none transition focus:border-[#232322] focus:bg-white focus:ring-2 focus:ring-[#232322]/10"
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={closeWorkspaceCaptureEditor}
            className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              void saveWorkspaceCaptureEdit();
            }}
            disabled={isSavingWorkspaceCaptureEdit}
            className="rounded-full bg-[#232322] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#111111] disabled:cursor-not-allowed disabled:bg-[#232322]/40"
          >
            {isSavingWorkspaceCaptureEdit ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
