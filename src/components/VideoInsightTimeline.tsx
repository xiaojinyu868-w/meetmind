'use client';

import { memo } from 'react';

export interface VideoInsightItem {
  id: string;
  prompt: string;
  summary: string;
  timestamps: number[];
  color: string;
}

interface VideoInsightTimelineProps {
  items: VideoInsightItem[];
  activeItemId: string | null;
  totalDuration: number;
  formatTime: (ms: number) => string;
  onSelectItem: (itemId: string) => void;
  onSeek: (timeMs: number) => void;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function VideoInsightTimelineComponent({
  items,
  activeItemId,
  totalDuration,
  formatTime,
  onSelectItem,
  onSeek,
}: VideoInsightTimelineProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
        在右侧提问后，这里会按“每轮回答”生成可点击的时间戳高亮。
      </div>
    );
  }

  const activeItem = items.find((item) => item.id === activeItemId) || items[0];
  const safeDuration = totalDuration > 0 ? totalDuration : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const selected = item.id === activeItem.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectItem(item.id)}
              className={`max-w-full rounded-full border px-3 py-1.5 text-xs transition ${
                selected
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
              title={item.prompt}
            >
              <span className="truncate block max-w-[240px]">{item.prompt}</span>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
        <div className="relative h-12 rounded-xl bg-white border border-gray-100 overflow-hidden">
          <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 bg-gray-100" />
          {activeItem.timestamps.map((timeMs, index) => (
            <button
              key={`${activeItem.id}-${timeMs}-${index}`}
              type="button"
              onClick={() => onSeek(timeMs)}
              className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white shadow transition hover:scale-110"
              style={{
                left: `${clampPercent((timeMs / safeDuration) * 100)}%`,
                backgroundColor: activeItem.color,
              }}
              title={formatTime(timeMs)}
            />
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
          <span>00:00</span>
          <span>{formatTime(safeDuration)}</span>
        </div>
      </div>

      <div className="space-y-2">
        {items.map((item) => {
          const selected = item.id === activeItem.id;
          return (
            <div
              key={item.id}
              className={`rounded-2xl border px-3 py-2 transition ${
                selected ? 'border-amber-200 bg-amber-50/50' : 'border-gray-100 bg-white'
              }`}
            >
              <div className="flex items-start gap-2">
                <span
                  className="mt-1 h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-800 truncate">{item.prompt}</div>
                  <div className="mt-0.5 text-xs text-gray-600 line-clamp-2">{item.summary}</div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {item.timestamps.map((timeMs, index) => (
                  <button
                    key={`${item.id}-chip-${timeMs}-${index}`}
                    type="button"
                    onClick={() => onSeek(timeMs)}
                    className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 transition hover:border-amber-300 hover:text-amber-700"
                  >
                    {formatTime(timeMs)}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const VideoInsightTimeline = memo(VideoInsightTimelineComponent);
