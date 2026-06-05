'use client';

/**
 * useShareAgentCreator — create a SharedAgent and copy the public link.
 *
 * The share interaction is intentionally link-first: one click creates the
 * share and copies the URL. A lightweight fallback dialog is shown only when
 * the clipboard write fails.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/hooks/useAuth';
import { COPY } from '@/lib/ui/copy';
import type { SharedAgentSnapshot } from '@/lib/services/share-agent-service';

export interface UseShareAgentCreatorReturn {
  /** Whether /api/share/agent is in flight. */
  isCreating: boolean;
  /** Create the share and copy its public link. */
  openCreator: (snapshot: SharedAgentSnapshot) => Promise<void>;
  /** Fallback dialog, rendered only when automatic copy fails. */
  modal: React.ReactNode;
}

interface CopyFallback {
  title: string;
  shareUrl: string;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function ShareLinkFallbackDialog({
  fallback,
  onClose,
}: {
  fallback: CopyFallback;
  onClose: () => void;
}) {
  const [copying, setCopying] = React.useState(false);

  const handleCopy = React.useCallback(async () => {
    setCopying(true);
    const ok = await copyText(fallback.shareUrl);
    setCopying(false);
    if (ok) {
      toast.success(COPY.share.creator.doneCopied);
      onClose();
    } else {
      toast.error(COPY.share.creator.doneCopyFailed);
    }
  }, [fallback.shareUrl, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="w-full max-w-[420px] rounded-2xl bg-white p-5 shadow-card">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-ink">{COPY.share.creator.fallbackTitle}</p>
            <p className="mt-1 text-[12.5px] leading-5 text-ink-muted">
              {COPY.share.creator.fallbackBody}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition hover:bg-canvas hover:text-ink"
            aria-label="关闭"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <label className="mt-4 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
          {fallback.title}
        </label>
        <input
          readOnly
          value={fallback.shareUrl}
          onFocus={(event) => event.currentTarget.select()}
          className="mt-2 w-full rounded-xl border border-divider bg-canvas px-3 py-2.5 text-[13px] text-ink outline-none focus:border-pine"
        />
        <button
          type="button"
          onClick={handleCopy}
          disabled={copying}
          className="mt-4 w-full rounded-full bg-ink px-4 py-3 text-[14px] font-semibold text-white transition hover:bg-pine-deep active:scale-[0.99] disabled:opacity-60"
        >
          {copying ? COPY.share.creator.doneCopying : COPY.share.creator.doneCopy}
        </button>
      </section>
    </div>
  );
}

export function useShareAgentCreator(): UseShareAgentCreatorReturn {
  const { isAuthenticated, accessToken } = useAuth();
  const [isCreating, setIsCreating] = React.useState(false);
  const [fallback, setFallback] = React.useState<CopyFallback | null>(null);

  const openCreator = React.useCallback<UseShareAgentCreatorReturn['openCreator']>(
    async (snapshot) => {
      if (!isAuthenticated || !accessToken) {
        toast.error(COPY.share.creator.loginRequired);
        return;
      }
      setIsCreating(true);
      try {
        const res = await fetch('/api/share/agent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ snapshot }),
        });
        if (!res.ok) {
          const detail = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(detail.error || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { success: boolean; token: string; shareUrl: string };
        const copied = await copyText(data.shareUrl);
        if (copied) {
          setFallback(null);
          toast.success(COPY.share.creator.doneCopied);
          return;
        }
        setFallback({
          title: snapshot.title,
          shareUrl: data.shareUrl,
        });
        toast.message(COPY.share.creator.doneLinkCreated);
      } catch (err) {
        const msg = err instanceof Error ? err.message : COPY.share.creator.createFailed;
        toast.error(msg);
      } finally {
        setIsCreating(false);
      }
    },
    [accessToken, isAuthenticated],
  );

  const handleClose = React.useCallback(() => setFallback(null), []);

  const modal = fallback ? (
    <ShareLinkFallbackDialog fallback={fallback} onClose={handleClose} />
  ) : null;

  return { isCreating, openCreator, modal };
}
