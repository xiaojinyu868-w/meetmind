'use client';

import { useMemo, useState } from 'react';
import { Card, Tag } from '@/components/academic/primitives';

type AtomType = 'perception' | 'judgment' | 'interaction' | 'action' | 'evaluation';
type AtomStatus = 'live' | 'internal' | 'planned';
type CapabilityType = 'agent-tool' | 'ui-tool' | 'platform-service' | 'skill-pattern';

export interface ServiceActionAtomRegistryItem {
  id: string;
  name: string;
  toolName?: string;
  atomType: AtomType;
  status: AtomStatus;
  capabilityType: CapabilityType;
  serviceAction: string;
  description: string;
  owner: string;
  inputState: string;
  outputArtifact: string;
  userVisibleResult: string;
  evalCriteria: string[];
}

const TYPE_META: Record<AtomType, { label: string; loop: string; principle: string }> = {
  perception: {
    label: '感知',
    loop: '看见发生了什么',
    principle: '把外部信息变成 agent 可理解的上下文。',
  },
  judgment: {
    label: '判断',
    loop: '理解现在该做什么',
    principle: '形成意图、阶段、风险和下一步判断。',
  },
  interaction: {
    label: '交互',
    loop: '让用户参与决策',
    principle: '让用户确认、选择、上传、授权或接入语音。',
  },
  action: {
    label: '行动',
    loop: '改变状态或产生交付',
    principle: '生成 artifact、写状态、创建 lead 或推进服务。',
  },
  evaluation: {
    label: '评测',
    loop: '判断系统有没有做好',
    principle: '检查事实、体验、转化时机和 tool 组合质量。',
  },
};

const TYPE_ORDER: AtomType[] = ['perception', 'judgment', 'interaction', 'action', 'evaluation'];

const STATUS_LABEL: Record<AtomStatus, string> = {
  live: 'live',
  internal: 'internal',
  planned: 'planned',
};

const CAPABILITY_LABEL: Record<CapabilityType, string> = {
  'agent-tool': 'Agent tool',
  'ui-tool': 'Generative UI',
  'platform-service': 'Platform service',
  'skill-pattern': 'Skill pattern',
};

function toneForStatus(status: AtomStatus): 'neutral' | 'success' | 'warning' {
  if (status === 'live') return 'success';
  if (status === 'planned') return 'warning';
  return 'neutral';
}

export function ServiceActionAtomRegistry({ atoms }: { atoms: ServiceActionAtomRegistryItem[] }) {
  const [openType, setOpenType] = useState<AtomType>('judgment');
  const grouped = useMemo(() => {
    return TYPE_ORDER.reduce((acc, type) => {
      acc[type] = atoms.filter((atom) => atom.atomType === type);
      return acc;
    }, {} as Record<AtomType, ServiceActionAtomRegistryItem[]>);
  }, [atoms]);
  const visibleAtoms = grouped[openType] ?? [];

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-divider bg-card p-3">
        <div className="grid gap-2 md:grid-cols-5">
          {TYPE_ORDER.map((type) => {
            const meta = TYPE_META[type];
            const active = openType === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => setOpenType(type)}
                className={
                  'rounded-lg border px-3 py-2 text-left transition ' +
                  (active ? 'border-ink bg-hover' : 'border-divider bg-card hover:border-ink/40 hover:bg-hover')
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12px] font-medium text-ink">{meta.label}</div>
                  <div className="text-[10px] text-ink-muted">{grouped[type]?.length ?? 0}</div>
                </div>
                <div className="mt-1 text-[10.5px] leading-relaxed text-ink-muted">{meta.loop}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-divider bg-canvas px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-ink-muted">Service Action Atom Model</div>
        <div className="mt-1 text-[12.5px] leading-relaxed text-ink">
          {TYPE_META[openType].label} · {TYPE_META[openType].principle}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {visibleAtoms.map((atom) => (
          <Card key={atom.id} className="p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="font-mono text-[12px] font-medium text-ink">{atom.toolName ?? atom.name}</div>
                  <Tag tone={toneForStatus(atom.status)}>{STATUS_LABEL[atom.status]}</Tag>
                </div>
                <div className="mt-1 text-[12px] font-medium leading-relaxed text-ink">{atom.serviceAction}</div>
              </div>
              <Tag tone={atom.capabilityType === 'ui-tool' ? 'info' : 'neutral'}>
                {CAPABILITY_LABEL[atom.capabilityType]}
              </Tag>
            </div>

            <div className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary">{atom.description}</div>

            <div className="mt-3 grid gap-2">
              <AtomFact label="输入状态" value={atom.inputState} />
              <AtomFact label="输出资产" value={atom.outputArtifact} />
              <AtomFact label="用户感知" value={atom.userVisibleResult} />
            </div>

            <div className="mt-3 border-t border-divider pt-2">
              <div className="text-[10px] uppercase tracking-wider text-ink-muted">评测标准</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {atom.evalCriteria.slice(0, 3).map((criterion) => (
                  <span key={criterion} className="rounded border border-divider bg-canvas px-2 py-1 text-[10.5px] leading-relaxed text-ink-secondary">
                    {criterion}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-2 text-[10px] uppercase tracking-wider text-ink-muted">{atom.owner}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AtomFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-divider bg-card px-2 py-1.5">
      <div className="text-[10px] text-ink-muted">{label}</div>
      <div className="mt-0.5 text-[11.5px] leading-relaxed text-ink-secondary">{value}</div>
    </div>
  );
}
