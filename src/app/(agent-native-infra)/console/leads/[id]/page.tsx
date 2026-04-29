'use client';

/**
 * /console/leads/[id] —— 机构线索详情 + 对话回放
 *
 * 左右两栏（>lg 时），移动端堆叠：
 *   - 左：线索元信息（头衔 / 联系方式 / 状态 / 画像快照 / 备注）
 *   - 右：对话回放（ReplayThread），沉浸式阅读
 *
 * 未来 M.7.3 的"一键 AI 破冰话术"卡会接在左栏顶部。
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { UIMessage } from 'ai';
import { useAuth } from '@/lib/hooks/useAuth';
import { academicFetch } from '@/components/academic/academic-client';
import { Button, Card, PageHeader, Section } from '@/components/academic/primitives';
import { ReplayThread } from '@/components/console/replay-thread';

type Status = 'new' | 'contacted' | 'converted' | 'dropped';

interface LeadDetail {
  id: string;
  scenarioName: string;
  reason: string;
  headline?: string | null;
  consultantHint?: string | null;
  wechat?: string | null;
  phone?: string | null;
  status: Status;
  notes?: string | null;
  profileSnapshot: Record<string, unknown>;
  studentKey: string;
  sessionId?: string | null;
  createdAt: string;
}

interface SessionBundle {
  activeScenarioName: string | null;
  visitedScenarios: string[];
  runtime: string;
  messageCount: number;
  messages: UIMessage[];
  startedAt: string;
  updatedAt: string;
}

interface IcebreakerDraft {
  strategy: string;
  text: string;
  rationale?: string;
}

const STATUS_LABEL: Record<Status, string> = {
  new: '新',
  contacted: '已联系',
  converted: '已转化',
  dropped: '已放弃',
};

const STATUS_COLOR: Record<Status, string> = {
  new: 'bg-mint text-ink',
  contacted: 'bg-sand text-ink',
  converted: 'bg-dustyblue text-ink',
  dropped: 'bg-divider text-ink-muted',
};

function formatAbs(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

const SCENARIO_LABEL: Record<string, string> = {
  'cold-email-draft': '套磁起草',
  'cv-diagnose': 'CV 诊断',
};

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const leadId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const router = useRouter();
  const { accessToken } = useAuth();

  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [session, setSession] = useState<SessionBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [icebreakers, setIcebreakers] = useState<IcebreakerDraft[] | null>(null);
  const [icebreakerBusy, setIcebreakerBusy] = useState(false);
  const [icebreakerErr, setIcebreakerErr] = useState<string | null>(null);

  async function load() {
    if (!accessToken || !leadId) return;
    setLoading(true); setErr(null);
    try {
      const res = await academicFetch<{ lead: LeadDetail; session: SessionBundle | null }>(
        `/api/console/leads/${leadId}`,
        { accessToken },
      );
      setLead(res.lead);
      setSession(res.session);
      setNotes(res.lead.notes ?? '');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, leadId]);

  async function updateStatus(s: Status) {
    if (!lead || saving) return;
    setSaving(true);
    try {
      await academicFetch(`/api/console/leads/${lead.id}`, {
        accessToken,
        method: 'PATCH',
        body: { status: s, notes },
      });
      setLead({ ...lead, status: s, notes });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveNotes() {
    if (!lead || saving) return;
    setSaving(true);
    try {
      await academicFetch(`/api/console/leads/${lead.id}`, {
        accessToken,
        method: 'PATCH',
        body: { status: lead.status, notes },
      });
      setLead({ ...lead, notes });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function generateIcebreakers() {
    if (!lead || icebreakerBusy) return;
    setIcebreakerBusy(true);
    setIcebreakerErr(null);
    try {
      const res = await academicFetch<{ drafts: IcebreakerDraft[]; costMs: number }>(
        `/api/console/leads/${lead.id}/icebreaker`,
        { accessToken, method: 'POST', body: {} },
      );
      setIcebreakers(res.drafts);
    } catch (e) {
      setIcebreakerErr(e instanceof Error ? e.message : String(e));
    } finally {
      setIcebreakerBusy(false);
    }
  }

  const target = lead?.profileSnapshot.target_schools as string[] | undefined;
  const field = lead?.profileSnapshot.target_field as string | undefined;
  const degree = lead?.profileSnapshot.target_degree as string | undefined;

  const profileList = useMemo(() => {
    if (!lead) return [];
    const ps = lead.profileSnapshot ?? {};
    const pairs: { k: string; v: string }[] = [];
    for (const [k, v] of Object.entries(ps)) {
      if (v == null) continue;
      if (typeof v === 'string') pairs.push({ k, v });
      else if (Array.isArray(v)) pairs.push({ k, v: v.map(String).join('、') });
      else if (typeof v === 'object') pairs.push({ k, v: JSON.stringify(v) });
      else pairs.push({ k, v: String(v) });
    }
    return pairs;
  }, [lead]);

  return (
    <div className="space-y-6 py-6">
      <PageHeader
        title={lead ? lead.headline ?? `${SCENARIO_LABEL[lead.scenarioName] ?? lead.scenarioName} 线索` : '加载中…'}
        description={lead ? `${SCENARIO_LABEL[lead.scenarioName] ?? lead.scenarioName} · 产生于 ${formatAbs(lead.createdAt)}` : ''}
        actions={
          <Button onClick={() => router.push('/console/leads')} variant="secondary">
            ← 返回线索库
          </Button>
        }
      />

      {err && <Card className="border-rose/40 bg-rose/5 p-3 text-xs text-ink">{err}</Card>}
      {loading && <Card className="p-6 text-center text-sm text-ink-muted">读取线索…</Card>}

      {lead && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          {/* ═════ 左栏：线索元信息 ═════ */}
          <div className="space-y-4">
            {/* 一键开场白 —— 最优先曝光 */}
            <IcebreakerCard
              drafts={icebreakers}
              busy={icebreakerBusy}
              err={icebreakerErr}
              onGenerate={generateIcebreakers}
            />

            {/* 身份卡 */}
            <Card className="p-4">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_COLOR[lead.status]}`}>
                  {STATUS_LABEL[lead.status]}
                </span>
                <span className="text-[11px] text-ink-muted">{lead.scenarioName}</span>
              </div>
              {lead.consultantHint && (
                <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-hover px-2.5 py-1 text-[11px] text-ink">
                  <span className="h-1.5 w-1.5 rounded-full bg-ink/60" />
                  建议顾问：{lead.consultantHint}
                </div>
              )}

              <div className="mt-3 space-y-1.5 text-[12.5px]">
                {lead.wechat && (
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-canvas px-3 py-2">
                    <span className="text-ink-muted">微信</span>
                    <span className="font-medium tracking-wide text-ink">{lead.wechat}</span>
                    <CopyChip text={lead.wechat} />
                  </div>
                )}
                {lead.phone && (
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-canvas px-3 py-2">
                    <span className="text-ink-muted">手机</span>
                    <span className="font-medium tracking-wide text-ink">{lead.phone}</span>
                    <CopyChip text={lead.phone} />
                  </div>
                )}
              </div>

              <div className="mt-3 text-[12px] leading-relaxed text-ink-secondary">
                <span className="text-ink-muted">为什么值得聊：</span>
                {lead.reason}
              </div>
            </Card>

            {/* 学生画像摘要 */}
            <Card className="p-4">
              <Section title="学生画像（触发 CTA 时）">
                <div className="space-y-1.5 text-[12px]">
                  {field && <KV k="目标方向" v={field} />}
                  {degree && <KV k="目标学位" v={degree} />}
                  {target && target.length > 0 && <KV k="目标学校" v={target.join('、')} />}
                  {profileList.length === 0 && (
                    <div className="text-[11px] text-ink-muted">（画像为空）</div>
                  )}
                </div>
                <details className="mt-3 text-[11px]">
                  <summary className="cursor-pointer text-ink-muted hover:text-ink">
                    展开完整画像（{profileList.length} 项）
                  </summary>
                  <pre className="mt-2 max-h-80 overflow-auto rounded border border-divider bg-canvas p-3 text-[11px] text-ink-secondary">
                    {JSON.stringify(lead.profileSnapshot, null, 2)}
                  </pre>
                </details>
              </Section>
            </Card>

            {/* 状态 + 备注操作 */}
            <Card className="p-4">
              <Section title="顾问动作">
                <div className="flex flex-wrap gap-2">
                  {(['new', 'contacted', 'converted', 'dropped'] as Status[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => updateStatus(s)}
                      disabled={lead.status === s || saving}
                      className={
                        'rounded border px-3 py-1.5 text-xs transition ' +
                        (lead.status === s
                          ? 'border-ink bg-ink text-canvas'
                          : 'border-divider bg-card text-ink hover:border-ink/40 disabled:opacity-50')
                      }
                    >
                      标为 {STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              </Section>
              <Section title="备注">
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="加一条备注，比如通话时间、下一步动作…"
                  className="w-full rounded border border-divider bg-canvas px-3 py-2 text-xs focus:border-ink focus:outline-none"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-ink-muted">
                    Lead ID · {lead.id.slice(-8)} · Student · {lead.studentKey.slice(-8)}
                  </span>
                  <Button size="sm" onClick={saveNotes} disabled={saving || notes === (lead.notes ?? '')}>
                    保存备注
                  </Button>
                </div>
              </Section>
            </Card>
          </div>

          {/* ═════ 右栏：对话回放 ═════ */}
          <div>
            <Card className="p-5">
              <div className="mb-4 flex items-baseline justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-muted">完整对话回放</div>
                  <div className="mt-0.5 text-[14px] font-medium text-ink">
                    学生跟 AI 聊了什么
                  </div>
                </div>
                {session && (
                  <div className="text-[11px] text-ink-muted">
                    {session.messageCount} 条 · {session.runtime} · 最后 {formatAbs(session.updatedAt)}
                  </div>
                )}
              </div>
              <ReplayThread messages={session?.messages ?? []} />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0 text-ink-muted">{k}</span>
      <span className="text-ink">{v}</span>
    </div>
  );
}

function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
      className="shrink-0 rounded border border-divider px-2 py-0.5 text-[10px] text-ink-muted hover:border-ink/40 hover:text-ink"
    >
      {copied ? '已复制' : '复制'}
    </button>
  );
}

// ═════════════════════════════════════════════════════════════
// IcebreakerCard —— 基于对话 + 画像，给顾问出 2-3 条候选开场白
// 第一次点击 → loading → 出 drafts 卡列表（带"复制"）。
// ═════════════════════════════════════════════════════════════

function IcebreakerCard({
  drafts,
  busy,
  err,
  onGenerate,
}: {
  drafts: IcebreakerDraft[] | null;
  busy: boolean;
  err: string | null;
  onGenerate: () => void;
}) {
  const empty = drafts === null;
  return (
    <div
      className="overflow-hidden rounded-xl border p-4"
      style={{ borderColor: '#CDE3D8', background: 'linear-gradient(180deg, #F4FBF7 0%, #E8F4EC 100%)' }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: '#2D7559' }}>
            AI 破冰
          </div>
          <div className="mt-0.5 text-[13.5px] font-medium text-ink">
            用对话上下文生成开场白
          </div>
        </div>
        <Button size="sm" onClick={onGenerate} disabled={busy}>
          {busy ? '生成中…' : empty ? '生成' : '换一批'}
        </Button>
      </div>
      {empty && !busy && (
        <div className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary">
          基于学生跟 AI 的对话 + 画像，给你 3 条差异化候选开场白。
          <br />
          <span className="text-ink-muted">每条 30-60 字，价值先发，不要套话。</span>
        </div>
      )}
      {err && <div className="mt-2 text-[11px] text-rose-dark">{err}</div>}
      {busy && (
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg bg-card/70 p-3">
              <div className="h-2.5 w-16 consult-skeleton" style={{ animationDelay: `${i * 0.1}s` }} />
              <div className="mt-2 space-y-1.5">
                <div className="h-3 w-full consult-skeleton" style={{ animationDelay: `${0.1 + i * 0.1}s` }} />
                <div className="h-3 w-4/5 consult-skeleton" style={{ animationDelay: `${0.2 + i * 0.1}s` }} />
              </div>
            </div>
          ))}
        </div>
      )}
      {!busy && drafts && drafts.length > 0 && (
        <div className="mt-3 space-y-2">
          {drafts.map((d, i) => (
            <IcebreakerDraftCard key={i} draft={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function IcebreakerDraftCard({ draft }: { draft: IcebreakerDraft }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(draft.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }
  return (
    <div className="rounded-lg border border-divider bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-hover px-2 py-0.5 text-[10px] text-ink-secondary">
          {draft.strategy}
        </span>
        <button
          type="button"
          onClick={copy}
          className="rounded border border-divider px-2 py-0.5 text-[10px] text-ink-muted transition hover:border-ink/40 hover:text-ink"
        >
          {copied ? '已复制 ✓' : '复制'}
        </button>
      </div>
      <div className="mt-2 whitespace-pre-wrap text-[12.5px] leading-[1.65] text-ink">
        {draft.text}
      </div>
      {draft.rationale && (
        <div className="mt-2 text-[10.5px] leading-relaxed text-ink-muted">
          策略说明：{draft.rationale}
        </div>
      )}
    </div>
  );
}
