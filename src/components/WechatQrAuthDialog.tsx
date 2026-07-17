'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import Image from 'next/image';
import { Check, RefreshCw, ScanLine, X } from 'lucide-react';
import { useCallback } from 'react';
import { useWechatQrAuth, type WechatQrClientPhase } from '@/lib/hooks/useWechatQrAuth';
import { COPY } from '@/lib/ui/copy';

interface WechatQrAuthDialogProps {
  open: boolean;
  mode: 'login' | 'bind';
  onClose: () => void;
  redirectTo?: string;
  onBound?: () => void;
}

function statusCopy(phase: WechatQrClientPhase): string {
  if (phase === 'loading') return COPY.wechatQr.loading;
  if (phase === 'scanned') return COPY.wechatQr.scanned;
  if (phase === 'processing') return COPY.wechatQr.processing;
  if (phase === 'authenticated') return COPY.wechatQr.loginDone;
  if (phase === 'bound') return COPY.wechatQr.bindDone;
  return COPY.wechatQr.pending;
}

export function WechatQrAuthDialog({
  open,
  mode,
  onClose,
  redirectTo = '/app',
  onBound,
}: WechatQrAuthDialogProps) {
  const handleAuthenticated = useCallback(() => {
    window.location.replace(redirectTo);
  }, [redirectTo]);
  const handleBound = useCallback(() => {
    onBound?.();
  }, [onBound]);
  const state = useWechatQrAuth({
    enabled: open,
    mode,
    onAuthenticated: handleAuthenticated,
    onBound: handleBound,
  });

  const title = mode === 'login' ? COPY.wechatQr.loginTitle : COPY.wechatQr.bindTitle;
  const body = mode === 'login' ? COPY.wechatQr.loginBody : COPY.wechatQr.bindBody;
  const succeeded = state.phase === 'authenticated' || state.phase === 'bound';
  const failed = state.phase === 'expired' || state.phase === 'error';

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-ink/35 backdrop-blur-[2px]" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-[101] w-[calc(100%-2rem)] max-w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-[28px] border border-divider bg-paper p-6 outline-none">
          <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-pine/10 text-pine">
              <ScanLine className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <DialogPrimitive.Title className="text-[18px] font-semibold tracking-[-0.015em] text-ink">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
                {body}
              </DialogPrimitive.Description>
            </div>
          </div>
          <DialogPrimitive.Close asChild>
            <button
              type="button"
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-ink-muted transition hover:bg-pine/5 hover:text-ink"
              aria-label={COPY.wechatQr.close}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </DialogPrimitive.Close>
        </div>

        <div className="mt-6 flex min-h-[244px] items-center justify-center" aria-live="polite">
          {succeeded ? (
            <div className="flex flex-col items-center py-10 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-pine/25 bg-pine/10 text-pine">
                <Check className="h-8 w-8" strokeWidth={2.2} aria-hidden />
              </div>
              <p className="mt-4 text-[15px] font-medium text-ink">{statusCopy(state.phase)}</p>
            </div>
          ) : failed ? (
            <div className="flex flex-col items-center px-4 py-10 text-center">
              <p className="max-w-[250px] text-[14px] leading-relaxed text-vermilion">
                {state.error || COPY.wechatQr.failed}
              </p>
              <button
                type="button"
                onClick={state.retry}
                className="mt-5 inline-flex h-10 items-center gap-2 rounded-full border border-pine/35 bg-white px-4 text-[13px] font-medium text-pine transition hover:bg-pine/5"
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
                {COPY.wechatQr.retry}
              </button>
            </div>
          ) : state.imageUrl ? (
            <div className="rounded-[22px] border border-divider bg-white p-3">
              <Image
                src={state.imageUrl}
                alt={mode === 'login' ? COPY.wechatQr.imageAlt : COPY.wechatQr.bindImageAlt}
                width={220}
                height={220}
                unoptimized
                priority
                className="h-[220px] w-[220px] rounded-xl"
              />
            </div>
          ) : (
            <div className="flex h-[220px] w-[220px] items-center justify-center rounded-[22px] border border-divider bg-white">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-divider border-t-pine" aria-hidden />
            </div>
          )}
        </div>

        {!succeeded && !failed ? (
          <div className="mt-4 text-center" aria-live="polite">
            <div className="inline-flex items-center gap-2 text-[13px] font-medium text-ink-secondary">
              <span className={`h-2 w-2 rounded-full ${state.phase === 'scanned' || state.phase === 'processing' ? 'bg-vermilion' : 'bg-pine animate-pulse'}`} />
              {statusCopy(state.phase)}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-muted">{COPY.wechatQr.expiresHint}</p>
          </div>
        ) : null}

        {state.phase === 'bound' ? (
          <button
            type="button"
            onClick={onClose}
            className="mt-5 h-11 w-full rounded-xl bg-pine text-[14px] font-medium text-white transition hover:bg-pine-dark"
          >
            {COPY.wechatQr.close}
          </button>
        ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default WechatQrAuthDialog;
