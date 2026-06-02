/**
 * ChatCodeBlock —— 顶级体验代码块（M12）
 *
 * 对标 ChatGPT / Claude / Cursor 的代码块体验：
 *   - Shiki 语法高亮（github-light 主题，与 v7 米白纸感融合）
 *   - 顶部 header：语言 badge + 复制按钮
 *   - 复制反馈：Copy → Check 图标 + "已复制" toast 1.5s
 *   - 行号：>5 行时显示，CSS counter 自动维护
 *   - 长代码：横向滚动（不强制换行破坏代码结构）
 *   - 加载态：highlighter lazy load 时用 fallback <pre>，避免闪烁
 *
 * 性能：
 *   - Shiki highlighter 全局共享一个实例（lazy + cache + Promise dedup）
 *   - 短代码 codeToHtml 同步 ~1-5ms，不阻塞
 *   - 不在 streaming 时频繁 re-highlight：caller 控制 isStreaming 时传 false 即可
 */

'use client';

import * as React from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ───────────────────── shiki highlighter（全局 lazy 单例） ──────────────────── */

// 主流编程语言（覆盖 95% 学习场景，含算法 / 数据库 / 配置）
const COMMON_LANGS = [
  'javascript',
  'typescript',
  'jsx',
  'tsx',
  'python',
  'java',
  'go',
  'rust',
  'cpp',
  'c',
  'csharp',
  'sql',
  'json',
  'yaml',
  'toml',
  'bash',
  'shell',
  'html',
  'css',
  'scss',
  'markdown',
  'plaintext',
] as const;

type ShikiLang = (typeof COMMON_LANGS)[number];

interface HighlighterLite {
  codeToHtml: (
    code: string,
    options: { lang: string; theme: string },
  ) => string;
}

let cachedHighlighter: HighlighterLite | null = null;
let pendingPromise: Promise<HighlighterLite> | null = null;

/**
 * 异步加载 shiki highlighter 单例。
 * 第一次调用会加载 ~150KB（按需加载常见语言的 grammar）；
 * 后续调用直接命中 cache。
 */
async function loadHighlighter(): Promise<HighlighterLite> {
  if (cachedHighlighter) return cachedHighlighter;
  if (pendingPromise) return pendingPromise;

  pendingPromise = (async () => {
    // dynamic import（避免首屏被打包带走）
    const shiki = await import('shiki');
    const h = await shiki.createHighlighter({
      themes: ['github-light'],
      langs: [...COMMON_LANGS],
    });
    cachedHighlighter = h as HighlighterLite;
    return cachedHighlighter;
  })();

  return pendingPromise;
}

/** 别名归一：md → markdown / sh → bash / py → python 等 */
function normalizeLang(raw: string | undefined): string {
  const lang = (raw ?? '').toLowerCase().trim();
  const aliases: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    rb: 'ruby',
    sh: 'bash',
    shell: 'bash',
    md: 'markdown',
    yml: 'yaml',
    'c++': 'cpp',
    'c#': 'csharp',
  };
  const resolved = aliases[lang] || lang;
  if ((COMMON_LANGS as readonly string[]).includes(resolved)) return resolved;
  return 'plaintext';
}

/* ───────────────────── 组件 ──────────────────── */

export interface ChatCodeBlockProps {
  /** 代码内容（不含 ``` 标记） */
  code: string;
  /** 语言（``` 后跟的标识符，如 typescript / python / sql） */
  lang?: string;
  /** 是否还在流式输出（流式中暂不 highlight，等稳定再处理） */
  isStreaming?: boolean;
  className?: string;
}

export const ChatCodeBlock = React.memo(function ChatCodeBlock({
  code,
  lang,
  isStreaming = false,
  className,
}: ChatCodeBlockProps) {
  const normalizedLang = React.useMemo(() => normalizeLang(lang), [lang]);
  const [html, setHtml] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  // streaming 中暂不 highlight（避免每个 token 触发一次 highlighter 调用）
  // 等 isStreaming 落到 false 或代码段稳定后再 highlight
  React.useEffect(() => {
    if (isStreaming) return;
    let cancelled = false;
    loadHighlighter()
      .then((h) => {
        if (cancelled) return;
        try {
          const result = h.codeToHtml(code, {
            lang: normalizedLang,
            theme: 'github-light',
          });
          setHtml(result);
        } catch {
          setHtml(null); // fallback to <pre>
        }
      })
      .catch(() => {
        // shiki 加载失败 → 始终走 fallback
        setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, normalizedLang, isStreaming]);

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 静默失败
    }
  }, [code]);

  const lineCount = React.useMemo(() => code.split('\n').length, [code]);
  const showLineNumbers = lineCount > 5;

  // 显示用的语言标签：plaintext 显示为空（避免 "PLAINTEXT" 喧闹）
  const displayLang = normalizedLang === 'plaintext' ? '' : normalizedLang;

  return (
    <div
      className={cn(
        'group my-3 overflow-hidden rounded-lg border border-divider bg-paper-warm/60',
        showLineNumbers && 'chat-code-with-line-numbers',
        className,
      )}
    >
      {/* header */}
      <div className="flex items-center justify-between border-b border-divider/60 bg-paper-warm/80 px-3 py-1.5 backdrop-blur-sm">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-muted">
          {displayLang || (isStreaming ? '正在生成…' : 'code')}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="复制代码"
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] transition-all',
            copied
              ? 'text-pine'
              : 'text-ink-muted opacity-0 hover:bg-paper-deep hover:text-pine group-hover:opacity-100',
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
              <span>复制</span>
            </>
          )}
        </button>
      </div>

      {/* body */}
      {html ? (
        // shiki 输出整个 <pre style="..."><code>...</code></pre>，自带 token color
        // 我们只需要把外层 wrapper 的样式挂上（横向滚动 + padding + 字号）
        <div
          className="chat-code-shiki overflow-x-auto text-[12.5px] leading-[1.65]"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        // fallback：shiki 加载中 / streaming / 不支持的语言
        <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-[1.65] text-ink">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
});

ChatCodeBlock.displayName = 'ChatCodeBlock';
