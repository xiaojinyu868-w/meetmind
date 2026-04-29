'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { academicFetch, AcademicClientError } from '@/components/academic/academic-client';
import { Button, Card, InlineAlert, PageHeader } from '@/components/academic/primitives';

interface StudentInputField {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'url';
  required: boolean;
  placeholder?: string;
}

interface Scenario {
  id: string;
  name: string;
  description: string;
  productKind: string;
  studentInputSchema: StudentInputField[];
}

export default function ScenarioStartPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const { accessToken } = useAuth();

  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    academicFetch<{ scenarios: Scenario[] }>('/api/academic/scenarios', { accessToken })
      .then((res) => {
        const found = res.scenarios.find((s) => s.id === id);
        if (!found) setErr('场景不存在或尚未对你发布');
        else setScenario(found);
      })
      .catch((e: AcademicClientError) => setErr(e.message));
  }, [accessToken, id]);

  async function start() {
    if (!scenario) return;
    const missing = scenario.studentInputSchema.find((f) => f.required && !values[f.key]?.trim());
    if (missing) {
      setErr(`请填写：${missing.label}`);
      return;
    }
    setStarting(true);
    setErr(null);
    try {
      const res = await academicFetch<{ sessionId: string }>('/api/academic/practice', {
        accessToken,
        method: 'POST',
        body: { scenarioId: id, mode: 'text', studentInput: values },
      });
      router.push(`/learn/practice/${res.sessionId}`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '开启失败');
      setStarting(false);
    }
  }

  if (!scenario && !err) return <div className="text-sm text-ink-muted">加载中…</div>;
  if (err && !scenario) return <InlineAlert>{err}</InlineAlert>;
  if (!scenario) return null;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader
        eyebrow={
          <a href="/learn" className="hover:text-ink">
            ← 返回陪练列表
          </a>
        }
        title={scenario.name}
        description={scenario.description}
      />

      {err && <InlineAlert>{err}</InlineAlert>}

      <Card className="space-y-4 p-6">
        {scenario.studentInputSchema.length > 0 ? (
          <>
            <div className="text-sm font-medium">开始之前，先告诉陪练一些信息</div>
            {scenario.studentInputSchema.map((f) => (
              <label key={f.key} className="block space-y-1">
                <span className="text-xs text-ink-secondary">
                  {f.label}
                  {f.required && <span className="ml-1 text-rose-600">*</span>}
                </span>
                {f.kind === 'textarea' ? (
                  <textarea
                    rows={4}
                    value={values[f.key] || ''}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    className="w-full rounded border border-divider bg-card p-2 text-sm focus:border-ink focus:outline-none"
                  />
                ) : (
                  <input
                    type={f.kind === 'url' ? 'url' : 'text'}
                    value={values[f.key] || ''}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    className="w-full rounded border border-divider bg-card px-3 py-2 text-sm focus:border-ink focus:outline-none"
                  />
                )}
              </label>
            ))}
          </>
        ) : (
          <p className="text-sm text-ink-muted">无需额外输入，直接开始即可。</p>
        )}

        <div className="flex justify-end">
          <Button disabled={starting} onClick={start}>
            {starting ? '正在开启…' : '开始陪练'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
