'use client';

/**
 * /learn —— 学生端首页
 *
 * V0 MVP 聚焦「一张卡 + 一个按钮」：
 *   - 顶部：机构名 + 欢迎
 *   - 主卡：机构为你准备的一个默认语音陪练场景，点「开始陪练」直接进入语音通话
 *   - 底部（可选）：最近一次已完成的练习入口
 *
 * 产品口径：学生不需要自己选场景，机构主发布了什么，学生就练什么。
 */

import { useEffect, useState } from 'react';
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

interface Scenario {
  id: string;
  name: string;
  description: string;
  productKind: string;
}

interface OrgInfo {
  orgId: string;
  role: string;
  org: { id: string; name: string };
}

interface SessionSummary {
  id: string;
  status: 'active' | 'completed' | 'abandoned';
  mode: 'text' | 'voice';
  startedAt: string;
  completedAt: string | null;
  scenario: { id: string; name: string };
}

export default function LearnHomePage() {
  const router = useRouter();
  const { accessToken, user } = useAuth();
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [myOrg, setMyOrg] = useState<OrgInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    Promise.all([
      academicFetch<{ orgs: OrgInfo[] }>('/api/console/orgs/me', { accessToken }),
      academicFetch<{ scenarios: Scenario[] }>('/api/academic/scenarios', { accessToken }).catch(() => ({ scenarios: [] })),
      academicFetch<{ sessions: SessionSummary[] }>('/api/academic/practice', { accessToken }).catch(() => ({ sessions: [] })),
    ])
      .then(([orgRes, scRes, seRes]) => {
        setMyOrg(orgRes.orgs[0] || null);
        setScenarios(scRes.scenarios);
        setSessions(seRes.sessions);
      })
      .catch((e: AcademicClientError) => setErr(e.message));
  }, [accessToken]);

  async function startPractice() {
    if (!scenarios || scenarios.length === 0 || starting) return;
    setStarting(true);
    setErr(null);
    try {
      const res = await academicFetch<{ sessionId: string }>('/api/academic/practice', {
        accessToken,
        method: 'POST',
        body: { scenarioId: scenarios[0].id, mode: 'voice', studentInput: {} },
      });
      router.push(`/learn/practice/${res.sessionId}`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '开启失败');
      setStarting(false);
    }
  }

  if (scenarios === null && !err) return <div className="text-sm text-ink-muted">加载中…</div>;

  if (!myOrg) {
    return (
      <div className="mx-auto max-w-xl py-16">
        <EmptyState
          title={`你好，${user?.nickname || user?.username}`}
          description="你还没加入任何机构。找机构要一张邀请链接，或者自己创建一个机构。"
          action={
            <Button variant="secondary" onClick={() => (window.location.href = '/console')}>
              我是机构方，创建机构
            </Button>
          }
        />
      </div>
    );
  }

  const scenario = scenarios?.[0];
  const active = sessions.find((s) => s.status === 'active');
  const lastCompleted = sessions.find((s) => s.status === 'completed');

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-6">
      <div className="border-b border-divider pb-4">
        <div className="text-xs text-ink-muted">{myOrg.org.name}</div>
        <h1 className="mt-1 text-2xl font-medium">你好，{user?.nickname || user?.username}</h1>
      </div>

      {err && <InlineAlert>{err}</InlineAlert>}

      {/* 主卡：一键开练 */}
      {!scenario ? (
        <EmptyState
          title="机构还在准备"
          description="等机构主上传并分析完第一段老师视频，你就能在这里开麦练了。"
        />
      ) : (
        <Card className="space-y-5 p-8">
          <div className="inline-flex items-center gap-2">
            <Tag tone="info">语音陪练</Tag>
            {scenario.productKind === 'mock-interview' && <Tag tone="neutral">模拟面试</Tag>}
          </div>
          <div>
            <h2 className="text-2xl font-medium">{scenario.name}</h2>
            {scenario.description && (
              <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{scenario.description}</p>
            )}
          </div>

          {active ? (
            <div className="flex items-center justify-between rounded border border-divider bg-canvas p-4">
              <div>
                <div className="text-xs text-ink-muted">你上一次的练习还没结束</div>
                <div className="mt-0.5 text-sm text-ink">
                  {new Date(active.startedAt).toLocaleString()} 开始
                </div>
              </div>
              <Button onClick={() => router.push(`/learn/practice/${active.id}`)}>继续</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Button onClick={startPractice} disabled={starting} size="md" className="h-12 text-base">
                {starting ? '正在接通…' : '开始陪练（开麦）'}
              </Button>
              <p className="text-xs text-ink-muted">
                点击后系统会请求麦克风权限。这是一段语音通话，像跟老师 1v1 面试。
              </p>
            </div>
          )}
        </Card>
      )}

      {/* 上一次已完成的练习入口 */}
      {lastCompleted && (
        <a href={`/learn/practice/${lastCompleted.id}`} className="block">
          <Card interactive className="flex items-center justify-between gap-4 p-4">
            <div>
              <div className="text-xs text-ink-muted">上一次练习反馈</div>
              <div className="mt-0.5 text-sm font-medium">{lastCompleted.scenario.name}</div>
              <div className="mt-0.5 text-xs text-ink-muted">
                {lastCompleted.completedAt
                  ? new Date(lastCompleted.completedAt).toLocaleString()
                  : new Date(lastCompleted.startedAt).toLocaleString()}
              </div>
            </div>
            <span className="text-xs text-ink-secondary">看反馈 →</span>
          </Card>
        </a>
      )}
    </div>
  );
}
