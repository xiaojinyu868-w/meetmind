/**
 * ChatMermaidBlock —— Mermaid 图表块（M14.5）
 *
 * 对标 ChatGPT / Claude 的 mermaid 体验：
 *   - 检测到 ```mermaid 代码块 → 替代默认代码渲染，调 mermaid.js 转 SVG
 *   - 渲染失败 → 回退到代码块（避免白屏）
 *   - 顶部 header：mermaid badge + 复制源代码 + 下载 SVG
 *   - lazy import：mermaid 是 1.5MB，绝不进入首屏 bundle
 *
 * 性能：
 *   - mermaid.run() 异步，渲染期间显示骨架屏
 *   - streaming 中暂不渲染（等代码段稳定）
 */

'use client';

import * as React from 'react';
import { Copy, Check, Download } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MermaidLite {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
}

let cachedMermaid: MermaidLite | null = null;
let pendingPromise: Promise<MermaidLite> | null = null;

async function loadMermaid(): Promise<MermaidLite> {
  if (cachedMermaid) return cachedMermaid;
  if (pendingPromise) return pendingPromise;

  pendingPromise = (async () => {
    const mod = await import('mermaid');
    const m = (mod.default ?? mod) as MermaidLite;
    // v7 设计宪法：墨松绿 + 米白纸感
    m.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: {
        primaryColor: '#FAF7F2',
        primaryTextColor: '#1C1B19',
        primaryBorderColor: '#2D4F3E',
        lineColor: '#5C5A55',
        secondaryColor: '#E8E2D5',
        tertiaryColor: '#FFFFFF',
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      securityLevel: 'strict',
    });
    cachedMermaid = m;
    return m;
  })();

  return pendingPromise;
}

export interface ChatMermaidBlockProps {
  code: string;
  isStreaming?: boolean;
  className?: string;
}

export const ChatMermaidBlock = React.memo(function ChatMermaidBlock({
  code,
  isStreaming = false,
  className,
}: ChatMermaidBlockProps) {
  const idRef = React.useRef(`mermaid-${Math.random().toString(36).slice(2, 10)}`);
  const [svg, setSvg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (isStreaming) return;
    let cancelled = false;
    setError(null);
    loadMermaid()
      .then(async (m) => {
        try {
          // 每次渲染用新 id 避免 mermaid 内部缓存冲突
          const renderId = `${idRef.current}-${Date.now()}`;
          const { svg } = await m.render(renderId, code);
          if (!cancelled) setSvg(svg);
        } catch (err) {
          if (!cancelled) {
            setSvg(null);
            setError(err instanceof Error ? err.message : '图表渲染失败');
          }
        }
      })
      .catch(() => {
        if (!cancelled) setError('图表引擎加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [code, isStreaming]);

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }, [code]);

  const handleDownload = React.useCallback(() => {
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chart-${Date.now()}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [svg]);

  return (
    <div
      className={cn(
        'group my-3 overflow-hidden rounded-lg border border-divider bg-paper-warm/60',
        className,
      )}
    >
      {/* header */}
      <div className="flex items-center justify-between border-b border-divider/60 bg-paper-warm/80 px-3 py-1.5">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-pine">
          mermaid
        </span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {svg ? (
            <button
              type="button"
              onClick={handleDownload}
              aria-label="下载 SVG"
              title="下载 SVG"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-ink-muted hover:bg-paper-deep hover:text-pine transition-all"
            >
              <Download size={11} strokeWidth={1.8} />
              <span>SVG</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleCopy}
            aria-label="复制源码"
            title="复制 mermaid 源码"
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] transition-all',
              copied ? 'text-pine' : 'text-ink-muted hover:bg-paper-deep hover:text-pine',
            )}
          >
            {copied ? (
              <>
                <Check size={11} strokeWidth={2} />
                <span>已复制</span>
              </>
            ) : (
              <>
                <Copy size={11} strokeWidth={1.8} />
                <span>源码</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* body */}
      {svg ? (
        <div
          className="chat-mermaid-svg flex items-center justify-center overflow-x-auto bg-white p-4"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : error ? (
        <div className="px-3 py-2.5 text-[12.5px]">
          <div className="mb-1.5 text-vermilion">{error}</div>
          <pre className="overflow-x-auto font-mono text-[11.5px] leading-[1.6] text-ink-muted">
            <code>{code}</code>
          </pre>
        </div>
      ) : (
        // 加载/streaming 状态：显示源码
        <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-[1.65] text-ink">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
});

ChatMermaidBlock.displayName = 'ChatMermaidBlock';
