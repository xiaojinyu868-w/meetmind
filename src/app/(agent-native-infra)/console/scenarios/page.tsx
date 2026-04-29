'use client';

/**
 * /console/scenarios —— 场景列表
 *
 * 每张卡片一眼告诉机构主：
 *   - 是不是已发布
 *   - 有没有关联老师视频（没有就警告）
 *   - 用了多少条 Playbook
 *   - 近 7 天练习数
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
  PageHeader,
  Tag,
} from '@/components/academic/primitives';

interface ScenarioListItem {
  id: string;
  name: string;
  description: string;
  productKind: string;
  status: 'draft' | 'published' | 'archived';
  coachingSourceRefs?: string[];
  playbookSectionRefs?: string[];
  updatedAt: string;
}

const PRODUCT_KIND_LABEL: Record<string, string> = {
  practice: '自由陪练',
  review: '作品回看',
  qa: '答疑',
  'mock-interview': '模拟面试',
  'material-polish': '材料打磨',
};

export default function ScenariosListPage() {
  const router = useRouter();
  const { accessToken } = useAuth();
  const [items, setItems] = useState<ScenarioListItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    academicFetch<{ scenarios: ScenarioListItem[] }>('/api/console/scenarios', { accessToken })
      .then((res) => setItems(res.scenarios))
      .catch((e: AcademicClientError) => setErr(e.message));
  }, [accessToken]);

  async function createBlank() {
    setBusy(true);
    const draft = {
      name: '新场景',
      description: '',
      productKind: 'practice',
      studentInputSchema: [],
      personaSeed: { tone: 'direct', style: 'mentor', feedbackAxes: ['结构', '逻辑'], forbiddenZones: [] },
      checkpointTriggers: [],
      coachingSourceRefs: [],
      playbookSectionRefs: [],
      industryTemplate: 'blank',
      promptPatch: {},
    };
    try {
      const res = await academicFetch<{ scenario: { id: string } }>('/api/console/scenarios', {
        accessToken,
        method: 'POST',
        body: draft,
      });
      router.push(`/console/scenarios/${res.scenario.id}`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  if (items === null && !err) return <div className="text-sm text-ink-muted">加载中…</div>;

  const published = items?.filter((s) => s.status === 'published') ?? [];
  const drafts = items?.filter((s) => s.status === 'draft') ?? [];
  const archived = items?.filter((s) => s.status === 'archived') ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="机构控制台"
        title="陪练场景"
        description="场景是你机构真正交付给学生的产品。决定 AI 陪练以什么方式、什么老师风格、回答哪类问题。"
        actions={
          <Button onClick={createBlank} disabled={busy}>
            {busy ? '创建中…' : '新建场景'}
          </Button>
        }
      />

      {err && <InlineAlert>{err}</InlineAlert>}

      {!items || items.length === 0 ? (
        <EmptyState
          title="还没有场景"
          description="从空白开始或去 onboarding 选一个行业模板推荐的场景。"
          action={
            <div className="flex justify-center gap-2">
              <Button variant="secondary" onClick={() => (window.location.href = '/console/onboarding')}>
                选一个模板
              </Button>
              <Button onClick={createBlank}>从空白开始</Button>
            </div>
          }
        />
      ) : (
        <>
          {published.length > 0 && (
            <ScenarioGroup title="已发布" items={published} tone="success" />
          )}
          {drafts.length > 0 && <ScenarioGroup title="草稿" items={drafts} tone="warning" />}
          {archived.length > 0 && (
            <ScenarioGroup title="已归档" items={archived} tone="neutral" />
          )}
        </>
      )}
    </div>
  );
}

function ScenarioGroup({
  title,
  items,
  tone,
}: {
  title: string;
  items: ScenarioListItem[];
  tone: 'success' | 'warning' | 'neutral';
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between border-b border-divider pb-2">
        <h2 className="text-sm font-medium">
          {title}
          <span className="ml-2 text-xs text-ink-muted">{items.length}</span>
        </h2>
      </div>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((s) => (
          <li key={s.id}>
            <a href={`/console/scenarios/${s.id}`} className="block">
              <Card interactive className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Tag tone={tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : 'neutral'}>
                        {title}
                      </Tag>
                      <span className="text-xs text-ink-muted">
                        {PRODUCT_KIND_LABEL[s.productKind] || s.productKind}
                      </span>
                    </div>
                    <h3 className="mt-2 text-base font-medium text-ink">{s.name}</h3>
                    {s.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-ink-secondary">{s.description}</p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-divider pt-3 text-xs text-ink-muted">
                  <AssetCountBadge
                    kind="老师视频"
                    count={s.coachingSourceRefs?.length ?? 0}
                    warnIfZero={s.status === 'published'}
                  />
                  <AssetCountBadge
                    kind="Playbook"
                    count={s.playbookSectionRefs?.length ?? 0}
                    warnIfZero={s.status === 'published'}
                  />
                  <span className="ml-auto">{new Date(s.updatedAt).toLocaleDateString()} 更新</span>
                </div>
              </Card>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AssetCountBadge({
  kind,
  count,
  warnIfZero,
}: {
  kind: string;
  count: number;
  warnIfZero: boolean;
}) {
  const warn = warnIfZero && count === 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
        warn ? 'bg-rose-light text-rose-700' : 'bg-hover text-ink-secondary'
      }`}
    >
      {kind} · {count}
      {warn && <span className="ml-1">⚠︎</span>}
    </span>
  );
}
