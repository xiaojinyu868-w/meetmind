'use client';

/**
 * /console —— 机构主首页
 *
 * V0 MVP 只做一件事：上传老师视频 → 等分析完成 → 系统自动发布成学生可练的默认场景。
 *
 * 布局：
 *   ┌─ 左侧 ─────────────────────────────┬─ 右侧 ─────────────┐
 *   │                                    │                     │
 *   │  拖拽上传区（大）                   │  学生将如何看见      │
 *   │  你的老师视频列表                   │  (ScenarioPreview)  │
 *   │    - 状态 + 视频画像摘要             │                     │
 *   │                                    │                     │
 *   └────────────────────────────────────┴─────────────────────┘
 *
 * 没有 Dashboard、没有 TODO、没有 StatCard。一页解决："我上传了什么 / 学生会看到什么"。
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { academicFetch, AcademicClientError } from '@/components/academic/academic-client';
import {
  Button,
  Card,
  EmptyState,
  InlineAlert,
  Tag,
} from '@/components/academic/primitives';

interface OrgSummary {
  orgId: string;
  role: string;
  org: { id: string; name: string; status: string; onboardingStep: number };
}

interface Source {
  id: string;
  title: string;
  assetId: string | null;
  status: 'pending' | 'analyzing' | 'ready' | 'failed';
  analysisJson: string | null;
  createdAt: string;
  uploader?: { id: string; nickname: string; username: string } | null;
}

interface SourceAnalysis {
  segmentCount: number;
  teacherStyle?: { tone?: string; style?: string; voiceSummary?: string };
  questionPatterns?: string[];
  feedbackPatterns?: string[];
  signaturePhrases?: string[];
  mediaMetadata?: { durationSec: number };
}

interface Scenario {
  id: string;
  name: string;
  description: string;
  productKind: string;
  status: 'draft' | 'published' | 'archived';
  coachingSourceRefs: string[];
  updatedAt: string;
}

// Consult 线索概览（M.7.4）
interface LeadSummary {
  id: string;
  scenarioName: string;
  headline?: string | null;
  reason: string;
  wechat?: string | null;
  phone?: string | null;
  status: 'new' | 'contacted' | 'converted' | 'dropped';
  messageCount?: number;
  createdAt: string;
}

export default function ConsoleHomePage() {
  const router = useRouter();
  const { accessToken, user } = useAuth();

  const [org, setOrg] = useState<OrgSummary | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [defaultScenario, setDefaultScenario] = useState<Scenario | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [needsOrg, setNeedsOrg] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [leadsLoaded, setLeadsLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!accessToken) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function load() {
    setLoading(true);
    try {
      const orgsRes = await academicFetch<{ orgs: OrgSummary[] }>('/api/console/orgs/me', { accessToken });
      if (orgsRes.orgs.length === 0) {
        setNeedsOrg(true);
        setLoading(false);
        return;
      }
      setOrg(orgsRes.orgs[0]);

      const [srcRes, scRes, leadRes] = await Promise.all([
        academicFetch<{ sources: Source[] }>('/api/console/coaching-sources', { accessToken }),
        academicFetch<{ scenarios: Scenario[] }>('/api/console/scenarios', { accessToken }),
        academicFetch<{ leads: LeadSummary[] }>('/api/console/leads?limit=20', { accessToken })
          .catch(() => ({ leads: [] as LeadSummary[] })),
      ]);
      setSources(srcRes.sources);
      setDefaultScenario(scRes.scenarios.find((s) => s.status === 'published') || null);
      setLeads(leadRes.leads);
      setLeadsLoaded(true);
    } catch (e: unknown) {
      if (e instanceof AcademicClientError && (e.code === 'NO_ACTIVE_ORG' || e.code === 'NOT_A_MEMBER')) {
        setNeedsOrg(true);
      } else {
        setErr(e instanceof Error ? e.message : '加载失败');
      }
    } finally {
      setLoading(false);
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    if (!accessToken) return;
    const list = Array.from(files).filter((f) => f.type.startsWith('video/') || f.type.startsWith('audio/'));
    if (list.length === 0) {
      setErr('请上传视频或音频文件');
      return;
    }
    setUploading(true);
    setErr(null);
    try {
      for (const file of list) {
        // 1. 传到 asset 仓库
        const fd = new FormData();
        fd.append('file', file);
        fd.append('title', file.name);
        fd.append('kind', file.type.startsWith('audio/') ? 'audio' : 'video');
        const res = await fetch('/api/console/assets', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body: fd,
        });
        const json = await res.json();
        if (!res.ok || json.ok === false) throw new Error(json?.error?.message || '上传失败');
        const assetId = json.data.asset.id;

        // 2. 挂为 CoachingSource
        const sourceRes = await academicFetch<{ source: { id: string } }>(
          '/api/console/coaching-sources',
          {
            accessToken,
            method: 'POST',
            body: { assetId, title: file.name.replace(/\.[^.]+$/, '') },
          },
        );

        // 3. 立刻触发分析（不 await，让前端轮询状态）
        void academicFetch(`/api/console/coaching-sources/${sourceRes.source.id}/analyze`, {
          accessToken,
          method: 'POST',
        }).catch(() => {});
      }
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }

  async function analyzeSource(id: string) {
    setErr(null);
    setAnalyzingId(id);
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'analyzing' } : s)));
    try {
      await academicFetch(`/api/console/coaching-sources/${id}/analyze`, { accessToken, method: 'POST' });
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '分析失败');
      await load();
    } finally {
      setAnalyzingId(null);
    }
  }

  if (loading) return <div className="text-sm text-ink-muted">加载中…</div>;

  if (needsOrg) {
    return (
      <div className="mx-auto max-w-xl py-16">
        <EmptyState
          title={`欢迎，${user?.nickname || user?.username}`}
          description="创建一个机构就能开始：上传你自己/老师的辅导视频，系统会理解老师的风格，让学生像跟这位老师 1v1 语音面试。"
          action={<Button onClick={() => router.push('/console/onboarding')}>创建机构</Button>}
        />
      </div>
    );
  }

  const readyReferenced = new Set(defaultScenario?.coachingSourceRefs || []);
  const hasReady = sources.some((s) => s.status === 'ready');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider pb-4">
        <div>
          <div className="text-xs text-ink-muted">机构控制台</div>
          <h1 className="mt-0.5 text-2xl font-medium">{org?.org.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {defaultScenario ? (
            <Tag tone="success">学生端已可练</Tag>
          ) : hasReady ? (
            <Tag tone="warning">发布中…</Tag>
          ) : (
            <Tag tone="neutral">尚无可练场景</Tag>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push('/console/settings')}
          >
            设置
          </Button>
        </div>
      </div>

      {err && <InlineAlert>{err}</InlineAlert>}

      {/* Consult 新线索提醒（M.7.4） */}
      {leadsLoaded && <LeadsInbox leads={leads} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* 左：上传 + 视频列表 */}
        <div className="space-y-4">
          {/* Dropzone */}
          <div
            className={`rounded-lg border-2 border-dashed bg-card p-8 text-center transition-colors ${
              dragOver ? 'border-ink bg-hover' : 'border-divider'
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
            }}
          >
            <div className="text-sm font-medium text-ink">
              {sources.length === 0 ? '上传一段你的辅导视频' : '再上传一段'}
            </div>
            <div className="mt-1 text-xs text-ink-muted">
              把真实的辅导录像拖进来，系统会理解这位老师的提问、反馈、判断方式。
            </div>
            <div className="mt-4">
              <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? '上传中…' : '选择视频 / 音频'}
              </Button>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept="video/*,audio/*"
                multiple
                onChange={(e) => e.target.files && uploadFiles(e.target.files)}
              />
            </div>
            <div className="mt-3 text-[11px] text-ink-muted">
              分析一段视频约 30-120 秒。完成后学生就能立刻跟这位老师"通话"练习。
            </div>
          </div>

          {/* 视频列表 */}
          {sources.length === 0 ? (
            <Card className="p-8 text-center">
              <div className="text-sm text-ink-muted">还没有上传过视频。</div>
            </Card>
          ) : (
            <ul className="space-y-2">
              {sources.map((s) => (
                <SourceRow
                  key={s.id}
                  source={s}
                  analyzing={analyzingId === s.id}
                  inDefault={readyReferenced.has(s.id)}
                  onAnalyze={() => analyzeSource(s.id)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* 右：学生预览 */}
        <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <div className="text-xs text-ink-muted">学生现在会看到</div>
          <StudentPreview org={org?.org.name} scenario={defaultScenario} sources={sources} />
          <p className="text-[11px] text-ink-muted">
            机构主和学生看到的是同一个场景——你上传的视频分析完成后，这里会立刻更新。
          </p>
          {defaultScenario && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.open('/learn', '_blank')}
              className="w-full"
            >
              打开学生视角查看
            </Button>
          )}
        </aside>
      </div>
    </div>
  );
}

// ========== Sub components ==========

function SourceRow({
  source,
  analyzing,
  inDefault,
  onAnalyze,
}: {
  source: Source;
  analyzing: boolean;
  inDefault: boolean;
  onAnalyze: () => void;
}) {
  const analysis = source.analysisJson ? (safeParse<SourceAnalysis>(source.analysisJson) ?? null) : null;
  const isReady = source.status === 'ready';
  const isAnalyzing = source.status === 'analyzing' || analyzing;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isReady ? (
              inDefault ? (
                <Tag tone="success">学生可练</Tag>
              ) : (
                <Tag tone="info">已分析</Tag>
              )
            ) : isAnalyzing ? (
              <Tag tone="warning">分析中…</Tag>
            ) : source.status === 'failed' ? (
              <Tag tone="danger">失败</Tag>
            ) : (
              <Tag tone="neutral">待分析</Tag>
            )}
            <span className="truncate text-sm font-medium text-ink">{source.title}</span>
          </div>
          <div className="mt-1 text-xs text-ink-muted">
            {analysis?.mediaMetadata && (
              <>
                {Math.round(analysis.mediaMetadata.durationSec)}s · {analysis.segmentCount} 段 ·{' '}
              </>
            )}
            {new Date(source.createdAt).toLocaleDateString()}
          </div>
          {analysis?.teacherStyle?.voiceSummary && (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-secondary">
              {analysis.teacherStyle.voiceSummary}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {!isAnalyzing && (
            <Button size="sm" variant={isReady ? 'ghost' : 'secondary'} onClick={onAnalyze}>
              {isReady ? '重新分析' : '开始分析'}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function StudentPreview({
  org,
  scenario,
  sources,
}: {
  org: string | undefined;
  scenario: Scenario | null;
  sources: Source[];
}) {
  const src = scenario?.coachingSourceRefs[0];
  const linkedSource = sources.find((s) => s.id === src);
  const analysis = linkedSource?.analysisJson
    ? (safeParse<SourceAnalysis>(linkedSource.analysisJson) ?? null)
    : null;

  if (!scenario) {
    return (
      <Card className="space-y-4 bg-canvas p-5">
        <Tag tone="warning">学生暂时看不到任何场景</Tag>
        <p className="text-sm text-ink-secondary">
          上传并分析完第一段老师视频，这里会出现一张「一键陪练」的卡片。
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-4 bg-canvas p-5">
      <div className="text-[11px] text-ink-muted">{org} · 学生视角预览</div>
      <div>
        <div className="inline-flex items-center gap-2">
          <Tag tone="info">语音陪练</Tag>
        </div>
        <h3 className="mt-2 text-lg font-medium text-ink">{scenario.name}</h3>
        {scenario.description && (
          <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{scenario.description}</p>
        )}
      </div>
      {linkedSource && (
        <div className="rounded border border-divider bg-white p-3 text-[11px] text-ink-muted">
          <div className="text-ink-muted">AI 模仿的老师</div>
          <div className="mt-1 text-ink">{linkedSource.title}</div>
          {analysis?.signaturePhrases && analysis.signaturePhrases.length > 0 && (
            <div className="mt-2">
              <span className="text-ink-muted">常说：</span>
              <span className="text-ink-secondary">
                {analysis.signaturePhrases.slice(0, 2).join(' / ')}
              </span>
            </div>
          )}
        </div>
      )}
      <div className="inline-flex w-full items-center justify-center rounded-lg border border-ink bg-ink px-4 py-3 text-sm font-medium text-card opacity-80">
        开始陪练（开麦）
      </div>
    </Card>
  );
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ═════════════════════════════════════════════════════════════
// LeadsInbox —— 首页顶部的 Consult 线索提示条
//  - 没有线索：不渲染（不制造噪音）
//  - 有 new：红点 badge + 最近 3 条摘要卡 + "去处理 N 条新线索 →" CTA
//  - 全部 handled（0 new）：一条安静的统计提示
// ═════════════════════════════════════════════════════════════

function LeadsInbox({ leads }: { leads: LeadSummary[] }) {
  if (leads.length === 0) return null; // 没线索就完全不出现

  const newLeads = leads.filter((l) => l.status === 'new');
  const newCount = newLeads.length;

  if (newCount === 0) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-divider bg-card px-4 py-3">
        <div className="flex items-center gap-3 text-[12px] text-ink-secondary">
          <span className="h-1.5 w-1.5 rounded-full bg-mint-400" />
          <span>
            Consult 线索库：<span className="text-ink">{leads.length}</span> 条，全部已处理 ✓
          </span>
        </div>
        <Link
          href="/console/leads"
          className="text-[11.5px] text-ink-muted hover:text-ink hover:underline underline-offset-2"
        >
          查看全部 →
        </Link>
      </div>
    );
  }

  const preview = newLeads.slice(0, 3);

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: '#E6D38A', background: 'linear-gradient(180deg, #FEFAEB 0%, #FDF3C0 100%)' }}
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="consult-dot-pulse absolute inline-flex h-full w-full rounded-full bg-rose-dark/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-dark" />
            </span>
            <span className="text-[10px] uppercase tracking-wider" style={{ color: '#A68400' }}>
              AI 顾问 · 新线索
            </span>
          </div>
          <div className="mt-1 text-[15px] font-medium text-ink">
            {newCount} 条学生留了微信，等你联系
          </div>
        </div>
        <Link
          href="/console/leads?status=new"
          className="shrink-0 rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-canvas hover:bg-ink/85"
        >
          去处理 →
        </Link>
      </div>
      <ul className="mt-3 divide-y divide-ink/5 border-t border-ink/5 bg-card/40">
        {preview.map((lead) => (
          <li key={lead.id}>
            <Link
              href={`/console/leads/${lead.id}`}
              className="flex items-center gap-3 px-5 py-2.5 transition hover:bg-ink/[0.03]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px] text-ink-muted">
                  <span>{lead.scenarioName}</span>
                  <span>·</span>
                  <span>{formatRelative(lead.createdAt)}</span>
                  {lead.messageCount != null && lead.messageCount > 0 && (
                    <>
                      <span>·</span>
                      <span>对话 {lead.messageCount} 条</span>
                    </>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[12.5px] text-ink">
                  {lead.headline || lead.reason.slice(0, 80)}
                </div>
              </div>
              <div className="shrink-0 text-right">
                {lead.wechat && (
                  <div className="text-[11px] text-ink">{lead.wechat}</div>
                )}
                {lead.phone && !lead.wechat && (
                  <div className="text-[11px] text-ink">{lead.phone}</div>
                )}
              </div>
              <span className="shrink-0 text-[10px] text-ink-muted">→</span>
            </Link>
          </li>
        ))}
      </ul>
      {newCount > preview.length && (
        <div className="border-t border-ink/5 bg-card/40 px-5 py-2 text-center">
          <Link
            href="/console/leads?status=new"
            className="text-[11px] text-ink-muted hover:text-ink hover:underline underline-offset-2"
          >
            还有 {newCount - preview.length} 条新线索 →
          </Link>
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)} 小时前`;
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}
