'use client';

import { memo, useCallback, useState } from 'react';
import { COPY } from '@/lib/ui/copy';

// ── 类型 ──────────────────────────────────────────

export interface EchoHighlight {
  text: string;
  timestamp?: string;
  speaker?: string;
}

export interface EchoData {
  id: string;
  kind?: string | null;
  title: string;
  body: string;
  highlights?: EchoHighlight[];
  takeaway?: string;
  sourceCaptureIds?: string[];
  createdAt: string;
  updatedAt?: string;
}

interface EchoCardProps {
  echo: EchoData;
  /** 关联的 capture 标题映射，用于来源标签 */
  captureLabels?: Map<string, string>;
  onShare?: (echo: EchoData) => void;
  onNavigateToCapture?: (captureId: string) => void;
  /** 相对时间格式化 */
  formatTime?: (iso: string) => string;
  /** 是否展开完整内容（默认折叠到 160 字） */
  expanded?: boolean;
}

// ── 默认时间格式 ──────────────────────────────────

function defaultFormatTime(isoString: string): string {
  const now = Date.now();
  const ts = new Date(isoString).getTime();
  const diffMs = now - ts;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(isoString).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

// ── 设计哲学 ──────────────────────────────────────
//
// 1. 回到系统内 — 只用设计系统 token：
//    card(#fff), divider(#E8E2D5), ink(#1C1B19), ink-secondary(#5C5A55), ink-muted(#8E8B82)
// 2. 唯一主角 — echo 正文是用户唯一要读的东西
// 3. 用「无」创造存在感 — 大留白 + 排版节奏，不靠装饰

const MAX_COLLAPSED_CHARS = 160;
const MAX_SOURCE_TAGS = 2;

function EchoCardInner({
  echo,
  captureLabels,
  onShare,
  onNavigateToCapture,
  formatTime = defaultFormatTime,
  expanded: initialExpanded = false,
}: EchoCardProps) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);

  const handleShare = useCallback(() => {
    onShare?.(echo);
  }, [echo, onShare]);

  const displayTime = formatTime(echo.updatedAt || echo.createdAt);
  const sources = echo.sourceCaptureIds?.filter(Boolean) || [];
  const highlights = echo.highlights?.filter((h) => h.text.trim()) || [];
  const takeaway = echo.takeaway?.trim() || '';
  const needsTruncation = echo.body.length > MAX_COLLAPSED_CHARS;
  const displayBody = !isExpanded && needsTruncation
    ? echo.body.slice(0, MAX_COLLAPSED_CHARS) + '…'
    : echo.body;

  return (
    <div className="group relative">
      {/* ── 标记行：极小的 ✦ + 时间，不抢戏 ── */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] leading-none text-[#8E8B82]">✦</span>
          <span className="text-[11px] text-[#8E8B82]">
            {displayTime}
          </span>
        </div>
        {onShare && (
          <button
            type="button"
            onClick={handleShare}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#E8E2D5] bg-white px-2.5 py-1 text-[11px] font-medium text-[#5C5A55] transition hover:border-[#DDDDD9] hover:bg-[#FAF7F2] hover:text-[#1C1B19] active:scale-[0.99]"
            aria-label={COPY.echoShare.open}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
            <span>{COPY.echoShare.open}</span>
          </button>
        )}
      </div>

      {/* ── 正文：这是全部，这是唯一的主角 ── */}
      <div className="text-[15px] leading-[1.9] tracking-[0.01em] text-[#1C1B19]">
        {displayBody.split('\n').map((line, i) => (
          <p key={i} className={i > 0 ? 'mt-2' : ''}>
            {renderEchoLine(line)}
          </p>
        ))}
        {needsTruncation && !isExpanded && (
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="ml-0.5 inline text-[14px] text-[#8E8B82] transition-colors hover:text-[#5C5A55]"
          >
            展开
          </button>
        )}
      </div>

      {/* ── 金句：不是独立区块，是正文下方的「划线」── */}
      {highlights.length > 0 && (
        <div className="mt-5 space-y-3">
          {highlights.map((highlight, i) => (
            <div key={i} className="border-l border-[#E8E2D5] pl-4">
              <p className="text-[14px] italic leading-[1.8] text-[#5C5A55]">
                {highlight.text}
              </p>
              {(highlight.timestamp || highlight.speaker) && (
                <p className="mt-1 text-[11px] text-[#8E8B82]">
                  {[highlight.speaker, highlight.timestamp].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── 一句话带走：融为正文尾声，不另起炉灶 ── */}
      {takeaway && (
        <p className="mt-4 text-[13px] leading-[1.8] text-[#5C5A55]">
          {takeaway}
        </p>
      )}

      {/* ── 来源：像脚注，贴在最底部 ── */}
      {sources.length > 0 && (
        <div className="mt-4 flex items-center gap-1">
          {sources.slice(0, MAX_SOURCE_TAGS).map((captureId) => {
            const label = captureLabels?.get(captureId) || '收集';
            return (
              <button
                key={captureId}
                type="button"
                onClick={() => onNavigateToCapture?.(captureId)}
                className="text-[11px] text-[#8E8B82] underline decoration-[#E8E2D5] underline-offset-2 transition-colors hover:text-[#5C5A55]"
              >
                {truncate(label, 14)}
              </button>
            );
          })}
          {sources.length > MAX_SOURCE_TAGS && (
            <span className="text-[11px] text-[#8E8B82]">+{sources.length - MAX_SOURCE_TAGS}</span>
          )}
        </div>
      )}

      {/* ── 底部分隔线：与下一张卡片的呼吸 ── */}
      <div className="mt-6 h-px bg-[#F0EBDF]" />
    </div>
  );
}

// ── 行内渲染：引号内容微妙加深，不加底色 ────────────

function renderEchoLine(line: string) {
  const parts = line.split(/(「[^」]+」|"[^"]+"|"[^"]+")/);
  return parts.map((part, i) => {
    if (/^[「"][^」"]+[」"]$/.test(part) || /^"[^"]+"$/.test(part)) {
      return (
        <span key={i} className="text-[#1C1B19] font-medium">
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ── 工具函数 ──────────────────────────────────────

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

// ── 导出 ──────────────────────────────────────────

export const EchoCard = memo(EchoCardInner);
export default EchoCard;
