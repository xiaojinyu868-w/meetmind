'use client';

/**
 * /console/knowledge —— 机构知识库（资产 / 老师视频 / Playbook 片段 三合一）
 *
 * 设计意图：
 *   - 机构主的心智不是"我要管理 3 张表"，而是"我要给 Coaching Twin 提供素材"
 *   - 所以这一页把原来的 /console/assets /console/sources /console/playbook 合并
 *   - 顶部一个大的 Dropzone，自动按 mime 类型判断 kind；上传完文档自动提示"拆为 Playbook"
 *   - 左侧 Filter tabs：全部 / 老师视频 / 文档 / Playbook 片段
 *   - 列表项统一用 Card 语言；不同类别用 Tag 区分
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { academicFetch } from '@/components/academic/academic-client';
import {
  Button,
  Card,
  EmptyState,
  InlineAlert,
  PageHeader,
  Section,
  Tag,
} from '@/components/academic/primitives';

// ========== Types ==========

interface Asset {
  id: string;
  kind: 'document' | 'audio' | 'video' | 'image' | 'url';
  title: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  storagePath: string | null;
  publicUrl: string | null;
  sourceUrl: string | null;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  processingStage: string | null;
  errorMessage: string | null;
  createdAt: string;
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

interface PlaybookSection {
  id: string;
  title: string;
  sectionKind: 'overview' | 'sop' | 'rubric' | 'script' | 'sample' | 'case';
  body: string;
  tags: string[];
  updatedAt: string;
}

interface SourceAnalysis {
  segmentCount: number;
  teacherStyle?: { tone?: string; style?: string; voiceSummary?: string };
  questionPatterns?: string[];
  feedbackPatterns?: string[];
  signaturePhrases?: string[];
  mediaMetadata?: { durationSec: number };
}

// ========== Helpers ==========

function formatSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const ASSET_KIND_TAG: Record<Asset['kind'], { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
  document: { label: '文档', tone: 'info' },
  audio: { label: '音频', tone: 'warning' },
  video: { label: '视频', tone: 'warning' },
  image: { label: '图片', tone: 'neutral' },
  url: { label: '链接', tone: 'neutral' },
};

const SECTION_KIND_LABEL: Record<PlaybookSection['sectionKind'], string> = {
  overview: '总览',
  sop: 'SOP',
  rubric: '评分',
  script: '话术',
  sample: '样本',
  case: '案例',
};

type Tab = 'all' | 'source' | 'document' | 'playbook';

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'source', label: '老师视频' },
  { key: 'document', label: '文档' },
  { key: 'playbook', label: 'Playbook 片段' },
];

// ========== Page ==========

export default function KnowledgePage() {
  const { accessToken } = useAuth();
  const params = useSearchParams();
  const initialTab = (params?.get('kind') as Tab) || 'all';

  const [tab, setTab] = useState<Tab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [playbook, setPlaybook] = useState<PlaybookSection[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // playbook editor drawer
  const [editingPlaybook, setEditingPlaybook] = useState<Partial<PlaybookSection> | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function load() {
    setLoading(true);
    try {
      const res = await academicFetch<{
        assets: Asset[];
        sources: Source[];
        playbook: PlaybookSection[];
      }>('/api/console/knowledge', { accessToken });
      setAssets(res.assets);
      setSources(res.sources);
      setPlaybook(res.playbook);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    if (!accessToken) return;
    setUploading(true);
    setErr(null);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('title', file.name);
        const res = await fetch('/api/console/assets', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body: fd,
        });
        const json = await res.json();
        if (!res.ok || json.ok === false) {
          throw new Error(json?.error?.message || '上传失败');
        }
      }
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }

  async function removeAsset(id: string) {
    if (!confirm('删除这个资产？')) return;
    try {
      await academicFetch(`/api/console/assets/${id}`, { accessToken, method: 'DELETE' });
      void load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '删除失败');
    }
  }

  async function extractDocument(id: string) {
    setErr(null);
    setExtractingId(id);
    try {
      const res = await academicFetch<{ count: number }>(
        `/api/console/assets/${id}/extract`,
        { accessToken, method: 'POST' },
      );
      await load();
      setTab('playbook');
      alert(`已拆分为 ${res.count} 个 Playbook 片段`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '拆分失败');
      await load();
    } finally {
      setExtractingId(null);
    }
  }

  async function promoteToSource(asset: Asset) {
    try {
      await academicFetch('/api/console/coaching-sources', {
        accessToken,
        method: 'POST',
        body: { assetId: asset.id, title: asset.title },
      });
      await load();
      setTab('source');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '挂接失败');
    }
  }

  async function analyzeSource(id: string) {
    setErr(null);
    setAnalyzingId(id);
    // 乐观更新
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

  async function savePlaybook() {
    if (!editingPlaybook || !editingPlaybook.title?.trim() || !editingPlaybook.body?.trim()) return;
    try {
      if (editingPlaybook.id) {
        await academicFetch(`/api/console/playbook/${editingPlaybook.id}`, {
          accessToken,
          method: 'PUT',
          body: {
            title: editingPlaybook.title,
            sectionKind: editingPlaybook.sectionKind,
            body: editingPlaybook.body,
            tags: editingPlaybook.tags ?? [],
          },
        });
      } else {
        await academicFetch('/api/console/playbook', {
          accessToken,
          method: 'POST',
          body: {
            title: editingPlaybook.title,
            sectionKind: editingPlaybook.sectionKind || 'sop',
            body: editingPlaybook.body,
            tags: editingPlaybook.tags ?? [],
          },
        });
      }
      setEditingPlaybook(null);
      void load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '保存失败');
    }
  }

  async function deletePlaybook(id: string) {
    if (!confirm('删除这个 Playbook 片段？')) return;
    try {
      await academicFetch(`/api/console/playbook/${id}`, { accessToken, method: 'DELETE' });
      void load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '删除失败');
    }
  }

  // 排除已经挂为 CoachingSource 的视频/音频 asset
  const assetsExcludingMountedMedia = useMemo(() => {
    const mounted = new Set(sources.map((s) => s.assetId).filter(Boolean));
    return assets.filter((a) => {
      if ((a.kind === 'video' || a.kind === 'audio') && mounted.has(a.id)) return false;
      return true;
    });
  }, [assets, sources]);

  // 按 tab 过滤
  const listed = useMemo(() => {
    if (tab === 'source') return sources.map((s) => ({ kind: 'source' as const, row: s }));
    if (tab === 'document') {
      return assetsExcludingMountedMedia
        .filter((a) => a.kind === 'document' || a.kind === 'url' || a.kind === 'image')
        .map((a) => ({ kind: 'asset' as const, row: a }));
    }
    if (tab === 'playbook') return playbook.map((p) => ({ kind: 'playbook' as const, row: p }));
    // all
    return [
      ...sources.map((s) => ({ kind: 'source' as const, row: s, time: s.createdAt })),
      ...assetsExcludingMountedMedia.map((a) => ({ kind: 'asset' as const, row: a, time: a.createdAt })),
      ...playbook.map((p) => ({ kind: 'playbook' as const, row: p, time: p.updatedAt })),
    ].sort((a, b) => (b.time > a.time ? 1 : -1));
  }, [tab, sources, assetsExcludingMountedMedia, playbook]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="机构能力"
        title="知识库"
        description="你提供的一切素材都会沉淀在这里，喂给 Coaching Twin。上传文档会拆成 Playbook 片段，上传老师视频会被 AI 理解成老师风格。"
        actions={
          <Button onClick={() => setEditingPlaybook({ title: '', sectionKind: 'sop', body: '' })} variant="secondary">
            手写一条 Playbook
          </Button>
        }
      />

      {err && <InlineAlert>{err}</InlineAlert>}

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
        <div className="text-sm text-ink">把文件拖到这里上传</div>
        <div className="mt-1 text-xs text-ink-muted">
          文档自动拆为 Playbook 片段 · 视频/音频可一键挂为老师视频
        </div>
        <div className="mt-4">
          <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? '上传中…' : '选择文件'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            multiple
            onChange={(e) => e.target.files && uploadFiles(e.target.files)}
          />
        </div>
        <div className="mt-3 text-[11px] text-ink-muted">
          支持 PDF / DOCX / MD / TXT · MP3 / M4A / WAV · MP4 / MOV · 图片
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-divider">
        {TABS.map((t) => {
          const count =
            t.key === 'source'
              ? sources.length
              : t.key === 'document'
                ? assetsExcludingMountedMedia.filter((a) => a.kind === 'document' || a.kind === 'url' || a.kind === 'image').length
                : t.key === 'playbook'
                  ? playbook.length
                  : sources.length + assetsExcludingMountedMedia.length + playbook.length;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                active
                  ? 'border-ink text-ink'
                  : 'border-transparent text-ink-secondary hover:text-ink'
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-xs text-ink-muted">{count}</span>
            </button>
          );
        })}
      </div>

      {/* List */}
      <Section>
        {loading ? (
          <div className="text-sm text-ink-muted">加载中…</div>
        ) : listed.length === 0 ? (
          <EmptyState
            title={
              tab === 'source'
                ? '还没有老师视频'
                : tab === 'document'
                  ? '还没有文档'
                  : tab === 'playbook'
                    ? '还没有 Playbook 片段'
                    : '知识库是空的'
            }
            description="把第一份经验资料拖上来，系统会帮你结构化。"
          />
        ) : (
          <ul className="space-y-2">
            {listed.map((item, i) => {
              if (item.kind === 'source') {
                const s = item.row as Source;
                const analysis = s.analysisJson ? (safeParse<SourceAnalysis>(s.analysisJson) ?? null) : null;
                return (
                  <li key={`s-${s.id}`}>
                    <Card className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Tag tone="warning">老师视频</Tag>
                            <span className="text-sm font-medium text-ink">{s.title}</span>
                            <StatusTag status={s.status} />
                          </div>
                          <div className="mt-1 text-xs text-ink-muted">
                            上传者：{s.uploader?.nickname || s.uploader?.username || '—'}
                            {analysis?.mediaMetadata && (
                              <> · {Math.round(analysis.mediaMetadata.durationSec)}s · {analysis.segmentCount} 段</>
                            )}
                            · {new Date(s.createdAt).toLocaleDateString()}
                          </div>
                          {analysis?.teacherStyle?.voiceSummary && (
                            <p className="mt-2 text-xs text-ink-secondary">
                              {analysis.teacherStyle.voiceSummary}
                            </p>
                          )}
                          {analysis?.signaturePhrases && analysis.signaturePhrases.length > 0 && (
                            <div className="mt-2 text-xs text-ink-muted">
                              招牌表达：{analysis.signaturePhrases.slice(0, 3).join(' / ')}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          {s.status !== 'analyzing' && analyzingId !== s.id ? (
                            <Button size="sm" variant="secondary" onClick={() => analyzeSource(s.id)}>
                              {s.status === 'ready' ? '重新分析' : '开始分析'}
                            </Button>
                          ) : (
                            <span className="text-xs text-ink-muted">分析中…</span>
                          )}
                        </div>
                      </div>
                    </Card>
                  </li>
                );
              }
              if (item.kind === 'asset') {
                const a = item.row as Asset;
                const meta = ASSET_KIND_TAG[a.kind];
                return (
                  <li key={`a-${a.id}`}>
                    <Card className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Tag tone={meta.tone}>{meta.label}</Tag>
                            <span className="text-sm font-medium text-ink">{a.title}</span>
                            <StatusTag status={a.status} />
                          </div>
                          <div className="mt-1 text-xs text-ink-muted">
                            {formatSize(a.sizeBytes)}
                            {a.filename && a.filename !== a.title && ` · ${a.filename}`}
                            · {new Date(a.createdAt).toLocaleDateString()}
                          </div>
                          {a.sourceUrl && (
                            <div className="mt-1 truncate text-xs text-ink-muted">{a.sourceUrl}</div>
                          )}
                          {a.errorMessage && (
                            <div className="mt-1 text-xs text-rose-600">{a.errorMessage}</div>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          {a.kind === 'document' && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => extractDocument(a.id)}
                              disabled={extractingId === a.id}
                            >
                              {extractingId === a.id ? '拆分中…' : '拆为 Playbook'}
                            </Button>
                          )}
                          {(a.kind === 'video' || a.kind === 'audio') && (
                            <Button size="sm" variant="secondary" onClick={() => promoteToSource(a)}>
                              挂为老师视频
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => removeAsset(a.id)}>
                            删除
                          </Button>
                        </div>
                      </div>
                    </Card>
                  </li>
                );
              }
              const p = item.row as PlaybookSection;
              return (
                <li key={`p-${p.id}`}>
                  <Card className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Tag tone="info">Playbook · {SECTION_KIND_LABEL[p.sectionKind]}</Tag>
                          <span className="text-sm font-medium text-ink">{p.title}</span>
                        </div>
                        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-ink-secondary">
                          {p.body}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => setEditingPlaybook(p)}>
                          编辑
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deletePlaybook(p.id)}>
                          删除
                        </Button>
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {editingPlaybook && (
        <PlaybookDrawer
          value={editingPlaybook}
          onChange={setEditingPlaybook}
          onSave={savePlaybook}
          onClose={() => setEditingPlaybook(null)}
        />
      )}
    </div>
  );
}

// ========== Subcomponents ==========

function StatusTag({ status }: { status: string }) {
  const map: Record<string, { tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'; label: string }> = {
    pending: { tone: 'neutral', label: '待处理' },
    processing: { tone: 'warning', label: '处理中' },
    analyzing: { tone: 'warning', label: '分析中' },
    ready: { tone: 'success', label: '就绪' },
    failed: { tone: 'danger', label: '失败' },
  };
  const m = map[status] || { tone: 'neutral', label: status };
  return <Tag tone={m.tone}>{m.label}</Tag>;
}

function PlaybookDrawer({
  value,
  onChange,
  onSave,
  onClose,
}: {
  value: Partial<PlaybookSection>;
  onChange: (v: Partial<PlaybookSection>) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const KINDS: PlaybookSection['sectionKind'][] = ['overview', 'sop', 'rubric', 'script', 'sample', 'case'];
  return (
    <div className="fixed inset-0 z-30 flex">
      <div className="flex-1 bg-ink/20" onClick={onClose} />
      <aside className="flex w-full max-w-xl flex-col border-l border-divider bg-card">
        <header className="flex items-center justify-between border-b border-divider px-5 py-3">
          <h3 className="text-sm font-medium">{value.id ? '编辑 Playbook 片段' : '新建 Playbook 片段'}</h3>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <label className="block space-y-1 text-xs">
            <span className="text-ink-muted">标题</span>
            <input
              value={value.title || ''}
              onChange={(e) => onChange({ ...value, title: e.target.value })}
              className="w-full rounded border border-divider bg-card px-3 py-2 text-sm"
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="text-ink-muted">类别</span>
            <select
              value={value.sectionKind || 'sop'}
              onChange={(e) => onChange({ ...value, sectionKind: e.target.value as PlaybookSection['sectionKind'] })}
              className="w-full rounded border border-divider bg-card px-3 py-2 text-sm"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {SECTION_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-xs">
            <span className="text-ink-muted">内容（markdown）</span>
            <textarea
              rows={16}
              value={value.body || ''}
              onChange={(e) => onChange({ ...value, body: e.target.value })}
              className="w-full rounded border border-divider bg-card p-2 font-mono text-xs"
            />
          </label>
        </div>
        <footer className="flex justify-end gap-2 border-t border-divider p-3">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={onSave} disabled={!value.title?.trim() || !value.body?.trim()}>
            保存
          </Button>
        </footer>
      </aside>
    </div>
  );
}

// ========== Util ==========

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
