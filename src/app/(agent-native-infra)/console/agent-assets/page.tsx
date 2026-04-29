'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { academicFetch } from '@/components/academic/academic-client';
import { Button, Card, InlineAlert, PageHeader, Tag } from '@/components/academic/primitives';
import { ServiceActionAtomRegistry } from '@/components/console/service-action-atom-registry';
import { SERVICE_ACTION_ATOMS, getServiceActionAtomSummary } from '@/lib/consult/service-action-atoms';

type SkillStatus = 'pending' | 'approved' | 'rejected';
type LeadStatus = 'new' | 'contacted' | 'converted' | 'dropped';

interface OrgSkill {
  id: string;
  name: string;
  description: string;
  status: SkillStatus;
  rejectReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

interface OrgAsset {
  id: string;
  kind: string;
  title: string;
  status?: string;
  createdAt?: string;
}

interface Scenario {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'published' | 'archived';
  productKind?: string;
  updatedAt: string;
}

interface Lead {
  id: string;
  scenarioName: string;
  headline?: string | null;
  reason: string;
  status: LeadStatus;
  messageCount?: number;
  sessionId?: string | null;
  createdAt: string;
}

type ArenaStatus = 'passed' | 'failed' | 'needs-run';

interface ArenaCriterion {
  id: string;
  label: string;
  severity: 'critical' | 'major' | 'minor';
  passed: boolean;
  evidence: string;
}

interface ArenaCase {
  caseId: string;
  title: string;
  prompt: string;
  status: ArenaStatus;
  score: number;
  maxScore: number;
  criteria: ArenaCriterion[];
  lastRunAt?: string;
  sessionId?: string;
}

interface ArenaOverview {
  summary: {
    total: number;
    passed: number;
    failed: number;
    needsRun: number;
  };
  cases: ArenaCase[];
}

const STATUS_LABEL: Record<SkillStatus, string> = {
  pending: '待审核',
  approved: '已上线',
  rejected: '已驳回',
};

const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: '新线索',
  contacted: '已联系',
  converted: '已转化',
  dropped: '已放弃',
};

const ARENA_STATUS_LABEL: Record<ArenaStatus, string> = {
  passed: '通过',
  failed: '失败',
  'needs-run': '待运行',
};

function toneForSkill(status: SkillStatus): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'approved') return 'success';
  if (status === 'pending') return 'warning';
  return 'danger';
}

function toneForScenario(status: Scenario['status']): 'neutral' | 'success' | 'warning' {
  if (status === 'published') return 'success';
  if (status === 'draft') return 'warning';
  return 'neutral';
}

function toneForArena(status: ArenaStatus): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'passed') return 'success';
  if (status === 'failed') return 'danger';
  return 'warning';
}

function formatTime(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function countBy<T extends string>(items: Array<{ status: T }>): Record<T, number> {
  return items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {} as Record<T, number>);
}

export default function AgentAssetsPage() {
  const { accessToken } = useAuth();
  const [skills, setSkills] = useState<OrgSkill[]>([]);
  const [assets, setAssets] = useState<OrgAsset[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [arena, setArena] = useState<ArenaOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    if (!accessToken) return;
    setLoading(true);
    setErr(null);
    try {
      const [skillRes, assetRes, scenarioRes, leadRes, arenaRes] = await Promise.all([
        academicFetch<{ skills: OrgSkill[] }>('/api/console/skills', { accessToken }),
        academicFetch<{ assets: OrgAsset[] }>('/api/console/assets', { accessToken }),
        academicFetch<{ scenarios: Scenario[] }>('/api/console/scenarios', { accessToken }),
        academicFetch<{ leads: Lead[] }>('/api/console/leads?limit=8', { accessToken }),
        academicFetch<{ arena: ArenaOverview }>('/api/console/arena', { accessToken }),
      ]);
      setSkills(skillRes.skills);
      setAssets(assetRes.assets);
      setScenarios(scenarioRes.scenarios);
      setLeads(leadRes.leads);
      setArena(arenaRes.arena);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const skillCounts = useMemo(() => countBy(skills), [skills]);
  const assetKindCount = useMemo(() => {
    return assets.reduce((acc, asset) => {
      acc[asset.kind] = (acc[asset.kind] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [assets]);
  const publishedScenarios = scenarios.filter((s) => s.status === 'published').length;
  const openLeads = leads.filter((lead) => lead.status === 'new').length;
  const atomSummary = useMemo(() => getServiceActionAtomSummary(SERVICE_ACTION_ATOMS), []);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agent OS Control Plane"
        title="Agent 资产"
        description="把机构服务方法论、平台工具、评测状态和真实运行证据放在同一个控制台里。"
        actions={
          <Button onClick={() => void load()} disabled={loading} variant="ghost" size="sm">
            <RefreshCw size={13} strokeWidth={1.8} />
            {loading ? '刷新中' : '刷新'}
          </Button>
        }
      />

      {err && <InlineAlert>{err}</InlineAlert>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Metric label="Service atoms" value={atomSummary.total} hint={`${atomSummary.byStatus.live ?? 0} 个 live 原子`} />
        <Metric label="Org skills" value={skills.length} hint={`${skillCounts.approved ?? 0} 个已上线`} />
        <Metric label="Scenarios" value={scenarios.length} hint={`${publishedScenarios} 个学生端可见`} />
        <Metric label="Evidence" value={leads.length} hint={`${openLeads} 个新线索 / replay 入口`} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <AssetSection
            title="Service Action Atom Registry"
            description="媒介是表层，动作是原子。平台按感知、判断、交互、行动、评测组织 agent 原生能力。"
            action={<Tag tone="info">Action-native</Tag>}
          >
            <ServiceActionAtomRegistry atoms={SERVICE_ACTION_ATOMS} />
          </AssetSection>

          <AssetSection
            title="Org Skill Library"
            description="机构服务 know-how 的资产化形态。下一步这些 skill 会进入 Arena 自动评测。"
            action={<Link className="text-xs text-ink-secondary underline underline-offset-2 hover:text-ink" href="/console/skills">管理 skill</Link>}
          >
            {loading ? (
              <LoadingLine />
            ) : skills.length === 0 ? (
              <EmptyLine text="还没有机构 skill。先在 /console/skills 上传第一份 .skill。" />
            ) : (
              <div className="space-y-2">
                {skills.slice(0, 6).map((skill) => (
                  <Card key={skill.id} className="p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="font-mono text-[12px] font-medium text-ink">{skill.name}</div>
                          <Tag tone={toneForSkill(skill.status)}>{STATUS_LABEL[skill.status]}</Tag>
                          <Tag tone="neutral">未评测</Tag>
                        </div>
                        <div className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-ink-secondary">
                          {skill.description}
                        </div>
                        {skill.rejectReason && (
                          <div className="mt-2 rounded border border-rose/40 bg-rose-light px-2 py-1 text-[11px] text-ink">
                            {skill.rejectReason}
                          </div>
                        )}
                      </div>
                      <div className="text-[11px] text-ink-muted">{formatTime(skill.reviewedAt ?? skill.createdAt)}</div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </AssetSection>
        </div>

        <div className="space-y-6">
          <AssetSection title="Skill Arena" description="自动评测 tool 组合质量：先从 Percy flagship case 做发布门槛。">
            {!arena ? (
              <LoadingLine />
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <MiniStat label="通过" value={arena.summary.passed} />
                  <MiniStat label="失败" value={arena.summary.failed} />
                  <MiniStat label="待跑" value={arena.summary.needsRun} />
                </div>
                {arena.cases.map((item) => (
                  <Card key={item.caseId} className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-[12px] font-medium text-ink">{item.title}</div>
                          <Tag tone={toneForArena(item.status)}>{ARENA_STATUS_LABEL[item.status]}</Tag>
                          <Tag tone="neutral">{item.score}/{item.maxScore}</Tag>
                        </div>
                        <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-muted">
                          “{item.prompt}”
                        </div>
                      </div>
                      {item.lastRunAt && <div className="shrink-0 text-[10px] text-ink-muted">{formatTime(item.lastRunAt)}</div>}
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {item.criteria.map((criterion) => (
                        <div key={criterion.id} className="rounded border border-divider bg-canvas px-2 py-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[11px] font-medium text-ink">{criterion.label}</div>
                            <Tag tone={criterion.passed ? 'success' : criterion.severity === 'minor' ? 'warning' : 'danger'}>
                              {criterion.passed ? 'pass' : criterion.severity}
                            </Tag>
                          </div>
                          <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-ink-muted">{criterion.evidence}</div>
                        </div>
                      ))}
                    </div>
                    {item.sessionId && (
                      <div className="mt-2 text-[10.5px] text-ink-muted">
                        session · {item.sessionId.slice(-8)}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </AssetSection>

          <AssetSection title="Knowledge Assets" description="机构上传的文档、音视频和案例资产。">
            {assets.length === 0 ? (
              <EmptyLine text="还没有知识资产。" />
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(assetKindCount).map(([kind, count]) => (
                    <Tag key={kind} tone="neutral">{kind} · {count}</Tag>
                  ))}
                </div>
                {assets.slice(0, 5).map((asset) => (
                  <div key={asset.id} className="rounded border border-divider bg-card px-3 py-2">
                    <div className="truncate text-[12px] font-medium text-ink">{asset.title}</div>
                    <div className="mt-0.5 text-[11px] text-ink-muted">{asset.kind} {asset.status ? `· ${asset.status}` : ''}</div>
                  </div>
                ))}
              </div>
            )}
          </AssetSection>

          <AssetSection title="Runtime Evidence" description="真实学生互动留下的 lead 和 replay 证据。">
            {leads.length === 0 ? (
              <EmptyLine text="还没有真实运行证据。" />
            ) : (
              <div className="space-y-2">
                {leads.slice(0, 5).map((lead) => (
                  <Link
                    key={lead.id}
                    href={`/console/leads/${lead.id}`}
                    className="block rounded border border-divider bg-card px-3 py-2 transition-colors hover:border-ink"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-[12px] font-medium text-ink">
                        {lead.headline || lead.scenarioName}
                      </div>
                      <Tag tone={lead.status === 'new' ? 'success' : 'neutral'}>{LEAD_STATUS_LABEL[lead.status]}</Tag>
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-secondary">
                      {lead.reason}
                    </div>
                    <div className="mt-1 text-[10px] text-ink-muted">
                      对话 {lead.messageCount ?? 0} 条 · {formatTime(lead.createdAt)}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </AssetSection>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-wider text-ink-muted">{label}</div>
      <div className="mt-2 text-2xl font-medium leading-none text-ink">{value}</div>
      <div className="mt-2 text-xs text-ink-secondary">{hint}</div>
    </Card>
  );
}

function AssetSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-ink">{title}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-divider bg-card px-2 py-2">
      <div className="text-lg font-medium leading-none text-ink">{value}</div>
      <div className="mt-1 text-[10px] text-ink-muted">{label}</div>
    </div>
  );
}

function LoadingLine() {
  return <Card className="p-4 text-sm text-ink-muted">加载中…</Card>;
}

function EmptyLine({ text }: { text: string }) {
  return <Card className="p-4 text-sm text-ink-muted">{text}</Card>;
}
