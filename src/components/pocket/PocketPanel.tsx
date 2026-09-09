'use client';

/**
 * 口袋 —— /companion（桌面小窗 ⌘⇧K，也可以在浏览器里直接开）
 *
 * 形态（对标 Drafts 的"先收再整理" + Apple 快速备忘录的"带着来源"）：
 *   上：今天收进来的东西，一条流，按来源成组（「来自 ChatGPT · 3 条」），每条可撤销、可回原处
 *   下：一行输入——记（写一句 / 粘贴 / 拖进来）或问（同学读过口袋里的东西）
 *   整个面板是拖放与粘贴目标：文字 / HTML / 网址走 /api/workspace/clip，图片走 upload-image → captures
 *
 * 壳内检测：desktop/panel-preload.js 注入 window.meetmindDesktop；浏览器里没有它时壳能力按钮隐藏，
 * 拖放 / 粘贴 / 记 / 问照常可用——所以这一页在普通浏览器里也是一个可用的口袋。
 */

import * as React from 'react';
import Image from 'next/image';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { ArrowUp, Crop, ExternalLink, X } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';
import { POCKET_COPY } from '@/lib/ui/copy-pocket';
import { readStoredAccessToken } from '@/lib/hooks/useAuth';
import { cn } from '@/lib/utils';
import { CompanionMarkdown } from '@/components/classroom/CompanionMarkdown';
import { countToday, formatPocketTime, groupPocketItems, shouldClipPastedHtml, type PocketItem } from './pocket-model';
import styles from './PocketPanel.module.css';

interface DesktopBridge {
  captureScreen: () => Promise<unknown>;
  captureSelection?: () => Promise<unknown>;
  showMain: (path?: string) => Promise<unknown>;
  hidePanel: () => Promise<unknown>;
}

function readDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { meetmindDesktop?: DesktopBridge }).meetmindDesktop || null;
}

type Mode = 'note' | 'ask';

function collectText(message: { parts?: Array<{ type: string; text?: string }> } | undefined): string {
  if (!message?.parts) return '';
  return message.parts.filter((part) => part.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('');
}

function authHeaders(): Record<string, string> {
  const token = readStoredAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function postClip(payload: { text?: string; html?: string; source?: Record<string, string> }): Promise<boolean> {
  const response = await fetch('/api/workspace/clip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ...payload, occurredAt: new Date().toISOString(), clientId: `web-${Date.now().toString(36)}` }),
  });
  const data = (await response.json().catch(() => null)) as { success?: boolean } | null;
  return Boolean(response.ok && data?.success);
}

async function uploadImageFile(file: File): Promise<boolean> {
  const form = new FormData();
  form.append('image', file, file.name || 'drop.png');
  form.append('imageKey', `pocket-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const upload = await fetch('/api/workspace/upload-image', { method: 'POST', headers: authHeaders(), body: form });
  const uploaded = (await upload.json().catch(() => null)) as { success?: boolean; mediaUrl?: string } | null;
  if (!upload.ok || !uploaded?.success || !uploaded.mediaUrl) return false;
  const now = new Date();
  const response = await fetch('/api/workspace/captures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      sourceType: 'desktop-drop',
      sourceKey: `pocket-drop-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'support',
      contentType: 'image',
      title: file.name || '拖进来的图',
      mediaUrl: uploaded.mediaUrl,
      occurredAt: now.toISOString(),
      metadata: { channel: 'desktop-pocket' },
    }),
  });
  return response.ok;
}

async function deleteCapture(captureId: string): Promise<boolean> {
  const response = await fetch('/api/workspace/captures', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ captureId }),
  });
  return response.ok;
}

// ── 单条 ────────────────────────────────────────────────────────────

function PocketClipCard({ item, onRemove }: { item: PocketItem; onRemove: (id: string) => void }) {
  const [expanded, setExpanded] = React.useState(false);
  const isImage = item.contentType === 'image' && item.mediaUrl;
  const body = item.normalizedText || item.previewText || item.title;
  const long = body.length > 320 || body.split('\n').length > 7;
  return (
    <article className={styles.clip} data-kind={isImage ? 'image' : 'text'}>
      {isImage ? (
        <a className={styles.clipImage} href={item.mediaUrl!} target="_blank" rel="noreferrer">
          {/* 口袋里的图是用户自己截的：原图预览，不做 next/image 优化 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.mediaUrl!} alt={item.title} loading="lazy" />
        </a>
      ) : (
        <div className={cn(styles.clipBody, !expanded && long && styles.clipBodyClamped)}>
          <CompanionMarkdown content={body} />
        </div>
      )}
      <footer className={styles.clipFooter}>
        <span className={styles.clipTime}>{formatPocketTime(item.occurredAt)}</span>
        {item.pocket?.hasMath ? <span className={styles.clipBadge}>{POCKET_COPY.mathBadge}</span> : null}
        {!isImage && long ? (
          <button type="button" className={styles.clipAction} onClick={() => setExpanded((value) => !value)}>
            {expanded ? POCKET_COPY.collapseItem : POCKET_COPY.expand}
          </button>
        ) : null}
        <span className={styles.clipSpacer} />
        <button type="button" className={styles.clipAction} onClick={() => onRemove(item.id)}>{POCKET_COPY.remove}</button>
      </footer>
    </article>
  );
}

// ── 面板 ────────────────────────────────────────────────────────────

export function PocketPanel() {
  const [desktop, setDesktop] = React.useState<DesktopBridge | null>(null);
  const [token, setToken] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);
  const [items, setItems] = React.useState<PocketItem[] | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>('note');
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const streamRef = React.useRef<HTMLDivElement>(null);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  const refreshToken = React.useCallback(() => {
    const latest = readStoredAccessToken();
    setToken((current) => (current === latest ? current : latest));
  }, []);

  const load = React.useCallback(async () => {
    if (!readStoredAccessToken()) return;
    try {
      const response = await fetch('/api/workspace/pocket?limit=80&sinceHours=96', { headers: authHeaders() });
      const data = (await response.json().catch(() => null)) as { success?: boolean; items?: PocketItem[] } | null;
      if (!response.ok || !data?.success || !Array.isArray(data.items)) throw new Error('load failed');
      setItems(data.items);
      setLoadError(false);
    } catch {
      setLoadError(true);
      setItems((current) => current ?? []);
    }
  }, []);

  React.useEffect(() => {
    const bridge = readDesktopBridge();
    setDesktop(bridge);
    refreshToken();
    setReady(true);
    if (bridge) document.documentElement.dataset.inDesktop = 'true';
  }, [refreshToken]);

  // 小窗每次被唤起（focus / visible）都刷新：热键在主进程收下的东西要立刻出现在流里
  React.useEffect(() => {
    const refresh = () => { refreshToken(); void load(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load, refreshToken]);

  React.useEffect(() => { if (token) void load(); }, [token, load]);

  const flash = React.useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((current) => (current === text ? null : current)), 1800);
  }, []);

  // 问：同学读过口袋里的东西（服务端 global 模式带工作区收集）
  const transport = React.useMemo(
    () => new DefaultChatTransport({
      api: '/api/tutor/agent',
      headers: (): Record<string, string> => authHeaders(),
      body: () => ({ mode: 'global', sessionId: 'desktop-pocket', context: {}, options: {} }),
    }),
    [],
  );
  const { messages, sendMessage, status } = useChat({ transport });
  const asking = status === 'submitted' || status === 'streaming';
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  const latestAnswer = collectText(latestAssistant);

  React.useEffect(() => {
    if (mode === 'ask') streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight });
  }, [latestAnswer, asking, mode]);

  const saveNote = React.useCallback(async (text: string, html?: string) => {
    setBusy(true);
    try {
      const ok = await postClip({ text, html, source: { app: desktop ? 'pocket' : 'web-pocket' } });
      flash(ok ? POCKET_COPY.saved : POCKET_COPY.saveFailed);
      if (ok) void load();
      return ok;
    } catch {
      flash(POCKET_COPY.saveFailed);
      return false;
    } finally {
      setBusy(false);
    }
  }, [desktop, flash, load]);

  const handleSend = React.useCallback(() => {
    const text = input.trim();
    if (!text || busy || asking) return;
    setInput('');
    if (mode === 'note') { void saveNote(text); return; }
    void sendMessage({ text });
  }, [input, busy, asking, mode, saveNote, sendMessage]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSend();
    }
  };

  // 粘贴：带结构的 HTML / 图片直接收进口袋；一句话留在输入框里
  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const data = event.clipboardData;
    const files = Array.from(data.files || []).filter((file) => file.type.startsWith('image/'));
    if (files.length > 0) {
      event.preventDefault();
      void handleFiles(files);
      return;
    }
    const html = data.getData('text/html');
    const text = data.getData('text/plain');
    if (mode === 'note' && shouldClipPastedHtml(text, html)) {
      event.preventDefault();
      void (async () => {
        const ok = await saveNote(text, html);
        if (ok) flash(POCKET_COPY.pastedRich);
      })();
    }
  };

  const handleFiles = React.useCallback(async (files: File[]) => {
    setBusy(true);
    try {
      let count = 0;
      for (const file of files.slice(0, 5)) {
        if (await uploadImageFile(file)) count += 1;
      }
      flash(count > 0 ? POCKET_COPY.imageUploaded(count) : POCKET_COPY.saveFailed);
      if (count > 0) void load();
    } finally {
      setBusy(false);
    }
  }, [flash, load]);

  // 整个面板是拖放目标
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files || []).filter((file) => file.type.startsWith('image/'));
    if (files.length > 0) { void handleFiles(files); return; }
    const text = event.dataTransfer.getData('text/plain');
    const html = event.dataTransfer.getData('text/html');
    const uri = (event.dataTransfer.getData('text/uri-list') || '').split('\n').find((line) => line && !line.startsWith('#')) || '';
    if (!text.trim() && !html.trim() && !uri.trim()) return;
    void (async () => {
      setBusy(true);
      try {
        const ok = await postClip({ text: text || uri, html, source: { app: 'drag', ...(uri ? { url: uri } : {}) } });
        flash(ok ? POCKET_COPY.saved : POCKET_COPY.saveFailed);
        if (ok) void load();
      } finally {
        setBusy(false);
      }
    })();
  };

  const handleRemove = React.useCallback(async (id: string) => {
    setItems((current) => (current ? current.filter((item) => item.id !== id) : current));
    const ok = await deleteCapture(id);
    flash(ok ? POCKET_COPY.removed : POCKET_COPY.saveFailed);
    if (!ok) void load();
  }, [flash, load]);

  const groups = React.useMemo(() => groupPocketItems(items ?? []), [items]);
  const todayCount = React.useMemo(() => countToday(items ?? []), [items]);

  const header = (
    <header className={styles.header} data-drag>
      <span className={styles.brand}>
        <Image src="/images/octo-buddy/idle.png" alt="" width={22} height={22} />
        <span>{POCKET_COPY.title}</span>
        {items ? <span className={styles.count}>{POCKET_COPY.todayCount(todayCount)}</span> : null}
      </span>
      {desktop ? <span className={styles.hotkey}>{isMac ? POCKET_COPY.hotkeyHint : POCKET_COPY.hotkeyHintWin}</span> : null}
      {desktop ? (
        <button type="button" className={styles.iconButton} aria-label={POCKET_COPY.collapse} onClick={() => void desktop.hidePanel()}>
          <X size={15} />
        </button>
      ) : null}
    </header>
  );

  if (!ready) {
    return <div className={styles.page}><div className={styles.panel}>{header}</div></div>;
  }

  if (!token) {
    return (
      <div className={styles.page}>
        <div className={styles.panel}>
          {header}
          <div className={styles.loginHint}>
            <p>{POCKET_COPY.loginHint}</p>
            {desktop ? (
              <button type="button" className={styles.primaryButton} onClick={() => void desktop.showMain('/login')}>{POCKET_COPY.loginAction}</button>
            ) : (
              <a className={styles.primaryButton} href="/login">{POCKET_COPY.loginAction}</a>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div
        className={cn(styles.panel, dragging && styles.panelDragging)}
        onDragOver={(event) => { event.preventDefault(); if (!dragging) setDragging(true); }}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
        onDrop={handleDrop}
      >
        {header}

        <div className={styles.stream} ref={streamRef}>
          {mode === 'ask' && messages.length > 0 ? (
            <div className={styles.askThread}>
              {messages.map((message) => (
                message.role === 'user'
                  ? <div className={styles.userBubble} key={message.id}>{collectText(message)}</div>
                  : <div className={styles.answerBubble} key={message.id}><CompanionMarkdown content={collectText(message)} /></div>
              ))}
              {asking && !latestAnswer.trim() ? <div className={styles.thinking}><span className={styles.thinkingDot} />{POCKET_COPY.thinking}</div> : null}
            </div>
          ) : null}

          {items === null ? (
            <p className={styles.quiet}>{POCKET_COPY.loading}</p>
          ) : loadError && items.length === 0 ? (
            <p className={styles.quiet}>{POCKET_COPY.loadFailed}</p>
          ) : groups.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>{POCKET_COPY.emptyTitle}</p>
              <p className={styles.emptyBody}>{desktop ? POCKET_COPY.emptyBody : POCKET_COPY.emptyBrowserBody}</p>
              {desktop ? (
                <button type="button" className={styles.ghostButton} onClick={() => void desktop.captureScreen()}>
                  <Crop size={13} />{POCKET_COPY.captureRegion}
                </button>
              ) : null}
            </div>
          ) : (
            groups.map((group) => (
              <section className={styles.group} key={group.key}>
                <header className={styles.groupHead}>
                  <span className={styles.groupSource}>{group.label}</span>
                  <span className={styles.groupMeta}>{POCKET_COPY.groupCount(group.items.length)}</span>
                  {group.url ? (
                    <a className={styles.groupLink} href={group.url} target="_blank" rel="noreferrer">
                      {POCKET_COPY.openSource}<ExternalLink size={11} />
                    </a>
                  ) : null}
                </header>
                {group.items.map((item) => <PocketClipCard key={item.id} item={item} onRemove={handleRemove} />)}
              </section>
            ))
          )}
        </div>

        {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
        {dragging ? <div className={styles.dropVeil}>{POCKET_COPY.dropHere}</div> : null}

        <div className={styles.composer}>
          <div className={styles.modeSwitch} role="tablist">
            {(['note', 'ask'] as const).map((next) => (
              <button key={next} type="button" role="tab" aria-selected={mode === next}
                className={cn(styles.modeTab, mode === next && styles.modeTabActive)} onClick={() => setMode(next)}>
                {next === 'note' ? POCKET_COPY.modeNote : POCKET_COPY.modeAsk}
              </button>
            ))}
          </div>
          <textarea
            className={styles.input}
            value={input}
            rows={1}
            placeholder={mode === 'note' ? POCKET_COPY.placeholderNote : POCKET_COPY.placeholderAsk}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />
          {desktop ? (
            <button type="button" className={styles.iconButton} aria-label={POCKET_COPY.captureRegion} title={POCKET_COPY.captureRegion} onClick={() => void desktop.captureScreen()}>
              <Crop size={15} />
            </button>
          ) : null}
          <button type="button" className={styles.sendButton} aria-label={POCKET_COPY.send} disabled={!input.trim() || busy || asking} onClick={handleSend}>
            <ArrowUp size={16} />
          </button>
        </div>
        <div className={styles.footRow}>
          {desktop ? (
            <button type="button" className={styles.footLink} onClick={() => void desktop.showMain('/app')}>{POCKET_COPY.openFull}</button>
          ) : (
            <a className={styles.footLink} href="/app">{POCKET_COPY.openFull}</a>
          )}
          <span className={styles.footBrand}>{COPY.identity.productName}</span>
        </div>
      </div>
    </div>
  );
}
