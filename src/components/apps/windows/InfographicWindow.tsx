'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { toast } from 'sonner';

import type { AppExecutionResult } from '@/lib/ai-native/types';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { AppWindowPlaceholder } from './AppWindowPlaceholder';
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
  // 等待态与讲给同桌听的核对等待同一语言：一条呼吸的细线 + 一句话，不放图标盒子
  return (
    <section
      className="flex h-full items-center justify-center bg-canvas px-6"
      data-testid="infographic-window"
    >
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <span className="thinking-strip h-1 w-40 rounded-full" />
        <div>
          <p className="text-[14px] font-medium text-ink">{APPS_COPY.infographic.preparing}</p>
          <p className="mt-1 text-[12px] leading-6 text-ink-muted">{APPS_COPY.infographic.preparingHint}</p>
        </div>
      </div>
    </section>
  );
}

/** 两个词 + 下划线的切换（与导图顶栏、速查表工具条同一控件语言） */
function WordToggle<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (next: T) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`text-[13px] underline-offset-[5px] transition ${
              active ? 'font-medium text-ink underline decoration-ink' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
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
      toast.success(APPS_COPY.infographic.readableCopied);
    } catch {
      toast.error(APPS_COPY.infographic.readableCopyFailed);
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
      anchor.download = `${previewDraft.title || APPS_COPY.infographic.appName}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      toast.success(APPS_COPY.infographic.downloaded);
    } catch {
      toast.error(APPS_COPY.infographic.downloadFailed);
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
      toast.error(APPS_COPY.infographic.missingContext);
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
        throw new Error(data?.error || APPS_COPY.infographic.generateFailed);
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
      toast.success(APPS_COPY.infographic.finished);
    } catch {
      toast.error(APPS_COPY.infographic.generateFailed);
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
        toast.error(APPS_COPY.infographic.generateFailed);
        return;
      }
      await requestImage(baseResult);
    } catch {
      setImageFailed(true);
      toast.error(APPS_COPY.infographic.generateFailed);
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
        {/* 一张海报是主角：头部一行字，切换与动作全退成文字；去掉「做好了」徽章——图在这儿就是做好了 */}
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-divider py-3">
          <p className="min-w-0 truncate text-[14px] font-semibold text-ink">
            {previewDraft.title || APPS_COPY.infographic.appName}
          </p>
          <div className="flex items-baseline gap-4 text-[12px]">
            <WordToggle
              value={previewMode}
              onChange={setPreviewMode}
              options={[
                { value: 'fit', label: APPS_COPY.infographic.fit },
                { value: 'full', label: APPS_COPY.infographic.full },
              ]}
            />
            <span className="h-3 w-px self-center bg-divider" aria-hidden />
            <button type="button" onClick={downloadImage} className="text-ink-muted transition hover:text-ink">
              {APPS_COPY.infographic.save}
            </button>
            <button type="button" onClick={() => setCustomizeMode(true)} className="text-ink-muted transition hover:text-ink">
              {APPS_COPY.infographic.adjust}
            </button>
          </div>
        </header>

        <div className={`min-h-0 flex-1 ${previewMode === 'fit' ? 'overflow-hidden' : 'overflow-auto'}`}>
          <div className="flex min-h-full items-center justify-center py-4">
            <img
              src={imageUrl}
              alt={previewDraft.title || APPS_COPY.infographic.appName}
              className={previewMode === 'fit'
                ? 'h-auto max-h-full w-auto max-w-full rounded-[10px] object-contain shadow-card'
                : 'h-auto max-w-none rounded-[10px] object-contain shadow-card'}
            />
          </div>
        </div>
      </section>
    );
  }

  if (!customizeMode && (imageFailed || !imageEnabled) && !aiDraft) {
    // 图没出来、模型草案也没有：诚实失败。之前这里会拿转录切几句当"要点"，
    // 或者直接放「提炼课堂重点 / 梳理知识关系 / 突出关键结论」三条万能句，标成"可读版做好了"。
    return (
      <section className="h-full bg-canvas" data-testid="infographic-window">
        <AppWindowPlaceholder
          status="error"
          appName={APPS_COPY.infographic.appName}
          errorMessage={APPS_COPY.infographic.generateFailed}
          onRetry={() => void generateFromCurrentContext()}
        />
      </section>
    );
  }

  if (!customizeMode && (imageFailed || !imageEnabled)) {
    // 图没出来但模型草案在：可读版是同学真整理出的要点，不是拼的
    const keyPoints = (previewDraft.keyPoints || []).slice(0, 5);
    return (
      <section
        className="h-full overflow-auto bg-canvas px-4 py-5 sm:px-6"
        data-testid="infographic-window"
      >
        <div className="mx-auto max-w-xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-ink">{APPS_COPY.infographic.readableReady}</p>
              <p className="mt-0.5 text-[11px] leading-5 text-ink-muted">{APPS_COPY.infographic.readableHint}</p>
            </div>
            <button
              type="button"
              onClick={() => setCustomizeMode(true)}
              className="shrink-0 text-[12px] text-ink-muted transition hover:text-ink"
            >
              {APPS_COPY.infographic.adjust}
            </button>
          </div>

          <article className="overflow-hidden rounded-[28px] border border-pine/20 bg-paper shadow-soft">
            <div className="border-b border-pine/15 bg-pine px-5 py-5 text-white">
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-white/65">MeetMind · {APPS_COPY.infographic.appName}</p>
              <h2 className="mt-3 font-serif text-[26px] leading-[1.16] tracking-[-0.02em]">
                {previewDraft.title || APPS_COPY.infographic.appName}
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

          <div className="mt-4 flex flex-wrap items-baseline justify-end gap-4 text-[12px]">
            <button type="button" onClick={() => void copyReadableDraft()} className="text-ink-muted transition hover:text-ink">
              {APPS_COPY.infographic.copyReadable}
            </button>
            {imageEnabled ? (
              <button type="button" onClick={() => void requestImage(result)} className="font-medium text-pine transition hover:opacity-80">
                {APPS_COPY.infographic.retryImage}
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
      {/* 定制：不是表单，是纸上的三行字——每行左边一个词，右边几个可选的词，选中的加下划线；
          补充要求是一条可以写字的横线。页面唯一饱和的东西是右下角那一个动作。 */}
      <div className="mx-auto max-w-xl pt-2">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
          {result ? APPS_COPY.infographic.adjustTitle : APPS_COPY.infographic.createTitle}
        </h2>
        <p className="mt-1 text-[12px] leading-6 text-ink-muted">
          {result ? APPS_COPY.infographic.adjustHint : APPS_COPY.infographic.createHint}
        </p>

        {taskState?.status === 'error' ? (
          <p className="mt-4 border-l-2 border-vermilion pl-3 text-[12px] leading-6 text-vermilion">
            {APPS_COPY.infographic.generateFailed}
          </p>
        ) : null}

        {!imageEnabled ? (
          <div className="mt-4 border-l-2 border-divider pl-3">
            <p className="text-[13px] font-medium text-ink">{APPS_COPY.infographic.serviceUnavailable}</p>
            <p className="mt-0.5 text-[12px] leading-6 text-ink-muted">{APPS_COPY.infographic.serviceUnavailableBody}</p>
          </div>
        ) : null}

        <dl className="mt-7 divide-y divide-divider">
          <div className="grid grid-cols-[64px_1fr] items-baseline gap-4 py-3.5">
            <dt className="text-[12px] text-ink-muted">{APPS_COPY.infographic.orientation}</dt>
            <dd>
              <WordToggle
                value={orientation}
                onChange={setOrientation}
                options={ORIENTATIONS.map((option) => ({ value: option.value, label: option.label }))}
              />
            </dd>
          </div>
          <div className="grid grid-cols-[64px_1fr] items-baseline gap-4 py-3.5">
            <dt className="text-[12px] text-ink-muted">{APPS_COPY.infographic.style}</dt>
            <dd>
              <WordToggle
                value={stylePreset}
                onChange={setStylePreset}
                options={STYLE_PRESETS.map((item) => ({ value: item.key, label: item.label }))}
              />
            </dd>
          </div>
          <div className="grid grid-cols-[64px_1fr] items-start gap-4 py-3.5">
            <dt className="pt-1.5 text-[12px] text-ink-muted">{APPS_COPY.infographic.custom}</dt>
            <dd>
              <textarea
                value={customDesc}
                onChange={(event) => setCustomDesc(event.target.value)}
                placeholder={APPS_COPY.infographic.customPlaceholder}
                rows={2}
                className="w-full resize-none border-b border-divider bg-transparent px-0 py-1.5 text-[13px] leading-6 text-ink outline-none transition placeholder:text-ink-faint focus:border-ink"
              />
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex justify-end">
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
            {result ? APPS_COPY.infographic.regenerate : APPS_COPY.infographic.generate}
          </button>
        </div>
      </div>
    </section>
  );
}
