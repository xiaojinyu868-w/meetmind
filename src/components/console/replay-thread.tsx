'use client';

/**
 * ReplayThread —— 机构侧用的对话回放组件
 *
 * 不是学生端 MessageView 的复制，而是**只读版**：
 *   - 所有 UI 块（askOptions/showOutreachWorkspace/showDraft/ctaWechat/fileUpload）都进入"已完成"形态
 *   - 没有 addToolResult / API 调用
 *   - 保留完整视觉语言（时间线、抽屉气泡、草稿左侧 ink 边条）
 *   - 顶部加一条 turn 标签（#1 / #2 / ...）让顾问快速跳
 *
 * 为什么不复用学生端 MessageView？
 *   - 会带入 useChat 的状态副作用（setInput / streaming UI）
 *   - ctaWechat 自带 fetch 提交，会被顾问误点
 *   - 回放场景下"我们展示的是已发生的事实"，交互元素反而制造噪音
 */

import type { UIMessage } from 'ai';
import { AdvisorDiscoveryBlock, type AdvisorDiscoveryInput } from '@/components/consult/advisor-discovery';
import { ConsultantMoveBlock, type ConsultantMoveInput } from '@/components/consult/consultant-move';
import { ConsultMarkdown } from '@/components/consult/consult-markdown';
import { OutreachWorkspaceBlock, type OutreachWorkspaceInput } from '@/components/consult/outreach-workspace';
import { ServicePlanBlock, type ServicePlanInput } from '@/components/consult/service-plan';

const CAPABILITY_TOOLS = new Set(['webSearch', 'searchProgramRequirements', 'readProfile', 'writeProfile']);

interface ToolPart {
  toolCallId: string;
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

export function ReplayThread({ messages }: { messages: UIMessage[] }) {
  if (!messages || messages.length === 0) {
    return (
      <div className="rounded-xl border border-divider bg-card px-4 py-6 text-center text-[12px] text-ink-muted">
        这条线索还没有归档对话。可能是在对话归档上线之前留的资。
      </div>
    );
  }

  let turnCount = 0;
  return (
    <div className="space-y-5">
      {messages.map((m) => {
        if (m.role === 'user') turnCount += 1;
        const turn = m.role === 'user' ? turnCount : null;
        return <ReplayMessage key={m.id} message={m} turn={turn} />;
      })}
    </div>
  );
}

function ReplayMessage({ message, turn }: { message: UIMessage; turn: number | null }) {
  if (message.role === 'user') {
    const text = (message.parts ?? [])
      .map((p) => (p.type === 'text' ? (p as { text?: string }).text ?? '' : ''))
      .join('')
      .trim();
    if (!text) return null;
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%]">
          {turn !== null && (
            <div className="mb-1 text-right text-[10px] text-ink-muted">学生 · #{turn}</div>
          )}
          <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[13px] leading-[1.6] text-canvas">
            {text}
          </div>
        </div>
      </div>
    );
  }

  // assistant
  const parts = message.parts ?? [];
  const timelineItems: Array<{ toolCallId: string; toolName: string; part: ToolPart }> = [];
  const sequential: Array<
    | { kind: 'text'; key: string; text: string }
    | { kind: 'tool'; key: string; toolName: string; part: ToolPart }
  > = [];

  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i];
    if (p.type === 'text') {
      const t = ((p as { text?: string }).text ?? '').trim();
      if (t) sequential.push({ kind: 'text', key: `t-${i}`, text: t });
      continue;
    }
    if (typeof p.type === 'string' && p.type.startsWith('tool-')) {
      const toolName = p.type.slice('tool-'.length);
      const tp = p as ToolPart;
      if (CAPABILITY_TOOLS.has(toolName)) {
        timelineItems.push({ toolCallId: tp.toolCallId, toolName, part: tp });
      } else {
        sequential.push({ kind: 'tool', key: `tool-${i}`, toolName, part: tp });
      }
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-[10px] text-ink-muted">AI 顾问</div>
      {timelineItems.length > 0 && <ReplayTimeline items={timelineItems} />}
      {sequential.map((item) => {
        if (item.kind === 'text') {
          return (
            <div key={item.key}>
              <ConsultMarkdown content={item.text} density="chat" />
            </div>
          );
        }
        return <ReplayToolBlock key={item.key} toolName={item.toolName} part={item.part} />;
      })}
    </div>
  );
}

// ───────────────── Timeline (read-only) ─────────────────

function ReplayTimeline({
  items,
}: {
  items: Array<{ toolCallId: string; toolName: string; part: ToolPart }>;
}) {
  return (
    <div className="rounded-xl border border-divider bg-card/60 px-4 py-3">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-ink-muted">Agent 动作（已完成）</div>
      <ol className="relative space-y-1.5">
        <span className="absolute left-[3px] top-2 bottom-2 w-px bg-divider" aria-hidden="true" />
        {items.map((it) => (
          <ReplayTimelineRow key={it.toolCallId} toolName={it.toolName} part={it.part} />
        ))}
      </ol>
    </div>
  );
}

function ReplayTimelineRow({ toolName, part }: { toolName: string; part: ToolPart }) {
  const input = (part.input ?? {}) as Record<string, unknown>;
  const { title, subtitle } = describeCapability(toolName, input);
  const stateDot =
    part.state === 'output-error'
      ? 'bg-rose-dark'
      : part.state === 'output-available'
      ? 'bg-mint-400'
      : 'bg-ink/40';
  return (
    <li className="group relative pl-5">
      <span className={`absolute left-0 top-1.5 h-2 w-2 rounded-full ${stateDot}`} aria-hidden="true" />
      <div className="flex items-baseline justify-between gap-3 text-[12px] text-ink-secondary">
        <div className="min-w-0 flex-1">
          <span className="font-medium text-ink">{title}</span>
          {subtitle && <span className="ml-1.5 text-ink-muted">{subtitle}</span>}
        </div>
        <span className="shrink-0 text-[10px] text-ink-muted">
          {part.state === 'output-error' ? '失败' : part.state === 'output-available' ? '完成' : '未完成'}
        </span>
      </div>
      {part.state === 'output-error' && part.errorText && (
        <div className="mt-1 text-[11px] text-rose-dark">{part.errorText.slice(0, 160)}</div>
      )}
    </li>
  );
}

function describeCapability(toolName: string, input: Record<string, unknown>): { title: string; subtitle?: string } {
  switch (toolName) {
    case 'webSearch':
      return { title: '联网检索', subtitle: typeof input.query === 'string' ? input.query : undefined };
    case 'searchProgramRequirements': {
      const school = typeof input.school === 'string' ? input.school : '';
      const schools = Array.isArray(input.schools) ? (input.schools as string[]) : [];
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
        subtitle: [school || schools.slice(0, 3).join('、'), field].filter(Boolean).join(' · ') || undefined,
      };
    }
    case 'readProfile': {
      const keys = Array.isArray(input.keys) ? (input.keys as string[]) : [];
      return { title: '读取画像', subtitle: keys.length > 0 ? `${keys.length} 项：${keys.slice(0, 4).join('、')}${keys.length > 4 ? '…' : ''}` : undefined };
    }
    case 'writeProfile': {
      const patch = (input.patch ?? {}) as Record<string, unknown>;
      const keys = Object.keys(patch);
      return { title: '更新画像', subtitle: keys.length > 0 ? keys.join('、') : undefined };
    }
    default:
      return { title: toolName };
  }
}

// ───────────────── Tool blocks (read-only) ─────────────────

function ReplayToolBlock({ toolName, part }: { toolName: string; part: ToolPart }) {
  if (toolName === 'showConsultantMove') return <ReplayConsultantMove part={part} />;
  if (toolName === 'showAdvisorDiscovery') return <ReplayAdvisorDiscovery part={part} />;
  if (toolName === 'showServicePlan') return <ReplayServicePlan part={part} />;
  if (toolName === 'askOptions') return <ReplayAskOptions part={part} />;
  if (toolName === 'showOutreachWorkspace') return <ReplayOutreachWorkspace part={part} />;
  if (toolName === 'showDraft') return <ReplayShowDraft part={part} />;
  if (toolName === 'ctaWechat') return <ReplayCtaWechat part={part} />;
  if (toolName === 'fileUpload') return <ReplayFileUpload part={part} />;
  if (toolName === 'startVoiceCall') return <ReplayStartVoiceCall part={part} />;
  if (toolName === 'useSkill') return <ReplayUseSkill part={part} />;
  return null;
}

function ReplayConsultantMove({ part }: { part: ToolPart }) {
  return (
    <ConsultantMoveBlock
      state={part.state}
      input={part.input as ConsultantMoveInput | undefined}
      output={part.output}
      readOnly
    />
  );
}

function ReplayAdvisorDiscovery({ part }: { part: ToolPart }) {
  return (
    <AdvisorDiscoveryBlock
      state={part.state}
      input={part.input as AdvisorDiscoveryInput | undefined}
      output={part.output}
      readOnly
    />
  );
}

function ReplayServicePlan({ part }: { part: ToolPart }) {
  return (
    <ServicePlanBlock
      state={part.state}
      input={part.input as ServicePlanInput | undefined}
      output={part.output}
      readOnly
    />
  );
}

function ReplayOutreachWorkspace({ part }: { part: ToolPart }) {
  return (
    <OutreachWorkspaceBlock
      state={part.state}
      input={part.input as OutreachWorkspaceInput | undefined}
      output={part.output}
      readOnly
    />
  );
}

function ReplayAskOptions({ part }: { part: ToolPart }) {
  const input = (part.input ?? {}) as {
    prompt?: string;
    multi?: boolean;
    choices?: { id: string; label: string; description?: string }[];
  };
  const output = part.output as { selected?: string[]; labels?: string[] } | undefined;
  const selected = output?.selected ?? [];
  if (!input.choices) return null;

  return (
    <div className="rounded-xl border border-divider bg-card p-4">
      <div className="mb-3 text-[13px] text-ink">{input.prompt}</div>
      <div className="space-y-1.5">
        {input.choices.map((c) => {
          const isSel = selected.includes(c.id);
          return (
            <div
              key={c.id}
              className={
                'rounded-lg border px-3.5 py-2.5 ' +
                (isSel ? 'border-ink bg-ink/[0.03]' : 'border-divider bg-card opacity-60')
              }
            >
              <div className="flex items-center gap-2">
                <span
                  className={
                    'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ' +
                    (isSel ? 'border-ink bg-ink' : 'border-ink/30')
                  }
                >
                  {isSel && <span className="h-1.5 w-1.5 rounded-full bg-canvas" />}
                </span>
                <span className="text-[13px] font-medium text-ink">{c.label}</span>
              </div>
              {c.description && (
                <div className="mt-0.5 pl-5 text-[11px] leading-relaxed text-ink-muted">{c.description}</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-[11px] text-ink-muted">
        {selected.length > 0
          ? `学生选了：${(output?.labels ?? selected).join('、')}`
          : part.state === 'output-available'
          ? '学生未选择'
          : '选项未回填'}
      </div>
    </div>
  );
}

function ReplayShowDraft({ part }: { part: ToolPart }) {
  const input = (part.input ?? {}) as {
    kind?: string;
    title?: string;
    body?: string;
    annotations?: { note: string; quote: string }[];
  };
  const output = part.output as { actionId?: string } | undefined;
  if (!input.body) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-divider bg-card">
      <div className="flex items-start justify-between gap-3 border-l-2 border-ink bg-hover/40 px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-ink-muted">{kindLabel(input.kind)}</div>
          <div className="mt-0.5 text-[14px] font-medium leading-snug text-ink">{input.title}</div>
        </div>
      </div>
      <div className="px-5 py-4">
        <ConsultMarkdown content={input.body} density="draft" />
      </div>
      {input.annotations && input.annotations.length > 0 && (
        <div className="border-t border-divider bg-sand/30 px-5 py-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-ink-muted">机构批注</div>
          <ul className="space-y-2">
            {input.annotations.map((a, i) => (
              <li key={i} className="text-[11.5px] leading-relaxed">
                <div className="text-ink-muted">「{a.quote}」</div>
                <div className="mt-0.5 text-ink">→ {a.note}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {output?.actionId && (
        <div className="border-t border-divider px-4 py-2 text-[11px] text-ink-muted">
          学生点击了：{output.actionId}
        </div>
      )}
    </div>
  );
}

function ReplayCtaWechat({ part }: { part: ToolPart }) {
  const input = (part.input ?? {}) as { headline?: string; reason?: string; consultantHint?: string };
  return (
    <div
      className="overflow-hidden rounded-xl border p-5"
      style={{ borderColor: '#E6D38A', background: 'linear-gradient(180deg, #FEFAEB 0%, #FDF3C0 100%)' }}
    >
      <div className="mb-1 text-[10px] uppercase tracking-wider" style={{ color: '#A68400' }}>
        顾问对接（回放）
      </div>
      <div className="text-[14px] font-medium leading-snug text-ink">{input.headline}</div>
      {input.reason && (
        <div className="mt-2 text-[12px] leading-[1.7] text-ink-secondary">{input.reason}</div>
      )}
      {input.consultantHint && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-card/80 px-2.5 py-1 text-[11px] text-ink">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#A68400' }} />
          {input.consultantHint}
        </div>
      )}
      <div className="mt-3 text-[11px]" style={{ color: '#A68400' }}>
        学生最终填写了联系方式 → 产生了本条线索
      </div>
    </div>
  );
}

function ReplayFileUpload({ part }: { part: ToolPart }) {
  const input = (part.input ?? {}) as { prompt?: string };
  const output = part.output as { fileName?: string; charCount?: number } | undefined;
  return (
    <div className="rounded-xl border border-divider bg-card p-4">
      <div className="mb-2 text-[13px] text-ink">{input.prompt}</div>
      {output?.fileName ? (
        <div className="flex items-center gap-2 rounded-lg border border-mint-400/40 bg-mint-50 px-3 py-2 text-[12px]">
          <span className="h-1.5 w-1.5 rounded-full bg-mint-400" />
          <span className="text-ink">学生已上传 {output.fileName}</span>
          {output.charCount != null && <span className="text-ink-muted">· {output.charCount} 字</span>}
        </div>
      ) : (
        <div className="text-[11px] text-ink-muted">学生未上传文件</div>
      )}
    </div>
  );
}

function ReplayStartVoiceCall({ part }: { part: ToolPart }) {
  const input = (part.input ?? {}) as { openingLine?: string; reason?: string; focus?: string[]; voice?: string };
  const output = part.output as { action?: 'accepted' | 'declined' } | undefined;
  return (
    <div
      className="overflow-hidden rounded-xl border p-4"
      style={{ borderColor: '#A8D8B9', background: 'linear-gradient(180deg, #F2FAF4 0%, #DCF2E2 100%)' }}
    >
      <div className="text-[10px] uppercase tracking-wider" style={{ color: '#2D7559' }}>
        AI 发起语音通话（回放）
      </div>
      <div className="mt-1 text-[13.5px] font-medium text-ink">「{input.openingLine}」</div>
      {input.reason && (
        <div className="mt-1 text-[12px] leading-[1.6] text-ink-secondary">{input.reason}</div>
      )}
      {input.focus && input.focus.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {input.focus.map((f) => (
            <span key={f} className="rounded-full border border-mint-400/50 bg-card/80 px-2 py-0.5 text-[11px] text-ink">{f}</span>
          ))}
        </div>
      )}
      <div className="mt-2 text-[11px]" style={{ color: '#2D7559' }}>
        {output?.action === 'accepted'
          ? '✓ 学生接听了语音'
          : output?.action === 'declined'
          ? '学生选择"稍后再说"'
          : '通话未完成'}
      </div>
    </div>
  );
}

function ReplayUseSkill({ part }: { part: ToolPart }) {
  const input = (part.input ?? {}) as { name?: string; reason?: string };
  const output = part.output as { ok?: boolean; name?: string } | undefined;
  if (!input.name) return null;
  return (
    <div className="rounded-lg border border-divider bg-card/60 px-3 py-1.5 text-[11px] text-ink-secondary">
      <span className="text-ink-muted">切换剧本 → </span>
      <span className="font-medium text-ink">{input.name}</span>
      {input.reason && <span className="ml-1.5 text-ink-muted">（{input.reason}）</span>}
      {output && output.ok === false && <span className="ml-1.5 text-rose-dark">加载失败</span>}
    </div>
  );
}

function kindLabel(kind?: string): string {
  switch (kind) {
    case 'cold-email-draft': return '套磁草稿';
    case 'cv-diagnosis': return 'CV 诊断';
    case 'program-shortlist': return '项目短名单';
    case 'advisor-card': return '导师卡片';
    case 'interview-feedback': return '面试反馈';
    case 'application-plan': return '申请计划';
    case 'statement-draft': return '文书草稿';
    case 'recommendation-plan': return '推荐信策略';
    default: return kind ?? '草稿';
  }
}
