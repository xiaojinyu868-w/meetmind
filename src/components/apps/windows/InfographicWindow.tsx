'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, ImageIcon, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import type { AppExecutionResult } from '@/lib/ai-native/types';
import { COPY } from '@/lib/ui/copy';
import {
  type DraftPayload,
  type ImageConfigResponse,
  type InfographicWindowProps,
  type RenderPayload,
  ICON_SM,
  ICON_STROKE,
  ORIENTATIONS,
  STYLE_PRESETS,
  buildFallbackDraft,
  buildSyntheticResult,
  resolveInfographicGenerationBase,
  resolveStylePresetKey,
} from './infographic-window-data';

function PreparingState() {
  return (
    <section
      className="flex h-full items-center justify-center bg-canvas px-6"
      data-testid="infographic-window"
    >
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-pine-mist text-pine">
          <Loader2 size={26} strokeWidth={2} className="animate-spin" />
        </div>
        <p className="mt-4 text-[15px] font-semibold text-ink">{COPY.apps.infographic.preparing}</p>
        <p className="mt-1.5 text-[12px] leading-6 text-ink-muted">{COPY.apps.infographic.preparingHint}</p>
      </div>
    </section>
  );
}

export function InfographicWindow({
  sessionId,
  result,
  taskState,
  contentContext,
  onGenerateDraft,
  onResultUpdate,
}: InfographicWindowProps) {
  const payload = useMemo(
    () => (result?.render?.payload || {}) as RenderPayload,
    [result?.render?.payload],
  );
  const draftFromRaw = (result?.raw?.infographicDraft || null) as DraftPayload | null;
  const aiDraft = useMemo(
    () => payload.draft || draftFromRaw || null,
    [payload.draft, draftFromRaw],
  );
  const imageUrl = payload.image?.imageUrl
    || (result?.raw?.infographicImageUrl as string | undefined)
    || (typeof window !== 'undefined'
      ? sessionStorage.getItem(`mm_infographic_img:${sessionId}`) || ''
      : '');

  const [orientation, setOrientation] = useState<'landscape' | 'portrait' | 'square'>(
    aiDraft?.suggestedOrientation || 'portrait',
  );
  const [detailLevel, setDetailLevel] = useState<'concise' | 'standard' | 'detailed'>(
    aiDraft?.suggestedDetailLevel || 'standard',
  );
  const [scenePreset, setScenePreset] = useState(aiDraft?.suggestedScene || 'class-take-away');
  const [stylePreset, setStylePreset] = useState(resolveStylePresetKey(aiDraft?.stylePreset));
  const [customDesc, setCustomDesc] = useState('');
  const [customizeMode, setCustomizeMode] = useState(false);
  const [imageEnabled, setImageEnabled] = useState(false);
  const [checking, setChecking] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [previewMode, setPreviewMode] = useState<'fit' | 'full'>('fit');

  useEffect(() => {
    let cancelled = false;
    const checkImageService = async () => {
      setChecking(true);
      try {
        const response = await fetch('/api/apps/infographic/generate-image', { method: 'GET' });
        const data = (await response.json().catch(() => ({}))) as ImageConfigResponse;
        if (!cancelled) setImageEnabled(Boolean(data.enabled));
      } catch {
        if (!cancelled) setImageEnabled(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    };
    void checkImageService();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (aiDraft?.suggestedScene) setScenePreset(aiDraft.suggestedScene);
    if (aiDraft?.suggestedOrientation) setOrientation(aiDraft.suggestedOrientation);
    if (aiDraft?.suggestedDetailLevel) setDetailLevel(aiDraft.suggestedDetailLevel);
    if (aiDraft?.stylePreset) setStylePreset(resolveStylePresetKey(aiDraft.stylePreset));
  }, [
    aiDraft?.stylePreset,
    aiDraft?.suggestedDetailLevel,
    aiDraft?.suggestedOrientation,
    aiDraft?.suggestedScene,
  ]);

  useEffect(() => {
    if (imageUrl) setPreviewMode('fit');
  }, [imageUrl]);

  const previewDraft = useMemo(
    () => aiDraft || buildFallbackDraft({ contentContext, scenePreset, orientation, detailLevel }),
    [aiDraft, contentContext, detailLevel, orientation, scenePreset],
  );
  const currentStyle = STYLE_PRESETS.find((item) => item.key === stylePreset) || STYLE_PRESETS[0];

  const copyReadableDraft = useCallback(async () => {
    const lines = [
      previewDraft.title,
      previewDraft.subtitle,
      ...(previewDraft.keyPoints || []).map((point, index) => `${index + 1}. ${point}`),
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success(COPY.apps.infographic.readableCopied);
    } catch {
      toast.error(COPY.apps.infographic.readableCopyFailed);
    }
  }, [previewDraft]);

  const downloadImage = useCallback(async () => {
    if (!imageUrl) return;
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${previewDraft.title || COPY.apps.infographic.appName}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      toast.success(COPY.apps.infographic.downloaded);
    } catch {
      toast.error(COPY.apps.infographic.downloadFailed);
    }
  }, [imageUrl, previewDraft.title]);

  const requestImage = useCallback(async (baseResult: AppExecutionResult | null = result) => {
    const basePayload = ((baseResult?.render?.payload || {}) as RenderPayload) || {};
    const baseDraftFromRaw = (baseResult?.raw?.infographicDraft || null) as DraftPayload | null;
    const fallbackDraft = buildFallbackDraft({ contentContext, scenePreset, orientation, detailLevel });
    const sourceDraft = basePayload.draft || baseDraftFromRaw || fallbackDraft;
    const mergedDraft: DraftPayload = {
      ...fallbackDraft,
      ...sourceDraft,
      stylePreset: currentStyle.prompt || sourceDraft.stylePreset || fallbackDraft.stylePreset,
      suggestedScene: scenePreset,
      suggestedOrientation: orientation,
      suggestedDetailLevel: detailLevel,
    };
    const basePrompt = mergedDraft.imagePrompt?.trim()
      || fallbackDraft.imagePrompt?.trim()
      || mergedDraft.title?.trim()
      || '';
    const finalPrompt = customDesc.trim()
      ? `${basePrompt}\n\n用户补充要求：${customDesc.trim()}`
      : basePrompt;

    if (!finalPrompt.trim()) {
      toast.error(COPY.apps.infographic.missingContext);
      return;
    }

    setGenerating(true);
    setImageFailed(false);
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
          language: '中文（简体）',
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
        throw new Error(data?.error || COPY.apps.infographic.generateFailed);
      }

      try {
        sessionStorage.setItem(`mm_infographic_img:${sessionId}`, data.imageUrl);
      } catch {
        // The in-memory result remains available even when browser storage is full.
      }
      onResultUpdate(buildSyntheticResult({
        baseResult,
        draft: mergedDraft,
        image: { imageUrl: data.imageUrl, requestId: data.requestId, model: data.model },
      }));
      setCustomizeMode(false);
      setImageFailed(false);
      toast.success(COPY.apps.infographic.finished);
    } catch {
      toast.error(COPY.apps.infographic.generateFailed);
      setImageFailed(true);
      setCustomizeMode(false);
    } finally {
      setGenerating(false);
    }
  }, [
    contentContext,
    currentStyle.prompt,
    customDesc,
    detailLevel,
    onResultUpdate,
    orientation,
    result,
    scenePreset,
    sessionId,
  ]);

  const hasAutoStartedRef = useRef(false);
  useEffect(() => {
    if (hasAutoStartedRef.current || customizeMode || !result || !imageEnabled || imageUrl) return;
    if (generating || checking || taskState?.status === 'running') return;
    hasAutoStartedRef.current = true;
    void requestImage(result);
  }, [
    checking,
    customizeMode,
    generating,
    imageEnabled,
    imageUrl,
    requestImage,
    result,
    taskState?.status,
  ]);

  const generateFromCurrentContext = useCallback(async () => {
    setGenerating(true);
    try {
      const baseResult = await resolveInfographicGenerationBase(result, onGenerateDraft);
      if (!baseResult && onGenerateDraft) {
        setImageFailed(true);
        toast.error(COPY.apps.infographic.generateFailed);
        return;
      }
      await requestImage(baseResult);
    } catch {
      setImageFailed(true);
      toast.error(COPY.apps.infographic.generateFailed);
    } finally {
      setGenerating(false);
    }
  }, [onGenerateDraft, requestImage, result]);

  if ((taskState?.status === 'running' && !result) || generating || checking) {
    return <PreparingState />;
  }

  if (imageUrl && !customizeMode) {
    return (
      <section
        className="flex h-full min-h-0 flex-col bg-canvas px-3 pb-4 sm:px-5"
        data-testid="infographic-window"
      >
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-divider py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-[14px] font-semibold text-ink">
                {previewDraft.title || COPY.apps.infographic.appName}
              </p>
              <span className="inline-flex items-center gap-1 rounded-full bg-pine-mist px-2 py-0.5 text-[10px] font-medium text-pine">
                <Check size={11} strokeWidth={2.5} />
                {COPY.apps.infographic.finished}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="inline-flex rounded-full border border-divider bg-card p-0.5">
              {(['fit', 'full'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPreviewMode(mode)}
                  className={`rounded-full px-2.5 py-1.5 text-[11px] font-medium transition ${
                    previewMode === mode ? 'bg-ink text-canvas' : 'text-ink-muted'
                  }`}
                >
                  {mode === 'fit' ? COPY.apps.infographic.fit : COPY.apps.infographic.full}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={downloadImage}
              aria-label={COPY.apps.infographic.save}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-divider bg-card px-3 text-[11px] font-medium text-ink"
            >
              <Download size={14} strokeWidth={ICON_STROKE} />
              <span className="hidden sm:inline">{COPY.apps.infographic.save}</span>
            </button>
            <button
              type="button"
              onClick={() => setCustomizeMode(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-pine px-3 text-[11px] font-medium text-white"
            >
              <RefreshCw size={13} strokeWidth={ICON_STROKE} />
              {COPY.apps.infographic.adjust}
            </button>
          </div>
        </header>

        <div className={`min-h-0 flex-1 ${previewMode === 'fit' ? 'overflow-hidden' : 'overflow-auto'}`}>
          <div className="flex min-h-full items-center justify-center py-4">
            <img
              src={imageUrl}
              alt={previewDraft.title || COPY.apps.infographic.appName}
              className={previewMode === 'fit'
                ? 'h-auto max-h-full w-auto max-w-full rounded-2xl border border-divider object-contain'
                : 'h-auto max-w-none rounded-2xl border border-divider object-contain'}
            />
          </div>
        </div>
      </section>
    );
  }

  if (!customizeMode && (imageFailed || !imageEnabled)) {
    const keyPoints = (previewDraft.keyPoints || []).slice(0, 5);
    return (
      <section
        className="h-full overflow-auto bg-canvas px-4 py-5 sm:px-6"
        data-testid="infographic-window"
      >
        <div className="mx-auto max-w-xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-ink">{COPY.apps.infographic.readableReady}</p>
              <p className="mt-0.5 text-[11px] leading-5 text-ink-muted">{COPY.apps.infographic.readableHint}</p>
            </div>
            <button
              type="button"
              onClick={() => setCustomizeMode(true)}
              className="shrink-0 rounded-full border border-divider bg-card px-3 py-1.5 text-[11px] font-medium text-ink-secondary"
            >
              {COPY.apps.infographic.adjust}
            </button>
          </div>

          <article className="overflow-hidden rounded-[28px] border border-pine/20 bg-paper shadow-soft">
            <div className="border-b border-pine/15 bg-pine px-5 py-5 text-white">
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-white/65">MeetMind · {COPY.apps.infographic.appName}</p>
              <h2 className="mt-3 font-serif text-[26px] leading-[1.16] tracking-[-0.02em]">
                {previewDraft.title || COPY.apps.infographic.appName}
              </h2>
              {previewDraft.subtitle ? (
                <p className="mt-2 text-[12px] leading-6 text-white/75">{previewDraft.subtitle}</p>
              ) : null}
            </div>
            <div className="space-y-3 p-4">
              {keyPoints.map((point, index) => (
                <div key={`${point}-${index}`} className="flex gap-3 rounded-2xl border border-divider/80 bg-white px-4 py-3.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-vermilion-mist font-mono text-[11px] font-semibold text-vermilion">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <p className="pt-0.5 text-[13px] leading-6 text-ink-secondary">{point}</p>
                </div>
              ))}
            </div>
          </article>

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => void copyReadableDraft()}
              className="inline-flex items-center gap-1.5 rounded-full border border-divider bg-card px-3.5 py-2 text-[11px] font-medium text-ink-secondary"
            >
              <Copy size={13} strokeWidth={ICON_STROKE} />
              {COPY.apps.infographic.copyReadable}
            </button>
            {imageEnabled ? (
              <button
                type="button"
                onClick={() => void requestImage(result)}
                className="inline-flex items-center gap-1.5 rounded-full bg-pine px-3.5 py-2 text-[11px] font-medium text-white"
              >
                <RefreshCw size={13} strokeWidth={ICON_STROKE} />
                {COPY.apps.infographic.retryImage}
              </button>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="h-full overflow-auto bg-canvas px-4 py-6 sm:px-6"
      data-testid="infographic-window"
    >
      <div className="mx-auto max-w-2xl rounded-[24px] border border-divider bg-card p-5 sm:p-7">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-pine-mist text-pine">
            <Sparkles size={20} strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="text-[17px] font-semibold text-ink">
              {result ? COPY.apps.infographic.adjustTitle : COPY.apps.infographic.createTitle}
            </h2>
            <p className="mt-1 text-[12px] leading-6 text-ink-muted">
              {result ? COPY.apps.infographic.adjustHint : COPY.apps.infographic.createHint}
            </p>
          </div>
        </div>

        {taskState?.status === 'error' ? (
          <div className="mt-5 rounded-2xl bg-vermilion-mist px-4 py-3 text-[12px] leading-6 text-vermilion">
            {COPY.apps.infographic.generateFailed}
          </div>
        ) : null}

        {!imageEnabled ? (
          <div className="mt-5 rounded-2xl border border-divider bg-canvas px-4 py-3">
            <p className="text-[13px] font-medium text-ink">{COPY.apps.infographic.serviceUnavailable}</p>
            <p className="mt-1 text-[12px] leading-6 text-ink-muted">{COPY.apps.infographic.serviceUnavailableBody}</p>
          </div>
        ) : null}

        <div className="mt-6 space-y-6">
          <div>
            <p className="text-[12px] font-medium text-ink">{COPY.apps.infographic.orientation}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {ORIENTATIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setOrientation(option.value)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-[12px] font-medium transition ${
                    orientation === option.value
                      ? 'border-pine bg-pine-mist text-pine'
                      : 'border-divider bg-canvas text-ink-muted'
                  }`}
                >
                  {orientation === option.value ? <Check size={12} strokeWidth={2.5} /> : null}
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[12px] font-medium text-ink">{COPY.apps.infographic.style}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {STYLE_PRESETS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setStylePreset(item.key)}
                  className={`rounded-full border px-3 py-2 text-[12px] font-medium transition ${
                    stylePreset === item.key
                      ? 'border-pine bg-pine-mist text-pine'
                      : 'border-divider bg-canvas text-ink-muted'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-[12px] font-medium text-ink">{COPY.apps.infographic.custom}</span>
            <textarea
              value={customDesc}
              onChange={(event) => setCustomDesc(event.target.value)}
              placeholder={COPY.apps.infographic.customPlaceholder}
              rows={3}
              className="mt-2 w-full resize-none rounded-2xl border border-divider bg-canvas px-4 py-3 text-[13px] leading-6 text-ink outline-none placeholder:text-ink-faint focus:border-pine"
            />
          </label>
        </div>

        <div className="mt-7 flex justify-end">
          <button
            type="button"
            onClick={() => {
              setCustomizeMode(false);
              void generateFromCurrentContext();
            }}
            disabled={!imageEnabled || generating}
            className="inline-flex items-center gap-2 rounded-full bg-pine px-5 py-2.5 text-[13px] font-semibold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ImageIcon size={ICON_SM} strokeWidth={ICON_STROKE} />
            {result ? COPY.apps.infographic.regenerate : COPY.apps.infographic.generate}
          </button>
        </div>
      </div>
    </section>
  );
}
