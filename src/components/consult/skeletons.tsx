'use client';

/**
 * Consult skeletons —— 各种 pending / streaming 状态的骨架屏
 *
 * 设计原则：
 *   1. 每种状态的骨架都反映最终 UI 的真实结构（不是通用灰条）
 *   2. 配 skeleton shimmer 动画，给学生"系统在工作"的节奏感
 *   3. 一旦真实内容可用，骨架**原位被替换**，视觉连续
 *
 * 使用场景：
 *   - PendingAssistantSkeleton: 学生刚发消息/点 tool 结果，等 first token 之间
 *   - BlockStreamingSkeleton: tool 的 state === 'input-streaming'，JSON 还没完整
 *   - CapabilityRunningHint: 后端能力块执行中（webSearch / parse-file），给步骤 hint
 */

import { useEffect, useState } from 'react';
import { PixelAgentStatus } from './pixel-agent-status';

// ─────────────────────────────────────────────────────
// 1. 学生刚交互完，等 first token：整体助手消息的占位
// ─────────────────────────────────────────────────────

/** 学生刚发完消息 / 刚提交工具结果，在等 assistant 流回来 */
export function PendingAssistantSkeleton() {
  return (
    <div className="consult-reveal consult-breathe space-y-3">
      <div className="rounded-xl border border-divider bg-card/60 px-4 py-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <PixelAgentStatus state="reading" label="我在看你的背景" size="md" />
          <span className="hidden text-[10px] uppercase tracking-wider text-ink-muted sm:inline">
            正在工作
          </span>
        </div>
        <div className="space-y-1.5 pl-[52px]">
          <div className="h-3 w-2/3 consult-skeleton" />
          <div className="h-3 w-1/2 consult-skeleton" style={{ animationDelay: '0.2s' }} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 2. tool 的 input-streaming 阶段：按 tool 类型的专用骨架
// ─────────────────────────────────────────────────────

type BlockKind = 'askOptions' | 'consultantMove' | 'advisorDiscovery' | 'servicePlan' | 'showDraft' | 'outreachWorkspace' | 'fileUpload' | 'ctaWechat';

const HINT_FOR_KIND: Record<BlockKind, string> = {
  askOptions: '正在整理选项…',
  consultantMove: '正在判断你的真实意图…',
  advisorDiscovery: '正在收窄导师方向…',
  servicePlan: '正在组织完整服务方案…',
  showDraft: '正在起草…',
  outreachWorkspace: '正在搭工作台…',
  fileUpload: '准备上传入口…',
  ctaWechat: '即将为你接通顾问…',
};

export function BlockStreamingSkeleton({ kind }: { kind: BlockKind }) {
  if (kind === 'consultantMove') {
    return (
      <div className="consult-reveal consult-breathe rounded-xl border border-divider bg-card px-4 py-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <PixelAgentStatus state="thinking" label="我在判断" size="sm" />
          <span className="text-[10px] text-ink-muted">{HINT_FOR_KIND.consultantMove}</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-divider bg-canvas px-3 py-2">
            <div className="h-2 w-20 consult-skeleton" />
            <div className="mt-2 h-3 w-4/5 consult-skeleton" />
          </div>
          <div className="rounded-lg border border-divider bg-card px-3 py-2">
            <div className="h-2 w-16 consult-skeleton" />
            <div className="mt-2 h-3 w-2/3 consult-skeleton" />
          </div>
        </div>
      </div>
    );
  }

  if (kind === 'servicePlan') {
    return (
      <div className="consult-reveal consult-breathe overflow-hidden rounded-xl border border-divider bg-card">
        <div className="border-l-2 border-ink/30 bg-hover/40 px-4 py-3">
          <div className="h-2 w-24 consult-skeleton" />
          <div className="mt-2 h-3.5 w-3/5 consult-skeleton" />
          <div className="mt-2 h-3 w-4/5 consult-skeleton" />
        </div>
        <div className="grid gap-2 px-4 py-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-divider bg-canvas px-3 py-2">
              <div className="h-2 w-16 consult-skeleton" style={{ animationDelay: `${i * 0.08}s` }} />
              <div className="mt-2 h-3 w-4/5 consult-skeleton" />
            </div>
          ))}
        </div>
        <div className="px-4 pb-3 text-[11px] text-ink-muted consult-breathe">{HINT_FOR_KIND.servicePlan}</div>
      </div>
    );
  }

  if (kind === 'advisorDiscovery') {
    return (
      <div className="consult-reveal consult-breathe overflow-hidden rounded-xl border border-divider bg-card">
        <div className="border-l-2 border-ink/30 bg-hover/40 px-4 py-3">
          <div className="h-2 w-24 consult-skeleton" />
          <div className="mt-2 h-3.5 w-3/5 consult-skeleton" />
          <div className="mt-2 h-3 w-4/5 consult-skeleton" />
        </div>
        <div className="space-y-2 px-4 py-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-divider bg-card px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="h-3 w-1/3 consult-skeleton" style={{ animationDelay: `${i * 0.08}s` }} />
                <div className="h-5 w-14 rounded-full consult-skeleton" />
              </div>
              <div className="mt-2 h-2.5 w-4/5 consult-skeleton" />
            </div>
          ))}
        </div>
        <div className="px-4 pb-3 text-[11px] text-ink-muted consult-breathe">{HINT_FOR_KIND.advisorDiscovery}</div>
      </div>
    );
  }

  if (kind === 'askOptions') {
    return (
      <div className="consult-reveal consult-breathe rounded-xl border border-divider bg-card p-4">
        <div className="h-3 w-2/5 consult-skeleton" />
        <div className="mt-3 space-y-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-divider bg-card px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <div className="h-3.5 w-3.5 rounded-full consult-skeleton" />
                <div className="h-3 w-1/3 consult-skeleton" style={{ animationDelay: `${i * 0.08}s` }} />
              </div>
              <div className="mt-1 ml-5 h-2.5 w-3/5 consult-skeleton" style={{ animationDelay: `${0.1 + i * 0.08}s` }} />
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="h-7 w-14 consult-skeleton rounded-lg" />
          <span className="text-[11px] text-ink-muted">{HINT_FOR_KIND.askOptions}</span>
        </div>
      </div>
    );
  }

  if (kind === 'showDraft') {
    return (
      <div className="consult-reveal consult-breathe overflow-hidden rounded-xl border border-divider bg-card">
        <div className="flex items-center justify-between gap-3 border-l-2 border-ink/30 bg-hover/40 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-2 w-16 consult-skeleton" />
            <div className="h-3.5 w-3/4 consult-skeleton" />
          </div>
        </div>
        <div className="space-y-2 px-5 py-4">
          {[80, 95, 70, 88, 60].map((w, i) => (
            <div
              key={i}
              className="h-3 consult-skeleton"
              style={{ width: `${w}%`, animationDelay: `${i * 0.08}s` }}
            />
          ))}
        </div>
        <div className="px-5 pb-3 text-[11px] text-ink-muted consult-breathe">{HINT_FOR_KIND.showDraft}</div>
      </div>
    );
  }

  if (kind === 'outreachWorkspace') {
    return (
      <div className="consult-reveal consult-breathe overflow-hidden rounded-xl border border-divider bg-card">
        <div className="border-l-2 border-ink/30 bg-hover/40 px-4 py-3">
          <div className="h-2 w-28 consult-skeleton" />
          <div className="mt-2 h-3.5 w-3/5 consult-skeleton" />
          <div className="mt-2 h-3 w-4/5 consult-skeleton" style={{ animationDelay: '0.1s' }} />
        </div>
        <div className="divide-y divide-divider">
          {[0, 1, 2].map((i) => (
            <div key={i} className="px-4 py-3">
              <div className="mb-2 h-2 w-20 consult-skeleton" style={{ animationDelay: `${i * 0.08}s` }} />
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="h-12 rounded-lg border border-divider bg-canvas consult-skeleton" />
                <div className="h-12 rounded-lg border border-divider bg-canvas consult-skeleton" style={{ animationDelay: '0.12s' }} />
              </div>
            </div>
          ))}
        </div>
        <div className="px-4 pb-3 text-[11px] text-ink-muted consult-breathe">{HINT_FOR_KIND.outreachWorkspace}</div>
      </div>
    );
  }

  if (kind === 'fileUpload') {
    return (
      <div className="consult-reveal consult-breathe rounded-xl border border-divider bg-card p-4">
        <div className="mb-3 h-3 w-1/3 consult-skeleton" />
        <div className="flex items-center gap-3 rounded-lg border-2 border-dashed border-divider bg-canvas/50 px-4 py-5">
          <div className="h-10 w-10 rounded-lg consult-skeleton" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-1/2 consult-skeleton" />
            <div className="h-2.5 w-3/4 consult-skeleton" style={{ animationDelay: '0.15s' }} />
          </div>
        </div>
      </div>
    );
  }

  // ctaWechat
  return (
    <div
      className="consult-reveal consult-breathe overflow-hidden rounded-xl border p-5"
      style={{
        borderColor: '#E6D38A',
        background: 'linear-gradient(180deg, #FEFAEB 0%, #FDF3C0 100%)',
      }}
    >
      <div className="h-2 w-12 consult-skeleton" style={{ background: 'rgba(166, 132, 0, 0.15)' }} />
      <div className="mt-2 h-3.5 w-4/5 consult-skeleton" style={{ background: 'rgba(166, 132, 0, 0.15)' }} />
      <div className="mt-2 space-y-1.5">
        <div className="h-2.5 w-[90%] consult-skeleton" style={{ background: 'rgba(166, 132, 0, 0.12)' }} />
        <div className="h-2.5 w-[75%] consult-skeleton" style={{ background: 'rgba(166, 132, 0, 0.12)', animationDelay: '0.1s' }} />
      </div>
      <div className="mt-4 flex gap-2">
        <div className="h-9 flex-1 consult-skeleton rounded-lg" />
        <div className="h-9 flex-1 consult-skeleton rounded-lg" style={{ animationDelay: '0.15s' }} />
      </div>
      <div className="mt-2 text-[11px]" style={{ color: '#A68400' }}>{HINT_FOR_KIND.ctaWechat}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 3. 后端能力块执行中：rotating hint（让长等待有故事感）
// ─────────────────────────────────────────────────────

const HINTS_WEBSEARCH = [
  '正在联系搜索引擎',
  '分析相关来源',
  '排除低相关结果',
  '整理引用清单',
];
const HINTS_PROGRAM = [
  '打开项目官网',
  '核对申请要求',
  '查找截止日期',
  '整理官方来源',
];

const HINTS_READ = ['读你的画像中', '核对字段白名单'];
const HINTS_WRITE = ['合并到你的画像', '写入数据库'];
const HINTS_USESKILL = ['调取对应的剧本', '准备按剧本推进'];

/** 根据当前工具返回一组 hint 轮转 */
export function RotatingHint({ tool }: { tool: string }) {
  const hints =
    tool === 'webSearch' ? HINTS_WEBSEARCH
    : tool === 'searchProgramRequirements' ? HINTS_PROGRAM
    : tool === 'readProfile' ? HINTS_READ
    : tool === 'writeProfile' ? HINTS_WRITE
    : tool === 'useSkill' ? HINTS_USESKILL
    : ['处理中'];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % hints.length), 2400);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);
  return (
    <span key={hints[idx]} className="consult-hint-swap text-ink-muted">
      {hints[idx]}…
    </span>
  );
}

// ─────────────────────────────────────────────────────
// 4. 流式文本尾部光标（闪烁 ▍）
// ─────────────────────────────────────────────────────

export function StreamingCaret() {
  return <span className="consult-caret" aria-hidden="true" />;
}
