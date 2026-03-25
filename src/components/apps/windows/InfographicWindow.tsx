'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Check,
  ChevronDown,
  Download,
  ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  Wand2,
} from 'lucide-react';

import type { AppExecutionResult } from '@/lib/ai-native/types';
import {
  type InfographicWindowProps,
  type DraftPayload,
  type RenderPayload,
  type ImageConfigResponse,
  ICON_SM,
  ICON_MD,
  ICON_STROKE,
  SCENE_ITEMS,
  STYLE_PRESETS,
  LANGUAGES,
  ORIENTATIONS,
  DETAIL_LEVELS,
  normalizeContextText,
  truncateText,
  resolveStylePresetKey,
  buildFallbackDraft,
  buildSyntheticResult,
} from './infographic-window-data';

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function DraftPreparingState() {
  return (
    <section className="flex h-full items-center justify-center" data-testid="infographic-window">
      <div className="flex min-h-80 w-full max-w-md flex-col items-center justify-center gap-5 rounded-3xl border border-slate-200 bg-white px-8 py-10 shadow-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
          <Loader2 size={26} strokeWidth={2} className="animate-spin" />
        </div>
        <div className="space-y-2 text-center">
          <p className="text-base font-semibold text-slate-900">AI 正在理解课堂内容</p>
          <p className="text-sm leading-6 text-slate-500">先帮你提炼标题、关键信息和推荐布局，完成后会回到可编辑页面。</p>
        </div>
        <div className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          <div className="flex items-center gap-2 text-slate-700">
            <Sparkles size={14} strokeWidth={ICON_STROKE} className="text-blue-500" />
            <span className="font-medium">正在准备 AI 推荐草案</span>
          </div>
          <p className="mt-2 leading-6">这一步只做内容理解，不会直接强制开始生图。</p>
        </div>
      </div>
    </section>
  );
}

function GeneratingProgress({ elapsed }: { elapsed: number }) {
  const steps = [
    { label: '整理你的生成要求', threshold: 0 },
    { label: '构思视觉布局', threshold: 4 },
    { label: '生成视觉元素', threshold: 10 },
    { label: '渲染高清图片', threshold: 22 },
    { label: '优化细节输出', threshold: 38 },
  ];
  const currentStep = Math.max(0, steps.filter((step) => elapsed >= step.threshold).length - 1);

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50">
          <Loader2 size={24} strokeWidth={2} className="animate-spin text-blue-600" />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-800">正在生成图片</p>
          <p className="mt-0.5 text-xs text-slate-400">AI 正在根据你的要求创作信息图</p>
        </div>
        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600">{elapsed}s</span>
      </div>
      <div className="mx-auto max-w-[240px] space-y-2">
        {steps.map((step, index) => {
          const done = index < currentStep;
          const active = index === currentStep;
          return (
            <div key={step.label} className="flex items-center gap-2.5">
              <div
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all ${
                  done
                    ? 'bg-[#232322] text-white'
                    : active
                      ? 'animate-pulse bg-blue-500 text-white'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {done ? <Check size={12} strokeWidth={2.5} /> : <span className="text-[10px] font-bold">{index + 1}</span>}
              </div>
              <span
                className={`text-xs transition-colors ${
                  done ? 'text-[#232322] line-through' : active ? 'font-semibold text-blue-700' : 'text-slate-400'
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

export function InfographicWindow({
  sessionId,
  result,
  taskState,
  contentContext,
  onResultUpdate,
  onGenerateDraft,
  standalone = false,
}: InfographicWindowProps) {
  const payload = useMemo(() => (result?.render?.payload || {}) as RenderPayload, [result?.render?.payload]);
  const draftFromRaw = (result?.raw?.infographicDraft || null) as DraftPayload | null;
  const aiDraft = useMemo(() => payload.draft || draftFromRaw || null, [payload.draft, draftFromRaw]);
  const imageUrl = payload.image?.imageUrl || (result?.raw?.infographicImageUrl as string | undefined) || '';

  const [language, setLanguage] = useState('中文（简体）');
  const [orientation, setOrientation] = useState<'landscape' | 'portrait' | 'square'>(
    aiDraft?.suggestedOrientation || 'landscape'
  );
  const [detailLevel, setDetailLevel] = useState<'concise' | 'standard' | 'detailed'>(
    aiDraft?.suggestedDetailLevel || 'standard'
  );
  const [scenePreset, setScenePreset] = useState(aiDraft?.suggestedScene || 'infographic');
  const [stylePreset, setStylePreset] = useState(resolveStylePresetKey(aiDraft?.stylePreset));
  const [customDesc, setCustomDesc] = useState('');
  const [showReferenceInfo, setShowReferenceInfo] = useState(false);

  const [imageEnabled, setImageEnabled] = useState(false);
  const [checking, setChecking] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genElapsed, setGenElapsed] = useState(0);
  const [previewMode, setPreviewMode] = useState<'fit' | 'full'>('fit');

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
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!generating) {
      setGenElapsed(0);
      return;
    }
    const timer = setInterval(() => setGenElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [generating]);

  useEffect(() => {
    if (aiDraft?.suggestedScene) setScenePreset(aiDraft.suggestedScene);
    if (aiDraft?.suggestedOrientation) setOrientation(aiDraft.suggestedOrientation);
    if (aiDraft?.suggestedDetailLevel) setDetailLevel(aiDraft.suggestedDetailLevel);
    if (aiDraft?.stylePreset) setStylePreset(resolveStylePresetKey(aiDraft.stylePreset));
  }, [aiDraft?.stylePreset, aiDraft?.suggestedDetailLevel, aiDraft?.suggestedOrientation, aiDraft?.suggestedScene]);

  useEffect(() => {
    if (imageUrl) {
      setPreviewMode('fit');
    }
  }, [imageUrl]);

  const previewDraft = useMemo(
    () =>
      aiDraft ||
      buildFallbackDraft({
        contentContext,
        scenePreset,
        orientation,
        detailLevel,
      }),
    [aiDraft, contentContext, detailLevel, orientation, scenePreset]
  );

  const currentScene = SCENE_ITEMS.find((item) => item.key === scenePreset) || SCENE_ITEMS[0];
  const currentOrientation = ORIENTATIONS.find((item) => item.value === orientation) || ORIENTATIONS[0];
  const currentDetail = DETAIL_LEVELS.find((item) => item.value === detailLevel) || DETAIL_LEVELS[1];
  const currentStyle = STYLE_PRESETS.find((item) => item.key === stylePreset) || STYLE_PRESETS[0];
  const summaryPreview = truncateText(normalizeContextText(contentContext), 120);
  const draftError = useMemo(() => {
    const raw = taskState?.status === 'error' ? taskState.error : '';
    if (!raw) return '';
    if (/failed to fetch|load failed|networkerror/i.test(raw)) {
      return '网络请求失败。通常是开发服务正在重启、接口暂时不可用，或浏览器请求被中断；刷新后重试即可。';
    }
    return raw;
  }, [taskState?.error, taskState?.status]);
  const hasAiDraft = Boolean(aiDraft?.imagePrompt || aiDraft?.keyPoints?.length || aiDraft?.visualPlan?.length);

  const downloadImage = useCallback(async () => {
    if (!imageUrl) return;
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${previewDraft.title || '课堂信息图'}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      toast.success('图片已下载');
    } catch {
      toast.error('下载失败，请右键图片另存为');
    }
  }, [imageUrl, previewDraft.title]);

  const requestImage = useCallback(
    async (baseResult: AppExecutionResult | null = result) => {
      const basePayload = ((baseResult?.render?.payload || {}) as RenderPayload) || {};
      const baseDraftFromRaw = (baseResult?.raw?.infographicDraft || null) as DraftPayload | null;
      const fallbackDraft = buildFallbackDraft({
        contentContext,
        scenePreset,
        orientation,
        detailLevel,
      });
      const sourceDraft = basePayload.draft || baseDraftFromRaw || fallbackDraft;
      const mergedDraft: DraftPayload = {
        ...fallbackDraft,
        ...sourceDraft,
        stylePreset: currentStyle.prompt || sourceDraft.stylePreset || fallbackDraft.stylePreset,
        suggestedScene: scenePreset,
        suggestedOrientation: orientation,
        suggestedDetailLevel: detailLevel,
      };
      const basePrompt = mergedDraft.imagePrompt?.trim() || fallbackDraft.imagePrompt?.trim() || mergedDraft.title?.trim() || '';
      const finalPrompt = customDesc.trim() ? `${basePrompt}\n\n用户补充要求：${customDesc.trim()}` : basePrompt;

      if (!finalPrompt.trim()) {
        toast.error('缺少课堂内容摘要，暂时无法生成信息图');
        return;
      }

      setGenerating(true);
      try {
        const response = await fetch('/api/apps/infographic/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            appKey: 'infographic',
            draftPrompt: finalPrompt,
            stylePreset: mergedDraft.stylePreset || currentStyle.prompt || '',
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

        const next = buildSyntheticResult({
          baseResult,
          draft: mergedDraft,
          image: {
            imageUrl: data.imageUrl,
            requestId: data.requestId,
            model: data.model,
          },
        });

        onResultUpdate(next);
        toast.success('图片生成完成');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '生图失败');
      } finally {
        setGenerating(false);
      }
    },
    [contentContext, currentStyle.prompt, customDesc, detailLevel, language, onResultUpdate, orientation, result, scenePreset, sessionId]
  );

  const handleDirectGenerate = useCallback(() => {
    void requestImage(result);
  }, [requestImage, result]);

  const handleAiRecommend = useCallback(() => {
    void onGenerateDraft?.();
  }, [onGenerateDraft]);

  const resetToCustomize = useCallback(() => {
    if (!result) return;
    const next = buildSyntheticResult({
      baseResult: result,
      draft: previewDraft,
      image: null,
    });
    onResultUpdate(next);
  }, [onResultUpdate, previewDraft, result]);

  if (taskState?.status === 'running' && !result && !generating) {
    return <DraftPreparingState />;
  }

  if (imageUrl && !generating) {
    return (
      <section className="flex h-full min-h-0 flex-col" data-testid="infographic-window">
        <div className="flex flex-col gap-3 px-1 pb-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-slate-900">{previewDraft.title || '信息图'}</p>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#D1F4E0]/30 px-2 py-0.5 text-[10px] font-medium text-[#232322]">
                <Check size={10} strokeWidth={3} />
                已完成
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500">
                {previewMode === 'fit' ? '适应页面' : '放大查看'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {standalone ? '这是结果页，不再复用应用窗口外壳；默认先看完整成品。' : '默认先展示完整成品，再把下载和继续修改收在同一条操作线上。'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setPreviewMode('fit')}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  previewMode === 'fit' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                适应页面
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode('full')}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  previewMode === 'full' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                放大查看
              </button>
            </div>
            <button
              type="button"
              onClick={downloadImage}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 active:bg-slate-100"
            >
              <Download size={ICON_SM} strokeWidth={ICON_STROKE} />
              下载
            </button>
            <button
              type="button"
              onClick={resetToCustomize}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-blue-700 active:bg-blue-800"
            >
              <RefreshCw size={ICON_SM} strokeWidth={ICON_STROKE} />
              继续修改
            </button>
          </div>
        </div>

        <div
          className={`min-h-0 flex flex-1 flex-col overflow-hidden rounded-[28px] ${
            standalone
              ? 'border border-slate-200 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.10)]'
              : 'border border-slate-800 bg-[#11141b] shadow-[0_18px_60px_rgba(15,23,42,0.22)]'
          }`}
        >
          <div
            className={`flex items-center justify-between px-4 py-3 text-xs ${
              standalone ? 'border-b border-slate-200 text-slate-500' : 'border-b border-white/10 text-slate-400'
            }`}
          >
            <span>{standalone ? '结果页会优先展示完整成品，避免首屏只看到局部。' : '完整成品会优先适配到当前窗口内，避免一打开就只能看到局部。'}</span>
            <span>{previewMode === 'fit' ? '优先看全貌' : '优先看细节'}</span>
          </div>
          <div className={`min-h-0 flex-1 ${previewMode === 'fit' ? 'overflow-hidden' : 'overflow-auto'} px-4 py-4 sm:px-6 sm:py-6`}>
            <div className="flex min-h-full items-center justify-center">
              <img
                src={imageUrl}
                alt={previewDraft.title || '课堂信息图'}
                className={
                  previewMode === 'fit'
                    ? standalone
                      ? 'h-auto max-h-[72vh] w-auto max-w-full rounded-2xl object-contain shadow-[0_18px_48px_rgba(15,23,42,0.18)]'
                      : 'max-h-full w-auto max-w-full rounded-2xl object-contain shadow-[0_24px_70px_rgba(2,6,23,0.42)]'
                    : standalone
                      ? 'h-auto max-w-[1100px] rounded-2xl object-contain shadow-[0_18px_48px_rgba(15,23,42,0.18)]'
                      : 'h-auto max-w-none rounded-2xl object-contain shadow-[0_24px_70px_rgba(2,6,23,0.42)]'
                }
              />
            </div>
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] text-slate-400">AI 智能生图 · 默认优先保证完整可见</p>
      </section>
    );
  }

  if (generating) {
    return (
      <section className="flex h-full items-center justify-center" data-testid="infographic-window">
        <div className="flex min-h-80 w-full max-w-md items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
          <GeneratingProgress elapsed={genElapsed} />
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full items-start justify-center overflow-auto py-6" data-testid="infographic-window">
      <div className="w-full max-w-5xl rounded-[28px] border border-slate-800 bg-[#0b0d12] text-slate-100 shadow-[0_24px_80px_rgba(2,6,23,0.45)]">
        <div className="border-b border-slate-800 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-indigo-300">
              <currentScene.Icon size={ICON_MD} strokeWidth={ICON_STROKE} />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Customize Infographic</p>
              <h2 className="mt-1 text-lg font-semibold text-white">自定义信息图</h2>
              <p className="mt-1 text-sm leading-6 text-slate-400">把关键配置直接放到一屏里，减少来回展开和扫视成本。</p>
            </div>
          </div>
        </div>

        <div className="space-y-6 px-6 py-6">
          {draftError ? (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {draftError}
            </div>
          ) : null}

          {!imageEnabled && !checking ? (
            <div className="rounded-2xl border border-[#E9E9E7]/30 bg-[#FADEC9]/10 px-4 py-3 text-sm leading-6 text-[#FDF3C0]">
              当前环境还没配置图片生成服务，所以可以先调界面，但暂时无法真正生图。
            </div>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="text-sm font-semibold text-white">选择语言</p>
              <div className="relative mt-3">
                <select
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                  className="w-full appearance-none rounded-2xl border border-slate-700 bg-[#10131a] py-3 pl-4 pr-10 text-sm text-slate-100 shadow-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                >
                  {LANGUAGES.map((languageOption) => (
                    <option key={languageOption.value} value={languageOption.value}>
                      {languageOption.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={ICON_SM}
                  strokeWidth={ICON_STROKE}
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-white">选择方向</p>
                <span className="text-xs text-slate-500">当前：{currentOrientation.label}</span>
              </div>
              <div className="mt-3 inline-flex w-full rounded-full border border-slate-700 bg-[#10131a] p-1">
                {ORIENTATIONS.map((option) => {
                  const selected = orientation === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setOrientation(option.value)}
                      className={`inline-flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-medium transition ${
                        selected ? 'bg-slate-700 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {selected ? <Check size={14} strokeWidth={2.5} /> : <option.Icon size={14} strokeWidth={ICON_STROKE} />}
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">选择视觉风格</p>
                <p className="mt-1 text-xs text-slate-500">参考图的优点是选项直接可见，你不用先读文案再猜结果。</p>
              </div>
              <span className="rounded-full border border-slate-700 bg-white/[0.03] px-3 py-1 text-xs text-slate-300">{currentStyle.label}</span>
            </div>
            <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
              {STYLE_PRESETS.map((item) => {
                const selected = stylePreset === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setStylePreset(item.key)}
                    className={`group w-[176px] shrink-0 text-left transition-transform hover:-translate-y-0.5 ${selected ? 'scale-[1.01]' : ''}`}
                  >
                    <div
                      className={`relative overflow-hidden rounded-[22px] border p-3 ${
                        selected ? 'border-indigo-400 bg-white/[0.07] shadow-[0_0_0_1px_rgba(129,140,248,0.28)]' : 'border-slate-700 bg-white/[0.03]'
                      }`}
                    >
                      <div className={`relative flex h-28 items-center justify-center rounded-2xl bg-gradient-to-br ${item.previewClassName}`}>
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.7),transparent_45%)]" />
                        <item.Icon size={32} strokeWidth={1.8} className="relative text-slate-700" />
                        {selected ? (
                          <div className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-900/80 text-white shadow-sm">
                            <Check size={14} strokeWidth={2.6} />
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-3">
                        <p className="text-sm font-semibold text-white">{item.label}</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{item.description}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">详细程度</p>
              <span className="text-xs text-slate-500">当前：{currentDetail.label}</span>
            </div>
            <div className="mt-3 inline-flex w-full rounded-full border border-slate-700 bg-[#10131a] p-1">
              {DETAIL_LEVELS.map((option) => {
                const selected = detailLevel === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDetailLevel(option.value)}
                    className={`inline-flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-medium transition ${
                      selected ? 'bg-slate-700 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {selected ? <Check size={14} strokeWidth={2.5} /> : null}
                    {option.label}
                    {option.badge ? (
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${selected ? 'bg-white/10 text-slate-200' : 'bg-slate-800 text-slate-500'}`}>
                        {option.badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">内容版式</p>
                <p className="mt-1 text-xs text-slate-500">保留能力，但收成轻量标签，不再堆成大面积表单卡片。</p>
              </div>
              <button
                type="button"
                onClick={() => setShowReferenceInfo((value) => !value)}
                className="text-xs font-medium text-slate-400 transition hover:text-slate-200"
              >
                {showReferenceInfo ? '收起课堂摘要' : '查看课堂摘要'}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {SCENE_ITEMS.map((item) => {
                const selected = scenePreset === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setScenePreset(item.key)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition ${
                      selected
                        ? 'border-indigo-400 bg-indigo-500/15 text-indigo-200'
                        : 'border-slate-700 bg-white/[0.03] text-slate-400 hover:border-slate-600 hover:text-slate-200'
                    }`}
                  >
                    <item.Icon size={13} strokeWidth={ICON_STROKE} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {showReferenceInfo ? (
            <div className="rounded-2xl border border-slate-800 bg-white/[0.03] px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">课堂摘要</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">{summaryPreview || '暂无摘要，将使用课堂原始内容提炼生成。'}</p>
              {hasAiDraft && previewDraft.keyPoints?.length ? (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">AI 推荐要点</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {previewDraft.keyPoints.slice(0, 5).map((point) => (
                      <span key={point} className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-xs text-slate-300">
                        {point}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div>
            <p className="text-sm font-semibold text-white">
              补充你的要求 <span className="font-normal text-slate-500">（可选）</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">例如强调蓝色主题、突出 3 个结论，或者更像复习海报。</p>
            <textarea
              value={customDesc}
              onChange={(event) => setCustomDesc(event.target.value)}
              placeholder='例如：“蓝色主题，突出 3 个核心结论；尽量像复习海报，适合手机查看。”'
              rows={5}
              className="mt-3 w-full resize-none rounded-[24px] border border-slate-700 bg-[#10131a] px-4 py-3 text-sm leading-6 text-slate-100 placeholder:text-slate-500 shadow-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
            />
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t border-slate-800 bg-white/[0.02] px-6 py-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-medium text-slate-300">
              已选择 {currentStyle.label} · {currentScene.label} · {currentOrientation.label} · {currentDetail.label}
            </p>
            <p className="mt-1 text-xs text-slate-500">主按钮固定在底部右侧，减少来回找操作的负担。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleAiRecommend}
              disabled={taskState?.status === 'running'}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Wand2 size={14} strokeWidth={ICON_STROKE} />
              AI 推荐草案
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full bg-indigo-500 px-7 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(99,102,241,0.35)] transition-all hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.97]"
              onClick={handleDirectGenerate}
              disabled={!imageEnabled || generating || checking}
            >
              <ImageIcon size={ICON_SM} strokeWidth={ICON_STROKE} />
              生成信息图
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
