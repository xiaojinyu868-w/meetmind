'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import {
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  Clock,
  Download,
  GitCompareArrows,
  ImageIcon,
  Loader2,
  Network,
  PenLine,
  RefreshCw,
  RectangleHorizontal,
  RectangleVertical,
  Square,
  Sparkles,
  TrendingUp,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface InfographicWindowProps {
  sessionId: string;
  result: AppExecutionResult | null;
  onResultUpdate: (next: AppExecutionResult) => void;
}

interface DraftPayload {
  title?: string;
  subtitle?: string;
  keyPoints?: string[];
  visualPlan?: string[];
  imagePrompt?: string;
  stylePreset?: string;
  suggestedScene?: string;
  suggestedOrientation?: 'landscape' | 'portrait' | 'square';
  suggestedDetailLevel?: 'concise' | 'standard' | 'detailed';
}

interface RenderPayload {
  draft?: DraftPayload;
  image?: {
    imageUrl?: string;
    requestId?: string;
    model?: string;
  } | null;
}

interface ImageConfigResponse {
  ok?: boolean;
  enabled?: boolean;
  model?: string;
}

/* ------------------------------------------------------------------ */
/*  Lucide icon size constants                                         */
/* ------------------------------------------------------------------ */

const ICON_SM = 16;
const ICON_MD = 20;
const ICON_STROKE = 1.75;

/* ------------------------------------------------------------------ */
/*  Scene presets — Lucide icons only, no emoji                        */
/* ------------------------------------------------------------------ */

interface SceneItem {
  key: string;
  label: string;
  Icon: LucideIcon;
}

const SCENE_ITEMS: SceneItem[] = [
  { key: 'infographic', label: '知识信息图', Icon: BarChart3 },
  { key: 'knowledge-card', label: '知识卡片', Icon: BookOpen },
  { key: 'timeline', label: '时间线', Icon: Clock },
  { key: 'comparison', label: '对比分析图', Icon: GitCompareArrows },
  { key: 'flowchart', label: '流程图', Icon: Workflow },
  { key: 'mind-map', label: '概念地图', Icon: Network },
  { key: 'review-poster', label: '复习海报', Icon: PenLine },
  { key: 'data-viz', label: '数据可视化', Icon: TrendingUp },
];

/* ------------------------------------------------------------------ */
/*  Static data                                                        */
/* ------------------------------------------------------------------ */

const LANGUAGES = [
  { value: '中文（简体）', label: '中文（简体）' },
  { value: '中文（繁体）', label: '中文（繁體）' },
  { value: 'English', label: 'English' },
  { value: '日本語', label: '日本語' },
  { value: '한국어', label: '한국어' },
];

const ORIENTATIONS: Array<{
  value: 'landscape' | 'portrait' | 'square';
  label: string;
  Icon: LucideIcon;
}> = [
  { value: 'landscape', label: '横版', Icon: RectangleHorizontal },
  { value: 'portrait', label: '竖版', Icon: RectangleVertical },
  { value: 'square', label: '方形', Icon: Square },
];

const DETAIL_LEVELS: Array<{ value: 'concise' | 'standard' | 'detailed'; label: string; badge?: string }> = [
  { value: 'concise', label: '简洁' },
  { value: 'standard', label: '标准' },
  { value: 'detailed', label: '详尽', badge: 'BETA' },
];

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function GeneratingProgress({ elapsed }: { elapsed: number }) {
  const steps = [
    { label: '理解内容结构', threshold: 0 },
    { label: '构思视觉布局', threshold: 5 },
    { label: '生成视觉元素', threshold: 12 },
    { label: '渲染高清图片', threshold: 25 },
    { label: '优化细节输出', threshold: 40 },
  ];
  const currentStep = steps.filter((s) => elapsed >= s.threshold).length - 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50">
          <Loader2 size={24} strokeWidth={2} className="animate-spin text-blue-600" />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-800">正在生成图片</p>
          <p className="mt-0.5 text-xs text-slate-400">AI 正在为你创作，请稍候</p>
        </div>
        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600">{elapsed}s</span>
      </div>
      <div className="mx-auto max-w-[240px] space-y-2">
        {steps.map((step, idx) => {
          const done = idx < currentStep;
          const active = idx === currentStep;
          return (
            <div key={step.label} className="flex items-center gap-2.5">
              <div
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all ${
                  done
                    ? 'bg-emerald-500 text-white'
                    : active
                      ? 'bg-blue-500 text-white animate-pulse'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {done ? (
                  <Check size={12} strokeWidth={2.5} />
                ) : (
                  <span className="text-[10px] font-bold">{idx + 1}</span>
                )}
              </div>
              <span
                className={`text-xs transition-colors ${
                  done ? 'text-emerald-600 line-through' : active ? 'text-blue-700 font-semibold' : 'text-slate-400'
                }`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function InfographicWindow({ sessionId, result, onResultUpdate }: InfographicWindowProps) {
  const payload = useMemo(() => (result?.render?.payload || {}) as RenderPayload, [result?.render?.payload]);
  const draftFromRaw = (result?.raw?.infographicDraft || null) as DraftPayload | null;
  const draft = useMemo(() => payload.draft || draftFromRaw || ({} as DraftPayload), [payload.draft, draftFromRaw]);
  const imageUrl = payload.image?.imageUrl || (result?.raw?.infographicImageUrl as string | undefined) || '';

  // Customization state
  const [language, setLanguage] = useState('中文（简体）');
  const [orientation, setOrientation] = useState<'landscape' | 'portrait' | 'square'>(
    draft.suggestedOrientation || 'landscape'
  );
  const [detailLevel, setDetailLevel] = useState<'concise' | 'standard' | 'detailed'>(
    draft.suggestedDetailLevel || 'standard'
  );
  const [scenePreset, setScenePreset] = useState(draft.suggestedScene || 'infographic');
  const [customDesc, setCustomDesc] = useState('');

  // API state
  const [imageEnabled, setImageEnabled] = useState(false);
  const [checking, setChecking] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genElapsed, setGenElapsed] = useState(0);

  // Check API capability on mount
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setChecking(true);
      try {
        const response = await fetch('/api/apps/infographic/generate-image', { method: 'GET' });
        const data = (await response.json().catch(() => ({}))) as ImageConfigResponse;
        if (cancelled) return;
        setImageEnabled(Boolean(data.enabled));
      } catch {
        if (!cancelled) setImageEnabled(false);
      }
      if (!cancelled) setChecking(false);
    };
    void run();
    return () => { cancelled = true; };
  }, []);

  // Generation timer
  useEffect(() => {
    if (!generating) { setGenElapsed(0); return; }
    const timer = setInterval(() => setGenElapsed((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, [generating]);

  // Sync LLM suggestions when draft changes
  useEffect(() => {
    if (draft.suggestedScene) setScenePreset(draft.suggestedScene);
    if (draft.suggestedOrientation) setOrientation(draft.suggestedOrientation);
    if (draft.suggestedDetailLevel) setDetailLevel(draft.suggestedDetailLevel);
  }, [draft.suggestedScene, draft.suggestedOrientation, draft.suggestedDetailLevel]);

  const downloadImage = useCallback(async () => {
    if (!imageUrl) return;
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${draft.title || '课堂信息图'}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('图片已下载');
    } catch {
      toast.error('下载失败，请右键图片另存为');
    }
  }, [imageUrl, draft.title]);

  const generateImage = useCallback(async () => {
    if (!result) return;
    const basePrompt = draft.imagePrompt?.trim() || draft.title?.trim() || '课堂信息图';
    const finalPrompt = customDesc.trim()
      ? `${basePrompt}\n\n用户补充要求：${customDesc.trim()}`
      : basePrompt;

    setGenerating(true);
    try {
      const response = await fetch('/api/apps/infographic/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          appKey: 'infographic',
          draftPrompt: finalPrompt,
          stylePreset: draft.stylePreset || '',
          orientation,
          detailLevel,
          language,
          scenePreset,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        imageUrl?: string;
        requestId?: string;
        model?: string;
      } | null;
      if (!response.ok || !data?.ok || !data.imageUrl) {
        throw new Error(data?.error || '生图失败');
      }

      const next: AppExecutionResult = {
        ...result,
        render: {
          ...(result.render || { mode: 'image', payload: {} }),
          mode: 'image',
          payload: {
            ...payload,
            draft,
            image: {
              imageUrl: data.imageUrl,
              requestId: data.requestId,
              model: data.model,
            },
          },
        },
        raw: {
          ...(result.raw || {}),
          infographicDraft: draft,
          infographicImageUrl: data.imageUrl,
          infographicImageRequestId: data.requestId,
          infographicImageModel: data.model,
        },
      };
      onResultUpdate(next);
      toast.success('图片生成完成');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生图失败');
    } finally {
      setGenerating(false);
    }
  }, [result, draft, sessionId, orientation, detailLevel, language, scenePreset, customDesc, payload, onResultUpdate]);

  if (!result) {
    return <AppWindowPlaceholder status="loading" appName="信息图工坊" />;
  }

  // ========== Result view ==========
  if (imageUrl && !generating) {
    return (
      <section className="flex h-full flex-col" data-testid="infographic-window">
        <div className="flex items-center justify-between px-1 pb-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-800">{draft.title || '信息图'}</p>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
              <Check size={10} strokeWidth={3} />
              已完成
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={downloadImage}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 active:bg-slate-100 transition"
            >
              <Download size={ICON_SM} strokeWidth={ICON_STROKE} />
              下载
            </button>
            <button
              type="button"
              onClick={() => {
                if (!result) return;
                const next: AppExecutionResult = {
                  ...result,
                  render: {
                    ...(result.render || { mode: 'custom', payload: {} }),
                    payload: { ...payload, image: null },
                  },
                  raw: {
                    ...(result.raw || {}),
                    infographicImageUrl: undefined,
                  },
                };
                onResultUpdate(next);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 transition"
            >
              <RefreshCw size={ICON_SM} strokeWidth={ICON_STROKE} />
              重新定制
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white">
          <Image
            src={imageUrl}
            alt={draft.title || '课堂信息图'}
            width={1536}
            height={1024}
            className="h-auto w-full object-contain"
            unoptimized
          />
        </div>
        <p className="mt-2 text-center text-[10px] text-slate-400">AI 智能生图</p>
      </section>
    );
  }

  // ========== Generating view ==========
  if (generating) {
    return (
      <section className="flex h-full items-center justify-center" data-testid="infographic-window">
        <div className="flex min-h-80 w-full max-w-md items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
          <GeneratingProgress elapsed={genElapsed} />
        </div>
      </section>
    );
  }

  // ========== Customize panel ==========
  const currentScene = SCENE_ITEMS.find((s) => s.key === scenePreset) || SCENE_ITEMS[0];

  return (
    <section className="flex h-full items-start justify-center overflow-auto py-4" data-testid="infographic-window">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <currentScene.Icon size={ICON_MD} strokeWidth={ICON_STROKE} />
          </div>
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">定制信息图</h2>
            <p className="text-xs text-slate-500 mt-0.5">选择场景和参数，AI 为你生成专属信息图</p>
          </div>
        </div>

        <div className="space-y-7 px-6 py-6">
          {/* Scene type grid */}
          <div>
            <p className="mb-3 text-[13px] font-semibold text-slate-900">场景类型</p>
            <div className="grid grid-cols-4 gap-2.5">
              {SCENE_ITEMS.map((item) => {
                const selected = scenePreset === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setScenePreset(item.key)}
                    className={`group flex flex-col items-center gap-2 rounded-xl px-2 py-4 text-center transition-all ${
                      selected
                        ? 'bg-blue-50 ring-2 ring-blue-500 text-blue-700'
                        : 'bg-slate-50/80 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 hover:text-slate-800 hover:ring-slate-300'
                    }`}
                  >
                    <item.Icon
                      size={ICON_MD}
                      strokeWidth={ICON_STROKE}
                      className={selected ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'}
                    />
                    <span className="text-xs font-medium leading-tight">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Language + Orientation */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="mb-2.5 text-[13px] font-semibold text-slate-900">语言</p>
              <div className="relative">
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-slate-200 bg-white py-2.5 pl-3 pr-9 text-sm text-slate-800 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang.value} value={lang.value}>{lang.label}</option>
                  ))}
                </select>
                <ChevronDown size={ICON_SM} strokeWidth={ICON_STROKE} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
            <div>
              <p className="mb-2.5 text-[13px] font-semibold text-slate-900">方向</p>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                {ORIENTATIONS.map((opt) => {
                  const selected = orientation === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setOrientation(opt.value)}
                      className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[13px] font-medium transition-all ${
                        selected
                          ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {selected ? <Check size={13} strokeWidth={2.5} /> : <opt.Icon size={14} strokeWidth={ICON_STROKE} />}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Detail level */}
          <div>
            <p className="mb-2.5 text-[13px] font-semibold text-slate-900">详细程度</p>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {DETAIL_LEVELS.map((opt) => {
                const selected = detailLevel === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDetailLevel(opt.value)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-5 py-2 text-[13px] font-medium transition-all ${
                      selected
                        ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {selected ? <Check size={13} strokeWidth={2.5} /> : null}
                    {opt.label}
                    {opt.badge ? (
                      <span className={`ml-1 rounded px-1.5 py-0 text-[10px] font-semibold ${
                        selected ? 'bg-slate-100 text-slate-500' : 'bg-slate-100 text-slate-400'
                      }`}>{opt.badge}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom description */}
          <div>
            <p className="mb-2.5 text-[13px] font-semibold text-slate-900">补充描述 <span className="font-normal text-slate-400">（可选）</span></p>
            <textarea
              value={customDesc}
              onChange={(e) => setCustomDesc(e.target.value)}
              placeholder='引导风格、配色或重点，例如: "使用蓝色主题，突出3个核心数据"'
              rows={3}
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-5">
          {!imageEnabled && !checking ? (
            <p className="text-xs font-medium text-amber-600">未配置图片生成服务</p>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <Sparkles size={13} strokeWidth={ICON_STROKE} />
              AI 智能生图
            </p>
          )}
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-7 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 transition-all active:scale-[0.97]"
            onClick={generateImage}
            disabled={!imageEnabled || generating || checking}
          >
            <ImageIcon size={ICON_SM} strokeWidth={ICON_STROKE} />
            生成
          </button>
        </div>
      </div>
    </section>
  );
}
