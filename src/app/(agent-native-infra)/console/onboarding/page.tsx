'use client';

/**
 * /console/onboarding —— 一步机构接入
 *
 * MVP 不再让用户选行业模板 / 填 playbook / 邀请成员。
 * 就一件事：起个机构名 → 创建 → 跳到 /console 上传第一段视频。
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { academicFetch, AcademicClientError } from '@/components/academic/academic-client';
import { Button, Card, InlineAlert, PageHeader } from '@/components/academic/primitives';

export default function OnboardingPage() {
  const router = useRouter();
  const { accessToken, user } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState(user?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    // 如果已经有机构，直接把用户送进主页
    academicFetch<{ orgs: { org: { id: string } }[] }>('/api/console/orgs/me', { accessToken })
      .then((res) => {
        if (res.orgs.length > 0) router.push('/console');
      })
      .catch(() => {});
  }, [accessToken, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name.trim() || !email.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await academicFetch('/api/console/orgs', {
        accessToken,
        method: 'POST',
        body: { name: name.trim(), contactEmail: email.trim(), industry: 'blank' },
      });
      // 直接把 onboardingStep 跳到完成
      const orgsRes = await academicFetch<{ orgs: { org: { id: string } }[] }>(
        '/api/console/orgs/me',
        { accessToken },
      );
      const orgId = orgsRes.orgs[0]?.org.id;
      if (orgId) {
        await academicFetch(`/api/console/orgs/${orgId}/onboarding`, {
          accessToken,
          method: 'POST',
          body: { step: 5 },
        }).catch(() => {});
      }
      router.push('/console');
    } catch (e: unknown) {
      if (e instanceof AcademicClientError) setErr(e.message);
      else setErr(e instanceof Error ? e.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 py-10">
      <PageHeader
        title="欢迎来到 MeetMind 陪练"
        description="给你的机构起个名字。下一步你就能上传第一段老师视频，让学生跟这位老师语音面试。"
      />

      {err && <InlineAlert>{err}</InlineAlert>}

      <Card className="p-6">
        <form className="space-y-4" onSubmit={submit}>
          <label className="block space-y-1">
            <span className="text-xs text-ink-muted">机构名称</span>
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：卿云申博"
              className="w-full rounded border border-divider bg-card px-3 py-2 text-sm focus:border-ink focus:outline-none"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-ink-muted">联系邮箱</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              className="w-full rounded border border-divider bg-card px-3 py-2 text-sm focus:border-ink focus:outline-none"
            />
          </label>
          <Button type="submit" disabled={busy || !name.trim() || !email.trim()}>
            {busy ? '创建中…' : '创建机构，开始上传视频'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
