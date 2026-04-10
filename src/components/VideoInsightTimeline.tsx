'use client';

import { memo, useMemo } from 'react';

export type InsightKind = 'highlight' | 'checkpoint';

export interface VideoInsightItem {
  id: string;
  prompt: string;
  summary: string;
  timestamps: number[];
  color: string;
  /** 片段结束时间（ms），与 timestamps[0] 配合表达一个时间区间 */
  endMs?: number;
  /** 类型区分：高光片段 or 测验检查点 */
  kind?: InsightKind;
  /** 检查点状态（仅 kind=checkpoint 时有效） */
  checkpointStatus?: 'pending' | 'active' | 'completed' | 'skipped';
  /** 检查点索引（用于手动触发） */
  checkpointIndex?: number;
}

interface VideoInsightTimelineProps {
  items: VideoInsightItem[];
  activeItemId: string | null;
  totalDuration: number;
  formatTime: (ms: number) => string;
  onSelectItem: (itemId: string) => void;
  onSeek: (timeMs: number) => void;
  /** 点击检查点旗帜时的回调（手动触发测验） */
  onTriggerCheckpoint?: (checkpointIndex: number) => void;
  /** 当前播放进度（ms），用于显示进度指针 */
  currentTimeMs?: number;
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

// ── 检查点旗帜图标 ──
function CheckpointFlag({ color, size = 14, completed }: { color: string; size?: number; completed?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      {completed ? (
        // 完成态：打勾
        <g>
          <rect x="2" y="1" width="12" height="10" rx="2" fill={color} opacity="0.9" />
          <polyline points="5,7 7.5,9.5 11,4.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <line x1="4" y1="11" x2="4" y2="15" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        </g>
      ) : (
        // 待做态：问号旗帜
        <g>
          <rect x="2" y="1" width="12" height="10" rx="2" fill={color} opacity="0.85" />
          <text x="8" y="8.5" textAnchor="middle" fill="white" fontSize="8" fontWeight="700" fontFamily="system-ui">?</text>
          <line x1="4" y1="11" x2="4" y2="15" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}

// ── 检查点状态 badge ──
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; bg: string; text: string }> = {
    pending: { label: '待检验', bg: 'bg-amber-50 border-amber-200', text: 'text-amber-600' },
    active: { label: '进行中', bg: 'bg-blue-50 border-blue-200', text: 'text-blue-600' },
    completed: { label: '已完成', bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-600' },
    skipped: { label: '已跳过', bg: 'bg-[#F7F7F5] border-[#E9E9E7]', text: 'text-[#A3A39E]' },
  };
  const c = config[status] || config.pending;
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

/** 测验检查点颜色 — 区别于高光片段的紫/绿/蓝色调 */
const CHECKPOINT_COLOR = '#E67E22';

function VideoInsightTimelineComponent({
  items,
  activeItemId,
  totalDuration,
  formatTime,
  onSelectItem,
  onSeek,
  onTriggerCheckpoint,
  currentTimeMs = 0,
}: VideoInsightTimelineProps) {
  // 分类
  const highlights = useMemo(() => items.filter((i) => i.kind !== 'checkpoint'), [items]);
  const checkpoints = useMemo(() => items.filter((i) => i.kind === 'checkpoint'), [items]);

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#E9E9E7] bg-[#F7F7F5] px-5 py-8 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white border border-[#E9E9E7]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A3A39E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8" />
            <path d="M12 17v4" />
            <path d="m10 9 3 2-3 2" />
          </svg>
        </div>
        <p className="text-[13px] text-[#787774] leading-relaxed">开启随堂检验后<br/>精选片段和检查点会自动出现在这里</p>
      </div>
    );
  }

  const activeItem = items.find((item) => item.id === activeItemId) || items[0];
  const dur = totalDuration > 0 ? totalDuration : 1;
  const progressPct = clampPct((currentTimeMs / dur) * 100);

  return (
    <div className="space-y-3">
      {/* ── 可视化时间轴 ── */}
      <div className="rounded-2xl border border-[#E9E9E7] bg-white p-4">
        {/* 时间轴 track */}
        <div className="relative" style={{ height: 40 }}>
          {/* 底部背景轨道 */}
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[6px] rounded-full bg-[#F0F0EE]" />

          {/* 已播放进度 */}
          <div
            className="absolute top-1/2 -translate-y-1/2 h-[6px] rounded-full bg-[#E9E9E7] transition-[width] duration-300"
            style={{ left: 0, width: `${progressPct}%` }}
          />

          {/* 高光片段色带 */}
          {highlights.map((item, i) => {
            const isActive = item.id === activeItem?.id;
            const startMs = item.timestamps[0] ?? 0;
            const hasRange = typeof item.endMs === 'number' && item.endMs > startMs;

            if (hasRange) {
              const leftPct = clampPct((startMs / dur) * 100);
              const rawWidth = clampPct(((item.endMs! - startMs) / dur) * 100);
              const widthPct = Math.max(2.5, rawWidth);
              return (
                <button
                  key={`hl-${item.id}`}
                  type="button"
                  onClick={() => { onSelectItem(item.id); onSeek(startMs); }}
                  className="absolute top-1/2 -translate-y-1/2 rounded-full transition-all cursor-pointer"
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    height: isActive ? 14 : 8,
                    backgroundColor: item.color,
                    opacity: isActive ? 0.9 : 0.35,
                    zIndex: isActive ? 20 : i + 1,
                  }}
                  title={`${item.prompt}: ${formatTime(startMs)} – ${formatTime(item.endMs!)}`}
                />
              );
            }

            // 无 endMs 的点
            const leftPct = clampPct((startMs / dur) * 100);
            return (
              <button
                key={`hl-dot-${item.id}-${startMs}`}
                type="button"
                onClick={() => { onSelectItem(item.id); onSeek(startMs); }}
                className="absolute top-1/2 rounded-full transition-all cursor-pointer"
                style={{
                  left: `${leftPct}%`,
                  width: 8,
                  height: isActive ? 12 : 8,
                  backgroundColor: item.color,
                  opacity: isActive ? 0.9 : 0.35,
                  zIndex: isActive ? 20 : i + 1,
                  transform: 'translate(-50%, -50%)',
                }}
              />
            );
          })}

          {/* 测验检查点旗帜 */}
          {checkpoints.map((cp) => {
            const triggerMs = cp.timestamps[0] ?? 0;
            const leftPct = clampPct((triggerMs / dur) * 100);
            const isCompleted = cp.checkpointStatus === 'completed';
            const isSkipped = cp.checkpointStatus === 'skipped';
            const isActive = cp.id === activeItem?.id;

            return (
              <button
                key={`cp-${cp.id}`}
                type="button"
                onClick={() => {
                  onSelectItem(cp.id);
                  if (onTriggerCheckpoint && typeof cp.checkpointIndex === 'number' && !isCompleted && !isSkipped) {
                    onTriggerCheckpoint(cp.checkpointIndex);
                  } else {
                    onSeek(triggerMs);
                  }
                }}
                className={`absolute transition-all cursor-pointer ${isActive ? 'scale-125' : 'hover:scale-110'}`}
                style={{
                  left: `${leftPct}%`,
                  top: -2,
                  transform: 'translateX(-50%)',
                  zIndex: 30,
                  opacity: isSkipped ? 0.4 : 1,
                }}
                title={`${cp.prompt} (${formatTime(triggerMs)})`}
              >
                <CheckpointFlag color={CHECKPOINT_COLOR} size={18} completed={isCompleted} />
              </button>
            );
          })}

          {/* 播放进度指针 */}
          <div
            className="absolute top-1/2 h-4 w-1 rounded-full bg-[#232322] transition-[left] duration-300"
            style={{
              left: `${progressPct}%`,
              transform: 'translate(-50%, -50%)',
              zIndex: 40,
            }}
          />
        </div>

        {/* 时间刻度 */}
        <div className="flex items-center justify-between mt-1 text-[11px] text-[#A3A39E] tabular-nums select-none">
          <span>00:00</span>
          <span>{formatTime(dur)}</span>
        </div>
      </div>

      {/* ── 检查点卡片（优先显示） ── */}
      {checkpoints.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 px-1">
            <CheckpointFlag color={CHECKPOINT_COLOR} size={13} />
            <span className="text-[12px] font-medium text-[#787774]">知识检查点</span>
            <span className="text-[11px] text-[#A3A39E]">{checkpoints.length} 个</span>
          </div>
          {checkpoints.map((cp) => {
            const isActive = cp.id === activeItem?.id;
            const triggerMs = cp.timestamps[0] ?? 0;
            const isCompleted = cp.checkpointStatus === 'completed';
            const isSkipped = cp.checkpointStatus === 'skipped';
            const canTrigger = !isCompleted && !isSkipped && onTriggerCheckpoint && typeof cp.checkpointIndex === 'number';

            return (
              <button
                key={cp.id}
                type="button"
                onClick={() => {
                  onSelectItem(cp.id);
                  if (canTrigger) {
                    onTriggerCheckpoint!(cp.checkpointIndex!);
                  }
                }}
                className={`group w-full text-left rounded-2xl transition-colors overflow-hidden ${
                  isActive
                    ? 'bg-amber-50/80 border border-amber-200'
                    : 'bg-white border border-[#E9E9E7] hover:border-amber-300 hover:bg-amber-50/30'
                }`}
              >
                <div className="px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <CheckpointFlag color={CHECKPOINT_COLOR} size={15} completed={isCompleted} />
                    <span className="text-[13px] font-medium text-[#232322] leading-snug truncate flex-1">{cp.prompt}</span>
                    <StatusBadge status={cp.checkpointStatus || 'pending'} />
                  </div>
                  {cp.summary && (
                    <p className="mt-1.5 text-xs text-[#787774] line-clamp-1 leading-relaxed pl-[23px]">{cp.summary}</p>
                  )}
                  <div className="mt-1.5 pl-[23px] flex items-center gap-2">
                    <span className="text-[11px] tabular-nums text-[#A3A39E]">{formatTime(triggerMs)}</span>
                    {canTrigger && (
                      <span className="text-[11px] font-medium text-amber-600 group-hover:text-amber-700">
                        点击检验 →
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── 高光片段卡片 ── */}
      {highlights.length > 0 && highlights.some(h => !h.id.startsWith('seed-')) && (
        <div className="space-y-1.5">
          {checkpoints.length > 0 && (
            <div className="flex items-center gap-1.5 px-1 mt-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: highlights[0]?.color || '#B48EFA' }} />
              <span className="text-[12px] font-medium text-[#787774]">精选片段</span>
              <span className="text-[11px] text-[#A3A39E]">{highlights.filter(h => !h.id.startsWith('seed-')).length} 个</span>
            </div>
          )}
          {highlights.filter(h => !h.id.startsWith('seed-')).map((item, index) => {
            const isActive = item.id === activeItem?.id;
            const hasRange = typeof item.endMs === 'number' && item.endMs > (item.timestamps[0] ?? 0);
            const startMs = item.timestamps[0] ?? 0;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => { onSelectItem(item.id); onSeek(startMs); }}
                className={`group w-full text-left rounded-2xl transition-colors overflow-hidden ${
                  isActive ? 'bg-[#F7F7F5]' : 'bg-white hover:bg-[#F7F7F5]/60'
                }`}
              >
                <div className="flex">
                  <div
                    className="w-1 shrink-0 rounded-l-2xl"
                    style={{ backgroundColor: item.color, opacity: isActive ? 1 : 0.4 }}
                  />
                  <div className="flex-1 min-w-0 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[5px] px-1 text-[10px] font-bold text-white leading-none"
                        style={{ backgroundColor: item.color }}
                      >
                        {index + 1}
                      </span>
                      <span className="text-[13px] font-medium text-[#232322] leading-snug truncate">{item.prompt}</span>
                    </div>
                    {item.summary && (
                      <p className="mt-1 text-xs text-[#787774] line-clamp-2 leading-relaxed pl-[26px]">{item.summary}</p>
                    )}
                    <div className="mt-1.5 pl-[26px] flex flex-wrap gap-1.5">
                      {hasRange ? (
                        <span
                          onClick={(e) => { e.stopPropagation(); onSeek(startMs); }}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#E9E9E7] bg-white px-2 py-[3px] text-[11px] tabular-nums text-[#787774] transition-colors hover:border-[#232322] hover:text-[#232322] cursor-pointer select-none"
                        >
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 opacity-50">
                            <polygon points="4,2 14,8 4,14" />
                          </svg>
                          {formatTime(startMs)}
                          <span className="text-[#A3A39E]">–</span>
                          {formatTime(item.endMs!)}
                        </span>
                      ) : (
                        item.timestamps.map((timeMs, tIndex) => (
                          <span
                            key={`${item.id}-chip-${timeMs}-${tIndex}`}
                            onClick={(e) => { e.stopPropagation(); onSeek(timeMs); }}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#E9E9E7] bg-white px-2 py-[3px] text-[11px] tabular-nums text-[#787774] transition-colors hover:border-[#232322] hover:text-[#232322] cursor-pointer select-none"
                          >
                            {formatTime(timeMs)}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const VideoInsightTimeline = memo(VideoInsightTimelineComponent);
