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
  /** LLM plan 正在加载中 */
  isPlanLoading?: boolean;
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

// ── Shimmer 骨架屏动画 ──
function InsightSkeleton() {
  return (
    <div className="animate-pulse">
      {/* 时间轴骨架 */}
      <div className="py-2">
        <div className="relative" style={{ height: 40 }}>
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[6px] rounded-full bg-[#F0F0EE]" />
          {[18, 38, 62, 80].map((left) => (
            <div
              key={left}
              className="absolute top-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: `${left}%`,
                width: '8%',
                height: 8,
                backgroundColor: '#E9E9E7',
                opacity: 0.6,
              }}
            />
          ))}
        </div>
        <div className="flex items-center justify-between mt-1">
          <div className="h-3 w-8 rounded bg-[#F0F0EE]" />
          <div className="h-3 w-8 rounded bg-[#F0F0EE]" />
        </div>
      </div>
      {/* 章节行骨架 */}
      <div className="pt-1 space-y-0.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 px-1 py-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#E9E9E7]" />
            <div className="flex-1 h-3.5 rounded bg-[#F0F0EE]" style={{ width: `${60 + i * 6}%` }} />
            <div className="h-3 w-10 rounded bg-[#F7F7F5]" />
          </div>
        ))}
      </div>
      <p className="text-center text-[12px] text-[#A3A39E] pt-2">
        AI 正在分析课堂内容…
      </p>
    </div>
  );
}

function VideoInsightTimelineComponent({
  items,
  activeItemId,
  totalDuration,
  formatTime,
  onSelectItem,
  onSeek,
  onTriggerCheckpoint,
  currentTimeMs = 0,
  isPlanLoading = false,
}: VideoInsightTimelineProps) {
  // 分类
  const highlights = useMemo(() => items.filter((i) => i.kind !== 'checkpoint'), [items]);
  const checkpoints = useMemo(() => items.filter((i) => i.kind === 'checkpoint'), [items]);

  // 只有 seed 项（或空）且正在加载 → 展示骨架屏
  const hasRealItems = items.some((i) => !i.id.startsWith('seed-'));
  if (!hasRealItems && isPlanLoading) {
    return <InsightSkeleton />;
  }

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
    <div>
      {/* ── 可视化时间轴 ── */}
      <div className="py-3">
        {/* 时间轴 track */}
        <div className="relative" style={{ height: 44 }}>
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
        <div className="flex items-center justify-between mt-2 text-[11px] text-[#A3A39E] tabular-nums select-none">
          <span>00:00</span>
          <span>{formatTime(dur)}</span>
        </div>
      </div>

      {/* ── 紧凑章节列表（Longcut 风格） ── */}
      {/* 高光片段 */}
      {highlights.filter(h => !h.id.startsWith('seed-')).length > 0 && (
        <div className="pt-2">
          {highlights.filter(h => !h.id.startsWith('seed-')).map((item) => {
            const isActive = item.id === activeItem?.id;
            const startMs = item.timestamps[0] ?? 0;
            const hasRange = typeof item.endMs === 'number' && item.endMs > startMs;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => { onSelectItem(item.id); onSeek(startMs); }}
                className={`group w-full flex items-center gap-3 px-2 py-2.5 text-left transition-colors rounded-lg ${
                  isActive ? 'bg-[#F7F7F5]' : 'hover:bg-[#F7F7F5]/60'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: item.color, opacity: isActive ? 1 : 0.5 }}
                />
                <span className={`flex-1 min-w-0 text-[13px] leading-snug truncate ${
                  isActive ? 'text-[#232322] font-medium' : 'text-[#787774]'
                }`}>
                  {item.prompt}
                </span>
                <span className="shrink-0 text-[12px] tabular-nums text-[#A3A39E]">
                  {hasRange ? `${formatTime(startMs)}` : formatTime(startMs)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* 测验检查点 */}
      {checkpoints.length > 0 && (
        <div className={`${highlights.filter(h => !h.id.startsWith('seed-')).length > 0 ? 'border-t border-[#E9E9E7] mt-2 pt-2' : 'pt-2'}`}>
          <div className="flex items-center gap-1.5 px-2 py-2">
            <CheckpointFlag color={CHECKPOINT_COLOR} size={12} />
            <span className="text-[11px] font-medium text-[#A3A39E] uppercase tracking-wide">检查点</span>
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
                  } else {
                    onSeek(triggerMs);
                  }
                }}
                className={`group w-full flex items-center gap-3 px-2 py-2.5 text-left transition-colors rounded-lg ${
                  isActive ? 'bg-[#F7F7F5]' : 'hover:bg-[#F7F7F5]/60'
                }`}
              >
                <CheckpointFlag color={CHECKPOINT_COLOR} size={13} completed={isCompleted} />
                <span className={`flex-1 min-w-0 text-[13px] leading-snug truncate ${
                  isActive ? 'text-[#232322] font-medium' : 'text-[#787774]'
                }`}>
                  {cp.prompt}
                </span>
                <div className="shrink-0 flex items-center gap-2">
                  {canTrigger && (
                    <span className="text-[11px] text-amber-600 opacity-0 group-hover:opacity-100 transition-opacity">
                      检验 →
                    </span>
                  )}
                  <StatusBadge status={cp.checkpointStatus || 'pending'} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* 加载中提示 */}
      {isPlanLoading && !hasRealItems && (
        <p className="text-center text-[12px] text-[#A3A39E] py-3">
          AI 正在分析课堂内容…
        </p>
      )}
    </div>
  );
}

export const VideoInsightTimeline = memo(VideoInsightTimelineComponent);
