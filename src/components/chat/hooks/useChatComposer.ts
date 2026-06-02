/**
 * useChatComposer — 输入条交互合集。
 *
 * 解决三个常见坑：
 *   1) IME（中文输入法）期间 Enter 不触发发送。
 *   2) 草稿持久化 —— 切 chat / 关闭 modal 不丢草稿（按 draftKey 存 sessionStorage）。
 *   3) 自适应高度 —— textarea 1 行 → 8 行平滑增长。
 *
 * 不做的事：
 *   - 不维护 messages 状态（那是 useChat 的事）
 *   - 不挂全局快捷键（焦点丢了也不响应——避免和编辑器冲突）
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseChatComposerOptions {
  /** 草稿持久化 key（例如 sessionId）。不传则不持久化。 */
  draftKey?: string;
  /** 提交回调 —— 由消费者真正发送 */
  onSubmit: (text: string) => void;
  /** 提交后清空草稿，默认 true */
  clearOnSubmit?: boolean;
  /** 是否禁用（busy 时） */
  disabled?: boolean;
  /** Enter 行为：'send' = 直接发，'newline' = 换行。默认 'send'，Shift+Enter 永远换行。 */
  enterBehavior?: 'send' | 'newline';
  /**
   * 大段粘贴回调（M12）—— 当用户从剪贴板粘贴的文本超过 largePasteThreshold 字符时，
   * hook 会**阻止**默认粘贴行为，转而调用此回调，让消费者决定（弹对话框 / 转文件 / 直接接收）。
   * 不传则不拦截，按默认粘贴行为处理。
   */
  onLargePaste?: (text: string) => void;
  /** 大段粘贴阈值（默认 500 字符） */
  largePasteThreshold?: number;
}

export interface UseChatComposerResult {
  value: string;
  setValue: (v: string) => void;
  /** 把 ref 挂到 <textarea> 上，自动维护高度 */
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  /** 把 props 摊到 <textarea> */
  textareaProps: {
    ref: React.RefObject<HTMLTextAreaElement>;
    value: string;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
    onCompositionStart: () => void;
    onCompositionEnd: () => void;
    disabled?: boolean;
  };
  /** 主动触发一次 submit（外部按钮点击时用） */
  submit: () => void;
  /** 是否处于中文输入法 composing 状态（用于禁用某些 enter 触发） */
  isComposing: boolean;
}

const DRAFT_PREFIX = 'mm-chat-draft:';

function loadDraft(key: string): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(DRAFT_PREFIX + key) ?? '';
  } catch {
    return '';
  }
}

function saveDraft(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    if (value.trim()) {
      window.sessionStorage.setItem(DRAFT_PREFIX + key, value);
    } else {
      window.sessionStorage.removeItem(DRAFT_PREFIX + key);
    }
  } catch {
    /* ignore quota */
  }
}

export function useChatComposer({
  draftKey,
  onSubmit,
  clearOnSubmit = true,
  disabled = false,
  enterBehavior = 'send',
  onLargePaste,
  largePasteThreshold = 500,
}: UseChatComposerOptions): UseChatComposerResult {
  const [value, setValueState] = useState<string>(() => (draftKey ? loadDraft(draftKey) : ''));
  const [isComposing, setIsComposing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // draftKey 变化时重新加载草稿（切 session 场景）
  useEffect(() => {
    if (draftKey) setValueState(loadDraft(draftKey));
    else setValueState('');
  }, [draftKey]);

  const setValue = useCallback(
    (v: string) => {
      setValueState(v);
      if (draftKey) saveDraft(draftKey, v);
    },
    [draftKey],
  );

  // 自适应高度
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = 200; // ~8 行
    const next = Math.min(el.scrollHeight, max);
    el.style.height = next + 'px';
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [value]);

  const submit = useCallback(() => {
    if (disabled || isComposing) return;
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
    if (clearOnSubmit) setValue('');
  }, [value, disabled, isComposing, onSubmit, clearOnSubmit, setValue]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // IME composing 中 Enter 永远不发送（中文输入法选词时按 Enter）
      // React 的 e.nativeEvent.isComposing 是最权威的来源；composition flag 兜底
      const composing = isComposing || (e.nativeEvent as KeyboardEvent).isComposing;
      if (e.key !== 'Enter') return;
      if (composing) return;
      if (e.shiftKey) return; // 永远换行
      // Cmd/Ctrl+Enter 永远发送（即使 enterBehavior=newline）
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        submit();
        return;
      }
      if (enterBehavior === 'send') {
        e.preventDefault();
        submit();
      }
      // enterBehavior=newline 时 Enter 让默认行为换行
    },
    [isComposing, enterBehavior, submit],
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);
    },
    [setValue],
  );

  // 大段粘贴拦截（M12）——剪贴板纯文本 > largePasteThreshold 时调用 onLargePaste
  // 让消费者决定（弹对话框 / 转文件 / 直接接收），不传则按默认粘贴
  const onPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!onLargePaste) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text.length >= largePasteThreshold) {
        e.preventDefault();
        onLargePaste(text);
      }
    },
    [onLargePaste, largePasteThreshold],
  );

  return {
    value,
    setValue,
    textareaRef,
    textareaProps: {
      ref: textareaRef,
      value,
      onChange,
      onKeyDown,
      onPaste,
      onCompositionStart: () => setIsComposing(true),
      onCompositionEnd: () => setIsComposing(false),
      disabled,
    },
    submit,
    isComposing,
  };
}
