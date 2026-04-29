'use client';

/**
 * /console/settings —— 机构设置
 *   - 机构信息（名称、邮箱、行业、状态）
 *   - 成员（邀请链接、列表、移除）
 *   - 接入向导（onboarding 入口）
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { academicFetch } from '@/components/academic/academic-client';
import {
  Button,
  Card,
  EmptyState,
  InlineAlert,
  KeyValueList,
  PageHeader,
  Section,
  Tag,
} from '@/components/academic/primitives';

interface Org {
  id: string;
  name: string;
  industry: string;
  status: string;
  onboardingStep: number;
}

interface Membership {
  orgId: string;
  role: string;
  joinedAt: string;
  org: Org;
}

interface Member {
  id: string;
  userId: string;
  role: 'owner' | 'consultant' | 'teacher' | 'student';
  joinedAt: string;
  user: { id: string; username: string; nickname: string; email: string | null };
}

interface Invite {
  id: string;
  token: string;
  role: string;
  email: string | null;
  expiresAt: string | null;
  usedAt: string | null;
  createdAt: string;
}

const ROLE_LABEL: Record<string, string> = {
  owner: '机构主',
  consultant: '顾问',
  teacher: '老师',
  student: '学生',
};

export default function SettingsPage() {
  const { accessToken } = useAuth();
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function load() {
    setLoading(true);
    try {
      const [orgsRes, memRes] = await Promise.all([
        academicFetch<{ orgs: Membership[] }>('/api/console/orgs/me', { accessToken }),
        academicFetch<{ members: Member[]; invites: Invite[] }>('/api/console/members', { accessToken }),
      ]);
      setMemberships(orgsRes.orgs);
      setMembers(memRes.members);
      setInvites(memRes.invites);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function createInvite(role: 'teacher' | 'student' | 'consultant') {
    try {
      await academicFetch('/api/console/members', {
        accessToken,
        method: 'POST',
        body: { role },
      });
      void load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '生成失败');
    }
  }

  async function removeMember(id: string) {
    if (!confirm('移除该成员？')) return;
    try {
      await academicFetch(`/api/console/members/${id}`, { accessToken, method: 'DELETE' });
      void load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '移除失败');
    }
  }

  async function copyInvite(token: string) {
    const url = `${window.location.origin}/invite?token=${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 1500);
    } catch {
      // fallback: 选中
    }
  }

  if (loading) return <div className="text-sm text-ink-muted">加载中…</div>;

  const org = memberships?.[0]?.org;
  const pendingInvites = invites.filter((i) => !i.usedAt);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="控制台" title="设置" description="机构信息、成员、邀请链接。" />

      {err && <InlineAlert>{err}</InlineAlert>}

      {/* 机构信息 */}
      <Section title="机构信息">
        {!org ? (
          <EmptyState
            title="你还没有机构"
            description="去接入向导，3 分钟创建一个机构。"
            action={<Button onClick={() => (window.location.href = '/console/onboarding')}>开始接入</Button>}
          />
        ) : (
          <Card className="p-5">
            <KeyValueList
              rows={[
                { k: '机构名称', v: <span className="font-medium text-ink">{org.name}</span> },
                { k: '行业模板', v: org.industry },
                {
                  k: '接入状态',
                  v: (
                    <span>
                      {org.status === 'active' ? (
                        <Tag tone="success">已接入</Tag>
                      ) : (
                        <Tag tone="warning">接入中（第 {org.onboardingStep}/5 步）</Tag>
                      )}
                      {org.status !== 'active' && (
                        <a href="/console/onboarding" className="ml-3 text-xs text-ink underline">
                          继续接入 →
                        </a>
                      )}
                    </span>
                  ),
                },
                { k: '你的角色', v: ROLE_LABEL[memberships?.[0]?.role || ''] || memberships?.[0]?.role },
              ]}
            />
          </Card>
        )}
      </Section>

      {/* 成员 */}
      <Section
        title="成员"
        description="机构里的老师、顾问和学生。"
        right={<span>{members.length} 人</span>}
      >
        <Card>
          {members.length === 0 ? (
            <div className="p-5 text-sm text-ink-muted">暂无成员。</div>
          ) : (
            <ul className="divide-y divide-divider">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{m.user.nickname}</span>
                      <Tag tone={m.role === 'owner' ? 'info' : 'neutral'}>{ROLE_LABEL[m.role]}</Tag>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-muted">{m.user.email || m.user.username}</div>
                  </div>
                  {m.role !== 'owner' && (
                    <Button size="sm" variant="ghost" onClick={() => removeMember(m.id)}>
                      移除
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      {/* 邀请 */}
      <Section
        title="邀请新成员"
        description="生成一个邀请链接发给老师或学生，他们登录后会自动加入机构。"
      >
        <Card className="p-5">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => createInvite('teacher')}>
              生成老师邀请链接
            </Button>
            <Button variant="secondary" size="sm" onClick={() => createInvite('student')}>
              生成学生邀请链接
            </Button>
            <Button variant="ghost" size="sm" onClick={() => createInvite('consultant')}>
              生成顾问邀请链接
            </Button>
          </div>

          {pendingInvites.length > 0 && (
            <ul className="mt-4 space-y-2">
              {pendingInvites.map((i) => {
                const url = `${window.location.origin}/invite?token=${i.token}`;
                return (
                  <li
                    key={i.id}
                    className="flex items-center justify-between gap-3 rounded border border-divider bg-canvas px-3 py-2 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Tag tone="info">{ROLE_LABEL[i.role]}</Tag>
                        <span className="truncate text-ink-secondary">{url}</span>
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => copyInvite(i.token)}>
                      {copiedToken === i.token ? '已复制' : '复制'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </Section>
    </div>
  );
}
