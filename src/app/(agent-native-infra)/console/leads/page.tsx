'use client';

/**
 * /console/leads — 机构线索列表
 *
 * 学生点完 consult CTA "留微信" 之后，线索就在这里。
 * 机构顾问可以：看 reason / headline / 画像快照 → 更新状态（new → contacted → converted / dropped）→ 加备注。
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';
import { academicFetch } from '@/components/academic/academic-client';
import { Button, Card, PageHeader, Section } from '@/components/academic/primitives';

interface Lead {
  id: string;
  scenarioName: string;
  reason: string;
  headline?: string | null;
  consultantHint?: string | null;
  wechat?: string | null;
  phone?: string | null;
  status: 'new' | 'contacted' | 'converted' | 'dropped';
  notes?: string | null;
  profileSnapshot: Record<string, unknown>;
  studentKey: string;
  sessionId?: string | null;
  messageCount?: number;
  createdAt: string;
}

const STATUS_COLOR: Record<Lead['status'], string> = {
  new: 'bg-mint text-ink',
  contacted: 'bg-sand text-ink',
  converted: 'bg-dustyblue text-ink',
  dropped: 'bg-divider text-ink-muted',
};

const STATUS_LABEL: Record<Lead['status'], string> = {
  new: '新',
  contacted: '已联系',
  converted: '已转化',
  dropped: '已放弃',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const mins = Math.floor((now - d.getTime()) / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)} 小时前`;
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function LeadsPage() {
  const { accessToken } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | Lead['status']>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load() {
    if (!accessToken) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await academicFetch<{ leads: Lead[] }>('/api/console/leads', { accessToken });
      setLeads(res.leads);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function updateStatus(id: string, status: Lead['status'], notes?: string) {
    try {
      await academicFetch(`/api/console/leads/${id}`, {
        accessToken,
        method: 'PATCH',
        body: { status, notes },
      });
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status, notes: notes ?? l.notes } : l)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const visible = filter === 'all' ? leads : leads.filter((l) => l.status === filter);

  return (
    <div className="space-y-6 py-6">
      <PageHeader
        title="线索库"
        description='学生用 AI 顾问走完场景、点了"留微信"，就会出现在这里。'
        actions={
          <Button onClick={load} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        {(['all', 'new', 'contacted', 'converted', 'dropped'] as const).map((f) => {
          const count = f === 'all' ? leads.length : leads.filter((l) => l.status === f).length;
          const active = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={
                'rounded border px-3 py-1.5 text-xs ' +
                (active ? 'border-ink bg-ink text-canvas' : 'border-divider bg-card text-ink hover:border-ink/40')
              }
            >
              {f === 'all' ? '全部' : STATUS_LABEL[f]} · {count}
            </button>
          );
        })}
      </div>

      {err && (
        <Card className="border-rose/40 bg-rose/5 p-3 text-xs text-ink">{err}</Card>
      )}

      {!loading && visible.length === 0 && (
        <Card className="p-6 text-center text-sm text-ink-muted">
          {filter === 'all' ? '还没有线索。' : `没有${STATUS_LABEL[filter as Lead['status']]}线索。`}
        </Card>
      )}

      <div className="space-y-3">
        {visible.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            expanded={expandedId === lead.id}
            onToggle={() => setExpandedId((x) => (x === lead.id ? null : lead.id))}
            onStatus={(s, notes) => updateStatus(lead.id, s, notes)}
          />
        ))}
      </div>
    </div>
  );
}

function LeadCard({
  lead,
  expanded,
  onToggle,
  onStatus,
}: {
  lead: Lead;
  expanded: boolean;
  onToggle: () => void;
  onStatus: (s: Lead['status'], notes?: string) => void;
}) {
  const [notes, setNotes] = useState(lead.notes ?? '');
  const target = (lead.profileSnapshot.target_schools as string[] | undefined)?.join('、');
  const field = lead.profileSnapshot.target_field as string | undefined;
  const advisors = lead.profileSnapshot.advisor_candidates as Array<{ name?: string; school?: string }> | undefined;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_COLOR[lead.status]}`}>
              {STATUS_LABEL[lead.status]}
            </span>
            <span className="text-[11px] text-ink-muted">{lead.scenarioName}</span>
            <span className="text-[11px] text-ink-muted">· {formatTime(lead.createdAt)}</span>
            {lead.messageCount !== undefined && lead.messageCount > 0 && (
              <span className="text-[11px] text-ink-muted">· 对话 {lead.messageCount} 条</span>
            )}
          </div>
          {lead.headline && (
            <Link
              href={`/console/leads/${lead.id}`}
              className="block text-sm font-medium text-ink hover:underline underline-offset-2"
            >
              {lead.headline}
            </Link>
          )}
          <div className="text-xs leading-relaxed text-ink-secondary">{lead.reason}</div>
          <div className="flex flex-wrap gap-3 pt-1 text-[11px] text-ink">
            {lead.wechat && <span>微信：<span className="font-medium">{lead.wechat}</span></span>}
            {lead.phone && <span>手机：<span className="font-medium">{lead.phone}</span></span>}
            {target && <span className="text-ink-muted">目标：{target}</span>}
            {field && <span className="text-ink-muted">方向：{field}</span>}
            {advisors && advisors.length > 0 && (
              <span className="text-ink-muted">导师：{advisors.map((a) => a.name).filter(Boolean).join('、')}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Link
            href={`/console/leads/${lead.id}`}
            className="rounded-lg border border-divider bg-card px-3 py-1.5 text-[11px] text-ink hover:border-ink/40 hover:bg-hover"
          >
            查看对话 →
          </Link>
          <button type="button" onClick={onToggle} className="text-[11px] text-ink-secondary underline underline-offset-2">
            {expanded ? '收起' : '快速操作'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-divider pt-3">
          <Section title="操作">
            <div className="flex flex-wrap gap-2">
              {(['new', 'contacted', 'converted', 'dropped'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onStatus(s, notes)}
                  disabled={lead.status === s}
                  className={
                    'rounded border px-3 py-1.5 text-xs ' +
                    (lead.status === s
                      ? 'border-ink bg-ink text-canvas'
                      : 'border-divider bg-card text-ink hover:border-ink/40')
                  }
                >
                  标记为 {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </Section>

          <Section title="顾问备注">
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="添加备注（保存时与状态一起提交）"
              className="w-full rounded border border-divider bg-canvas px-3 py-2 text-xs focus:border-ink focus:outline-none"
            />
          </Section>

          <Section title="画像快照（CTA 触发时）">
            <pre className="max-h-64 overflow-auto rounded border border-divider bg-canvas p-3 text-[11px] text-ink-secondary">
              {JSON.stringify(lead.profileSnapshot, null, 2)}
            </pre>
          </Section>

          <div className="text-[10px] text-ink-muted">Lead ID：{lead.id} · StudentKey：{lead.studentKey}</div>
        </div>
      )}
    </Card>
  );
}
