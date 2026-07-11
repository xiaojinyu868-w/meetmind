'use client';

/**
 * LessonDigestCard — 课堂结构化笔记的纯展示组件
 *
 * 给定 LessonDigest data，渲染飞书妙记式分段总结。
 * 不包含任何布局假设——桌面端放在 ReviewWorkspacePanel tab，
 * 移动端放在 review 主视图。
 *
 * v7 设计：
 *   - 关键段有 pine 左侧竖条 + ★ 标记
 *   - 图片内联在对应段落
 *   - 时间戳 chip 可点击跳转播放
 *   - 长按段落触发 onMarkConfusion（困惑点 = digest 属性）
 *   - "原文"折叠区展开该段原始转录
 */

import React, { useState, useCallback } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { LessonDigest, DigestSection } from '@/lib/services/lesson-digest-service';

export interface LessonDigestCardProps {
  digest: LessonDigest;
  /** 点击时间戳跳转播放（传入毫秒） */
  onSeek?: (ms: number) => void;
  /** 长按段落标记困惑点 */
  onMarkConfusion?: (section: DigestSection) => void;
  /** 获取图片 URL（通过 imageId 查找） */
  getImageUrl?: (imageId: string) => string | undefined;
  /** 该段是否有原始转录可展开 */
  getOriginalTranscript?: (startMs: number, endMs: number) => string | undefined;
  /** 哪些段是关键段（由 AI 标记或前端判断） */
  keySectionIndices?: Set<number>;
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function DigestSectionCard({
  index,
  section,
  isKey,
  onSeek,
  onMarkConfusion,
  getImageUrl,
  getOriginalTranscript,
}: {
  index: number;
  section: DigestSection;
  isKey: boolean;
  onSeek?: (ms: number) => void;
  onMarkConfusion?: (section: DigestSection) => void;
  getImageUrl?: (imageId: string) => string | undefined;
  getOriginalTranscript?: (startMs: number, endMs: number) => string | undefined;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const imageUrl = section.imageId ? getImageUrl?.(section.imageId) : undefined;
  const originalText = getOriginalTranscript?.(section.startMs, section.endMs);

  const handleSeek = useCallback(() => {
    onSeek?.(section.startMs);
  }, [onSeek, section.startMs]);

  const pressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlePressStart = useCallback(() => {
    pressTimerRef.current = setTimeout(() => {
      onMarkConfusion?.(section);
    }, 500);
  }, [onMarkConfusion, section]);
  const handlePressEnd = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }, []);

  return (
    <div
      className="relative overflow-hidden rounded-[20px] border border-divider bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.03)]"
      onTouchStart={handlePressStart}
      onTouchEnd={handlePressEnd}
      onTouchMove={handlePressEnd}
      onMouseDown={handlePressStart}
      onMouseUp={handlePressEnd}
      onMouseLeave={handlePressEnd}
    >
      {isKey ? (
        <div className="absolute left-0 top-4 bottom-4 w-[3px] rounded-r-full bg-pine" />
      ) : null}
      <div className={`flex items-center gap-2 mb-2.5 ${isKey ? 'pl-1' : ''}`}>
        <span className="font-mono text-[10px] font-semibold text-pine bg-pine-mist px-1.5 py-0.5 rounded">
          {String(index + 1).padStart(2, '0')}
        </span>
        {isKey ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="#2D4F3E" className="flex-shrink-0">
            <path d="M12 2L9 9l-7 .5L7.5 14 6 21l6-3.5 6 3.5-1.5-7L22 9.5 15 9z" />
          </svg>
        ) : null}
        <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">
          {section.heading}
        </h3>
        <span className="font-mono text-[9px] text-ink-muted ml-auto">
          {formatMs(section.startMs)}
        </span>
      </div>
      <p className={`text-[13px] leading-[1.75] text-ink-secondary ${isKey ? 'pl-1' : ''}`}>
        {section.text}
      </p>
      {imageUrl ? (
        <div className="mt-3 relative rounded-xl overflow-hidden ring-1 ring-divider/60">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={section.heading} className="w-full h-44 object-cover" />
          <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-ink/80 backdrop-blur px-2 py-0.5">
            <span className="font-mono text-[9px] font-medium text-white">
              {formatMs(section.startMs)}
            </span>
          </div>
        </div>
      ) : null}
      <div className={`mt-3 flex items-center gap-2 ${isKey ? 'pl-1' : ''}`}>
        {onSeek ? (
          <button
            type="button"
            onClick={handleSeek}
            className="inline-flex items-center gap-1 rounded-full bg-paper-warm px-2.5 py-1 font-mono text-[10.5px] font-medium text-pine transition active:scale-95 hover:bg-pine-mist"
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21" />
            </svg>
            {formatMs(section.startMs)}
          </button>
        ) : null}
        {originalText ? (
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full bg-paper-warm px-2.5 py-1 text-[10.5px] font-medium text-ink-muted transition active:scale-95"
          >
            原文
            {showOriginal ? (
              <ChevronUp size={8} strokeWidth={2.5} />
            ) : (
              <ChevronDown size={8} strokeWidth={2.5} />
            )}
          </button>
        ) : null}
      </div>
      {showOriginal && originalText ? (
        <div className="mt-2 pl-1">
          <div className="rounded-lg bg-canvas/60 px-3 py-2 border-l-2 border-pine/20">
            <p className="font-mono text-[9px] text-ink-muted mb-1">
              [{formatMs(section.startMs)} - {formatMs(section.endMs)}]
            </p>
            <p className="text-[11px] leading-relaxed text-ink-muted italic">
              &ldquo;{originalText}&rdquo;
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function LessonDigestCard({
  digest,
  onSeek,
  onMarkConfusion,
  getImageUrl,
  getOriginalTranscript,
  keySectionIndices,
}: LessonDigestCardProps) {
  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-pine">
          课堂总结
        </p>
        <h1 className="mt-1.5 font-serif text-[26px] leading-[1.15] tracking-[-0.02em] text-ink">
          {digest.title}
        </h1>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">
          {digest.overview}
        </p>
      </div>

      {digest.sections.map((section, i) => (
        <DigestSectionCard
          key={`section-${i}-${section.startMs}`}
          index={i}
          section={section}
          isKey={keySectionIndices?.has(i) ?? false}
          onSeek={onSeek}
          onMarkConfusion={onMarkConfusion}
          getImageUrl={getImageUrl}
          getOriginalTranscript={getOriginalTranscript}
        />
      ))}

      {digest.extras.length > 0 ? (
        <div className="rounded-[20px] border border-dashed border-divider bg-canvas/50 p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted mb-2">
            课后补充
          </p>
          <p className="text-[12px] leading-relaxed text-ink-muted mb-3">
            课后拍的补充资料，没有对应到课堂具体时间：
          </p>
          <div className="space-y-2">
            {digest.extras.map((extra, i) => {
              const imgUrl = extra.imageId ? getImageUrl?.(extra.imageId) : undefined;
              return (
                <div key={`extra-${i}`} className="flex items-center gap-2">
                  {imgUrl ? (
                    <div className="h-12 w-16 rounded-lg overflow-hidden ring-1 ring-divider flex-shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imgUrl} alt={extra.text} className="h-full w-full object-cover" />
                    </div>
                  ) : null}
                  <span className="text-[12px] text-ink-secondary">{extra.text}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default LessonDigestCard;
