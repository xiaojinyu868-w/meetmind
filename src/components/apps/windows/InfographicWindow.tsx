'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import type { AppExecutionResult } from '@/lib/ai-native/types';

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

  const keyPoints = useMemo(() => (Array.isArray(draft.keyPoints) ? draft.keyPoints.filter(Boolean) : []), [draft.keyPoints]);
  const visualPlan = useMemo(() => (Array.isArray(draft.visualPlan) ? draft.visualPlan.filter(Boolean) : []), [draft.visualPlan]);

  if (!result) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">正在生成信息图草案...</div>;
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
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <button
          type="button"
          className="mt-4 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-55"
          onClick={generateImage}
          disabled={!imageEnabled || generating || checking}
        >
          {generating ? '生图中...' : '步骤 2：确认并生成图片'}
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
        <p className="text-sm font-medium text-slate-700">结果预览</p>
        {imageUrl ? (
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
            <Image src={imageUrl} alt={draft.title || '课堂信息图'} width={1200} height={1200} className="h-auto w-full object-cover" unoptimized />
          </div>
        ) : (
          <div className="mt-3 flex min-h-72 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
            还没有图片，先确认草案后生成
          </div>
        )}
      </div>
    </section>
  );
}
