'use client';

/**
 * /console/scenarios/[id] —— 场景编辑器
 *
 * 布局：左编辑 + 右试跑 两列（lg 及以上）
 * 左栏分 3 个段落：
 *   1. 基本信息：名称 / 描述 / 产物类型 / Persona 种子（tone+style+feedbackAxes+forbiddenZones）
 *   2. 学生开始前必填（studentInputSchema）
 *   3. 关联素材：老师视频 + Playbook 片段
 *   4. 自由 Prompt 补丁（systemAppendix / userKickoff / reviewerRubric）
 * 右栏：试跑对话 + system prompt 预览 + 本轮用到的素材
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { academicFetch, AcademicClientError } from '@/components/academic/academic-client';
import {
  Button,
  Card,
  InlineAlert,
  PageHeader,
  Tag,
} from '@/components/academic/primitives';

interface PersonaSeed {
  tone: 'gentle' | 'direct' | 'probing' | 'structured';
  style: 'socratic' | 'mentor' | 'interviewer' | 'reviewer';
  feedbackAxes: string[];
  forbiddenZones: string[];
}

interface StudentInputField {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'url';
  required: boolean;
  placeholder?: string;
}

interface Scenario {
  id: string;
  orgId: string;
  name: string;
  description: string;
  productKind: 'practice' | 'review' | 'qa' | 'mock-interview' | 'material-polish';
  studentInputSchema: StudentInputField[];
  personaSeed: PersonaSeed;
  checkpointTriggers: { kind: string; description?: string }[];
  coachingSourceRefs: string[];
  playbookSectionRefs: string[];
  industryTemplate: string;
  promptPatch: { systemAppendix?: string; userKickoff?: string; reviewerRubric?: string };
  status: 'draft' | 'published' | 'archived';
}

const PRODUCT_KINDS: { value: Scenario['productKind']; label: string; hint: string }[] = [
  { value: 'practice', label: '自由陪练', hint: '学生跟 AI 聊，开放话题' },
  { value: 'mock-interview', label: '模拟面试', hint: 'AI 扮演面试官对学生发起提问' },
  { value: 'review', label: '作品回看', hint: '学生提交产物后 AI 给回顾' },
  { value: 'qa', label: '问答咨询', hint: '学生主动问，AI 用机构口径答' },
  { value: 'material-polish', label: '材料打磨', hint: '反复润色学生的文档/PS' },
];

const TONES: { value: PersonaSeed['tone']; label: string; hint: string }[] = [
  { value: 'gentle', label: '温和', hint: '鼓励为主，少对抗' },
  { value: 'direct', label: '直接', hint: '实话实说，不绕弯子' },
  { value: 'probing', label: '追问', hint: '层层深挖，逼学生想清楚' },
  { value: 'structured', label: '结构化', hint: '条理清晰、有框架' },
];

const STYLES: { value: PersonaSeed['style']; label: string; hint: string }[] = [
  { value: 'socratic', label: '苏格拉底', hint: '只问不答，启发式' },
  { value: 'mentor', label: '导师', hint: '边引导边指点' },
  { value: 'interviewer', label: '面试官', hint: '模拟真实面试压力' },
  { value: 'reviewer', label: '评审', hint: '给鉴定式反馈' },
];

type LeftTab = 'basic' | 'studentInput' | 'assets' | 'prompt';

export default function ScenarioEditorPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { accessToken } = useAuth();

  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [tab, setTab] = useState<LeftTab>('basic');

  const [playbookOptions, setPlaybookOptions] = useState<Array<{ id: string; title: string; sectionKind: string }>>([]);
  const [sourceOptions, setSourceOptions] = useState<Array<{ id: string; title: string; status: string }>>([]);

  const [tryMessages, setTryMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [tryInput, setTryInput] = useState('');
  const [tryBusy, setTryBusy] = useState(false);
  const [systemPreview, setSystemPreview] = useState<string>('');
  const [tryMeta, setTryMeta] = useState<{ sourcesUsed: string[]; playbookSectionsUsed: number } | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    Promise.all([
      academicFetch<{ scenario: Scenario }>(`/api/console/scenarios/${id}`, { accessToken }),
      academicFetch<{ sections: { id: string; title: string; sectionKind: string }[] }>('/api/console/playbook', {
        accessToken,
      }).catch(() => ({ sections: [] })),
      academicFetch<{ sources: { id: string; title: string; status: string }[] }>('/api/console/coaching-sources', {
        accessToken,
      }).catch(() => ({ sources: [] })),
    ])
      .then(([scRes, pbRes, srcRes]) => {
        setScenario(scRes.scenario);
        setPlaybookOptions(pbRes.sections);
        setSourceOptions(srcRes.sources);
      })
      .catch((e: AcademicClientError) => setErr(e.message));
  }, [accessToken, id]);

  const patch = useCallback(<K extends keyof Scenario>(key: K, value: Scenario[K]) => {
    setScenario((s) => (s ? { ...s, [key]: value } : s));
  }, []);

  async function save(andPublish = false) {
    if (!scenario) return;
    setSaving(true);
    setErr(null);
    try {
      const { id: _a, orgId: _b, status: _c, ...draft } = scenario;
      const savedRes = await academicFetch<{ scenario: Scenario }>(`/api/console/scenarios/${id}`, {
        accessToken,
        method: 'PUT',
        body: draft,
      });
      if (andPublish) {
        const pubRes = await academicFetch<{ scenario: Scenario }>(
          `/api/console/scenarios/${id}/publish`,
          { accessToken, method: 'POST' },
        );
        setScenario(pubRes.scenario);
      } else {
        setScenario(savedRes.scenario);
      }
      setSavedAt(new Date());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function sendTryMessage() {
    if (!scenario || !tryInput.trim()) return;
    setTryBusy(true);
    const next = [...tryMessages, { role: 'user' as const, content: tryInput.trim() }];
    setTryMessages(next);
    setTryInput('');
    try {
      const { id: _a, orgId: _b, status: _c, ...draft } = scenario;
      const res = await academicFetch<{
        assistantReply: string;
        systemPromptPreview: string;
        sourcesUsed?: string[];
        playbookSectionsUsed?: number;
      }>(`/api/console/scenarios/${id}/try`, {
        accessToken,
        method: 'POST',
        body: { draft, messages: next },
      });
      setTryMessages([...next, { role: 'assistant', content: res.assistantReply }]);
      setSystemPreview(res.systemPromptPreview);
      setTryMeta({
        sourcesUsed: res.sourcesUsed ?? [],
        playbookSectionsUsed: res.playbookSectionsUsed ?? 0,
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '试跑失败');
    } finally {
      setTryBusy(false);
    }
  }

  if (!scenario && !err) return <div className="text-sm text-ink-muted">加载中…</div>;
  if (!scenario) return <InlineAlert>{err}</InlineAlert>;

  const isPublished = scenario.status === 'published';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <a href="/console/scenarios" className="hover:text-ink">
              场景
            </a>
            <span>/</span>
            <span>编辑器</span>
            {isPublished ? <Tag tone="success">已发布</Tag> : <Tag tone="warning">草稿</Tag>}
          </span>
        }
        title={
          <input
            value={scenario.name}
            onChange={(e) => patch('name', e.target.value)}
            className="w-full rounded border-b border-transparent bg-transparent py-1 text-2xl font-medium focus:border-divider focus:outline-none"
          />
        }
        actions={
          <>
            {savedAt && <span className="mr-2 text-xs text-ink-muted">已保存 {relTime(savedAt)}</span>}
            <Button variant="secondary" onClick={() => save(false)} disabled={saving}>
              保存草稿
            </Button>
            <Button onClick={() => save(true)} disabled={saving}>
              {isPublished ? '保存并重新发布' : '发布'}
            </Button>
          </>
        }
      />

      {err && <InlineAlert>{err}</InlineAlert>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* 左栏 */}
        <div className="space-y-4">
          <div className="flex gap-1 border-b border-divider">
            {[
              { key: 'basic' as LeftTab, label: '基本信息' },
              { key: 'studentInput' as LeftTab, label: '学生入口' },
              { key: 'assets' as LeftTab, label: '关联素材', warn: scenario.coachingSourceRefs.length === 0 },
              { key: 'prompt' as LeftTab, label: '高级补丁' },
            ].map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                    active ? 'border-ink text-ink' : 'border-transparent text-ink-secondary hover:text-ink'
                  }`}
                >
                  {t.label}
                  {t.warn && <span className="ml-1 text-rose-600">·</span>}
                </button>
              );
            })}
          </div>

          {tab === 'basic' && (
            <BasicFields scenario={scenario} patch={patch} />
          )}

          {tab === 'studentInput' && (
            <StudentInputEditor
              schema={scenario.studentInputSchema}
              onChange={(v) => patch('studentInputSchema', v)}
            />
          )}

          {tab === 'assets' && (
            <AssetRefs
              scenario={scenario}
              patch={patch}
              sourceOptions={sourceOptions}
              playbookOptions={playbookOptions}
            />
          )}

          {tab === 'prompt' && (
            <PromptPatch scenario={scenario} patch={patch} />
          )}
        </div>

        {/* 右栏：试跑 */}
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between border-b border-divider px-4 py-2">
              <span className="text-sm font-medium">试跑对话</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTryMessages([]);
                  setSystemPreview('');
                  setTryMeta(null);
                }}
              >
                重置
              </Button>
            </div>
            <div className="h-80 overflow-y-auto p-3 text-sm">
              {tryMessages.length === 0 ? (
                <div className="text-xs text-ink-muted">
                  这里模拟学生跟这个场景对话。改完左边可以立刻试效果。
                </div>
              ) : (
                tryMessages.map((m, i) => (
                  <div key={i} className={`mb-3 ${m.role === 'user' ? 'text-right' : ''}`}>
                    <div
                      className={`inline-block max-w-[85%] rounded px-3 py-2 text-sm ${
                        m.role === 'user' ? 'bg-ink text-card' : 'bg-canvas border border-divider text-ink'
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                ))
              )}
              {tryBusy && <div className="text-xs text-ink-muted">思考中…</div>}
            </div>
            <div className="flex gap-2 border-t border-divider p-2">
              <input
                value={tryInput}
                onChange={(e) => setTryInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendTryMessage();
                  }
                }}
                placeholder="模拟学生说点什么…"
                className="flex-1 rounded border border-divider bg-card px-3 py-1.5 text-sm focus:border-ink focus:outline-none"
              />
              <Button size="sm" onClick={sendTryMessage} disabled={tryBusy || !tryInput.trim()}>
                发送
              </Button>
            </div>
          </Card>

          {tryMeta && (
            <Card className="p-3 text-xs">
              <div className="text-ink-muted">本轮用到</div>
              <div className="mt-1 text-ink">
                {tryMeta.playbookSectionsUsed} 条 Playbook ·{' '}
                {tryMeta.sourcesUsed.length > 0
                  ? `${tryMeta.sourcesUsed.length} 段老师视频（${tryMeta.sourcesUsed.join('、')}）`
                  : '无老师视频'}
              </div>
            </Card>
          )}

          {systemPreview && (
            <details className="rounded border border-divider bg-card p-3 text-xs">
              <summary className="cursor-pointer text-ink-secondary">System prompt 预览</summary>
              <pre className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-ink-secondary">
                {systemPreview}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

// ========== Sub editors ==========

function BasicFields({
  scenario,
  patch,
}: {
  scenario: Scenario;
  patch: <K extends keyof Scenario>(key: K, value: Scenario[K]) => void;
}) {
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <Field label="描述" hint="一句话告诉学生这个场景能帮他什么。">
          <textarea
            rows={2}
            value={scenario.description}
            onChange={(e) => patch('description', e.target.value)}
            className="w-full rounded border border-divider bg-card px-3 py-2 text-sm focus:border-ink focus:outline-none"
          />
        </Field>

        <Field label="产物类型">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {PRODUCT_KINDS.map((p) => {
              const active = scenario.productKind === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => patch('productKind', p.value)}
                  className={`rounded border px-3 py-2 text-left text-xs transition-colors ${
                    active ? 'border-ink bg-hover' : 'border-divider hover:border-ink'
                  }`}
                >
                  <div className="text-sm font-medium text-ink">{p.label}</div>
                  <div className="mt-0.5 text-[11px] text-ink-muted">{p.hint}</div>
                </button>
              );
            })}
          </div>
        </Field>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="text-sm font-medium">陪练风格</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="语气">
            <div className="space-y-1">
              {TONES.map((t) => {
                const active = scenario.personaSeed.tone === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => patch('personaSeed', { ...scenario.personaSeed, tone: t.value })}
                    className={`flex w-full items-center justify-between rounded px-3 py-1.5 text-xs transition-colors ${
                      active ? 'bg-hover text-ink' : 'text-ink-secondary hover:bg-hover'
                    }`}
                  >
                    <span>{t.label}</span>
                    <span className="text-[11px] text-ink-muted">{t.hint}</span>
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="风格">
            <div className="space-y-1">
              {STYLES.map((t) => {
                const active = scenario.personaSeed.style === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => patch('personaSeed', { ...scenario.personaSeed, style: t.value })}
                    className={`flex w-full items-center justify-between rounded px-3 py-1.5 text-xs transition-colors ${
                      active ? 'bg-hover text-ink' : 'text-ink-secondary hover:bg-hover'
                    }`}
                  >
                    <span>{t.label}</span>
                    <span className="text-[11px] text-ink-muted">{t.hint}</span>
                  </button>
                );
              })}
            </div>
          </Field>
        </div>

        <Field label="反馈维度" hint="AI 会按这些维度评价学生。逗号分隔。">
          <input
            value={scenario.personaSeed.feedbackAxes.join(', ')}
            onChange={(e) =>
              patch('personaSeed', {
                ...scenario.personaSeed,
                feedbackAxes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
              })
            }
            placeholder="研究深度, 表达清晰, 动机匹配"
            className="w-full rounded border border-divider bg-card px-3 py-2 text-sm focus:border-ink focus:outline-none"
          />
        </Field>

        <Field label="禁区" hint="这些事 AI 绝不会替学生做。逗号分隔。">
          <input
            value={scenario.personaSeed.forbiddenZones.join(', ')}
            onChange={(e) =>
              patch('personaSeed', {
                ...scenario.personaSeed,
                forbiddenZones: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
              })
            }
            placeholder="替学生决定投哪所学校, 承诺录取概率"
            className="w-full rounded border border-divider bg-card px-3 py-2 text-sm focus:border-ink focus:outline-none"
          />
        </Field>
      </Card>
    </div>
  );
}

function StudentInputEditor({
  schema,
  onChange,
}: {
  schema: StudentInputField[];
  onChange: (v: StudentInputField[]) => void;
}) {
  function update(i: number, next: StudentInputField) {
    const arr = [...schema];
    arr[i] = next;
    onChange(arr);
  }
  function remove(i: number) {
    onChange(schema.filter((_, j) => j !== i));
  }
  function add() {
    onChange([...schema, { key: `field_${schema.length + 1}`, label: '新字段', kind: 'text', required: false }]);
  }

  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">学生开始前必填</div>
          <div className="mt-0.5 text-xs text-ink-muted">
            学生点击"开始"后先填这些，AI 就能知道他的目标、背景，立刻进入状态。
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={add}>
          添加字段
        </Button>
      </div>
      {schema.length === 0 ? (
        <div className="rounded border border-dashed border-divider p-4 text-center text-xs text-ink-muted">
          无字段 · 学生点开始直接进。
        </div>
      ) : (
        <ul className="space-y-2">
          {schema.map((f, i) => (
            <li
              key={i}
              className="grid grid-cols-[1fr_1fr_100px_80px_auto] items-center gap-2 rounded border border-divider bg-canvas p-2 text-xs"
            >
              <input
                value={f.key}
                onChange={(e) => update(i, { ...f, key: e.target.value })}
                placeholder="key"
                className="rounded border border-divider bg-card px-2 py-1"
              />
              <input
                value={f.label}
                onChange={(e) => update(i, { ...f, label: e.target.value })}
                placeholder="显示标签"
                className="rounded border border-divider bg-card px-2 py-1"
              />
              <select
                value={f.kind}
                onChange={(e) => update(i, { ...f, kind: e.target.value as StudentInputField['kind'] })}
                className="rounded border border-divider bg-card px-2 py-1"
              >
                <option value="text">短文本</option>
                <option value="textarea">长文本</option>
                <option value="url">链接</option>
              </select>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={f.required}
                  onChange={(e) => update(i, { ...f, required: e.target.checked })}
                />
                必填
              </label>
              <Button size="sm" variant="ghost" onClick={() => remove(i)}>
                删
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AssetRefs({
  scenario,
  patch,
  sourceOptions,
  playbookOptions,
}: {
  scenario: Scenario;
  patch: <K extends keyof Scenario>(key: K, value: Scenario[K]) => void;
  sourceOptions: Array<{ id: string; title: string; status: string }>;
  playbookOptions: Array<{ id: string; title: string; sectionKind: string }>;
}) {
  const readySources = sourceOptions.filter((s) => s.status === 'ready');
  const pendingSources = sourceOptions.filter((s) => s.status !== 'ready');

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <div>
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">老师视频</div>
            <a className="text-xs text-ink underline" href="/console/knowledge?kind=source" target="_blank" rel="noreferrer">
              去知识库
            </a>
          </div>
          <div className="mt-0.5 text-xs text-ink-muted">
            勾选后 AI 陪练会以这位老师的风格提问、反馈、评价学生。
          </div>
        </div>

        {readySources.length === 0 && pendingSources.length === 0 && (
          <div className="rounded border border-dashed border-divider p-4 text-center text-xs text-ink-muted">
            还没有老师视频。去知识库上传一段，分析完就能在这里选。
          </div>
        )}

        {readySources.length > 0 && (
          <ul className="divide-y divide-divider">
            {readySources.map((s) => {
              const checked = scenario.coachingSourceRefs.includes(s.id);
              return (
                <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const set = new Set(scenario.coachingSourceRefs);
                      if (e.target.checked) set.add(s.id);
                      else set.delete(s.id);
                      patch('coachingSourceRefs', Array.from(set));
                    }}
                  />
                  <span className="flex-1">{s.title}</span>
                  <Tag tone="success">已分析</Tag>
                </li>
              );
            })}
          </ul>
        )}

        {pendingSources.length > 0 && (
          <div className="rounded border border-divider bg-canvas p-3 text-xs text-ink-muted">
            还有 {pendingSources.length} 段视频未分析，分析完会出现在这里。
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-5">
        <div>
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Playbook 片段</div>
            <a className="text-xs text-ink underline" href="/console/knowledge?kind=playbook" target="_blank" rel="noreferrer">
              去知识库
            </a>
          </div>
          <div className="mt-0.5 text-xs text-ink-muted">
            机构的 SOP、话术、样本。勾选后作为 AI 的底层知识。
          </div>
        </div>

        {playbookOptions.length === 0 ? (
          <div className="rounded border border-dashed border-divider p-4 text-center text-xs text-ink-muted">
            还没有 Playbook 片段。去知识库手写，或上传文档自动拆分。
          </div>
        ) : (
          <ul className="max-h-64 divide-y divide-divider overflow-y-auto">
            {playbookOptions.map((p) => {
              const checked = scenario.playbookSectionRefs.includes(p.id);
              return (
                <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const set = new Set(scenario.playbookSectionRefs);
                      if (e.target.checked) set.add(p.id);
                      else set.delete(p.id);
                      patch('playbookSectionRefs', Array.from(set));
                    }}
                  />
                  <span className="flex-1">{p.title}</span>
                  <span className="text-[11px] text-ink-muted">{p.sectionKind}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function PromptPatch({
  scenario,
  patch,
}: {
  scenario: Scenario;
  patch: <K extends keyof Scenario>(key: K, value: Scenario[K]) => void;
}) {
  return (
    <Card className="space-y-4 p-5">
      <div>
        <div className="text-sm font-medium">高级：自由 Prompt 补丁</div>
        <div className="mt-0.5 text-xs text-ink-muted">
          留空即可。只有当上面的结构化字段不够用时，才在这里补充私货。
        </div>
      </div>

      <Field label="系统追加（机构私货）">
        <textarea
          rows={4}
          value={scenario.promptPatch.systemAppendix || ''}
          onChange={(e) => patch('promptPatch', { ...scenario.promptPatch, systemAppendix: e.target.value })}
          placeholder="例：遇到申博目标含糊的学生，先问他过去读过的三篇最有影响的论文。"
          className="w-full rounded border border-divider bg-card p-3 text-xs font-mono focus:border-ink focus:outline-none"
        />
      </Field>

      <Field label="学生第一句（可为空）">
        <textarea
          rows={2}
          value={scenario.promptPatch.userKickoff || ''}
          onChange={(e) => patch('promptPatch', { ...scenario.promptPatch, userKickoff: e.target.value })}
          placeholder="AI 会把这句当作学生的开场，主动发起第一轮。"
          className="w-full rounded border border-divider bg-card p-3 text-xs font-mono focus:border-ink focus:outline-none"
        />
      </Field>

      <Field label="评分量表（reviewer 类场景）">
        <textarea
          rows={3}
          value={scenario.promptPatch.reviewerRubric || ''}
          onChange={(e) => patch('promptPatch', { ...scenario.promptPatch, reviewerRubric: e.target.value })}
          className="w-full rounded border border-divider bg-card p-3 text-xs font-mono focus:border-ink focus:outline-none"
        />
      </Field>
    </Card>
  );
}

// ========== atoms ==========

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink">{label}</label>
      {hint && <div className="mt-0.5 text-[11px] text-ink-muted">{hint}</div>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function relTime(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 10) return '刚刚';
  if (s < 60) return `${s}s 前`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  return d.toLocaleTimeString();
}
