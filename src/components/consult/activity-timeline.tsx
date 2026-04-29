'use client';

/**
 * ActivityTimeline —— 把 agent 的"后台动作"呈现为可读的时间线。
 *
 * 取代之前那一堆散乱的小徽标。设计参考 Perplexity Pro Search / ChatGPT agent mode：
 *   - 每个后端 tool 调用 = 一行时间线项
 *   - 左侧图标 + icon 颜色表达状态（进行中脉动 / 成功淡色 / 失败红）
 *   - 右侧耗时或 "…"
 *   - 成功后可以展开看结果（比如 webSearch 的 citations）
 *
 * 本组件**只消费** 能力块（webSearch / searchProgramRequirements / readProfile / writeProfile），
 * UI 块（askOptions / showOutreachWorkspace / showDraft / ctaWechat / fileUpload）由主消息流渲染。
 *
 * 对 agent 行为的解读（人话化）：
 *   - webSearch  → "查 <query>"
 *   - searchProgramRequirements → "查项目要求"
 *   - readProfile → "读你的画像"
 *   - writeProfile → "记下 <字段>"
 */

import { useState } from 'react';
import { RotatingHint } from './skeletons';
import { PixelAgentStatus, type PixelAgentState } from './pixel-agent-status';

export interface TimelineItem {
  toolCallId: string;
  tool: 'webSearch' | 'searchProgramRequirements' | 'readProfile' | 'writeProfile' | 'useSkill' | 'unknown';
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

function humanizeAction(item: TimelineItem): { title: string; subtitle?: string } {
  const input = (item.input ?? {}) as Record<string, unknown>;
  switch (item.tool) {
    case 'webSearch': {
      const q = typeof input.query === 'string' ? input.query : '';
      return { title: '联网检索', subtitle: q || undefined };
    }
    case 'searchProgramRequirements': {
      const school = typeof input.school === 'string' ? input.school : '';
      const schools = Array.isArray(input.schools) ? (input.schools as string[]) : [];
      const target = school || schools.slice(0, 3).join('、');
      const field = typeof input.field === 'string' ? input.field : '';
      const focus = typeof input.focus === 'string' ? input.focus : 'requirements';
      const focusLabel: Record<string, string> = {
        requirements: '申请要求',
        deadline: '截止日期',
        funding: '奖学金/经费',
        curriculum: '课程结构',
        faculty: '导师/实验室',
      };
      return {
        title: `检索项目${focusLabel[focus] ?? '信息'}`,
        subtitle: [target, field].filter(Boolean).join(' · ') || undefined,
      };
    }
    case 'readProfile': {
      const keys = Array.isArray(input.keys) ? (input.keys as string[]) : [];
      return {
        title: '读取你的画像',
        subtitle: keys.length > 0 ? `${keys.length} 项：${keys.slice(0, 4).join('、')}${keys.length > 4 ? '…' : ''}` : undefined,
      };
    }
    case 'writeProfile': {
      const patch = (input.patch ?? {}) as Record<string, unknown>;
      const keys = Object.keys(patch);
      return {
        title: '更新你的画像',
        subtitle: keys.length > 0 ? keys.join('、') : undefined,
      };
    }
    case 'useSkill': {
      const name = typeof input.name === 'string' ? input.name : '';
      return { title: '切换到剧本', subtitle: name || undefined };
    }
    default:
      return { title: '执行' };
  }
}

function stateClass(state: TimelineItem['state']): { dot: string; text: string } {
  if (state === 'output-error') return { dot: 'bg-rose-dark', text: 'text-ink-secondary' };
  if (state === 'output-available') return { dot: 'bg-mint-400', text: 'text-ink' };
  return { dot: 'bg-ink/50 consult-dot-pulse', text: 'text-ink-secondary' };
}

function latencyLabel(item: TimelineItem): string | null {
  if (item.state !== 'output-available') return null;
  const out = item.output as Record<string, unknown> | undefined;
  const ms = typeof out?.costMs === 'number' ? (out.costMs as number) : undefined;
  if (typeof ms !== 'number') return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function timelineAgentState(items: TimelineItem[]): PixelAgentState {
  const active = items.find((item) => item.state === 'input-streaming' || item.state === 'input-available');
  const item = active ?? items[items.length - 1];
  if (!item) return 'idle';
  if (!active && item.state === 'output-available') return 'done';
  if (item.state === 'output-error') return 'blocked';
  if (item.tool === 'webSearch' || item.tool === 'searchProgramRequirements') return 'searching';
  if (item.tool === 'readProfile') return 'reading';
  if (item.tool === 'writeProfile') return 'drafting';
  if (item.tool === 'useSkill') return 'thinking';
  return 'thinking';
}

function Citations({ output }: { output: unknown }) {
  const out = output as { citations?: Array<{ index: number; title: string; url: string; site?: string }> } | undefined;
  const cites = out?.citations ?? [];
  if (cites.length === 0) return null;
  return (
    <ol className="mt-1.5 space-y-1 pl-4 text-[11px] leading-relaxed text-ink-secondary">
      {cites.slice(0, 5).map((c) => (
        <li key={c.index} className="flex items-baseline gap-1.5">
          <span className="text-ink-muted">[{c.index}]</span>
          <a
            href={c.url}
            target="_blank"
            rel="noreferrer noopener"
            className="truncate text-ink-secondary hover:text-ink hover:underline underline-offset-2"
            title={c.url}
          >
            {c.title}
          </a>
          {c.site && <span className="shrink-0 text-ink-muted">· {c.site}</span>}
        </li>
      ))}
    </ol>
  );
}

function ProfileDelta({ output }: { output: unknown }) {
  const out = output as { profile?: Record<string, unknown>; writtenKeys?: string[]; missing?: string[] } | undefined;
  if (!out) return null;
  if (Array.isArray(out.writtenKeys) && out.writtenKeys.length > 0) {
    return <div className="mt-1 text-[11px] text-ink-muted">已写入 {out.writtenKeys.length} 项</div>;
  }
  if (Array.isArray(out.missing) && out.missing.length > 0) {
    return <div className="mt-1 text-[11px] text-ink-muted">缺失：{out.missing.slice(0, 3).join('、')}{out.missing.length > 3 ? '…' : ''}</div>;
  }
  return null;
}

function ItemRow({ item }: { item: TimelineItem }) {
  const { title, subtitle } = humanizeAction(item);
  const sc = stateClass(item.state);
  const latency = latencyLabel(item);
  const [expanded, setExpanded] = useState(false);
  const expandable =
    (item.tool === 'webSearch' || item.tool === 'searchProgramRequirements') &&
    item.state === 'output-available';

  return (
    <li className="group relative pl-5">
      {/* 左侧 dot */}
      <span className={`absolute left-0 top-1.5 h-2 w-2 rounded-full ${sc.dot}`} aria-hidden="true" />
      {/* 主行 */}
      <div
        className={
          'flex items-baseline justify-between gap-3 text-[12px] ' +
          sc.text +
          (expandable ? ' cursor-pointer' : '')
        }
        onClick={() => expandable && setExpanded((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <span className="font-medium">{title}</span>
          {subtitle && <span className="ml-1.5 text-ink-muted">{subtitle}</span>}
        </div>
        <div className="shrink-0 text-[10px] text-ink-muted tabular-nums">
          {item.state === 'output-error' ? (
            '失败'
          ) : latency ? (
            latency
          ) : item.state === 'output-available' ? (
            '✓'
          ) : (
            <RotatingHint tool={item.tool} />
          )}
          {expandable && (
            <span className="ml-2 text-ink-muted">{expanded ? '收起' : '展开'}</span>
          )}
        </div>
      </div>

      {/* error message */}
      {item.state === 'output-error' && item.errorText && (
        <div className="mt-1 text-[11px] text-rose-dark">{item.errorText.slice(0, 160)}</div>
      )}

      {/* 展开：webSearch citations */}
      {expandable && expanded && <Citations output={item.output} />}

      {/* readProfile / writeProfile 附注 */}
      {item.state === 'output-available' && (item.tool === 'readProfile' || item.tool === 'writeProfile') && (
        <ProfileDelta output={item.output} />
      )}
    </li>
  );
}

export function ActivityTimeline({ items }: { items: TimelineItem[] }) {
  const hasActive = items.some((item) => item.state === 'input-streaming' || item.state === 'input-available');
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const agentState = timelineAgentState(items);
  const expanded = open || hasActive;
  const doneCount = items.filter((item) => item.state === 'output-available').length;
  const failedCount = items.filter((item) => item.state === 'output-error').length;
  const latest = humanizeAction(items[items.length - 1]);
  const compactLabel = hasActive ? '正在处理' : failedCount > 0 ? '有动作失败' : '已处理';
  const compactDetail = items.length === 1
    ? latest.title
    : `${doneCount}/${items.length} 个后台动作`;
  return (
    <div className="consult-reveal rounded-lg border border-divider bg-card/60 px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          {hasActive ? (
            <PixelAgentStatus state={agentState} label={compactLabel} size="sm" />
          ) : (
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${failedCount > 0 ? 'bg-rose-dark' : 'bg-mint-400'}`}
              aria-hidden="true"
            />
          )}
          <div className="min-w-0">
            {!hasActive && <div className="text-[11.5px] font-medium text-ink">{compactLabel}</div>}
            <div className="truncate text-[11px] leading-relaxed text-ink-muted">
              {compactDetail}{latest.subtitle && hasActive ? ` · ${latest.subtitle}` : ''}
            </div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[11px] text-ink-muted">{expanded ? '收起' : '详情'}</div>
        </div>
      </button>
      {expanded && (
        <ol className="relative mt-3 space-y-1.5 border-t border-divider pt-3">
          <span className="absolute left-[3px] top-5 bottom-2 w-px bg-divider" aria-hidden="true" />
          {items.map((it) => (
            <ItemRow key={it.toolCallId} item={it} />
          ))}
        </ol>
      )}
    </div>
  );
}
