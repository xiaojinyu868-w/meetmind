'use client';

/**
 * /console/skills — 机构场景（scenario skill）管理
 *
 * 机构主 / 顾问可以：
 *   - 上传 .skill 包（符合 AgentSkills / OpenClaw 规范）
 *   - 看到已审核 skill 清单 / 驳回原因
 *   - 批准 / 驳回 / 删除 skill
 *
 * 审核通过后：skill 文件部署到 orgs/<orgId>/skills/<name>/，
 * 学生端 /consult/<orgSlug> 的场景切换器自动出现新场景。
 */

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { academicFetch } from '@/components/academic/academic-client';
import { Button, Card, PageHeader, Section } from '@/components/academic/primitives';

interface OrgSkill {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectReason: string | null;
  skillDirPath: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

const STATUS_COLOR: Record<OrgSkill['status'], string> = {
  pending: 'bg-sand text-ink',
  approved: 'bg-mint text-ink',
  rejected: 'bg-rose/20 text-ink',
};

const STATUS_LABEL: Record<OrgSkill['status'], string> = {
  pending: '待审核',
  approved: '已上线',
  rejected: '已驳回',
};

function fmt(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SkillsPage() {
  const { accessToken } = useAuth();
  const [skills, setSkills] = useState<OrgSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    if (!accessToken) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await academicFetch<{ skills: OrgSkill[] }>('/api/console/skills', { accessToken });
      setSkills(res.skills);
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

  async function upload(file: File) {
    if (!accessToken || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/console/skills', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function act(id: string, action: 'approve' | 'reject' | 'delete', reason?: string) {
    try {
      if (action === 'delete') {
        await academicFetch(`/api/console/skills/${id}`, { accessToken, method: 'DELETE' });
      } else {
        await academicFetch(`/api/console/skills/${id}`, {
          accessToken,
          method: 'PATCH',
          body: { action, reason },
        });
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-6 py-6">
      <PageHeader
        title="场景（Scenario Skills）"
        description="上传一份 .skill 包，平台自动跑 OpenClaw 官方 validator；通过审核后学生端立即可见。"
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".skill,.zip"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? '上传中…' : '上传 .skill'}
            </Button>
            <Button onClick={load} disabled={loading} variant="ghost">
              {loading ? '刷新中…' : '刷新'}
            </Button>
          </>
        }
      />

      <Card className="p-4 text-xs leading-relaxed text-ink-secondary">
        <div className="font-medium text-ink">怎么得到一份 .skill 包？</div>
        <div className="mt-2 space-y-1">
          <div>
            1. 读 <code className="rounded bg-hover px-1">platform-skills/meetmind-scenario-author/SKILL.md</code>——
            告诉你怎么写合规的 scenario skill（含 block 使用规范、工具面板、画像 schema、自检清单）。
          </div>
          <div>
            2. 把这份 meta-skill 丢给 Claude Code / Cursor / 你自己的 coding agent，让它按规范产出
            <code className="rounded bg-hover px-1">SKILL.md</code>。
          </div>
          <div>
            3. 自检：<code className="rounded bg-hover px-1">python3 scripts/skill/quick_validate.py &lt;skill-dir&gt;</code>
          </div>
          <div>
            4. 打包：<code className="rounded bg-hover px-1">python3 scripts/skill/package_skill.py &lt;skill-dir&gt;</code>
            → <code className="rounded bg-hover px-1">&lt;name&gt;.skill</code>
          </div>
          <div>5. 把 .skill 上传到这里。</div>
        </div>
      </Card>

      {err && <Card className="border-rose/40 bg-rose/5 p-3 text-xs text-ink">{err}</Card>}

      {!loading && skills.length === 0 && (
        <Card className="p-6 text-center text-sm text-ink-muted">
          还没有 skill。点右上 "上传 .skill" 传第一份。
        </Card>
      )}

      <div className="space-y-3">
        {skills.map((s) => (
          <Card key={s.id} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_COLOR[s.status]}`}>
                    {STATUS_LABEL[s.status]}
                  </span>
                  <span className="text-sm font-medium text-ink">{s.name}</span>
                  <span className="text-[11px] text-ink-muted">{fmt(s.createdAt)}</span>
                </div>
                <div className="text-xs leading-relaxed text-ink-secondary">{s.description}</div>
                {s.status === 'rejected' && s.rejectReason && (
                  <div className="mt-1 rounded border border-rose/40 bg-rose/5 p-2 text-[11px] text-ink">
                    <span className="font-medium">驳回原因：</span>
                    <span className="whitespace-pre-wrap">{s.rejectReason}</span>
                  </div>
                )}
                {s.status === 'approved' && s.skillDirPath && (
                  <div className="mt-1 text-[10px] text-ink-muted">
                    已部署：<code className="rounded bg-hover px-1">{s.skillDirPath}</code>
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                {s.status === 'pending' && (
                  <>
                    <Button onClick={() => act(s.id, 'approve')}>批准上线</Button>
                    <Button
                      onClick={() => {
                        const r = prompt('驳回原因（必填）：');
                        if (r && r.trim()) act(s.id, 'reject', r.trim());
                      }}
                      variant="ghost"
                    >
                      驳回
                    </Button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`确认删除 ${s.name}？`)) act(s.id, 'delete');
                  }}
                  className="text-[10px] text-ink-muted underline underline-offset-2 hover:text-rose"
                >
                  删除
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
