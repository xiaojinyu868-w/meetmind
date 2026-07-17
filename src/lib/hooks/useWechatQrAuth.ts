'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createWechatQrChallenge,
  pollWechatQrChallenge,
} from '@/lib/services/wechat-qr-auth-client';
import type { WechatQrAuthMode } from '@/lib/services/wechat-qr-auth-service';
import { readStoredAccessToken, writeStoredAccessToken } from '@/lib/hooks/useAuth';
import { COPY } from '@/lib/ui/copy';

export type WechatQrClientPhase =
  | 'idle'
  | 'loading'
  | 'pending'
  | 'scanned'
  | 'processing'
  | 'authenticated'
  | 'bound'
  | 'expired'
  | 'error';

interface WechatQrClientState {
  phase: WechatQrClientPhase;
  imageUrl: string | null;
  error: string | null;
}

const INITIAL_STATE: WechatQrClientState = {
  phase: 'idle',
  imageUrl: null,
  error: null,
};

export function useWechatQrAuth(input: {
  enabled: boolean;
  mode: WechatQrAuthMode;
  onAuthenticated?: () => void;
  onBound?: () => void;
}) {
  const [state, setState] = useState<WechatQrClientState>(INITIAL_STATE);
  const [retryKey, setRetryKey] = useState(0);
  const onAuthenticatedRef = useRef(input.onAuthenticated);
  const onBoundRef = useRef(input.onBound);
  const clientNonceRef = useRef<string | null>(null);
  if (!clientNonceRef.current) {
    clientNonceRef.current = globalThis.crypto?.randomUUID?.()
      || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
  }

  useEffect(() => {
    onAuthenticatedRef.current = input.onAuthenticated;
    onBoundRef.current = input.onBound;
  }, [input.onAuthenticated, input.onBound]);

  useEffect(() => {
    if (!input.enabled) {
      setState(INITIAL_STATE);
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let consecutivePollFailures = 0;

    const schedulePoll = (challengeId: string, delay = 1600) => {
      pollTimer = setTimeout(() => { void poll(challengeId); }, delay);
    };

    const poll = async (challengeId: string): Promise<void> => {
      try {
        const result = await pollWechatQrChallenge({ challengeId });
        if (cancelled) return;
        consecutivePollFailures = 0;

        if (result.status === 'consumed') {
          setState((current) => ({ ...current, phase: 'error', error: COPY.wechatQr.failed }));
          return;
        }
        if (result.status === 'pending') {
          setState((current) => ({ ...current, phase: 'pending' }));
          schedulePoll(challengeId);
          return;
        }
        if (result.status === 'scanned' || result.status === 'processing') {
          const phase: WechatQrClientPhase = result.status === 'scanned' ? 'scanned' : 'processing';
          setState((current) => ({ ...current, phase }));
          schedulePoll(challengeId);
          return;
        }
        if (result.status === 'authenticated' && result.accessToken) {
          writeStoredAccessToken(result.accessToken);
          setState((current) => ({ ...current, phase: 'authenticated' }));
          onAuthenticatedRef.current?.();
          return;
        }
        if (result.status === 'bound') {
          setState((current) => ({ ...current, phase: 'bound' }));
          onBoundRef.current?.();
          return;
        }
        if (result.status === 'expired') {
          setState((current) => ({ ...current, phase: 'expired', error: COPY.wechatQr.expired }));
          return;
        }

        setState((current) => ({
          ...current,
          phase: 'error',
          error: result.error || COPY.wechatQr.failed,
        }));
      } catch {
        if (cancelled) return;
        consecutivePollFailures += 1;
        if (consecutivePollFailures <= 3) {
          schedulePoll(challengeId, 1200 * (2 ** consecutivePollFailures));
          return;
        }
        setState((current) => ({ ...current, phase: 'error', error: COPY.wechatQr.failed }));
      }
    };

    const start = async (): Promise<void> => {
      setState({ phase: 'loading', imageUrl: null, error: null });
      try {
        const challenge = await createWechatQrChallenge({
          mode: input.mode,
          accessToken: input.mode === 'bind' ? readStoredAccessToken() : null,
          clientNonce: clientNonceRef.current || undefined,
        });
        if (cancelled) return;
        setState({ phase: 'pending', imageUrl: challenge.imageUrl, error: null });
        schedulePoll(challenge.challengeId);
      } catch (error) {
        if (cancelled) return;
        setState({
          phase: 'error',
          imageUrl: null,
          error: error instanceof Error ? error.message : COPY.wechatQr.failed,
        });
      }
    };

    void start();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [input.enabled, input.mode, retryKey]);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  return { ...state, retry };
}

export default useWechatQrAuth;
