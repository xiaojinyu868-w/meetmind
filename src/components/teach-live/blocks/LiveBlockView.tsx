'use client';

/**
 * LiveBlockView —— 板上的一块（按 kind 分发到渲染器）。
 *
 * 只渲染「至少有一个 segment 已 reveal」的块；进入时带上浮淡入。
 * 每种渲染器只认自己的正文格式：
 *   svg   → ProgressiveSvg（逐元素描画，支持多 segment 追加）
 *   plot  → plot-dsl 编译成 SVG → ProgressiveSvg（一次性 reveal，曲线也是描出来的）
 *   math  → KaTeX display
 *   note  → react-markdown（gfm + math）
 *   code  → ChatCodeBlock（shiki，流式中不高亮）
 *   diagram → mermaid（lazy），失败回退显示源码
 *   anim  → 无脚本 iframe srcdoc（SVG 里的 <style>/SMIL 只作用于自己那一格）
 *   widget → allow-scripts 沙箱 iframe，postMessage 自报高度
 *   image → 占位卡 → image-ready 后淡入
 *   ask   → 提问卡（老师停下来等）
 */

import * as React from 'react';
import katex from 'katex';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ChatCodeBlock } from '@/components/chat/ChatCodeBlock';
import { MathText } from '@/components/apps/windows/MathText';
import { TEACH_LIVE_COPY } from '@/lib/ui/copy-teach-live';
import type { LiveBlock } from '../live-model';
import { revealedBody } from '../live-model';
import { compilePlotSvg, parsePlot } from '../plot-dsl';
import { ProgressiveSvg } from './ProgressiveSvg';
import { DrawBlock } from '../draw/DrawBlock';

// ---------- math ----------

function MathBlock({ body, label }: { body: string; label?: string }) {
  const html = React.useMemo(() => {
    const tex = body.replace(/^\s*\$+|\$+\s*$/g, '').replace(/^\\\[|\\\]$/g, '').trim();
    try {
      return katex.renderToString(tex, { displayMode: true, throwOnError: false, strict: 'ignore', output: 'html' });
    } catch {
      return `<code>${tex}</code>`;
    }
  }, [body]);
  return (
    <div className="live-math">
      {label ? <div className="live-block-label">{label}</div> : null}
      <div className="live-math-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

// ---------- note ----------

const NoteBlock = React.memo(function NoteBlock({ body }: { body: string }) {
  return (
    <div className="live-note">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {body}
      </ReactMarkdown>
    </div>
  );
});

// ---------- diagram（mermaid lazy） ----------

interface MermaidLite {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
}
let mermaidPromise: Promise<MermaidLite> | null = null;
function loadMermaid(): Promise<MermaidLite> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const m = (mod.default ?? mod) as MermaidLite;
      m.initialize({
        startOnLoad: false,
        theme: 'base',
        securityLevel: 'strict',
        themeVariables: {
          primaryColor: '#EAF3EE',
          primaryTextColor: '#20312A',
          primaryBorderColor: '#2F6B55',
          lineColor: '#53645C',
          secondaryColor: '#F5EBDD',
          tertiaryColor: '#FFFFFF',
          fontSize: '18px',
          fontFamily: '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif',
        },
        flowchart: { curve: 'basis', padding: 12 },
      });
      return m;
    });
  }
  return mermaidPromise;
}

function DiagramBlock({ body, complete }: { body: string; complete: boolean }) {
  const [svg, setSvg] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const idRef = React.useRef(`live-mermaid-${Math.random().toString(36).slice(2, 10)}`);
  React.useEffect(() => {
    if (!complete) return;
    let cancelled = false;
    loadMermaid()
      .then((m) => m.render(idRef.current, body.trim()))
      .then(({ svg: out }) => {
        if (!cancelled) setSvg(out);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [body, complete]);
  if (failed) return <pre className="live-fallback-code">{body}</pre>;
  if (!svg) return <div className="live-skeleton" aria-busy="true" />;
  return <div className="live-diagram live-fade-in" dangerouslySetInnerHTML={{ __html: svg }} />;
}

// ---------- anim / widget（iframe 沙箱） ----------

function ratioFromSvg(body: string): number {
  const m = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(body);
  if (m) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (w > 0 && h > 0) return w / h;
  }
  return 16 / 9;
}

const SANDBOX_BASE_CSS = `html,body{margin:0;padding:0;background:transparent;color:#20312A;font-family:"PingFang SC","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif;font-size:16px;line-height:1.5}
svg{display:block;width:100%;height:auto;max-height:100vh;overflow:visible}
*{box-sizing:border-box}
input[type=range]{accent-color:#2F6B55;width:100%}
button{font:inherit;padding:6px 14px;border-radius:999px;border:1px solid #2F6B55;background:#EAF3EE;color:#20312A;cursor:pointer}
label{display:block;margin:6px 0 2px;color:#53645C;font-size:14px}
canvas{max-width:100%;display:block}`;

function AnimBlock({ body, complete, animate }: { body: string; complete: boolean; animate: boolean }) {
  const [replayKey, setReplayKey] = React.useState(0);
  const ratio = React.useMemo(() => ratioFromSvg(body), [body]);
  if (!complete) return <div className="live-skeleton" aria-busy="true" />;
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>${SANDBOX_BASE_CSS}</style></head><body>${body}</body></html>`;
  return (
    <div className="live-anim live-fade-in" style={{ aspectRatio: `${ratio}`, maxWidth: `calc(42vh * ${ratio.toFixed(3)})` }}>
      <iframe
        key={`${replayKey}-${animate ? 'a' : 's'}`}
        title={TEACH_LIVE_COPY.animTitle}
        sandbox=""
        srcDoc={doc}
        className="live-sandbox-frame"
        loading="lazy"
      />
      <button type="button" className="live-replay" onClick={() => setReplayKey((k) => k + 1)}>
        {TEACH_LIVE_COPY.replay}
      </button>
    </div>
  );
}

const WIDGET_RESIZE_SCRIPT = `<script>(function(){function r(){var h=Math.max(document.documentElement.scrollHeight,document.body.scrollHeight);parent.postMessage({type:'live-widget-size',height:h},'*');}window.addEventListener('load',r);new MutationObserver(r).observe(document.documentElement,{subtree:true,childList:true,attributes:true});setInterval(r,800);})();</script>`;

function WidgetBlock({ body, complete }: { body: string; complete: boolean }) {
  const frameRef = React.useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = React.useState(300);
  React.useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const data = e.data as { type?: string; height?: number };
      if (data?.type === 'live-widget-size' && typeof data.height === 'number') {
        setHeight(Math.max(120, Math.min(560, Math.ceil(data.height) + 8)));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  if (!complete) return <div className="live-skeleton" aria-busy="true" />;
  const hasHtml = /<html[\s>]/i.test(body);
  const doc = hasHtml
    ? body.replace(/<\/body>/i, `${WIDGET_RESIZE_SCRIPT}</body>`)
    : `<!doctype html><html><head><meta charset="utf-8"><style>${SANDBOX_BASE_CSS}</style></head><body>${body}${WIDGET_RESIZE_SCRIPT}</body></html>`;
  return (
    <div className="live-widget live-fade-in">
      <iframe ref={frameRef} title={TEACH_LIVE_COPY.widgetTitle} sandbox="allow-scripts" srcDoc={doc} className="live-sandbox-frame" style={{ height }} />
    </div>
  );
}

// ---------- image ----------

function ImageBlock({ block }: { block: LiveBlock }) {
  const alt = block.attrs.alt || block.attrs.title || TEACH_LIVE_COPY.imageAltFallback;
  if (!block.imageUrl) {
    return (
      <div className="live-image live-image-pending" role="img" aria-label={alt}>
        <div className="live-image-shimmer" />
        <div className="live-image-caption">
          <span className="live-dot-pulse" /> {TEACH_LIVE_COPY.imagePending(alt)}
        </div>
      </div>
    );
  }
  return (
    <figure className="live-image live-fade-in">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={block.imageUrl} alt={alt} loading="lazy" />
      <figcaption className="live-image-caption">{alt}</figcaption>
    </figure>
  );
}

// ---------- ask ----------

function AskBlock({ body }: { body: string }) {
  return (
    <div className="live-ask live-fade-in">
      <div className="live-ask-eyebrow">{TEACH_LIVE_COPY.askEyebrow}</div>
      <div className="live-ask-body">
        <MathText text={body} />
      </div>
    </div>
  );
}

// ---------- plot ----------

function PlotBlock({ block, animate, onGrow }: { block: LiveBlock; animate: boolean; onGrow?: () => void }) {
  const body = revealedBody(block);
  const complete = block.segments.every((s) => s.complete);
  const compiled = React.useMemo(() => {
    if (!complete) return null;
    const spec = parsePlot(block.attrs, body);
    return compilePlotSvg(spec);
  }, [block.attrs, body, complete]);
  if (!compiled) return <div className="live-skeleton" aria-busy="true" />;
  return (
    <ProgressiveSvg
      attrs={{ viewbox: compiled.viewBox, title: block.attrs.title ?? '' }}
      segments={[{ id: `${block.id}-plot`, text: compiled.markup, complete: true, revealed: true }]}
      animate={animate}
      onGrow={onGrow}
      rough={false}
    />
  );
}

// ---------- 分发 ----------

interface LiveBlockViewProps {
  block: LiveBlock;
  /** false = 历史回放：所有块直接终态 */
  animate: boolean;
  onGrow?: () => void;
  /** 板上出了问题（draw 脚本报错）→ 会话层记下，下次学生开口时告诉老师 */
  onIssue?: (blockId: string, message: string) => void;
  /** draw 块自愈要向服务端要修正脚本 */
  threadId?: string | null;
  /** 学生正指着这一块 */
  quoted?: boolean;
}

export const LiveBlockView = React.memo(function LiveBlockView({ block, animate, onGrow, onIssue, quoted, threadId }: LiveBlockViewProps) {
  const revealed = block.segments.some((s) => s.revealed);
  // draw 块未揭示也先挂载：脚本在到达时就开始算（必要时自愈），揭示那一刻直接描画
  if (!revealed && block.kind === 'draw') {
    return <DrawBlock block={block} animate={animate} revealed={false} threadId={threadId} onIssue={onIssue} />;
  }
  if (!revealed) return null;
  const body = revealedBody(block);
  const complete = block.segments.filter((s) => s.revealed).every((s) => s.complete);
  const title = block.attrs.title;
  const width = block.attrs.w === 'half' ? 'half' : 'full';

  let content: React.ReactNode;
  switch (block.kind) {
    case 'svg':
      content = <ProgressiveSvg attrs={block.attrs} segments={block.segments} animate={animate} onGrow={onGrow} className="live-svg" />;
      break;
    case 'draw':
      content = <DrawBlock block={block} animate={animate} revealed threadId={threadId} onGrow={onGrow} onIssue={onIssue} />;
      break;
    case 'plot':
      content = <PlotBlock block={block} animate={animate} onGrow={onGrow} />;
      break;
    case 'math':
      content = <MathBlock body={body} label={block.attrs.label} />;
      break;
    case 'note':
      content = <NoteBlock body={body} />;
      break;
    case 'code':
      content = <ChatCodeBlock code={body.replace(/^\n+|\n+$/g, '')} lang={block.attrs.lang} isStreaming={!complete} />;
      break;
    case 'diagram':
      content = <DiagramBlock body={body} complete={complete} />;
      break;
    case 'anim':
      content = <AnimBlock body={body} complete={complete} animate={animate} />;
      break;
    case 'widget':
      content = <WidgetBlock body={body} complete={complete} />;
      break;
    case 'image':
      content = <ImageBlock block={block} />;
      break;
    case 'ask':
      content = <AskBlock body={body} />;
      break;
    default:
      return null;
  }

  return (
    <section
      className={`live-block live-block-${block.kind} live-block-${width}${block.highlighted ? ' is-highlighted' : ''}${quoted ? ' is-quoted' : ''}${animate ? ' live-enter' : ''}`}
      data-block-id={block.id}
      data-label={block.label ?? undefined}
    >
      {title && block.kind !== 'math' ? <header className="live-block-title">{title}</header> : null}
      {content}
    </section>
  );
});
