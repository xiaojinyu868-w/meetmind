/**
 * Collection Store - 管理收集流（Collection Flow）状态
 *
 * 从 page.tsx 迁移的状态覆盖：
 * - 收集项（sourceItems, archivedLocalCollectionItems, supportReferences）
 * - 收集流 UI（collectionComposerText, showCollectionPulsePreview, captureDrivenPulse）
 * - 选择/引用（isCollectionContextSelectionMode, selectedCollectionContextIds 等）
 * - 收集消息菜单（activeCollectionMessageMenuId, confirmCollectionDeleteId）
 * - 文件导入（sourceFilePickerMode, activeSourceImportCount, sourceImportError）
 * - 音频播放（playingAudioMessageId, audioPlaybackState, expandedAudioTranscriptId）
 * - 工作区 capture 编辑器（workspaceCaptureEditor 等）
 *
 * 类型来源：@/types/page-types（single source of truth）
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  SourceIngestItem,
  SupportReferenceItem,
  CollectionPulseState,
  WorkspaceCaptureEditorState,
} from '@/types/page-types';

// ==================== 类型定义 ====================

export interface AudioPlaybackState {
  id: string;
  progress: number;
  currentTime: number;
  duration: number;
}

interface CollectionState {
  // 收集项数据
  sourceItems: SourceIngestItem[];
  archivedLocalCollectionItems: SourceIngestItem[];
  supportReferences: SupportReferenceItem[];

  // 收集流 UI
  collectionComposerText: string;
  showCollectionPulsePreview: boolean;
  captureDrivenPulse: CollectionPulseState | null;
  showScrollToLatest: boolean;

  // 选择/引用模式
  isCollectionContextSelectionMode: boolean;
  selectedCollectionContextIds: string[];
  selectedCollectionPrimaryId: string | null;
  quotedCollectionContextIds: string[];
  quotedCollectionPrimaryId: string | null;
  confirmSelectedCollectionDelete: boolean;

  // 收集消息菜单
  activeCollectionMessageMenuId: string | null;
  confirmCollectionDeleteId: string | null;

  // 文件导入
  sourceFilePickerMode: 'audio' | 'support' | 'all';
  activeSourceImportCount: number;
  sourceImportError: string;

  // 音频播放
  playingAudioMessageId: string | null;
  audioPlaybackState: AudioPlaybackState | null;
  expandedAudioTranscriptId: string | null;

  // 工作区 capture 编辑器
  workspaceCaptureEditor: WorkspaceCaptureEditorState | null;
  workspaceCaptureEditorTitle: string;
  workspaceCaptureEditorBody: string;
  isSavingWorkspaceCaptureEdit: boolean;
}

interface CollectionActions {
  // 收集项
  setSourceItems: (items: SourceIngestItem[] | ((prev: SourceIngestItem[]) => SourceIngestItem[])) => void;
  setArchivedLocalCollectionItems: (items: SourceIngestItem[] | ((prev: SourceIngestItem[]) => SourceIngestItem[])) => void;
  setSupportReferences: (refs: SupportReferenceItem[] | ((prev: SupportReferenceItem[]) => SupportReferenceItem[])) => void;

  // 收集流 UI
  setCollectionComposerText: (text: string | ((prev: string) => string)) => void;
  setShowCollectionPulsePreview: (show: boolean) => void;
  setCaptureDrivenPulse: (pulse: CollectionPulseState | null) => void;
  setShowScrollToLatest: (show: boolean) => void;

  // 选择/引用
  setIsCollectionContextSelectionMode: (mode: boolean) => void;
  setSelectedCollectionContextIds: (ids: string[] | ((prev: string[]) => string[])) => void;
  setSelectedCollectionPrimaryId: (id: string | null) => void;
  setQuotedCollectionContextIds: (ids: string[] | ((prev: string[]) => string[])) => void;
  setQuotedCollectionPrimaryId: (id: string | null) => void;
  setConfirmSelectedCollectionDelete: (confirm: boolean) => void;

  // 消息菜单
  setActiveCollectionMessageMenuId: (id: string | null | ((prev: string | null) => string | null)) => void;
  setConfirmCollectionDeleteId: (id: string | null | ((prev: string | null) => string | null)) => void;

  // 文件导入
  setSourceFilePickerMode: (mode: 'audio' | 'support' | 'all') => void;
  setActiveSourceImportCount: (count: number | ((prev: number) => number)) => void;
  setSourceImportError: (error: string) => void;

  // 音频播放
  setPlayingAudioMessageId: (id: string | null) => void;
  setAudioPlaybackState: (state: AudioPlaybackState | null | ((prev: AudioPlaybackState | null) => AudioPlaybackState | null)) => void;
  setExpandedAudioTranscriptId: (id: string | null | ((prev: string | null) => string | null)) => void;

  // 编辑器
  setWorkspaceCaptureEditor: (editor: WorkspaceCaptureEditorState | null) => void;
  setWorkspaceCaptureEditorTitle: (title: string) => void;
  setWorkspaceCaptureEditorBody: (body: string) => void;
  setIsSavingWorkspaceCaptureEdit: (saving: boolean) => void;

  // 批量重置
  resetCollectionState: () => void;
}

export type CollectionStore = CollectionState & { actions: CollectionActions };

// ==================== 初始状态 ====================

const initialState: CollectionState = {
  sourceItems: [],
  archivedLocalCollectionItems: [],
  supportReferences: [],

  collectionComposerText: '',
  showCollectionPulsePreview: false,
  captureDrivenPulse: null,
  showScrollToLatest: false,

  isCollectionContextSelectionMode: false,
  selectedCollectionContextIds: [],
  selectedCollectionPrimaryId: null,
  quotedCollectionContextIds: [],
  quotedCollectionPrimaryId: null,
  confirmSelectedCollectionDelete: false,

  activeCollectionMessageMenuId: null,
  confirmCollectionDeleteId: null,

  sourceFilePickerMode: 'all',
  activeSourceImportCount: 0,
  sourceImportError: '',

  playingAudioMessageId: null,
  audioPlaybackState: null,
  expandedAudioTranscriptId: null,

  workspaceCaptureEditor: null,
  workspaceCaptureEditorTitle: '',
  workspaceCaptureEditorBody: '',
  isSavingWorkspaceCaptureEdit: false,
};

// ==================== 辅助函数：支持函数式更新 ====================

function resolveUpdate<T>(next: T | ((prev: T) => T), prev: T): T {
  return typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
}

// ==================== Store 实现 ====================

export const useCollectionStore = create<CollectionStore>()(
  devtools(
    (set) => ({
      ...initialState,

      actions: {
        // 收集项
        setSourceItems: (next) => set((s) => ({ sourceItems: resolveUpdate(next, s.sourceItems) }), false, 'setSourceItems'),
        setArchivedLocalCollectionItems: (next) => set((s) => ({ archivedLocalCollectionItems: resolveUpdate(next, s.archivedLocalCollectionItems) }), false, 'setArchivedLocalCollectionItems'),
        setSupportReferences: (next) => set((s) => ({ supportReferences: resolveUpdate(next, s.supportReferences) }), false, 'setSupportReferences'),

        // 收集流 UI
        setCollectionComposerText: (next) => set((s) => ({ collectionComposerText: resolveUpdate(next, s.collectionComposerText) }), false, 'setCollectionComposerText'),
        setShowCollectionPulsePreview: (show) => set({ showCollectionPulsePreview: show }, false, 'setShowCollectionPulsePreview'),
        setCaptureDrivenPulse: (pulse) => set({ captureDrivenPulse: pulse }, false, 'setCaptureDrivenPulse'),
        setShowScrollToLatest: (show) => set({ showScrollToLatest: show }, false, 'setShowScrollToLatest'),

        // 选择/引用
        setIsCollectionContextSelectionMode: (mode) => set({ isCollectionContextSelectionMode: mode }, false, 'setIsCollectionContextSelectionMode'),
        setSelectedCollectionContextIds: (next) => set((s) => ({ selectedCollectionContextIds: resolveUpdate(next, s.selectedCollectionContextIds) }), false, 'setSelectedCollectionContextIds'),
        setSelectedCollectionPrimaryId: (id) => set({ selectedCollectionPrimaryId: id }, false, 'setSelectedCollectionPrimaryId'),
        setQuotedCollectionContextIds: (next) => set((s) => ({ quotedCollectionContextIds: resolveUpdate(next, s.quotedCollectionContextIds) }), false, 'setQuotedCollectionContextIds'),
        setQuotedCollectionPrimaryId: (id) => set({ quotedCollectionPrimaryId: id }, false, 'setQuotedCollectionPrimaryId'),
        setConfirmSelectedCollectionDelete: (confirm) => set({ confirmSelectedCollectionDelete: confirm }, false, 'setConfirmSelectedCollectionDelete'),

        // 消息菜单
        setActiveCollectionMessageMenuId: (next) => set((s) => ({ activeCollectionMessageMenuId: resolveUpdate(next, s.activeCollectionMessageMenuId) }), false, 'setActiveCollectionMessageMenuId'),
        setConfirmCollectionDeleteId: (next) => set((s) => ({ confirmCollectionDeleteId: resolveUpdate(next, s.confirmCollectionDeleteId) }), false, 'setConfirmCollectionDeleteId'),

        // 文件导入
        setSourceFilePickerMode: (mode) => set({ sourceFilePickerMode: mode }, false, 'setSourceFilePickerMode'),
        setActiveSourceImportCount: (next) => set((s) => ({ activeSourceImportCount: resolveUpdate(next, s.activeSourceImportCount) }), false, 'setActiveSourceImportCount'),
        setSourceImportError: (error) => set({ sourceImportError: error }, false, 'setSourceImportError'),

        // 音频播放
        setPlayingAudioMessageId: (id) => set({ playingAudioMessageId: id }, false, 'setPlayingAudioMessageId'),
        setAudioPlaybackState: (next) => set((s) => ({ audioPlaybackState: resolveUpdate(next, s.audioPlaybackState) }), false, 'setAudioPlaybackState'),
        setExpandedAudioTranscriptId: (next) => set((s) => ({ expandedAudioTranscriptId: resolveUpdate(next, s.expandedAudioTranscriptId) }), false, 'setExpandedAudioTranscriptId'),

        // 编辑器
        setWorkspaceCaptureEditor: (editor) => set({ workspaceCaptureEditor: editor }, false, 'setWorkspaceCaptureEditor'),
        setWorkspaceCaptureEditorTitle: (title) => set({ workspaceCaptureEditorTitle: title }, false, 'setWorkspaceCaptureEditorTitle'),
        setWorkspaceCaptureEditorBody: (body) => set({ workspaceCaptureEditorBody: body }, false, 'setWorkspaceCaptureEditorBody'),
        setIsSavingWorkspaceCaptureEdit: (saving) => set({ isSavingWorkspaceCaptureEdit: saving }, false, 'setIsSavingWorkspaceCaptureEdit'),

        // 重置
        resetCollectionState: () => set(initialState, false, 'resetCollectionState'),
      },
    }),
    { name: 'collection-store' }
  )
);

// ==================== Selector Hooks ====================

export const useSourceItems = () => useCollectionStore((s) => s.sourceItems);
export const useArchivedLocalCollectionItems = () => useCollectionStore((s) => s.archivedLocalCollectionItems);
export const useSupportReferences = () => useCollectionStore((s) => s.supportReferences);
export const useCollectionComposerText = () => useCollectionStore((s) => s.collectionComposerText);
export const useShowCollectionPulsePreview = () => useCollectionStore((s) => s.showCollectionPulsePreview);
export const useCaptureDrivenPulse = () => useCollectionStore((s) => s.captureDrivenPulse);
export const useShowScrollToLatest = () => useCollectionStore((s) => s.showScrollToLatest);
export const useIsCollectionContextSelectionMode = () => useCollectionStore((s) => s.isCollectionContextSelectionMode);
export const useSelectedCollectionContextIds = () => useCollectionStore((s) => s.selectedCollectionContextIds);
export const useSelectedCollectionPrimaryId = () => useCollectionStore((s) => s.selectedCollectionPrimaryId);
export const useSourceImportError = () => useCollectionStore((s) => s.sourceImportError);
export const usePlayingAudioMessageId = () => useCollectionStore((s) => s.playingAudioMessageId);
export const useAudioPlaybackState = () => useCollectionStore((s) => s.audioPlaybackState);
export const useWorkspaceCaptureEditor = () => useCollectionStore((s) => s.workspaceCaptureEditor);
export const useIsSavingWorkspaceCaptureEdit = () => useCollectionStore((s) => s.isSavingWorkspaceCaptureEdit);
export const useCollectionActions = () => useCollectionStore((s) => s.actions);

// ==================== 派生 Selector ====================

/** sourceImporting = activeSourceImportCount > 0 */
export const useSourceImporting = () => useCollectionStore((s) => s.activeSourceImportCount > 0);

export default useCollectionStore;
