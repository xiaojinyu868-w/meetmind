'use client';

/**
 * MobileCollectionCard — 移动端收集流卡片
 *
 * 对齐 demo：图标区分类型、时间+时长、状态标签（带脉冲点）、段数信息
 */

import React from 'react';
import { Mic, FileText, Camera, Link as LinkIcon, Video, ChevronRight, Check } from 'lucide-react';
import type { SourceIngestItem } from '@/types/page-types';

interface MobileCollectionCardProps {
  item: SourceIngestItem;
  onClick: () => void;
}

function formatTime(addedAt: string): string {
  const d = new Date(addedAt);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHr < 24) return `${diffHr}小时前`;
  if (diffDay === 1) return '昨天';
  if (diffDay < 7) return `${diffDay}天前`;
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return '不到1分钟';
  if (min < 60) return `${min}分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}小时${m}分` : `${h}小时`;
}

function getTypeIcon(type: SourceIngestItem['type']) {
  switch (type) {
    case 'audio':
      return { icon: Mic, bg: 'bg-pine-mist', color: 'text-pine' };
    case 'video':
      return { icon: Video, bg: 'bg-pine-mist', color: 'text-pine' };
    case 'image':
      return { icon: Camera, bg: 'bg-vermilion-mist', color: 'text-vermilion' };
    case 'text':
    case 'document':
      return { icon: FileText, bg: 'bg-paper-warm', color: 'text-ink-secondary' };
    default:
      return { icon: LinkIcon, bg: 'bg-paper-warm', color: 'text-ink-secondary' };
  }
}

function getStatusBadge(item: SourceIngestItem): { text: string; className: string; pulse?: boolean; check?: boolean } | null {
  if (item.status === 'transcribing') return { text: '转写中', className: 'bg-paper-warm text-ink-muted', pulse: true };
  if (item.status === 'parsing') return { text: '识别中', className: 'bg-paper-warm text-ink-muted', pulse: true };
  if (item.status === 'ready' && (item.type === 'audio' || item.type === 'video')) return { text: '已理解', className: 'bg-pine-mist text-pine', check: true };
  if (item.status === 'failed') return { text: '失败', className: 'bg-vermilion-mist text-vermilion' };
  return null;
}

export function MobileCollectionCard({ item, onClick }: MobileCollectionCardProps) {
  const { icon: Icon, bg, color } = getTypeIcon(item.type);
  const status = getStatusBadge(item);
  const timeLabel = formatTime(item.addedAt);
  const durLabel = formatDuration(item.durationMs);

  // 补充信息：段数 / 板书数
  const metaParts: string[] = [];
  if (item.segmentCount > 0) metaParts.push(`${item.segmentCount}段`);
  if (item.type === 'image') metaParts.push('板书');
  const metaText = metaParts.join(' · ');

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-[16px] bg-white border p-3 text-left active:scale-[0.99] transition ${item.type === 'text' ? 'border-vermilion/20' : 'border-divider'}`}
    >
      <div className="flex items-start gap-2.5">
        <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${bg}`}>
          <Icon size={15} strokeWidth={2} className={color} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink truncate leading-snug">
            {item.title || '未命名'}
          </p>
          <p className="text-[11px] text-ink-muted mt-0.5">
            {timeLabel}{durLabel ? ` · ${durLabel}` : ''}
          </p>
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            {status && (
              <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${status.className}`}>
                {status.pulse && <span className="h-1.5 w-1.5 rounded-full bg-pine m-rec-dot" />}
                {status.check && <Check size={8} strokeWidth={3} />}
                {status.text}
              </span>
            )}
            {metaText && (
              <span className="font-mono text-[9px] text-ink-muted">{metaText}</span>
            )}
          </div>
        </div>
        <ChevronRight size={14} className="flex-shrink-0 text-ink-muted mt-1" />
      </div>
    </button>
  );
}

export default MobileCollectionCard;
