/**
 * useChatFileUpload — 输入条文件上传交互合集。
 *
 * 三入口统一：
 *   1) 点击 Paperclip 按钮选文件
 *   2) 拖拽文件到 dropzone（target ref）
 *   3) 剪贴板粘贴图片（Cmd+V，target ref 上）
 *
 * 内部统一走 `parseFileForChat` —— 文档/图片/音频/视频解析成纯文本。
 * 失败的文件会以 `parseError` 方式暴露（按 file 名携带 message）。
 *
 * 状态：
 *   - attachedFiles: 已成功解析、正在等待发送的文件
 *   - busy: 至少有一个文件在解析中
 *   - error: 最近一次解析失败的提示（5s 后自动清空）
 *
 * 注意：
 *   - 图片当前还是走 OCR/VLM 文字回填（FileParseKind='image' 已支持）；
 *     V2 多模态 inline image 留 TODO，会在 parseFileForChat 升级后无缝接入。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseFileForChat, type FileParseResult } from '@/lib/services/file-parse-service';

export interface AttachedFile {
  id: string;
  title: string;
  text: string;
  characterCount: number;
  kind: FileParseResult['kind'];
}

export interface UseChatFileUploadOptions {
  authToken?: string;
  /** 单文件最大字节（默认 50MB） */
  maxBytes?: number;
  /** dropzone 容器（拖拽 + 粘贴目标）；不传则不启用拖拽/粘贴 */
  targetRef?: React.RefObject<HTMLElement | null> | React.RefObject<HTMLElement>;
  /** 是否允许粘贴图片（剪贴板）。默认 true。 */
  enablePasteImage?: boolean;
  /** 是否允许拖拽。默认 true。 */
  enableDrop?: boolean;
}

export interface UseChatFileUploadResult {
  attachedFiles: AttachedFile[];
  busy: boolean;
  error: string | null;
  isDragging: boolean;
  /** 添加文件（点击按钮场景） */
  addFiles: (files: FileList | File[] | null) => Promise<void>;
  /** 移除一个 attached file */
  removeFile: (id: string) => void;
  /** 清空所有（提交后调用） */
  clear: () => void;
  /** 给 <input type="file" /> 的 onChange 用 */
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function useChatFileUpload({
  authToken,
  maxBytes,
  targetRef,
  enablePasteImage = true,
  enableDrop = true,
}: UseChatFileUploadOptions): UseChatFileUploadResult {
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 错误提示 5s 后自动清
  useEffect(() => {
    if (!error) return;
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(null), 5000);
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, [error]);

  const addFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files) return;
      const list = Array.from(files);
      if (list.length === 0) return;
      setError(null);
      setBusy(true);
      try {
        for (const file of list) {
          try {
            const result = await parseFileForChat(file, { authToken, maxBytes });
            setAttachedFiles((prev) => [
              ...prev,
              {
                id: genId(),
                title: result.title,
                text: result.text,
                characterCount: result.characterCount,
                kind: result.kind,
              },
            ]);
          } catch (err) {
            const msg = err instanceof Error ? err.message : '解析失败';
            setError(`${file.name}：${msg}`);
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [authToken, maxBytes],
  );

  const removeFile = useCallback((id: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clear = useCallback(() => {
    setAttachedFiles([]);
    setError(null);
  }, []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void addFiles(e.target.files);
      e.target.value = '';
    },
    [addFiles],
  );

  // 拖拽 + 粘贴
  useEffect(() => {
    const el = targetRef?.current;
    if (!el) return;
    let dragCounter = 0;

    const handleDragEnter = (e: DragEvent) => {
      if (!enableDrop) return;
      e.preventDefault();
      dragCounter += 1;
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        setIsDragging(true);
      }
    };
    const handleDragLeave = (e: DragEvent) => {
      if (!enableDrop) return;
      e.preventDefault();
      dragCounter -= 1;
      if (dragCounter <= 0) {
        dragCounter = 0;
        setIsDragging(false);
      }
    };
    const handleDragOver = (e: DragEvent) => {
      if (!enableDrop) return;
      e.preventDefault();
    };
    const handleDrop = (e: DragEvent) => {
      if (!enableDrop) return;
      e.preventDefault();
      dragCounter = 0;
      setIsDragging(false);
      if (e.dataTransfer?.files?.length) {
        void addFiles(e.dataTransfer.files);
      }
    };
    const handlePaste = (e: ClipboardEvent) => {
      if (!enablePasteImage) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        void addFiles(files);
      }
    };

    el.addEventListener('dragenter', handleDragEnter);
    el.addEventListener('dragleave', handleDragLeave);
    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('drop', handleDrop);
    el.addEventListener('paste', handlePaste);
    return () => {
      el.removeEventListener('dragenter', handleDragEnter);
      el.removeEventListener('dragleave', handleDragLeave);
      el.removeEventListener('dragover', handleDragOver);
      el.removeEventListener('drop', handleDrop);
      el.removeEventListener('paste', handlePaste);
    };
  }, [targetRef, enableDrop, enablePasteImage, addFiles]);

  return { attachedFiles, busy, error, isDragging, addFiles, removeFile, clear, onInputChange };
}
