'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';

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

function GeneratingProgress({ elapsed }: { elapsed: number }) {
  const steps = [
    { label: '理解草案结构', threshold: 0 },
    { label: '生成视觉元素', threshold: 5 },
    { label: '合成图像', threshold: 15 },
    { label: '优化渲染', threshold: 30 },
  ];
  const currentStep = steps.filter((s) => elapsed >= s.threshold).length - 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center gap-2">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
        <span className="text-sm font-medium text-slate-700">正在生成信息图...</span>
        <span className="text-xs text-slate-400">{elapsed}s</span>
      </div>
      <div className="mx-auto max-w-xs space-y-1.5">
        {steps.map((step, idx) => {
          const done = idx < currentStep;
          const active = idx === currentStep;
          return (
            <div key={step.label} className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full transition-colors ${
                done ? 'bg-emerald-500' : active ? 'bg-blue-500 animate-pulse' : 'bg-slate-200'
              }`} />
              <span className={`text-xs transition-colors ${
                done ? 'text-emerald-600' : active ? 'text-blue-700 font-medium' : 'text-slate-400'
              }`}>{step.label}</span>
              {done ? <span className="text-xs text-emerald-500">✓</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function InfographicWindow({ sessionId, result, onResultUpdate }: InfographicWindowProps) {
  const payload = (result?.render?.payload || {}) as RenderPayload;
  const draftFromRaw = (result?.raw?.infographicDraft || null) as DraftPayload | null;
  const draft = payload.draft || draftFromRaw || {};
  const imageUrl = payload.image?.imageUrl || (result?.raw?.infographicImageUrl as string | undefined) || '';
  const [stylePreset, setStylePreset] = useState(draft.stylePreset || '教育学习海报，清爽明亮，信息层级明确');
  const [imageEnabled, setImageEnabled] = useState(false);
  const [imageModel, setImageModel] = useState('qwen-image-max');
  const [checking, setChecking] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genElapsed, setGenElapsed] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setChecking(true);
      const response = await fetch('/api/apps/infographic/generate-image', { method: 'GET' });
      const data = (await response.json().catch(() => ({}))) as ImageConfigResponse;
      if (cancelled) return;
      setImageEnabled(Boolean(data.enabled));
      setImageModel(data.model || 'qwen-image-max');
      setChecking(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  // 生图计时器
  useEffect(() => {
    if (!generating) { setGenElapsed(0); return; }
    const timer = setInterval(() => setGenElapsed((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, [generating]);

  const keyPoints = useMemo(() => (Array.isArray(draft.keyPoints) ? draft.keyPoints.filter(Boolean) : []), [draft.keyPoints]);
  const visualPlan = useMemo(() => (Array.isArray(draft.visualPlan) ? draft.visualPlan.filter(Boolean) : []), [draft.visualPlan]);

  const downloadImage = useCallback(async () => {
    if (!imageUrl) return;
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
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

  if (!result) {
    return <AppWindowPlaceholder status="loading" appName="信息图工坊" />;
  }

  const generateImage = async () => {
    if (!draft.imagePrompt?.trim()) {
      toast.error('草案中缺少生图提示词，请重新生成草案。');
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
          draftPrompt: draft.imagePrompt,
          stylePreset,
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
              model: data.model || imageModel,
            },
          },
        },
        raw: {
          ...(result.raw || {}),
          infographicDraft: draft,
          infographicImageUrl: data.imageUrl,
          infographicImageRequestId: data.requestId,
          infographicImageModel: data.model || imageModel,
        },
      };
      onResultUpdate(next);
      toast.success('信息图生成完成');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生图失败');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]" data-testid="infographic-window">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-700">步骤 1：结构文案预览</p>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">{draft.title || '课堂信息图草案'}</h2>
        {draft.subtitle ? <p className="mt-2 text-sm leading-6 text-slate-600">{draft.subtitle}</p> : null}

        <div className="mt-4 grid gap-3">
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">关键信息</p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {keyPoints.length > 0 ? keyPoints.map((point) => <li key={point}>• {point}</li>) : <li>暂无关键点</li>}
            </ul>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">视觉规划</p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {visualPlan.length > 0 ? visualPlan.map((item) => <li key={item}>• {item}</li>) : <li>暂无视觉规划</li>}
            </ul>
          </article>
        </div>

        <label className="mt-4 block text-sm text-slate-600">
          生图风格
          <input
            value={stylePreset}
            onChange={(event) => setStylePreset(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
        </label>

        <button
          type="button"
          className="mt-4 w-full rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2.5 text-sm font-medium text-white shadow-sm hover:from-blue-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:opacity-55 transition"
          onClick={generateImage}
          disabled={!imageEnabled || generating || checking}
        >
          {generating ? '生成中...' : imageUrl ? '重新生成图片' : '步骤 2：确认并生成图片'}
        </button>
        {!imageEnabled ? (
          <p className="mt-2 text-xs text-amber-700">
            文案预览可用；未配置 `DASHSCOPE_API_KEY`，暂不可生图。
          </p>
        ) : (
          <p className="mt-2 text-xs text-slate-500">当前生图模型：{imageModel}</p>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">结果预览</p>
          {imageUrl ? (
            <button
              type="button"
              onClick={downloadImage}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              下载图片
            </button>
          ) : null}
        </div>

        {generating ? (
          <div className="mt-3 flex min-h-72 items-center justify-center rounded-xl border border-dashed border-blue-300 bg-blue-50/30">
            <GeneratingProgress elapsed={genElapsed} />
          </div>
        ) : imageUrl ? (
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
            <Image src={imageUrl} alt={draft.title || '课堂信息图'} width={1200} height={1200} className="h-auto w-full object-cover" unoptimized />
          </div>
        ) : (
          <div className="mt-3 flex min-h-72 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50">
            <svg className="h-10 w-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
            <p className="text-sm text-slate-500">确认草案后点击生成</p>
          </div>
        )}
      </div>
    </section>
  );
}
