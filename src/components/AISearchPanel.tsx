'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { Components } from 'react-markdown';
import {
  AudioLines,
  FileText,
  ImageIcon,
  Link2,
  PlaySquare,
  PencilLine,
  Search,
  Sparkles,
  X,
  ArrowUp,
  Loader2,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';
import useAuth from '@/lib/hooks/useAuth';

// ─── 类型 ─────────────────────────────────────────────────

interface SearchSource {
  id: string;
  contentType: string;
  title: string;
  previewText: string;
  occurredAt: string | null;
  createdAt: string;
}

interface AISearchPanelProps {
  open: boolean;
  onClose: () => void;
  onNavigateToCapture?: (captureId: string) => void;
  isMobile?: boolean;
}

// ─── 内容类型图标 + 标签 + 配色 ──────────────────────────────

const CONTENT_TYPE_META: Record<
  string,
  { icon: typeof FileText; label: string; color: string; bg: string }
> = {
  text: { icon: PencilLine, label: '文字', color: 'text-pine', bg: 'bg-pine-fog' },
  audio: { icon: AudioLines, label: '录音', color: 'text-vermilion', bg: 'bg-vermilion-fog' },
  video: { icon: PlaySquare, label: '视频', color: 'text-vermilion', bg: 'bg-vermilion-fog' },
  image: { icon: ImageIcon, label: '图片', color: 'text-pine', bg: 'bg-pine-fog' },
  link: { icon: Link2, label: '链接', color: 'text-pine', bg: 'bg-pine-fog' },
  document: { icon: FileText, label: '文档', color: 'text-vermilion', bg: 'bg-vermilion-fog' },
};

function getContentTypeMeta(type: string) {
  return (
    CONTENT_TYPE_META[type] || {
      icon: FileText,
      label: type,
      color: 'text-ink-muted',
      bg: 'bg-paper-warm',
    }
  );
}

function formatSourceDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays}天前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ─── 引用徽章：Markdown 内嵌的 [数字] → 精美小按钮 ─────────

function CitationBadge({
  index,
  source,
  onClick,
}: {
  index: number;
  source?: SearchSource;
  onClick?: (id: string) => void;
}) {
  if (!source) {
    return (
      <span className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-paper-deep px-1 align-super text-[10px] font-bold leading-none text-ink-muted -translate-y-[0.35em]">
        {index}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onClick?.(source.id)}
      className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-pine-mist px-1 align-super text-[10px] font-bold leading-none text-pine transition-colors hover:bg-pine-mist -translate-y-[0.35em]"
      title={source.title}
    >
      {index}
    </button>
  );
}

// ─── 将文本中的 [数字] 引用替换为 CitationBadge ──────────────

function renderTextWithCitations(
  text: string,
  sources: SearchSource[],
  onClickSource?: (id: string) => void
): React.ReactNode[] {
  const parts = text.split(/(\[\d+\])/g);
  let keyIdx = 0;
  return parts.map((part) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (match) {
      const num = parseInt(match[1], 10);
      const source = sources[num - 1];
      return (
        <CitationBadge
          key={`cite-${keyIdx++}`}
          index={num}
          source={source}
          onClick={onClickSource}
        />
      );
    }
    return <React.Fragment key={`text-${keyIdx++}`}>{part}</React.Fragment>;
  });
}

// ─── 递归处理 React children，替换字符串中的引用 ────────────

function processChildrenForCitations(
  children: React.ReactNode,
  sources: SearchSource[],
  onClickSource?: (id: string) => void
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      return renderTextWithCitations(child, sources, onClickSource);
    }
    if (
      React.isValidElement<{ className?: string; children?: React.ReactNode }>(child)
    ) {
      // 跳过 KaTeX 渲染的数学公式，避免破坏 DOM
      const className = child.props.className;
      if (
        typeof className === 'string' &&
        (className.includes('katex') || className.includes('math'))
      ) {
        return child;
      }
      if (child.props.children) {
        return React.cloneElement(child, {
          ...child.props,
          children: processChildrenForCitations(
            child.props.children,
            sources,
            onClickSource
          ),
        });
      }
    }
    return child;
  });
}

// ─── 主组件 ───────────────────────────────────────────────

export function AISearchPanel({
  open,
  onClose,
  onNavigateToCapture,
  isMobile = false,
}: AISearchPanelProps) {
  const { accessToken, refreshToken } = useAuth();
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<SearchSource[]>([]);
  const [citedSourceIndices, setCitedSourceIndices] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [currentQuery, setCurrentQuery] = useState('');
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 打开时 focus
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery('');
      setAnswer('');
      setSources([]);
      setCitedSourceIndices(new Set());
      setError(null);
      setHasSearched(false);
      setIsSearching(false);
      setCurrentQuery('');
      setSourcesExpanded(false);
      abortRef.current?.abort();
    }
  }, [open]);

  // 滚动跟随
  useEffect(() => {
    if (answerRef.current) {
      answerRef.current.scrollTop = answerRef.current.scrollHeight;
    }
  }, [answer]);

  // 提取引用编号
  useEffect(() => {
    const matches = answer.matchAll(/\[(\d+)\]/g);
    const indices = new Set<number>();
    for (const m of matches) {
      indices.add(parseInt(m[1], 10) - 1);
    }
    setCitedSourceIndices(indices);
  }, [answer]);

  const handleSearch = useCallback(async () => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery || !accessToken || isSearching) return;

    setIsSearching(true);
    setAnswer('');
    setSources([]);
    setCitedSourceIndices(new Set());
    setError(null);
    setHasSearched(true);
    setCurrentQuery(trimmedQuery);

    const abort = new AbortController();
    abortRef.current = abort;

    // 内部函数：执行搜索请求
    const doSearch = async (token: string): Promise<Response> => {
      return fetch('/api/workspace/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query: trimmedQuery }),
        signal: abort.signal,
      });
    };

    try {
      let response = await doSearch(accessToken);

      // 如果 401，尝试刷新 token 后重试一次
      if (response.status === 401) {
        const refreshed = await refreshToken();
        if (!refreshed) {
          throw new Error('登录已过期，请重新登录');
        }
        // refreshToken 成功后 useAuth 会更新 accessToken，
        // 但由于闭包捕获的是旧值，需要从 localStorage 读取最新的
        const newToken =
          typeof window !== 'undefined'
            ? localStorage.getItem('meetmind_access_token') || localStorage.getItem('auth_token')
            : null;
        if (!newToken) {
          throw new Error('登录已过期，请重新登录');
        }
        response = await doSearch(newToken);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || `请求失败 (${response.status})`);
      }

      if (!response.body) throw new Error('无响应数据');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              setError(parsed.error);
              break;
            }
            if (parsed.type === 'sources') {
              setSources(parsed.sources || []);
            } else if (parsed.type === 'content' || parsed.type === 'thinking') {
              setAnswer((prev) => prev + (parsed.content || ''));
            }
          } catch {
            // 忽略
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : '检索失败，请稍后重试');
    } finally {
      setIsSearching(false);
    }
  }, [query, accessToken, isSearching, refreshToken]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSearch();
      }
    },
    [handleSearch]
  );

  // 只显示被引用的来源
  const citedSources = useMemo(
    () => sources.filter((_, i) => citedSourceIndices.has(i)),
    [sources, citedSourceIndices]
  );

  // ─── Markdown 组件定义 ──────────────────────────────────

  const markdownComponents: Components = useMemo(
    () => ({
      p: ({ children, ...props }) => (
        <p {...props} className="mb-3 last:mb-0 leading-[1.8]">
          {processChildrenForCitations(children, sources, onNavigateToCapture)}
        </p>
      ),
      li: ({ children, ...props }) => (
        <li {...props} className="leading-[1.8]">
          {processChildrenForCitations(children, sources, onNavigateToCapture)}
        </li>
      ),
      h1: ({ children, ...props }) => (
        <h1 {...props} className="mb-3 mt-5 text-[17px] font-bold text-ink first:mt-0">
          {processChildrenForCitations(children, sources, onNavigateToCapture)}
        </h1>
      ),
      h2: ({ children, ...props }) => (
        <h2 {...props} className="mb-2.5 mt-4 text-[15px] font-bold text-ink first:mt-0">
          {processChildrenForCitations(children, sources, onNavigateToCapture)}
        </h2>
      ),
      h3: ({ children, ...props }) => (
        <h3 {...props} className="mb-2 mt-3 text-sm font-bold text-ink">
          {processChildrenForCitations(children, sources, onNavigateToCapture)}
        </h3>
      ),
      ul: ({ children, ...props }) => (
        <ul {...props} className="mb-3 ml-1 list-inside list-disc space-y-1.5 text-ink-secondary marker:text-ink-faint">
          {children}
        </ul>
      ),
      ol: ({ children, ...props }) => (
        <ol {...props} className="mb-3 ml-1 list-inside list-decimal space-y-1.5 text-ink-secondary marker:text-ink-muted">
          {children}
        </ol>
      ),
      strong: ({ children, ...props }) => (
        <strong {...props} className="font-semibold text-ink">
          {processChildrenForCitations(children, sources, onNavigateToCapture)}
        </strong>
      ),
      em: ({ children, ...props }) => (
        <em {...props} className="not-italic text-ink-secondary bg-vermilion-fog/60 px-0.5 rounded">
          {processChildrenForCitations(children, sources, onNavigateToCapture)}
        </em>
      ),
      code: ({ children, className: codeClassName, ...props }) => {
        const isInline = !codeClassName;
        if (isInline) {
          return (
            <code
              {...props}
              className="rounded-md bg-paper-deep px-1.5 py-0.5 text-[13px] font-mono text-ink"
            >
              {children}
            </code>
          );
        }
        return (
          <code
            {...props}
            className={`block overflow-x-auto rounded-xl bg-paper-warm p-4 text-[13px] font-mono leading-relaxed ${codeClassName}`}
          >
            {children}
          </code>
        );
      },
      pre: ({ children, ...props }) => (
        <pre {...props} className="mb-3 overflow-hidden rounded-xl border border-divider-light">
          {children}
        </pre>
      ),
      blockquote: ({ children, ...props }) => (
        <blockquote
          {...props}
          className="my-3 rounded-r-lg border-l-[3px] border-pine/40 bg-pine-fog/40 py-2 pl-4 pr-3 text-ink-secondary"
        >
          {children}
        </blockquote>
      ),
      a: ({ children, href, ...props }) => (
        <a
          {...props}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-pine underline decoration-pine/30 underline-offset-2 transition-colors hover:text-pine-deep hover:decoration-pine"
        >
          {children}
        </a>
      ),
      hr: ({ ...props }) => <hr {...props} className="my-4 border-divider-light" />,
      table: ({ children, ...props }) => (
        <div className="mb-3 overflow-x-auto rounded-xl border border-divider-light">
          <table {...props} className="w-full text-sm">
            {children}
          </table>
        </div>
      ),
      thead: ({ children, ...props }) => (
        <thead {...props} className="bg-paper-warm text-left text-xs font-semibold text-ink-secondary">
          {children}
        </thead>
      ),
      th: ({ children, ...props }) => (
        <th {...props} className="px-3 py-2">
          {children}
        </th>
      ),
      td: ({ children, ...props }) => (
        <td {...props} className="border-t border-divider-light px-3 py-2 text-ink-secondary">
          {children}
        </td>
      ),
    }),
    [sources, onNavigateToCapture]
  );

  if (!open) return null;

  // ─── 渲染 ─────────────────────────────────────────────

  const panelContent = (
    <div className="flex h-full flex-col bg-white">
      {/* ── 头部 ── */}
      <div className="flex items-start justify-between gap-4 border-b border-[#E8E2D5] px-6 py-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#E8E2D5] bg-[#FAF7F2] text-[#1C1B19]">
              <Search size={15} />
            </div>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[#1C1B19]">搜索笔记</h2>
          </div>
          <p className="mt-2 max-w-[420px] text-[12px] leading-5 text-[#5C5A55]">
            像问同学一样提问，我会从你收进来的课、讲义和材料里找答案，并保留来源。
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-[#E8E2D5] text-[#5C5A55] transition-colors hover:bg-[#FAF7F2] hover:text-[#1C1B19]"
          aria-label="关闭"
        >
          <X size={17} />
        </button>
      </div>

      {/* ── 内容区域 ── */}
      <div ref={answerRef} className="min-h-0 flex-1 overflow-y-auto">
        {!hasSearched ? (
          /* ── 空状态引导 ── */
          <div className="flex min-h-full flex-col justify-between px-8 py-8 text-left">
            <div>
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#E8E2D5] bg-[#FAF7F2] text-[#1C1B19]">
                <Sparkles size={22} />
              </div>
              <p className="max-w-[460px] text-[22px] font-semibold leading-tight tracking-[-0.03em] text-[#1C1B19]">
                不用翻列表，直接问这堆材料。
              </p>
              <p className="mt-3 max-w-[430px] text-[14px] leading-7 text-[#5C5A55]">
                适合找某个概念、复盘上节课、或者把几份资料里的说法对齐。结果会带引用，点来源就能回到原件。
              </p>
            </div>
            <div className="mt-8">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#8E8B82]">可以这样问</p>
              <div className="flex flex-wrap gap-2">
                {['强化学习的奖励函数', '上节课讲的公式', '那个产品方法论'].map(
                  (example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => {
                        setQuery(example);
                        inputRef.current?.focus();
                      }}
                      className="rounded-full border border-[#E8E2D5] bg-white px-3.5 py-1.5 text-xs text-[#5C5A55] transition-colors hover:border-[#8E8B82] hover:bg-[#FAF7F2] hover:text-[#1C1B19]"
                    >
                      {example}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        ) : error ? (
          /* ── 错误状态 ── */
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-vermilion-mist/50">
              <X size={24} className="text-vermilion/65" />
            </div>
            <p className="text-sm font-medium text-vermilion">{error}</p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setHasSearched(false);
              }}
              className="mt-4 flex items-center gap-1.5 rounded-full border border-divider px-4 py-2 text-xs font-medium text-ink-secondary transition-colors hover:border-divider hover:bg-paper-warm"
            >
              <RotateCcw size={12} />
              重新搜索
            </button>
          </div>
        ) : (
          /* ── 回答区域 ── */
          <div className="px-5 py-5">
            {/* 用户查询回显 */}
            {currentQuery ? (
              <div className="mb-5 flex items-start gap-2.5">
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-ink mt-0.5">
                  <Search size={11} className="text-white" />
                </div>
                <p className="text-[14px] font-medium leading-relaxed text-ink-secondary pt-0.5">
                  {currentQuery}
                </p>
              </div>
            ) : null}

            {/* AI 回答 */}
            {answer || isSearching ? (
              <div className="relative">
                {/* AI 头像 + 标签 */}
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-[#E8E2D5] bg-[#FAF7F2] text-[#1C1B19]">
                    <Sparkles size={11} />
                  </div>
                  <span className="text-xs font-semibold text-[#5C5A55]">AI 回答</span>
                  {isSearching && !answer ? (
                    <div className="flex items-center gap-1.5 text-ink-muted">
                      <Loader2 size={12} className="animate-spin" />
                      <span className="text-[11px]">正在检索...</span>
                    </div>
                  ) : null}
                </div>

                {/* Markdown 渲染 */}
                {answer ? (
                  <div className="search-answer-markdown ml-8 text-[14px] text-ink-secondary">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={markdownComponents}
                    >
                      {answer}
                    </ReactMarkdown>

                    {/* 流式光标 */}
                    {isSearching ? (
                      <span className="ml-0.5 inline-block h-[18px] w-[3px] animate-pulse rounded-sm bg-pine-fog0 align-middle" />
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* ── 来源引用 ── */}
            {citedSources.length > 0 && !isSearching ? (
              <div className="ml-8 mt-4">
                {/* 折叠头：点击展开/收起 */}
                <button
                  type="button"
                  onClick={() => setSourcesExpanded((v) => !v)}
                  className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-paper-warm"
                >
                  <div className="flex items-center gap-1">
                    {citedSources.slice(0, 4).map((source) => {
                      const meta = getContentTypeMeta(source.contentType);
                      const Icon = meta.icon;
                      return (
                        <div
                          key={source.id}
                          className={`flex h-5 w-5 items-center justify-center rounded-md ${meta.bg} ${meta.color}`}
                        >
                          <Icon size={10} />
                        </div>
                      );
                    })}
                    {citedSources.length > 4 ? (
                      <span className="flex h-5 items-center px-0.5 text-[10px] text-ink-muted">
                        +{citedSources.length - 4}
                      </span>
                    ) : null}
                  </div>
                  <span className="text-[11px] text-ink-muted">
                    {citedSources.length} 条引用来源
                  </span>
                  <ChevronRight
                    size={12}
                    className={`ml-auto flex-shrink-0 text-ink-faint transition-transform ${sourcesExpanded ? 'rotate-90' : ''}`}
                  />
                </button>

                {/* 展开后的紧凑列表 */}
                {sourcesExpanded ? (
                  <div className="mt-2 space-y-0.5">
                    {citedSources.map((source) => {
                      const meta = getContentTypeMeta(source.contentType);
                      const Icon = meta.icon;
                      const globalIdx = sources.indexOf(source);
                      return (
                        <button
                          key={source.id}
                          type="button"
                          onClick={() => onNavigateToCapture?.(source.id)}
                          className="group flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-pine-fog/40"
                        >
                          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-pine-mist text-[10px] font-bold text-pine">
                            {globalIdx + 1}
                          </span>
                          <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md ${meta.bg} ${meta.color}`}>
                            <Icon size={10} />
                          </div>
                          <p className="min-w-0 flex-1 truncate text-[12px] text-ink-secondary">
                            {source.title}
                          </p>
                          <span className="flex-shrink-0 text-[10px] text-ink-faint">
                            {formatSourceDate(source.occurredAt || source.createdAt)}
                          </span>
                          <ChevronRight
                            size={12}
                            className="flex-shrink-0 text-ink-faint transition-colors group-hover:text-pine"
                          />
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ── 搜索输入框 ── */}
      <div className="border-t border-divider bg-white px-6 py-4">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="问一个想从笔记里找到的问题..."
            disabled={isSearching}
            className="w-full rounded-2xl border border-divider bg-paper py-3.5 pl-4 pr-12 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-pine/40 focus:bg-white disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleSearch}
            disabled={!query.trim() || isSearching}
            className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl bg-pine text-white transition-colors hover:bg-pine-deep disabled:cursor-not-allowed disabled:bg-divider disabled:text-ink-muted"
            aria-label="搜索"
          >
            {isSearching ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <ArrowUp size={14} />
            )}
          </button>
        </div>
      </div>
    </div>
  );

  // ─── 布局 ───────────────────────────────────────────────

  if (isMobile) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white animate-in fade-in slide-in-from-bottom-4 duration-200">
        {panelContent}
      </div>
    );
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-[#1C1B19]/12 animate-in fade-in duration-150"
        onClick={onClose}
        aria-hidden
      />
      <div className="fixed bottom-0 right-0 top-0 z-50 w-[min(720px,72vw)] min-w-[560px] overflow-hidden border-l border-[#E8E2D5] bg-white animate-in fade-in slide-in-from-right-6 duration-200">
        {panelContent}
      </div>
    </>
  );
}

export default AISearchPanel;
