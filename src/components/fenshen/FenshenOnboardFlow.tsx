'use client';

/**
 * FenshenOnboardFlow — 请分身三选一：名人堂（首发只有孔子）/ 贴 B 站链接 /
 * 上传录音。提交走 POST /api/fenshen/egos（upload 轨先经 /api/upload-audio 拿
 * sourceRef）。建行成功后由父层切到该分身的对话/进度视图。
 */

import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { COPY } from '@/lib/ui/copy';
import { fenshenCreateEgo, fenshenUploadAudio } from './fenshen-client';
import type { FenshenEgoDto, FenshenSourceType } from './fenshen-events';

type Track = FenshenSourceType;

// 名人堂首发只有孔子一位（产品已拍板；扩容时往这里加）
const HALL_NAMES = [COPY.fenshen.hallConfucius] as const;

interface FenshenOnboardFlowProps {
  onCreated: (ego: FenshenEgoDto) => void;
  onCancel: () => void;
}

export function FenshenOnboardFlow({ onCreated, onCancel }: FenshenOnboardFlowProps) {
  const [track, setTrack] = useState<Track>('hall');
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(
    async (payload: { name: string; sourceType: FenshenSourceType; sourceRef?: string }) => {
      if (submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const ego = await fenshenCreateEgo(payload);
        onCreated(ego);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : COPY.fenshen.createFailed);
      } finally {
        setSubmitting(false);
      }
    },
    [onCreated, submitting],
  );

  const handleSubmit = useCallback(async () => {
    if (track === 'bilibili') {
      if (!name.trim() || !link.trim()) return;
      await submit({ name: name.trim(), sourceType: 'bilibili', sourceRef: link.trim() });
      return;
    }
    if (track === 'upload') {
      if (!name.trim()) return;
      if (!file) {
        setError(COPY.fenshen.uploadMissing);
        return;
      }
      if (submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const sourceRef = await fenshenUploadAudio(file);
        const ego = await fenshenCreateEgo({ name: name.trim(), sourceType: 'upload', sourceRef });
        onCreated(ego);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : COPY.fenshen.createFailed);
      } finally {
        setSubmitting(false);
      }
    }
  }, [file, link, name, onCreated, submit, submitting, track]);

  const tabs: Array<{ key: Track; label: string }> = [
    { key: 'hall', label: COPY.fenshen.tabHall },
    { key: 'bilibili', label: COPY.fenshen.tabBilibili },
    { key: 'upload', label: COPY.fenshen.tabUpload },
  ];

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 py-6">
      <p className="text-[13px] leading-relaxed text-ink-secondary">{COPY.fenshen.onboardBody}</p>

      <div className="mt-5 flex gap-1.5" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={track === tab.key}
            onClick={() => {
              setTrack(tab.key);
              setError(null);
            }}
            className={cn(
              'rounded-full border px-3 py-1.5 text-[12px] transition-colors',
              track === tab.key
                ? 'border-pine/50 bg-pine-mist text-pine'
                : 'border-divider bg-card text-ink-secondary hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-6 flex-1">
        {track === 'hall' ? (
          <div className="grid grid-cols-1 gap-2">
            {HALL_NAMES.map((hallName) => (
              <button
                key={hallName}
                type="button"
                disabled={submitting}
                onClick={() => void submit({ name: hallName, sourceType: 'hall' })}
                className={cn(
                  'flex min-h-[72px] items-center justify-center rounded-2xl border border-divider bg-card',
                  'text-[14px] font-medium text-ink transition hover:border-pine/40 hover:-translate-y-[1px]',
                  'disabled:opacity-50',
                )}
              >
                {hallName}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] text-ink-muted">{COPY.fenshen.nameLabel}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={COPY.fenshen.namePlaceholder}
                maxLength={50}
                className="rounded-lg border border-divider bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-pine/50"
              />
            </label>
            {track === 'bilibili' ? (
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] text-ink-muted">{COPY.fenshen.bilibiliLabel}</span>
                <input
                  value={link}
                  onChange={(event) => setLink(event.target.value)}
                  placeholder={COPY.fenshen.bilibiliPlaceholder}
                  className="rounded-lg border border-divider bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-pine/50"
                />
              </label>
            ) : (
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] text-ink-muted">{COPY.fenshen.uploadLabel}</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg border border-dashed border-divider bg-card px-3 py-2.5 text-left text-[13px] text-ink-secondary transition hover:border-pine/40 hover:text-ink"
                >
                  {file ? file.name : COPY.fenshen.uploadPick}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {error ? <p className="mt-3 text-[12px] text-vermilion">{error}</p> : null}

      {track !== 'hall' ? (
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="naked" onClick={onCancel} disabled={submitting}>
            {COPY.fenshen.back}
          </Button>
          <Button
            variant="pine"
            loading={submitting}
            disabled={track === 'bilibili' ? !name.trim() || !link.trim() : !name.trim()}
            onClick={() => void handleSubmit()}
          >
            {submitting ? COPY.fenshen.submitting : COPY.fenshen.submit}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
