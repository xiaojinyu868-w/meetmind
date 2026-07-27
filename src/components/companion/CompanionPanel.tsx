'use client';

/**
 * /companion —— 桌面端小窗（也可是浏览器里的独立页）。
 *
 * 产品判断（AirJelly/Raycast 式就地完成）：
 *   小球点开不该是"几个按钮把你送去主窗口"——链路断在那里。
 *   小窗自己就要能完成最高频的两件事：随手记（收集线）、随口问（同学），
 *   截图/录课/完整现场作为快捷动作挂在底部。
 *
 * 壳内检测：desktop/panel-preload.js 会注入 window.meetmindDesktop，
 * 在浏览器里打开时这些壳能力自动隐藏，降级为普通链接。
 */

import * as React from 'react';
import Image from 'next/image';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { ArrowUp, Camera, Disc3, ExternalLink, X } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';
import { readStoredAccessToken } from '@/lib/hooks/useAuth';
import { cn } from '@/lib/utils';
import styles from './CompanionPanel.module.css';

interface DesktopBridge {
  captureScreen: () => Promise<unknown>;
  showMain: (path?: string) => Promise<unknown>;
  hidePanel: () => Promise<unknown>;
}

function readDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { meetmindDesktop?: DesktopBridge }).meetmindDesktop || null;
}

type PanelMode = 'ask' | 'note';

interface NoteEcho {
  id: number;
  text: string;
  ok: boolean;
}

/** useChat 消息的 parts → 纯文本（底座同款的轻量版） */
function collectText(message: { parts?: Array<{ type: string; text?: string }> } | undefined): string {
  if (!message?.parts) return '';
  return message.parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

export function CompanionPanel() {
  const copy = COPY.desktopPanel;
  const [desktop, setDesktop] = React.useState<DesktopBridge | null>(null);
  const [token, setToken] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);
  const [mode, setMode] = React.useState<PanelMode>('ask');
  const [input, setInput] = React.useState('');
  const [noteEchoes, setNoteEchoes] = React.useState<NoteEcho[]>([]);
  const [noteBusy, setNoteBusy] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const bridge = readDesktopBridge();
    setDesktop(bridge);
    setToken(readStoredAccessToken());
    setReady(true);
    // 壳内透明窗口：让 html/body 透明，面板自身圆角浮起
    if (bridge) {
      document.documentElement.dataset.inDesktop = 'true';
    }
  }, []);

  // 小窗只在首次创建时读 token 会漏掉「之后才在主窗口登录」的情况：
  // 每次重新获得焦点/可见时都刷新登录态（token 变化后 transport 会随之重建）
  React.useEffect(() => {
    const refresh = () => {
      const latest = readStoredAccessToken();
      setToken((current) => (current === latest ? current : latest));
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  const transport = React.useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/tutor/agent',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: () => ({
          mode: 'global',
          sessionId: 'desktop-panel',
          context: {},
          options: {},
        }),
      }),
    [token],
  );
  const { messages, sendMessage, status } = useChat({ transport });
  const asking = status === 'submitted' || status === 'streaming';

  const latestAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const latestAnswer = collectText(latestAssistant);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [latestAnswer, noteEchoes.length, asking]);

  const saveNote = React.useCallback(
    async (text: string) => {
      if (!token) return;
      setNoteBusy(true);
      try {
        const response = await fetch('/api/workspace/captures', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            sourceType: 'manual-note',
            sourceKey: `desktop-note-${Date.now()}`,
            role: 'support',
            contentType: 'text',
            title: text.slice(0, 24),
            normalizedText: text,
            occurredAt: new Date().toISOString(),
            metadata: { channel: 'desktop-panel' },
          }),
        });
        const data = (await response.json().catch(() => null)) as { success?: boolean } | null;
        setNoteEchoes((prev) => [...prev.slice(-5), { id: Date.now(), text, ok: Boolean(data?.success) }]);
      } catch {
        setNoteEchoes((prev) => [...prev.slice(-5), { id: Date.now(), text, ok: false }]);
      } finally {
        setNoteBusy(false);
      }
    },
    [token],
  );

  const handleSend = React.useCallback(() => {
    const text = input.trim();
    if (!text || asking || noteBusy) return;
    setInput('');
    if (mode === 'note') {
      void saveNote(text);
      return;
    }
    void sendMessage({ text });
  }, [input, asking, noteBusy, mode, saveNote, sendMessage]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSend();
    }
  };

  if (!ready) {
    return (
      <div className={styles.page}>
        <div className={styles.panel}>
          <header className={styles.header} data-drag>
            <span className={styles.brand}>
              <Image src="/images/octo-buddy/idle.png" alt="" width={26} height={26} />
              <span>{copy.title}</span>
            </span>
          </header>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className={styles.page}>
        <div className={styles.panel}>
          <header className={styles.header} data-drag>
            <span className={styles.brand}>
              <Image src="/images/octo-buddy/idle.png" alt="" width={26} height={26} />
              <span>{copy.title}</span>
            </span>
            {desktop && (
              <button type="button" className={styles.iconButton} aria-label={copy.collapse} onClick={() => void desktop.hidePanel()}>
                <X size={15} />
              </button>
            )}
          </header>
          <div className={styles.loginHint}>
            <p>{copy.loginHint}</p>
            {desktop ? (
              <button type="button" className={styles.primaryButton} onClick={() => void desktop.showMain('/login')}>
                {copy.loginAction}
              </button>
            ) : (
              <a className={styles.primaryButton} href="/login">{copy.loginAction}</a>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.panel}>
        <header className={styles.header} data-drag>
          <span className={styles.brand}>
            <Image src="/images/octo-buddy/idle.png" alt="" width={26} height={26} />
            <span>{copy.title}</span>
          </span>
          <span className={styles.subtitle}>{copy.subtitle}</span>
          {desktop && (
            <button type="button" className={styles.iconButton} aria-label={copy.collapse} onClick={() => void desktop.hidePanel()}>
              <X size={15} />
            </button>
          )}
        </header>

        <div className={styles.stream} ref={scrollRef}>
          {noteEchoes.map((echo) => (
            <div className={styles.noteEcho} data-ok={echo.ok} key={echo.id}>
              <span className={styles.noteEchoMark} />
              <span className={styles.noteEchoText}>
                {echo.ok ? copy.noteSaved : copy.noteFailed}
                {echo.ok && <em>{echo.text.length > 28 ? `${echo.text.slice(0, 28)}…` : echo.text}</em>}
              </span>
            </div>
          ))}

          {messages.map((message) =>
            message.role === 'user' ? (
              <div className={styles.userBubble} key={message.id}>{collectText(message)}</div>
            ) : (
              <div className={styles.answerBubble} key={message.id}>{collectText(message)}</div>
            ),
          )}
          {asking && !latestAnswer.trim() && (
            <div className={styles.thinking}>
              <span className={styles.thinkingDot} />
              {copy.thinking}
            </div>
          )}
        </div>

        <div className={styles.quickRow}>
          {desktop && (
            <button type="button" className={styles.quickAction} onClick={() => void desktop.captureScreen()}>
              <Camera size={13} />
              {copy.screenshot}
            </button>
          )}
          {desktop && (
            <button type="button" className={styles.quickAction} onClick={() => void desktop.showMain('/app')}>
              <Disc3 size={13} />
              {copy.recordClass}
            </button>
          )}
          {desktop ? (
            <button type="button" className={styles.quickAction} onClick={() => void desktop.showMain('/app')}>
              <ExternalLink size={13} />
              {copy.openFull}
            </button>
          ) : (
            <a className={styles.quickAction} href="/app">
              <ExternalLink size={13} />
              {copy.openFull}
            </a>
          )}
        </div>

        <div className={styles.composer}>
          <div className={styles.modeSwitch} role="tablist">
            {(['ask', 'note'] as const).map((next) => (
              <button
                key={next}
                type="button"
                role="tab"
                aria-selected={mode === next}
                className={cn(styles.modeTab, mode === next && styles.modeTabActive)}
                onClick={() => setMode(next)}
              >
                {next === 'ask' ? copy.modeAsk : copy.modeNote}
              </button>
            ))}
          </div>
          <textarea
            className={styles.input}
            value={input}
            rows={1}
            placeholder={mode === 'ask' ? copy.placeholderAsk : copy.placeholderNote}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            className={styles.sendButton}
            aria-label={copy.send}
            disabled={!input.trim() || asking || noteBusy}
            onClick={handleSend}
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
